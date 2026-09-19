"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { RosterPersonPicker } from "./RosterPersonPicker";
import { AudienceGroupPicker } from "./AudienceGroupPicker";
import {
  createCustomWeeklyRuleAction,
  updateCustomWeeklyRuleAction,
  type CustomWeeklyRuleActionResult,
  type CustomWeeklyRuleView,
} from "@/lib/notifications/ruleActions";
import { BROADCAST_BODY_MAX_LENGTH, BROADCAST_TITLE_MAX_LENGTH } from "@/lib/notifications/manualBroadcastLimits";
import { computeAudienceSummary } from "@/lib/presentation/managerBroadcast";
import type { ManagerAdoptionPersonView, ManagerPersonSummary } from "@/lib/readModels/managerTypes";
import type { AudienceGroupKey } from "@/lib/domain/audienceGroups";
import { resolveAudienceGroupMembers } from "@/lib/domain/audienceGroups";

type AudienceKind = "person" | "people" | "everyone" | "groups";

interface ManagerRecurringRuleComposerProps {
  roster: ManagerPersonSummary[];
  adoptionPeople: ManagerAdoptionPersonView[];
  editingRule: CustomWeeklyRuleView | null;
  onSaved: () => void;
  onCancel: () => void;
}

const AUDIENCE_OPTIONS: { value: AudienceKind; label: string }[] = [
  { value: "person", label: "אדם מסוים" },
  { value: "people", label: "כמה אנשים" },
  { value: "groups", label: "לפי קבוצות" },
  { value: "everyone", label: "כולם" },
];

const WEEKDAY_OPTIONS = [
  { value: 0, label: "ראשון" },
  { value: 1, label: "שני" },
  { value: 2, label: "שלישי" },
  { value: 3, label: "רביעי" },
  { value: 4, label: "חמישי" },
  { value: 5, label: "שישי" },
  { value: 6, label: "שבת" },
];

const ERROR_LABELS: Record<string, string> = {
  invalid_request: "הבקשה אינה תקינה. נסה/י שוב.",
  forbidden: "רק מנהל/ת יכול/ה לנהל התראות מחזוריות.",
  unauthenticated: "יש להתחבר מחדש.",
  invalid_title: `כותרת ההתראה חייבת להיות בין 1 ל-${BROADCAST_TITLE_MAX_LENGTH} תווים.`,
  invalid_body: `תוכן ההתראה חייב להיות בין 1 ל-${BROADCAST_BODY_MAX_LENGTH} תווים.`,
  invalid_weekday: "יש לבחור יום בשבוע.",
  invalid_schedule: "יש לבחור שעה תקינה.",
  invalid_audience: "בחירת \"אדם מסוים\" דורשת בדיוק איש/אשת צוות אחד/ת.",
  invalid_targets: "הבחירה אינה תקפה יותר. נסה/י לבחור מחדש.",
  no_targets: "לא נבחרו אנשי צוות תקפים.",
  not_found: "הכלל לא נמצא -- ייתכן שכבר הוסר.",
};

function errorLabel(error: string): string {
  return ERROR_LABELS[error] ?? "השמירה נכשלה. נסה/י שוב.";
}

function minuteOfDayToTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTimeValue(timeValue: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Create/edit form for a manager-authored weekly recurring notification --
 * V1: exactly one weekday + local time per rule (spec: "if a manager wants
 * two separate weekdays, they can create two rules"). Reuses
 * `RosterPersonPicker` for audience selection -- never a second roster-
 * selection implementation. Every real validation (title/body length,
 * weekday/time range, roster membership) happens server-side in
 * `createCustomWeeklyRuleAction`/`updateCustomWeeklyRuleAction`; this
 * component only narrows what the manager can click before submitting.
 */
export function ManagerRecurringRuleComposer({ roster, adoptionPeople, editingRule, onSaved, onCancel }: ManagerRecurringRuleComposerProps) {
  const [title, setTitle] = useState(() => editingRule?.title ?? "");
  const [body, setBody] = useState(() => editingRule?.body ?? "");
  const [weekday, setWeekday] = useState(() => editingRule?.weekday ?? 6);
  const [timeValue, setTimeValue] = useState(() =>
    editingRule ? minuteOfDayToTimeValue(editingRule.localHour, editingRule.localMinute) : "21:00",
  );
  const [audienceKind, setAudienceKind] = useState<AudienceKind>(() =>
    editingRule && editingRule.audienceKind !== "everyone" ? editingRule.audienceKind : "everyone",
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    editingRule && editingRule.audienceKind !== "everyone" && editingRule.audienceKind !== "groups" ? editingRule.targetPersonIds : [],
  );
  const [groupKeys, setGroupKeys] = useState<AudienceGroupKey[]>(() => editingRule?.audienceGroupKeys ?? []);
  const [excludedIds, setExcludedIds] = useState<string[]>(() => editingRule?.excludedPersonIds ?? []);
  const [excludeExpanded, setExcludeExpanded] = useState(() => (editingRule?.excludedPersonIds.length ?? 0) > 0);
  const [query, setQuery] = useState("");
  const [excludeQuery, setExcludeQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CustomWeeklyRuleActionResult | null>(null);
  const outcomeId = useId();

  const adoptionByPersonId = useMemo(() => new Map(adoptionPeople.map((person) => [person.personId, person])), [adoptionPeople]);
  const groupMatchIds = useMemo(() => resolveAudienceGroupMembers(roster, groupKeys).map((person) => person.id), [roster, groupKeys]);
  const baseSelectedIds = audienceKind === "everyone" ? roster.map((person) => person.id) : audienceKind === "groups" ? groupMatchIds : selectedIds;
  const excludedSet = useMemo(() => new Set(excludedIds), [excludedIds]);
  const effectiveSelectedIds = useMemo(() => baseSelectedIds.filter((id) => !excludedSet.has(id)), [baseSelectedIds, excludedSet]);
  const summary = useMemo(() => computeAudienceSummary(effectiveSelectedIds, adoptionByPersonId), [effectiveSelectedIds, adoptionByPersonId]);

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const parsedTime = parseTimeValue(timeValue);

  const canSubmit =
    !isPending &&
    trimmedTitle.length > 0 &&
    trimmedTitle.length <= BROADCAST_TITLE_MAX_LENGTH &&
    trimmedBody.length > 0 &&
    trimmedBody.length <= BROADCAST_BODY_MAX_LENGTH &&
    parsedTime !== null &&
    effectiveSelectedIds.length > 0;

  // Which specific field the latest server-reported error (if any) is
  // about -- lets that field carry `aria-invalid`/`aria-describedby`
  // pointing at the outcome message below, instead of relying only on the
  // page-level alert.
  const currentError = result && !result.ok ? result.error : null;
  const titleInvalid = currentError === "invalid_title";
  const bodyInvalid = currentError === "invalid_body";
  const scheduleInvalid = currentError === "invalid_schedule";

  function toggleAudience(next: AudienceKind) {
    setAudienceKind(next);
    if (next === "person") setSelectedIds((current) => current.slice(0, 1));
  }

  function togglePerson(personId: string) {
    setSelectedIds((current) => {
      if (current.includes(personId)) return current.filter((id) => id !== personId);
      if (audienceKind === "person") return [personId];
      return [...current, personId];
    });
  }

  function toggleGroup(key: AudienceGroupKey) {
    setGroupKeys((current) => (current.includes(key) ? current.filter((existing) => existing !== key) : [...current, key]));
  }

  function toggleExcludedPerson(personId: string) {
    setExcludedIds((current) => (current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId]));
  }

  function handleSubmit() {
    if (!canSubmit || !parsedTime) return;
    setResult(null);

    startTransition(async () => {
      const input = {
        title: trimmedTitle,
        body: trimmedBody,
        weekday,
        localHour: parsedTime.hour,
        localMinute: parsedTime.minute,
        audienceKind,
        targetPersonIds: audienceKind === "everyone" || audienceKind === "groups" ? [] : selectedIds,
        groupKeys: audienceKind === "groups" ? groupKeys : [],
        excludedPersonIds: excludedIds,
      };

      const outcome = editingRule ? await updateCustomWeeklyRuleAction(editingRule.id, input) : await createCustomWeeklyRuleAction(input);
      setResult(outcome);
      if (outcome.ok) onSaved();
    });
  }

  return (
    <Panel variant="inline" data-testid="manager-recurring-rule-composer">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-sm font-semibold text-foreground">{editingRule ? "✏️ עריכת התראה מחזורית" : "➕ התראה מחזורית חדשה"}</h5>
          <button type="button" onClick={onCancel} className="text-xs font-medium text-muted underline">
            ביטול
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">כותרת</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={BROADCAST_TITLE_MAX_LENGTH}
              placeholder="לדוגמה: 📌 תזכורת לאילוצים"
              aria-invalid={titleInvalid || undefined}
              aria-describedby={titleInvalid ? outcomeId : undefined}
              className="rounded-lg bg-overlay-soft px-3 py-1.5 text-sm text-foreground placeholder:text-muted-2 ring-1 ring-border focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">תוכן ההודעה</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={BROADCAST_BODY_MAX_LENGTH}
              rows={2}
              placeholder="תוכן ההתראה שיוצג לאנשי הצוות"
              aria-invalid={bodyInvalid || undefined}
              aria-describedby={bodyInvalid ? outcomeId : undefined}
              className="resize-none rounded-lg bg-overlay-soft px-3 py-1.5 text-sm text-foreground placeholder:text-muted-2 ring-1 ring-border focus:outline-none"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">יום בשבוע</span>
            <select
              value={weekday}
              onChange={(event) => setWeekday(Number(event.target.value))}
              className="rounded-lg bg-overlay-soft px-3 py-1.5 text-sm text-foreground ring-1 ring-border focus:outline-none"
            >
              {WEEKDAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  יום {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">שעה</span>
            <input
              type="time"
              value={timeValue}
              onChange={(event) => setTimeValue(event.target.value)}
              aria-label="שעת שליחה"
              aria-invalid={scheduleInvalid || undefined}
              aria-describedby={scheduleInvalid ? outcomeId : undefined}
              className="rounded-lg bg-overlay-soft px-3 py-1.5 text-sm text-foreground ring-1 ring-border focus:outline-none"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="למי לשלוח">
          {AUDIENCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={audienceKind === option.value}
              onClick={() => toggleAudience(option.value)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors duration-150 ${
                audienceKind === option.value
                  ? "bg-primary text-primary-foreground ring-primary"
                  : "bg-overlay-soft text-foreground ring-border hover:bg-overlay-strong"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {audienceKind === "groups" ? <AudienceGroupPicker selectedKeys={groupKeys} onToggle={toggleGroup} /> : null}

        {audienceKind !== "everyone" && audienceKind !== "groups" ? (
          <RosterPersonPicker
            roster={roster}
            adoptionPeople={adoptionPeople}
            query={query}
            onQueryChange={setQuery}
            selectedIds={selectedIds}
            onTogglePerson={togglePerson}
          />
        ) : null}

        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setExcludeExpanded((current) => !current)}
            aria-expanded={excludeExpanded}
            className="self-start text-xs font-medium text-muted underline"
          >
            {excludeExpanded ? "− הסתר לא לשלוח ל" : "+ לא לשלוח ל"}
          </button>
          {excludeExpanded ? (
            <>
              <span className="text-[11px] text-muted-2">מי שנבחר כאן לעולם לא יקבל את ההתראה -- גם אם הוא/היא נכלל/ת בקהל היעד שנבחר למעלה.</span>
              <RosterPersonPicker
                roster={roster}
                adoptionPeople={adoptionPeople}
                query={excludeQuery}
                onQueryChange={setExcludeQuery}
                selectedIds={excludedIds}
                onTogglePerson={toggleExcludedPerson}
              />
            </>
          ) : null}
        </div>

        <p className="text-xs text-muted">
          נבחרו <span className="font-semibold text-foreground">{summary.selectedCount}</span> אנשי צוות -- {summary.pushCapableCount} יקבלו גם
          Push, {summary.inboxOnlyCount} במרכז ההתראות בלבד.
        </p>

        <div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-busy={isPending}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "שומר/ת…" : editingRule ? "שמירת שינויים" : "יצירת התראה מחזורית"}
          </button>
        </div>

        {result && !result.ok ? (
          <StatusMessage tone="error" id={outcomeId} className="text-xs text-critical">
            {errorLabel(result.error)}
          </StatusMessage>
        ) : null}
      </div>
    </Panel>
  );
}
