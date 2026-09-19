"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { RosterPersonPicker } from "./RosterPersonPicker";
import { AudienceGroupPicker } from "./AudienceGroupPicker";
import { updateSystemRuleAction, type SystemRuleView, type UpdateSystemRuleActionResult } from "@/lib/notifications/ruleActions";
import { BROADCAST_BODY_MAX_LENGTH, BROADCAST_TITLE_MAX_LENGTH } from "@/lib/notifications/manualBroadcastLimits";
import { SYSTEM_RULE_DETAILS_PLACEHOLDER } from "@/lib/presentation/notificationRules";
import { computeAudienceSummary } from "@/lib/presentation/managerBroadcast";
import type { ManagerAdoptionPersonView, ManagerPersonSummary } from "@/lib/readModels/managerTypes";
import type { AudienceGroupKey } from "@/lib/domain/audienceGroups";
import { resolveAudienceGroupMembers } from "@/lib/domain/audienceGroups";

type SystemAudienceMode = "all_eligible" | "selected" | "groups";

interface ManagerSystemRuleEditorProps {
  rule: SystemRuleView;
  roster: ManagerPersonSummary[];
  adoptionPeople: ManagerAdoptionPersonView[];
  onSaved: (updated: SystemRuleView) => void;
  onCancel: () => void;
}

const AUDIENCE_OPTIONS: { value: SystemAudienceMode; label: string }[] = [
  { value: "all_eligible", label: "כל הרלוונטיים" },
  { value: "groups", label: "לפי קבוצות" },
  { value: "selected", label: "אנשים ספציפיים" },
];

const ERROR_LABELS: Record<string, string> = {
  invalid_request: "הבקשה אינה תקינה. נסה/י שוב.",
  forbidden: "רק מנהל/ת יכול/ה לנהל התראות קבועות.",
  unauthenticated: "יש להתחבר מחדש.",
  not_found: "הכלל לא נמצא -- ייתכן שכבר נערך/הוסר.",
  invalid_schedule: "יש לבחור שעה תקינה.",
  invalid_title: `הכותרת יכולה להיות עד ${BROADCAST_TITLE_MAX_LENGTH} תווים.`,
  invalid_body: `התוכן יכול להיות עד ${BROADCAST_BODY_MAX_LENGTH} תווים.`,
  invalid_body_details_placeholder: `התוכן חייב להכיל את "${SYSTEM_RULE_DETAILS_PLACEHOLDER}" פעם אחת בדיוק, כדי לשמר את הפרטים בפועל.`,
  invalid_audience: "יש לבחור קהל יעד תקין.",
  invalid_targets: "הבחירה אינה תקפה יותר. נסה/י לבחור מחדש.",
  no_targets: "יש לבחור לפחות איש/אשת צוות אחד/ת.",
  conflict: "ההתראה השתנתה מאז שפתחת אותה. טען/י מחדש ונסה/י שוב.",
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
 * Full editor for a system notification rule -- send time, title, body,
 * and an audience FILTER, all in one place (spec: "1. זמן שליחה 2. כותרת
 * 3. תוכן 4. קהל יעד"). Reuses `RosterPersonPicker` for "אנשים מסוימים"
 * -- never a second people-picker implementation. Every real validation
 * (title/body length, the `{details}` placeholder requirement for a
 * dynamic-body category, roster membership) happens server-side in
 * `updateSystemRuleAction`; this component only narrows what the manager
 * can click before submitting and explains WHY.
 *
 * The rule's trigger/domain-eligibility logic itself is never editable
 * here -- audience selection is explicitly presented as a FILTER
 * (`rule.audienceFilterNote`), never a replacement: "ההתראה עדיין תישלח
 * רק למי שרלוונטי בפועל -- הבחירה כאן רק מצמצמת."
 */
export function ManagerSystemRuleEditor({ rule, roster, adoptionPeople, onSaved, onCancel }: ManagerSystemRuleEditorProps) {
  const [enabled, setEnabled] = useState(rule.enabled);
  const [timeValue, setTimeValue] = useState(() => minuteOfDayToTimeValue(rule.localHour, rule.localMinute));
  const [title, setTitle] = useState(() => rule.titleOverride ?? "");
  const [body, setBody] = useState(() => rule.bodyOverride ?? "");
  const [audienceMode, setAudienceMode] = useState<SystemAudienceMode>(rule.audienceMode);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => rule.targetPersonIds);
  const [groupKeys, setGroupKeys] = useState<AudienceGroupKey[]>(() => rule.audienceGroupKeys);
  const [excludedIds, setExcludedIds] = useState<string[]>(() => rule.excludedPersonIds);
  const [excludeExpanded, setExcludeExpanded] = useState(() => rule.excludedPersonIds.length > 0);
  const [query, setQuery] = useState("");
  const [excludeQuery, setExcludeQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<UpdateSystemRuleActionResult | null>(null);
  const outcomeId = useId();
  const bodyErrorId = useId();

  const adoptionByPersonId = useMemo(() => new Map(adoptionPeople.map((person) => [person.personId, person])), [adoptionPeople]);

  // A client-side ESTIMATE only -- the real domain-eligible set (who
  // actually has a shift/duty/logistics assignment tomorrow, etc.) is
  // never known client-side, so this can only ever show an UPPER BOUND
  // ("at most this many, before today's real eligibility narrows it
  // further"), same spirit `rule.audienceFilterNote` already explains in
  // words. Uses the SAME shared group resolver (`resolveAudienceGroupMembers`)
  // the server applies, so a "groups" estimate can never structurally
  // drift from how membership is actually computed -- only from domain
  // eligibility, which is inherent to it being an upper bound.
  const groupMatchIds = useMemo(() => resolveAudienceGroupMembers(roster, groupKeys).map((person) => person.id), [roster, groupKeys]);
  const baseSelectedIds = audienceMode === "groups" ? groupMatchIds : audienceMode === "selected" ? selectedIds : roster.map((person) => person.id);
  const excludedSet = useMemo(() => new Set(excludedIds), [excludedIds]);
  const effectiveIds = useMemo(() => baseSelectedIds.filter((id) => !excludedSet.has(id)), [baseSelectedIds, excludedSet]);
  const summary = useMemo(() => computeAudienceSummary(effectiveIds, adoptionByPersonId), [effectiveIds, adoptionByPersonId]);

  const isDynamicBody = rule.bodyKind === "dynamic_details_required";
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const parsedTime = parseTimeValue(timeValue);
  const detailsOccurrences = trimmedBody ? trimmedBody.split(SYSTEM_RULE_DETAILS_PLACEHOLDER).length - 1 : 0;
  const bodyPlaceholderInvalid = isDynamicBody && trimmedBody.length > 0 && detailsOccurrences !== 1;

  const canSubmit =
    !isPending &&
    trimmedTitle.length <= BROADCAST_TITLE_MAX_LENGTH &&
    trimmedBody.length <= BROADCAST_BODY_MAX_LENGTH &&
    !bodyPlaceholderInvalid &&
    parsedTime !== null &&
    (audienceMode === "all_eligible" || (audienceMode === "selected" && selectedIds.length > 0) || (audienceMode === "groups" && groupKeys.length > 0));

  // Which specific field the latest server-reported error (if any) is
  // about -- lets that field carry `aria-invalid`/`aria-describedby`
  // pointing at the outcome message below. `bodyInvalid` also covers the
  // client-side `{details}`-placeholder check, which already rings the
  // textarea red visually -- this just wires the same fact into ARIA.
  const currentError = result && !result.ok ? result.error : null;
  const titleInvalid = currentError === "invalid_title";
  const bodyInvalid = bodyPlaceholderInvalid || currentError === "invalid_body";
  const scheduleInvalid = currentError === "invalid_schedule";

  function togglePerson(personId: string) {
    setSelectedIds((current) => (current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId]));
  }

  function toggleExcludedPerson(personId: string) {
    setExcludedIds((current) => (current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId]));
  }

  function toggleGroup(key: AudienceGroupKey) {
    setGroupKeys((current) => (current.includes(key) ? current.filter((existing) => existing !== key) : [...current, key]));
  }

  function handleResetCopy() {
    setTitle("");
    setBody("");
  }

  function handleSubmit() {
    if (!canSubmit || !parsedTime) return;
    setResult(null);

    startTransition(async () => {
      const outcome = await updateSystemRuleAction(rule.id, {
        enabled,
        localHour: parsedTime.hour,
        localMinute: parsedTime.minute,
        titleOverride: trimmedTitle.length > 0 ? trimmedTitle : null,
        bodyOverride: trimmedBody.length > 0 ? trimmedBody : null,
        audienceMode,
        targetPersonIds: audienceMode === "selected" ? selectedIds : [],
        audienceGroupKeys: audienceMode === "groups" ? groupKeys : [],
        excludedPersonIds: excludedIds,
        expectedRevision: rule.revision,
      });
      setResult(outcome);
      if (outcome.ok) onSaved(outcome.rule);
    });
  }

  return (
    <Panel variant="inline" data-testid="manager-system-rule-editor">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h5 className="text-sm font-semibold text-foreground">✏️ עריכת {rule.name}</h5>
          <button type="button" onClick={onCancel} className="text-xs font-medium text-muted underline">
            ביטול
          </button>
        </div>

        <label className="flex items-center gap-2 text-xs font-medium text-muted">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4" />
          <span>ההתראה פעילה</span>
        </label>

        <label className="flex flex-col gap-1 sm:w-40">
          <span className="text-xs font-medium text-muted">זמן שליחה</span>
          <input
            type="time"
            value={timeValue}
            onChange={(event) => setTimeValue(event.target.value)}
            aria-label={`שעת שליחה עבור ${rule.name}`}
            aria-invalid={scheduleInvalid || undefined}
            aria-describedby={scheduleInvalid ? outcomeId : undefined}
            className="rounded-lg bg-overlay-soft px-3 py-1.5 text-sm text-foreground ring-1 ring-border focus:outline-none"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">כותרת</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={BROADCAST_TITLE_MAX_LENGTH}
              placeholder={rule.defaultTitle}
              aria-invalid={titleInvalid || undefined}
              aria-describedby={titleInvalid ? outcomeId : undefined}
              className="rounded-lg bg-overlay-soft px-3 py-1.5 text-sm text-foreground placeholder:text-muted-2 ring-1 ring-border focus:outline-none"
            />
            <span className="text-[11px] text-muted-2">ברירת מחדל: {rule.defaultTitle}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">תוכן</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={BROADCAST_BODY_MAX_LENGTH}
              rows={2}
              placeholder={rule.defaultBody ?? SYSTEM_RULE_DETAILS_PLACEHOLDER}
              aria-invalid={bodyInvalid || undefined}
              aria-describedby={bodyInvalid ? (bodyPlaceholderInvalid ? bodyErrorId : outcomeId) : undefined}
              className={`resize-none rounded-lg bg-overlay-soft px-3 py-1.5 text-sm text-foreground placeholder:text-muted-2 ring-1 focus:outline-none ${
                bodyPlaceholderInvalid ? "ring-critical/50" : "ring-border"
              }`}
            />
            {isDynamicBody ? (
              <span className="text-[11px] text-muted-2">
                {SYSTEM_RULE_DETAILS_PLACEHOLDER} מוחלף אוטומטית בפרטי המשמרת/התורנות בפועל -- חובה להשאיר אותו בתוכן פעם אחת בדיוק.
              </span>
            ) : (
              <span className="text-[11px] text-muted-2">ברירת מחדל: {rule.defaultBody}</span>
            )}
            {bodyPlaceholderInvalid ? (
              <StatusMessage tone="error" id={bodyErrorId} className="text-[11px] text-critical">
                התוכן חייב להכיל את &ldquo;{SYSTEM_RULE_DETAILS_PLACEHOLDER}&rdquo; פעם אחת בדיוק.
              </StatusMessage>
            ) : null}
          </label>
        </div>

        {title.trim() || body.trim() ? (
          <div>
            <button type="button" onClick={handleResetCopy} className="text-xs font-medium text-muted underline">
              איפוס לברירת מחדל
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">קהל יעד</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="קהל יעד">
            {AUDIENCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={audienceMode === option.value}
                onClick={() => setAudienceMode(option.value)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors duration-150 ${
                  audienceMode === option.value
                    ? "bg-primary text-primary-foreground ring-primary"
                    : "bg-overlay-soft text-foreground ring-border hover:bg-overlay-strong"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-muted-2">{rule.audienceFilterNote}</span>
        </div>

        {audienceMode === "groups" ? <AudienceGroupPicker selectedKeys={groupKeys} onToggle={toggleGroup} /> : null}

        {audienceMode === "selected" ? (
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
          יישלח לכל היותר ל־<span className="font-semibold text-foreground">{summary.selectedCount}</span> אנשי צוות -- {summary.pushCapableCount} יקבלו
          גם Push, {summary.inboxOnlyCount} במרכז ההתראות בלבד.
        </p>

        <div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-busy={isPending}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "שומר/ת…" : "שמירת שינויים"}
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
