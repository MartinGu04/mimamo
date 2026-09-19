"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { RosterPersonPicker } from "./RosterPersonPicker";
import { AudienceGroupPicker } from "./AudienceGroupPicker";
import {
  sendManagerBroadcastAction,
  type SendManagerBroadcastActionResult,
} from "@/lib/notifications/manualBroadcastActions";
import { BROADCAST_BODY_MAX_LENGTH, BROADCAST_TITLE_MAX_LENGTH } from "@/lib/notifications/manualBroadcastLimits";
import {
  createScheduledBroadcastAction,
  editScheduledBroadcastAction,
  type ScheduledBroadcastActionResult,
  type ScheduledBroadcastView,
} from "@/lib/notifications/scheduledBroadcastActions";
import { formatScheduledBroadcastMoment } from "@/lib/presentation/scheduledBroadcast";
import { computeAudienceSummary } from "@/lib/presentation/managerBroadcast";
import type { ManagerAdoptionPersonView, ManagerPersonSummary } from "@/lib/readModels/managerTypes";
import type { AudienceGroupKey } from "@/lib/domain/audienceGroups";
import { resolveAudienceGroupMembers } from "@/lib/domain/audienceGroups";

type AudienceKind = "person" | "people" | "everyone" | "groups";
export type SendMode = "now" | "schedule";

/** The audience mode a brand-new (non-editing) composer always starts in -- also what the explicit "↺ איפוס טופס" action restores, regardless of what was selected before. */
const DEFAULT_AUDIENCE_KIND: AudienceKind = "person";

interface ManagerBroadcastComposerProps {
  /**
   * Fixed by the parent Notification Center section ("עכשיו"/"תזמון") --
   * this component itself never toggles between them anymore (see this
   * file's own docstring). Only ever `"schedule"` when `editingItem` is
   * set: editing an existing scheduled broadcast only ever happens from
   * "תזמון".
   */
  mode: SendMode;
  roster: ManagerPersonSummary[];
  /** Empty when the readiness lookup itself is unavailable -- the picker still works, it just can't annotate anyone's readiness. */
  adoptionPeople: ManagerAdoptionPersonView[];
  /** Set while the manager is editing an existing scheduled broadcast (from "🕒 התראות מתוזמנות"'s own "עריכה" action) -- pre-fills the form and switches submission to `editScheduledBroadcastAction`. `null`/omitted is the ordinary "new broadcast" composer. */
  editingItem?: ScheduledBroadcastView | null;
  /** Fired after ANY successful send/save (immediate, scheduled create, or scheduled edit) -- the parent uses this to refresh the scheduled/recent lists. */
  onSaved?: () => void;
  /** Fired when the manager leaves edit mode (save succeeded, or they cancel editing explicitly). */
  onCancelEdit?: () => void;
}

const AUDIENCE_OPTIONS: { value: AudienceKind; label: string }[] = [
  { value: "person", label: "אדם מסוים" },
  { value: "people", label: "כמה אנשים" },
  { value: "groups", label: "לפי קבוצות" },
  { value: "everyone", label: "כולם" },
];

function newIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const ERROR_LABELS: Record<string, string> = {
  invalid_request: "הבקשה אינה תקינה. נסה/י שוב.",
  unauthenticated: "יש להתחבר מחדש כדי לשלוח התראה.",
  missing_email: "לא נמצא מייל משויך למשתמש/ת שלך.",
  unmapped: "המשתמש/ת שלך אינו/ה מזוהה/ת בכ״א.",
  ambiguous_identity: "המייל שלך משויך ליותר מרשומה אחת בכ״א.",
  configuration_error: "יש בעיית תצורה במערכת. נסה/י שוב מאוחר יותר.",
  forbidden: "רק מנהל/ת יכול/ה לשלוח התראה.",
  invalid_title: `כותרת ההתראה חייבת להיות בין 1 ל-${BROADCAST_TITLE_MAX_LENGTH} תווים.`,
  invalid_body: `תוכן ההתראה חייב להיות בין 1 ל-${BROADCAST_BODY_MAX_LENGTH} תווים.`,
  invalid_audience: "בחירת \"אדם מסוים\" דורשת בדיוק איש/אשת צוות אחד/ת.",
  invalid_targets: "הבחירה אינה תקפה יותר. נסה/י לבחור מחדש.",
  no_targets: "לא נבחרו אנשי צוות תקפים לשליחה.",
  idempotency_conflict: "השליחה הקודמת עדיין בעיבוד או שונה מהבקשה הזו. נסה/י שוב.",
  invalid_schedule: "יש לבחור תאריך ושעה תקינים בעתיד.",
  not_found: "התזמון לא נמצא -- ייתכן שכבר בוטל.",
  already_started: "השליחה כבר התחילה, ולא ניתן עוד לערוך/לבטל.",
  already_cancelled: "התזמון הזה כבר בוטל.",
};

function errorLabel(error: string): string {
  return ERROR_LABELS[error] ?? "השליחה נכשלה. נסה/י שוב.";
}

function minuteOfDayToTimeValue(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** `null` when `timeValue` isn't a well-formed `HH:MM` (an empty/partially-filled `<input type="time">`). */
function parseTimeValue(timeValue: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * "📣 שליחת התראה" -- the manager-only manual-broadcast composer. Rendered
 * by the standalone Notification Center's own "עכשיו"/"תזמון" sections
 * (`app/(app)/notifications/page.tsx`), each fixing this component's `mode`
 * -- the component itself no longer owns an "עכשיו / תזמון" switch (that
 * choice is now which SECTION the manager is on). Purely a thin client
 * shell around `sendManagerBroadcastAction`/`createScheduledBroadcastAction`/
 * `editScheduledBroadcastAction` -- every real decision (who counts as a
 * valid recipient, push-capable vs. inbox-only vs. unresolved, dedupe,
 * audience-snapshot freezing) happens server-side; this component's own
 * `computeAudienceSummary` call is an ESTIMATE for the manager to read
 * before sending/scheduling, never the source of truth (see that
 * function's own docstring).
 *
 * `mode` branches the SAME form to one of three server actions: an
 * immediate send is byte-for-byte the PR #78 behavior
 * (`sendManagerBroadcastAction`, unchanged); `mode === "schedule"` saves a
 * still-mutable scheduled broadcast instead of sending anything
 * (`createScheduledBroadcastAction`) -- never claims Push was sent.
 * `editingItem` repurposes the exact same form (always `mode === "schedule"`
 * while editing) to edit an existing scheduled broadcast in place
 * (`editScheduledBroadcastAction`) rather than a second editor UI.
 */
export function ManagerBroadcastComposer({
  mode,
  roster,
  adoptionPeople,
  editingItem = null,
  onSaved,
  onCancelEdit,
}: ManagerBroadcastComposerProps) {
  // Initial state is derived from `editingItem` once, on mount -- the
  // parent section remounts this component with a fresh `key` whenever
  // `editingItem` changes identity (a different scheduled broadcast, or
  // leaving/entering edit mode), so there is no need to re-sync these via
  // an effect.
  const [audienceKind, setAudienceKind] = useState<AudienceKind>(() =>
    editingItem && editingItem.audienceKind !== "everyone" ? editingItem.audienceKind : editingItem ? "everyone" : DEFAULT_AUDIENCE_KIND,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    editingItem && editingItem.audienceKind !== "everyone" && editingItem.audienceKind !== "groups" ? editingItem.targetPersonIds : [],
  );
  const [groupKeys, setGroupKeys] = useState<AudienceGroupKey[]>(() => editingItem?.audienceGroupKeys ?? []);
  const [excludedIds, setExcludedIds] = useState<string[]>(() => editingItem?.excludedPersonIds ?? []);
  const [excludeExpanded, setExcludeExpanded] = useState(() => (editingItem?.excludedPersonIds.length ?? 0) > 0);
  const [query, setQuery] = useState("");
  const [excludeQuery, setExcludeQuery] = useState("");
  const [title, setTitle] = useState(() => editingItem?.title ?? "");
  const [body, setBody] = useState(() => editingItem?.body ?? "");
  const [scheduledDate, setScheduledDate] = useState(() => editingItem?.scheduledLocalDate ?? "");
  const [scheduledTime, setScheduledTime] = useState(() =>
    editingItem ? minuteOfDayToTimeValue(editingItem.scheduledLocalMinuteOfDay) : "",
  );
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SendManagerBroadcastActionResult | null>(null);
  const [scheduleResult, setScheduleResult] = useState<ScheduledBroadcastActionResult | null>(null);
  const resultOutcomeId = useId();
  const scheduleOutcomeId = useId();

  const adoptionByPersonId = useMemo(
    () => new Map(adoptionPeople.map((person) => [person.personId, person])),
    [adoptionPeople],
  );

  // The SAME shared resolver (`resolveAudienceGroupMembers`) the server
  // uses -- so this client-side preview can never structurally drift from
  // the actual send/save resolution (spec: "the preview must use the same
  // audience resolver as the actual send path").
  const groupMatchIds = useMemo(() => resolveAudienceGroupMembers(roster, groupKeys).map((person) => person.id), [roster, groupKeys]);
  const baseSelectedIds = audienceKind === "everyone" ? roster.map((person) => person.id) : audienceKind === "groups" ? groupMatchIds : selectedIds;
  const excludedSet = useMemo(() => new Set(excludedIds), [excludedIds]);
  const effectiveSelectedIds = useMemo(() => baseSelectedIds.filter((id) => !excludedSet.has(id)), [baseSelectedIds, excludedSet]);
  const summary = useMemo(
    () => computeAudienceSummary(effectiveSelectedIds, adoptionByPersonId),
    [effectiveSelectedIds, adoptionByPersonId],
  );

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const parsedTime = parseTimeValue(scheduledTime);
  const scheduleSummary =
    mode === "schedule" && scheduledDate && parsedTime
      ? formatScheduledBroadcastMoment(scheduledDate, parsedTime.hour * 60 + parsedTime.minute)
      : null;

  const canSubmit =
    !isPending &&
    trimmedTitle.length > 0 &&
    trimmedTitle.length <= BROADCAST_TITLE_MAX_LENGTH &&
    trimmedBody.length > 0 &&
    trimmedBody.length <= BROADCAST_BODY_MAX_LENGTH &&
    effectiveSelectedIds.length > 0 &&
    (mode === "now" || (scheduledDate.length > 0 && parsedTime !== null));

  // Which specific field the latest server-reported error (if any) is
  // about -- lets that field carry `aria-invalid`/`aria-describedby`
  // pointing at the SAME outcome message already shown below, instead of a
  // screen-reader user having to rely only on the page-level alert to
  // figure out which input needs fixing.
  const currentError = mode === "now" ? (result && !result.ok ? result.error : null) : scheduleResult && !scheduleResult.ok ? scheduleResult.error : null;
  const currentErrorId = mode === "now" ? resultOutcomeId : scheduleOutcomeId;
  const titleInvalid = currentError === "invalid_title";
  const bodyInvalid = currentError === "invalid_body";
  const scheduleInvalid = currentError === "invalid_schedule";

  /**
   * After a successful send/schedule-save: clears only title/body (and
   * mints a fresh idempotency key for the next submission) -- the
   * audience/filters (selected people, groups, exclusions, audience mode,
   * search queries) are deliberately left as-is so the manager can send
   * another notification to the SAME group right away. `scheduledDate`/
   * `scheduledTime` are cleared too, since a just-used one-time slot is
   * never worth resubmitting as-is.
   */
  function resetAfterSend() {
    setTitle("");
    setBody("");
    setScheduledDate("");
    setScheduledTime("");
    setIdempotencyKey(newIdempotencyKey());
  }

  /**
   * The explicit "↺ איפוס טופס" action -- restores the ENTIRE composer to
   * its initial/default state (same fields a brand-new, non-editing
   * composer starts with), unlike `resetAfterSend` above. Builds on
   * `resetAfterSend` rather than re-clearing title/body/schedule/
   * idempotency a second time. Purely local component state -- never
   * calls a Server Action, so it can never affect an already-sent
   * notification or the send history.
   */
  function resetToDefaultState() {
    resetAfterSend();
    setAudienceKind(DEFAULT_AUDIENCE_KIND);
    setSelectedIds([]);
    setGroupKeys([]);
    setExcludedIds([]);
    setExcludeExpanded(false);
    setQuery("");
    setExcludeQuery("");
    setResult(null);
    setScheduleResult(null);
  }

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
    if (!canSubmit) return;
    setResult(null);
    setScheduleResult(null);

    startTransition(async () => {
      if (mode === "now") {
        const outcome = await sendManagerBroadcastAction({
          audienceKind,
          targetPersonIds: audienceKind === "everyone" || audienceKind === "groups" ? [] : selectedIds,
          groupKeys: audienceKind === "groups" ? groupKeys : [],
          excludedPersonIds: excludedIds,
          title: trimmedTitle,
          body: trimmedBody,
          idempotencyKey,
        });
        setResult(outcome);
        if (outcome.ok) {
          resetAfterSend();
          onSaved?.();
        }
        return;
      }

      if (!parsedTime) return; // canSubmit already guards this; narrows for TypeScript.

      const scheduleInput = {
        audienceKind,
        targetPersonIds: audienceKind === "everyone" || audienceKind === "groups" ? [] : selectedIds,
        groupKeys: audienceKind === "groups" ? groupKeys : [],
        excludedPersonIds: excludedIds,
        title: trimmedTitle,
        body: trimmedBody,
        scheduledDate,
        scheduledHour: parsedTime.hour,
        scheduledMinute: parsedTime.minute,
      };

      const outcome = editingItem
        ? await editScheduledBroadcastAction(editingItem.id, scheduleInput)
        : await createScheduledBroadcastAction({ ...scheduleInput, idempotencyKey });

      setScheduleResult(outcome);
      if (outcome.ok) {
        resetAfterSend();
        onSaved?.();
        onCancelEdit?.();
      }
    });
  }

  return (
    <Panel variant="panel" glass="subtle" data-testid="manager-broadcast-composer">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {editingItem ? "✏️ עריכת התראה מתוזמנת" : "📣 שליחת התראה"}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            שולח/ת התראה לתיבת ההתראות של אנשי הצוות שנבחרו, וגם כ-Push למי שהפעיל/ה זאת.
          </p>
        </div>

        {editingItem ? (
          <button type="button" onClick={onCancelEdit} className="self-start text-xs font-medium text-muted underline">
            ביטול עריכה
          </button>
        ) : null}

        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="למי לשלוח">
          {AUDIENCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={audienceKind === option.value}
              onClick={() => toggleAudience(option.value)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
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

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">כותרת</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={BROADCAST_TITLE_MAX_LENGTH}
              placeholder="לדוגמה: עדכון חשוב"
              aria-invalid={titleInvalid || undefined}
              aria-describedby={titleInvalid ? currentErrorId : undefined}
              className="rounded-lg bg-overlay-soft px-3 py-1.5 text-sm text-foreground placeholder:text-muted-2 ring-1 ring-border focus:outline-none"
            />
            <span className="text-[11px] text-muted-2">
              {title.length}/{BROADCAST_TITLE_MAX_LENGTH}
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">תוכן ההודעה</span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={BROADCAST_BODY_MAX_LENGTH}
              rows={3}
              placeholder="תוכן ההתראה שיוצג לאנשי הצוות"
              aria-invalid={bodyInvalid || undefined}
              aria-describedby={bodyInvalid ? currentErrorId : undefined}
              className="resize-none rounded-lg bg-overlay-soft px-3 py-1.5 text-sm text-foreground placeholder:text-muted-2 ring-1 ring-border focus:outline-none"
            />
            <span className="text-[11px] text-muted-2">
              {body.length}/{BROADCAST_BODY_MAX_LENGTH}
            </span>
          </label>
        </div>

        {mode === "schedule" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">תאריך</span>
              <input
                type="date"
                value={scheduledDate}
                onChange={(event) => setScheduledDate(event.target.value)}
                aria-label="תאריך השליחה"
                aria-invalid={scheduleInvalid || undefined}
                aria-describedby={scheduleInvalid ? currentErrorId : undefined}
                className="rounded-lg bg-overlay-soft px-3 py-1.5 text-sm text-foreground ring-1 ring-border focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">שעה</span>
              <input
                type="time"
                value={scheduledTime}
                onChange={(event) => setScheduledTime(event.target.value)}
                aria-label="שעת השליחה"
                aria-invalid={scheduleInvalid || undefined}
                aria-describedby={scheduleInvalid ? currentErrorId : undefined}
                className="rounded-lg bg-overlay-soft px-3 py-1.5 text-sm text-foreground ring-1 ring-border focus:outline-none"
              />
            </label>
            {scheduleSummary ? (
              <p className="text-xs font-medium text-primary sm:col-span-2">תוזמן ל{scheduleSummary}</p>
            ) : null}
          </div>
        ) : null}

        {trimmedTitle || trimmedBody ? (
          <div className="rounded-xl bg-overlay-faint p-3 ring-1 ring-border">
            <p className="text-[11px] font-medium text-muted-2">תצוגה מקדימה</p>
            <p className="mt-1 text-sm font-semibold text-foreground">{trimmedTitle || "כותרת ההתראה"}</p>
            <p className="text-sm text-muted">{trimmedBody || "תוכן ההתראה"}</p>
          </div>
        ) : null}

        <div className="text-sm text-muted">
          <p>
            נבחרו <span className="font-semibold text-foreground">{summary.selectedCount}</span> אנשי צוות
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            <li>{summary.pushCapableCount} יקבלו גם Push</li>
            <li>{summary.inboxOnlyCount} יקבלו במרכז ההתראות בלבד</li>
            {summary.unresolvedCount > 0 ? (
              <li className="text-warning">{summary.unresolvedCount} לא ניתנים לשליחה כרגע</li>
            ) : null}
          </ul>
          {mode === "schedule" ? (
            <p className="mt-1 text-[11px] text-muted-2">
              ההערכה משקפת את המצב הנוכחי בלבד -- היא עשויה להשתנות עד למועד השליחה בפועל.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-busy={isPending}
            className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending
              ? "שולח/ת…"
              : editingItem
                ? "שמירת שינויים"
                : mode === "now"
                  ? "שלח התראה"
                  : "שמירת תזמון"}
          </button>
          <button
            type="button"
            onClick={resetToDefaultState}
            disabled={isPending}
            className="rounded-full bg-transparent px-4 py-2 text-sm font-medium text-muted ring-1 ring-border transition-colors duration-150 hover:bg-overlay-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            ↺ איפוס טופס
          </button>
        </div>

        {result ? (
          result.ok ? (
            <StatusMessage tone="success" id={resultOutcomeId} className="rounded-xl bg-success/10 p-3 text-sm text-success ring-1 ring-success/25">
              <p className="font-semibold">
                ✅ נוצרה התראה ל־{result.resolvedRecipientCount} משתמשים
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                <li>{result.pushCapableCount} מיועדים גם ל-Push</li>
                <li>{result.inboxOnlyCount} יקבלו במרכז ההתראות בלבד</li>
                {result.unresolvedCount > 0 ? <li>{result.unresolvedCount} מהבחירה לא ניתנים לשליחה</li> : null}
              </ul>
            </StatusMessage>
          ) : (
            <StatusMessage tone="error" id={resultOutcomeId} className="rounded-xl bg-critical/10 p-3 text-sm text-critical ring-1 ring-critical/25">
              {errorLabel(result.error)}
            </StatusMessage>
          )
        ) : null}

        {scheduleResult ? (
          scheduleResult.ok ? (
            <StatusMessage tone="success" id={scheduleOutcomeId} className="rounded-xl bg-success/10 p-3 text-sm text-success ring-1 ring-success/25">
              <p className="font-semibold">
                ✅ ההתראה תוזמנה
                {formatScheduledBroadcastMoment(
                  scheduleResult.item.scheduledLocalDate,
                  scheduleResult.item.scheduledLocalMinuteOfDay,
                )
                  ? ` ל${formatScheduledBroadcastMoment(
                      scheduleResult.item.scheduledLocalDate,
                      scheduleResult.item.scheduledLocalMinuteOfDay,
                    )}`
                  : ""}
              </p>
            </StatusMessage>
          ) : (
            <StatusMessage tone="error" id={scheduleOutcomeId} className="rounded-xl bg-critical/10 p-3 text-sm text-critical ring-1 ring-critical/25">
              {errorLabel(scheduleResult.error)}
            </StatusMessage>
          )
        ) : null}
      </div>
    </Panel>
  );
}
