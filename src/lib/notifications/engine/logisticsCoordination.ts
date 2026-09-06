import "server-only";
import { LOGISTICS_WITHDRAWAL_WINDOW, type MinuteWindow } from "@/lib/config/notificationTiming";
import { clipInterval } from "@/lib/domain/shiftCoverage";
import { resolveEventShiftInterval, type ShiftSchedule } from "@/lib/domain/shiftSchedule";
import { dayOfWeek, parseCalendarDate } from "@/lib/domain/dutyBlocks";
import type { Event } from "@/lib/domain/event";
import type { Person } from "@/lib/domain/types";
import { isLogisticsWithdrawalEvent } from "./logisticsWithdrawal";

/** `dayOfWeek` return value for Monday -- see that function's own "0=Sunday .. 6=Saturday" docstring. */
const MONDAY = 1;

/**
 * Logistics withdrawals are operationally expected every Monday -- the ONE
 * date the "nobody is assigned yet" FALLBACK notifications (the
 * supervisor's anti-spam warning and the all-hands teammate message) are
 * allowed to exist for. An explicit "משיכות" Event still works completely
 * normally on any weekday (an intentional exceptional withdrawal) -- this
 * gate only ever suppresses the FALLBACK path, never the assigned-person
 * coordination path. Reuses the existing `dayOfWeek`/`parseCalendarDate`
 * calendar helpers (`lib/domain/dutyBlocks.ts`) -- the same ones
 * `runConstraintsReminders` already uses for its own weekday gating --
 * rather than a second date-to-weekday computation. An unparseable date
 * conservatively never participates in the fallback.
 */
export function isLogisticsWithdrawalFallbackDate(date: string): boolean {
  const parsed = parseCalendarDate(date);
  if (!parsed) return false;
  return dayOfWeek(parsed) === MONDAY;
}

/**
 * Team-coordination logic around logistics withdrawals (משיכות
 * מהלוגיסטיקה), on top of `logisticsWithdrawal.ts`'s existing detection
 * (which stays untouched -- this module only ADDS "who else needs to know
 * about it" on top of "is this Event a withdrawal assignment").
 *
 * Everything here reuses the SAME canonical helpers the rest of the
 * domain uses for shift timing (`resolveEventShiftInterval`) and interval
 * overlap (`clipInterval`) -- never a second shift-time/availability
 * engine, and never reads Potential H1/H2 (the caller only ever supplies
 * the fresh personnel/schedule/settings Events already fetched for every
 * other reminder).
 */

export interface LogisticsPersonRef {
  personId: string;
  personName: string;
}

function comparePersonRef(a: LogisticsPersonRef, b: LogisticsPersonRef): number {
  return a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0;
}

/**
 * Every distinct person with a logistics-withdrawal Event on `date`,
 * deterministically ordered. Preserves `isLogisticsWithdrawalEvent` as the
 * ONE source of truth for "is this a withdrawal assignment" -- this only
 * adds dedup-by-person on top of it (spec: "Be robust if more than one
 * person somehow has a logistics-withdrawal Event on the same date").
 */
export function findLogisticsWithdrawalAssignees(events: readonly Event[], date: string): LogisticsPersonRef[] {
  const byPersonId = new Map<string, LogisticsPersonRef>();
  for (const event of events) {
    if (event.date !== date || !isLogisticsWithdrawalEvent(event)) continue;
    if (!byPersonId.has(event.personId)) {
      byPersonId.set(event.personId, { personId: event.personId, personName: event.personName });
    }
  }
  return [...byPersonId.values()].sort(comparePersonRef);
}

/** True when `event`'s own resolved (non-shadow) shift interval genuinely overlaps `window`. Never guessed -- an unresolved/invalid/shadow interval never counts as overlapping. */
function shiftEventOverlapsWindow(event: Event, schedule: ShiftSchedule, window: MinuteWindow): boolean {
  if (event.category !== "shift" || event.shadow) return false;
  const resolution = resolveEventShiftInterval(event, schedule);
  if (resolution.status !== "resolved") return false;
  return clipInterval(resolution.interval, window) !== null;
}

/**
 * The relevant אחמ"ש for `date`'s withdrawal window: every distinct
 * supervisor whose own resolved, non-shadow shift interval genuinely
 * overlaps `window` (default the 13:00–14:00 withdrawal window) --
 * structural, from the SAME Schedule Events every other coverage
 * computation uses, respecting configured shift times and per-Event
 * start/end overrides via `resolveEventShiftInterval`.
 *
 * Deliberately never `Person.isSupervisor` alone (spec: "Do NOT use
 * Person.isSupervisor alone to guess the on-duty supervisor"). If nobody
 * can be proven, returns an empty array -- callers must never invent a
 * fallback supervisor (spec: "fail conservatively: do not guess a
 * supervisor"). Multiple genuinely-overlapping supervisor shifts are all
 * returned -- every one of them may receive the notification.
 */
export function resolveRelevantSupervisors(
  events: readonly Event[],
  date: string,
  schedule: ShiftSchedule,
  window: MinuteWindow = LOGISTICS_WITHDRAWAL_WINDOW,
): LogisticsPersonRef[] {
  const byPersonId = new Map<string, LogisticsPersonRef>();
  for (const event of events) {
    if (event.date !== date || event.role !== "supervisor") continue;
    if (!shiftEventOverlapsWindow(event, schedule, window)) continue;
    if (!byPersonId.has(event.personId)) {
      byPersonId.set(event.personId, { personId: event.personId, personName: event.personName });
    }
  }
  return [...byPersonId.values()].sort(comparePersonRef);
}

/** אילוץ יום (constraint, period "day") is the ONE constraint period that excludes a technician from this logistics-team audience -- never אילוץ לילה/בוקר/unspecified (spec: "Do not invent new semantics for unrelated constraint periods"). */
function hasBlockingDayConstraint(events: readonly Event[], personId: string, date: string): boolean {
  return events.some(
    (event) =>
      event.personId === personId &&
      event.date === date &&
      event.category === "constraint" &&
      event.period === "day",
  );
}

/** ANY parsed absence on the same date excludes a technician from THIS audience -- deliberately every `AbsenceKind`, including partial ones like "after" (אפטר), unlike `BLOCKING_ABSENCE_KINDS` (a different, narrower rule for a different feature: whether an absence conflicts with an active assignment). */
function hasAnyAbsence(events: readonly Event[], personId: string, date: string): boolean {
  return events.some((event) => event.personId === personId && event.date === date && event.category === "absence");
}

/**
 * Technicians eligible to help with `date`'s withdrawal: a real personnel
 * `Person` with `isTechnician === true`, structurally present for `window`
 * (ANY of their own resolved, non-shadow shift Events that date overlaps
 * it -- reusing the exact same `resolveEventShiftInterval`/`clipInterval`
 * presence proof `resolveRelevantSupervisors` uses, never guessed from
 * `Person` existence alone), with no same-date absence Event of any kind
 * and no same-date אילוץ יום.
 *
 * Deterministically ordered by `personId`. Never reads Potential H1/H2 --
 * every input here is already the fresh personnel/schedule/settings read
 * the rest of the notification worker uses.
 */
export function resolveEligibleLogisticsTechnicians(
  events: readonly Event[],
  people: readonly Person[],
  date: string,
  schedule: ShiftSchedule,
  window: MinuteWindow = LOGISTICS_WITHDRAWAL_WINDOW,
): Person[] {
  const presentPersonIds = new Set<string>();
  for (const event of events) {
    if (event.date !== date) continue;
    if (!shiftEventOverlapsWindow(event, schedule, window)) continue;
    presentPersonIds.add(event.personId);
  }

  return people
    .filter((person) => person.isTechnician && presentPersonIds.has(person.id))
    .filter((person) => !hasAnyAbsence(events, person.id, date))
    .filter((person) => !hasBlockingDayConstraint(events, person.id, date))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Hebrew copy helpers -- shared singular/plural phrasing for a name list.
// Never emits one push per assignee (spec): a multi-assignee date produces
// ONE consolidated sentence naming everyone.
// ---------------------------------------------------------------------------

/** "X" / "X ו-Y" / "X, Y ו-Z" -- a conjunctive (never "או") list, since multiple assignees are all doing the withdrawal together. */
export function joinNamesWithVav(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} ו${names[names.length - 1]}`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/**
 * Shared assignee-informed sentence for the relevant supervisor, used both
 * the evening before ("מחר ...") and same-day at noon ("... היום ...") --
 * same deterministic name-joining and singular/plural rules either way,
 * the two callers below only ever differ in word order/timing.
 */
function buildSupervisorAssignedBody(assigneeNames: readonly string[], timing: "tomorrow" | "today"): string {
  const names = joinNamesWithVav(assigneeNames);
  const verb = pluralize(assigneeNames.length, "עושה", "עושים");
  const knowsClause = pluralize(assigneeNames.length, "שהוא מכיר", "שהם מכירים");
  const subject = timing === "tomorrow" ? `מחר ${names}` : names;
  const timeWord = timing === "tomorrow" ? "" : " היום";
  return `${subject} ${verb} משיכות${timeWord} בין 13:00–14:00. נדרש לוודא ${knowsClause} את המשימה.`;
}

/** "מחר איתן עושה משיכות בין 13:00–14:00. נדרש לוודא שהוא מכיר את המשימה." -- pluralized for 2+ assignees. */
export function buildSupervisorAssignedInformedBody(assigneeNames: readonly string[]): string {
  return buildSupervisorAssignedBody(assigneeNames, "tomorrow");
}

/** "איתן עושה משיכות היום בין 13:00–14:00. נדרש לוודא שהוא מכיר את המשימה." -- same-day (noon) counterpart of `buildSupervisorAssignedInformedBody`, pluralized for 2+ assignees. */
export function buildSupervisorAssignedTodayBody(assigneeNames: readonly string[]): string {
  return buildSupervisorAssignedBody(assigneeNames, "today");
}

/** "איתן עושה משיכות היום בין 13:00–14:00. נדרש לעזור לו." -- pluralized for 2+ assignees. */
export function buildTeamHelpAssignedBody(assigneeNames: readonly string[]): string {
  const names = joinNamesWithVav(assigneeNames);
  const verb = pluralize(assigneeNames.length, "עושה", "עושים");
  const pronoun = pluralize(assigneeNames.length, "לו", "להם");
  return `${names} ${verb} משיכות היום בין 13:00–14:00. נדרש לעזור ${pronoun}.`;
}
