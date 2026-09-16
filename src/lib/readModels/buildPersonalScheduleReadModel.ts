import {
  classifyAssignmentTemporalState,
  isEventStillRelevant,
} from "@/lib/domain/assignmentTemporalState";
import { computeAssignmentTiming } from "@/lib/domain/assignmentTiming";
import type { DerivedDutyAction } from "@/lib/domain/dutyActions";
import { deriveDutyActions } from "@/lib/domain/dutyActions";
import { buildDutyBlocks, type DutyBlock } from "@/lib/domain/dutyBlocks";
import type { Event } from "@/lib/domain/event";
import type { LocalNow } from "@/lib/domain/localNow";
import {
  detectOperationalIssues,
  type IssueSeverity,
  type OperationalIssue,
} from "@/lib/domain/operationalIssues";
import type { PotentialAllocation } from "@/lib/domain/potentialAllocation";
import { buildPotentialDutyEvents } from "@/lib/domain/potentialDutyEvents";
import { findOverlappingShiftCompanionEvents } from "@/lib/domain/shiftCompanions";
import { analyzeShiftCounterparts, buildShiftRoster, findShiftGroupEvents } from "@/lib/domain/shiftCoverage";
import {
  nextShiftPeriod,
  previousShiftPeriod,
  resolveEventShiftInterval,
  type ShiftSchedule,
} from "@/lib/domain/shiftSchedule";
import { addCalendarDays, formatCalendarDate, subtractCalendarDays } from "@/lib/domain/dateRange";
import { parseCalendarDate } from "@/lib/domain/dutyBlocks";
import type { Person } from "@/lib/domain/types";
import type {
  PersonalAdjacentShift,
  PersonalAdjacentShiftContext,
  PersonalAssignmentView,
  PersonalCalendarEventView,
  PersonalCounterpart,
  PersonalDutyAction,
  PersonalDutyBlock,
  PersonalEventView,
  PersonalIssue,
  PersonalIssueTargetSummary,
  PersonalNextAssignmentGroup,
  PersonalProfile,
  PersonalScheduleReadModel,
  PersonalShiftCompanion,
  PersonalShiftContext,
} from "./types";

export interface BuildPersonalScheduleReadModelInput {
  /** The authenticated Person this read model is being built for. */
  person: Person;
  /** Full parsed personnel list — needed for capability-mismatch issue detection. */
  people: readonly Person[];
  /** Full server-side parsed Event set (every person) — never returned as-is. */
  events: readonly Event[];
  shiftSchedule: ShiftSchedule;
  fetchedAt: string;
  now: LocalNow;
  /**
   * Combined H1 + H2 Potential/תקשא"ס allocations, structurally parsed
   * (`lib/parsers/potential.ts`), across every person — never pre-filtered
   * by the caller. Optional/defaults to empty so every existing caller and
   * test keeps working unchanged. Feeds every duty-display section below
   * (`todayEvents`/`upcomingEvents`/`calendarEvents`/`currentAssignments`/
   * `nextAssignmentGroup`/`dutyBlocks`/`dutyActions`) — but never `issues`,
   * `currentShiftContexts`/`nextShiftContexts` (coverage/roster), which
   * deliberately keep reading the raw, unmodified `events`.
   *
   * A synthetic Potential duty is a GAP-FILLER only, never a second source
   * of truth once a real one exists for that person/date: on top of
   * `buildPotentialDutyEvents`'s own exact `(date, dutyFamily, slot)`
   * dedup, this function additionally drops any synthetic duty for a date
   * where the person already has ANY real internal `category === "duty"`
   * Event at all -- real internal duty data is authoritative for a
   * person/date, full stop, even when its `dutyFamily` doesn't match the
   * Potential requirement (see `excludePotentialDutiesShadowedByRealDuty`'s
   * own docs for the real observed case this precedence rule fixes: an
   * actual internal "מטבח יומי"/daily_kitchen duty coexisting with a
   * mismatched "מטבח מלא 3"/full_kitchen Potential requirement used to show
   * as two separate duties on the person's own calendar). A person with NO
   * real internal duty at all on a date still gets their תקשא"ס-only duty
   * filled in here, exactly as before -- this is a precedence rule, never
   * a blanket exclusion of Potential from personal display.
   *
   * This precedence rule is deliberately local to THIS function, never
   * folded into `buildPotentialDutyEvents`/`buildPotentialDutyEventsForRoster`
   * themselves -- roster-wide, manager-facing callers (Manager Overview's
   * and the "כולם" calendar's own duty completeness lists) keep the
   * original per-slot-only dedup unchanged, and
   * `reconcilePotentialAllocations` (missing/covered requirement
   * detection, source-conflict logic) is entirely untouched -- neither is
   * built from this function's output.
   */
  potentialAllocations?: readonly PotentialAllocation[];
}

/**
 * Pure, deterministic construction of the authenticated person's safe
 * `PersonalScheduleReadModel` from already-parsed domain data. No network,
 * no auth, no Date/UTC — every temporal decision goes through `now`
 * (an explicit `LocalNow`) and the existing shift/duty domain rules.
 *
 * Never mutates `events`/`people`/`person`, and never lets input Event
 * order affect output order — every array below is explicitly sorted.
 */
export function buildPersonalScheduleReadModel(
  input: BuildPersonalScheduleReadModelInput,
): PersonalScheduleReadModel {
  const { person, people, events, shiftSchedule, fetchedAt, now, potentialAllocations = [] } = input;

  const personEvents = events.filter((event) => event.personId === person.id);

  /**
   * A normal department person's duties already have a real Event for
   * every occurrence, so `buildPotentialDutyEvents` drops every matching
   * (exact date+dutyFamily+slot) Potential allocation as already-covered.
   * `excludePotentialDutiesShadowedByRealDuty` goes one step further,
   * dropping ANY remaining synthetic duty for a date where the person
   * already has SOME real internal duty (even a different family/slot) --
   * see its own doc comment for why. What's left is only a genuine gap:
   * a date with a Potential requirement and NO real internal duty at all,
   * which still flows into every place this read model already displays
   * that person's own duties -- the calendar, today/upcoming, and
   * current/next assignments (PR #60 originally wired this into
   * `dutyBlocks`/`dutyActions` only; this is the same conversion, just
   * consumed more broadly) -- never JUST the personal Duties page.
   * `issues`/shift counterpart context/coverage below deliberately keep
   * reading the RAW `events` (every person, unmodified) instead of this
   * per-person merged list — a synthetic duty Event only ever represents
   * duty data for ITS OWN person's display, never a second source of
   * shift/coverage truth for anyone.
   */
  const potentialDutyEvents = excludePotentialDutiesShadowedByRealDuty(
    buildPotentialDutyEvents(potentialAllocations, person, people, personEvents),
    personEvents,
  );
  const personDisplayEvents = [...personEvents, ...potentialDutyEvents];
  const sortedPersonEvents = [...personDisplayEvents].sort((a, b) => compareEventsForDisplay(a, b, shiftSchedule));

  const todayEvents = sortedPersonEvents
    .filter((event) => event.date === now.date)
    .map((event) => toEventView(event, shiftSchedule, now));

  const upcomingEvents = sortedPersonEvents
    .filter((event) => isEventStillRelevant(event, shiftSchedule, now))
    .map((event) => toEventView(event, shiftSchedule, now));

  // Indexed ONCE for the whole calendar, from the same raw `events` every
  // other roster/coverage section reads -- so resolving "מי איתי במשמרת"
  // for a month of shifts stays a handful of date lookups rather than a
  // full scan per shift (and never a per-shift or per-person data request).
  const shiftEventsByDate = indexShiftEventsByDate(events);

  const calendarEvents = sortedPersonEvents
    .filter((event) => isPersonalCalendarActivityEvent(event))
    .map((event) => toCalendarEventView(event, shiftSchedule, now, shiftEventsByDate));

  const assignmentEvents = sortedPersonEvents.filter(isAssignmentEvent);

  const currentAssignments = assignmentEvents
    .filter((event) => classifyAssignmentTemporalState(event, shiftSchedule, now) === "current")
    .map((event) => toAssignmentView(event, shiftSchedule, now));

  const upcomingAssignmentCandidates = assignmentEvents.filter((event) =>
    isFutureAssignmentCandidate(event, shiftSchedule, now),
  );

  const nextGroupEvents = selectEarliestAssignmentGroup(upcomingAssignmentCandidates, shiftSchedule);
  const nextAssignmentGroup: PersonalNextAssignmentGroup | null =
    nextGroupEvents.length === 0
      ? null
      : {
          date: nextGroupEvents[0].date,
          events: nextGroupEvents.map((event) => toAssignmentView(event, shiftSchedule, now)),
        };

  const currentShiftEvents = assignmentEvents.filter(
    (event) =>
      event.category === "shift" && classifyAssignmentTemporalState(event, shiftSchedule, now) === "current",
  );
  const nextShiftEvents = selectEarliestAssignmentGroup(
    assignmentEvents.filter(
      (event) => event.category === "shift" && isFutureAssignmentCandidate(event, shiftSchedule, now),
    ),
    shiftSchedule,
  );

  const currentShiftContexts = currentShiftEvents.map((event) => buildShiftContext(event, events, shiftSchedule));
  const nextShiftContexts = nextShiftEvents.map((event) => buildShiftContext(event, events, shiftSchedule));
  const currentAdjacentShiftContexts = currentShiftEvents.map((event) =>
    buildAdjacentShiftContext(event, events, shiftSchedule),
  );

  const allIssues = detectOperationalIssues(events, people, shiftSchedule);
  const issues = allIssues
    .filter((issue) => issue.personId === person.id)
    .filter((issue) => isIssueRelevant(issue, shiftSchedule, now))
    .sort(compareIssues)
    .map(toPersonalIssue);

  // Merged into the SAME `buildDutyBlocks` call (never a second grouping
  // implementation) so a duty that spans both sources on consecutive dates
  // still groups into one real block instead of two artificial ones.
  const dutyBlocks = buildDutyBlocks(personDisplayEvents);
  const dutyActions = deriveDutyActions(dutyBlocks).filter((action) => action.date >= now.date);

  return {
    person: toPersonalProfile(person),
    fetchedAt,
    localNow: now,
    todayEvents,
    upcomingEvents,
    calendarEvents,
    currentAssignments,
    nextAssignmentGroup,
    currentShiftContexts,
    nextShiftContexts,
    currentAdjacentShiftContexts,
    issues,
    dutyBlocks: dutyBlocks.map(toDutyBlockView),
    dutyActions: dutyActions.map(toDutyActionView),
  };
}

/**
 * PERSONAL-read-model-only precedence rule, applied ON TOP OF
 * `buildPotentialDutyEvents`'s own exact `(date, dutyFamily, slot)` dedup:
 * a synthetic Potential duty is excluded whenever the person already has
 * ANY real internal `category === "duty"` Event on that exact date --
 * regardless of whether its `dutyFamily`/`slot` actually matches the
 * Potential requirement.
 *
 * Real internal duty data is authoritative for a person/date, full stop.
 * The real observed case this fixes: an actual internal "מטבח יומי"
 * (`daily_kitchen`) duty coexisting with a mismatched "מטבח מלא 3"
 * (`full_kitchen`) Potential requirement for the same person/date used to
 * show as two separate duties on the person's own calendar, even though
 * Potential is only organizational/source planning data, never a second
 * confirmed schedule entry -- `buildPotentialDutyEvents`'s own dedup never
 * caught this because it only matches an EXACT `dutyFamily`+`slot` triple,
 * by design (see its own docs), not "any duty this date".
 *
 * A person with NO real internal duty at all on a date is completely
 * unaffected -- their תקשא"ס-only duty still fills the gap exactly as
 * before; this only ever narrows an EXISTING synthetic duty list, never
 * widens it. Source-based, not certainty-based: a genuinely tentative
 * REAL internal duty (parsed with a trailing "?") still counts as "a real
 * duty this date" here -- `event.category === "duty"` alone decides this,
 * never `event.certainty`.
 *
 * Deliberately local to `buildPersonalScheduleReadModel` -- never folded
 * into `buildPotentialDutyEvents`/`buildPotentialDutyEventsForRoster`
 * themselves, so roster-wide manager-facing callers (Manager Overview's
 * and the "כולם" calendar's own duty completeness lists) keep their
 * original per-slot-only dedup unchanged.
 */
function excludePotentialDutiesShadowedByRealDuty(
  potentialDutyEvents: readonly Event[],
  personEvents: readonly Event[],
): Event[] {
  const datesWithRealDuty = new Set(
    personEvents.filter((event) => event.category === "duty").map((event) => event.date),
  );
  return potentialDutyEvents.filter((event) => !datesWithRealDuty.has(event.date));
}

function isAssignmentEvent(event: Event): boolean {
  return event.category === "shift" || event.category === "duty";
}

/**
 * The external ICS feed's calendar-worthy categories -- shift, duty, and
 * absence. Every other `EventCategory` is internal bookkeeping, never an
 * ICS entry on its own. Exported so `lib/calendar/icsItems.ts` (the
 * personal ICS feed) reuses the exact same definition rather than risking
 * a second one drifting out of sync. Deliberately NOT reused for the
 * in-app "הלוח שלי" calendar's own (wider) inclusion policy any more -- see
 * `isPersonalCalendarActivityEvent` below -- so widening the in-app
 * calendar can never silently widen what this app exports to ICS too.
 */
export function isCalendarDisplayEvent(event: Event): boolean {
  return event.category === "shift" || event.category === "duty" || event.category === "absence";
}

/**
 * The in-app "הלוח שלי" personal calendar's OWN, wider inclusion policy --
 * every `isCalendarDisplayEvent` category, PLUS a display-only personal
 * "activity" (category `"status"` -- e.g. סוגר -- or `"other"` -- e.g.
 * שלב 9/שלב 11/כנס בטיחות, or any future unrecognized non-empty personal
 * schedule text). These are calendar/display information only: `title` is
 * always non-empty for these two categories already (the parser's own
 * `classify()` only ever produces `"status"`/`"other"` for non-empty text
 * -- see `lib/parsers/event.ts`), but the check stays explicit here as a
 * documented invariant, not an assumption.
 *
 * `constraint`/`context`/`change_note`/`unknown` remain excluded -- this is
 * a narrow widening for genuinely informational activities, never a
 * blanket "show every category" policy.
 *
 * Deliberately a SEPARATE predicate from `isCalendarDisplayEvent`, never a
 * broadened version of it -- the external ICS feed
 * (`lib/calendar/icsItems.ts`/`loadCalendarFeedForToken.ts`) keeps
 * importing the narrower `isCalendarDisplayEvent` unchanged, so this
 * in-app-only widening can never leak into the ICS feed as a side effect.
 *
 * These activities stay operationally inert by construction, not by any
 * new check added here: `isAssignmentEvent` below (shift/duty only),
 * `buildDutyBlocks` (`category === "duty" && dutyFamily !== null`),
 * shift-coverage/roster (`category === "shift"` throughout
 * `shiftCoverage.ts`), and `detectOperationalIssues`/
 * `classifyAssignmentTemporalState` (shift/duty/absence only) all already
 * gate strictly on their own specific categories -- a `"status"`/`"other"`
 * event was never eligible to become an assignment, duty, coverage
 * contributor, or issue target before this predicate existed, and adding
 * it to the calendar grid here doesn't change any of that.
 */
export function isPersonalCalendarActivityEvent(event: Event): boolean {
  if (isCalendarDisplayEvent(event)) return true;
  if (event.category !== "status" && event.category !== "other") return false;
  return event.title.trim() !== "";
}

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

/** Resolved shift start minute for sorting; unresolved/non-shift sorts last within its date. */
function effectiveStartMinuteForSort(event: Event, schedule: ShiftSchedule): number {
  const resolution = resolveEventShiftInterval(event, schedule);
  return resolution.status === "resolved" ? resolution.interval.startMinute : Number.POSITIVE_INFINITY;
}

/**
 * date -> effective shift start -> category -> a stable, source-independent
 * tie-breaker. `sourceSheet`/`sourceCell` are used here only as an internal
 * sort key -- they are never present on any exposed projection.
 */
function compareEventsForDisplay(a: Event, b: Event, schedule: ShiftSchedule): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;

  const startA = effectiveStartMinuteForSort(a, schedule);
  const startB = effectiveStartMinuteForSort(b, schedule);
  if (startA !== startB) return startA - startB;

  if (a.category !== b.category) return a.category < b.category ? -1 : 1;
  if (a.sourceSheet !== b.sourceSheet) return a.sourceSheet < b.sourceSheet ? -1 : 1;
  return a.sourceCell < b.sourceCell ? -1 : a.sourceCell > b.sourceCell ? 1 : 0;
}

/**
 * A future/upcoming assignment candidate for `nextAssignmentGroup` /
 * `nextShiftContexts`: either a normally-classified "upcoming" assignment
 * (duty, or a resolved future/later-today shift), or a future-dated shift
 * whose exact timing can't be resolved. The latter is never excluded just
 * because its hour is unknown -- its calendar date alone is still known to
 * be future, and it's carried through with an honest `not_evaluable`
 * timing state rather than a guessed one. A same-day not_evaluable shift
 * is deliberately excluded here -- its timing can't be shown to be either
 * done or still to come.
 */
function isFutureAssignmentCandidate(event: Event, schedule: ShiftSchedule, now: LocalNow): boolean {
  const state = classifyAssignmentTemporalState(event, schedule, now);
  if (state === "upcoming") return true;
  return state === "not_evaluable" && event.category === "shift" && event.date > now.date;
}

function isResolvedShiftEvent(event: Event, schedule: ShiftSchedule): boolean {
  return event.category === "shift" && resolveEventShiftInterval(event, schedule).status === "resolved";
}

/**
 * Picks the single earliest calendar date among `events` and returns every
 * event on that date, deterministically ordered -- the group for
 * `nextAssignmentGroup` / the "next shift" pick behind `nextShiftContexts`.
 *
 * Within that date, date-level entries (duties, and shifts whose exact
 * hour can't be resolved) are always kept -- they never get dropped just
 * because a resolved shift on the same date has a finite start minute to
 * sort by. Resolved shifts on that date are narrowed to only the
 * earliest-starting one(s), so a later same-date shift doesn't crowd out
 * the group's "next" meaning; it simply isn't in *this* group.
 */
function selectEarliestAssignmentGroup(events: readonly Event[], schedule: ShiftSchedule): Event[] {
  if (events.length === 0) return [];

  const earliestDate = events.reduce((min, event) => (event.date < min ? event.date : min), events[0].date);
  const sameDateEvents = events.filter((event) => event.date === earliestDate);

  const resolvedShiftEvents = sameDateEvents.filter((event) => isResolvedShiftEvent(event, schedule));
  const dateLevelEvents = sameDateEvents.filter((event) => !isResolvedShiftEvent(event, schedule));

  let earliestResolvedShifts: Event[] = [];
  if (resolvedShiftEvents.length > 0) {
    const earliestStart = Math.min(
      ...resolvedShiftEvents.map((event) => effectiveStartMinuteForSort(event, schedule)),
    );
    earliestResolvedShifts = resolvedShiftEvents.filter(
      (event) => effectiveStartMinuteForSort(event, schedule) === earliestStart,
    );
  }

  return [...dateLevelEvents, ...earliestResolvedShifts].sort((a, b) => compareEventsForDisplay(a, b, schedule));
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Record<IssueSeverity, number> = { critical: 0, review: 1, info: 2 };

function compareIssues(a: OperationalIssue, b: OperationalIssue): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (SEVERITY_ORDER[a.severity] !== SEVERITY_ORDER[b.severity]) {
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  }
  if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1;

  const keyA = issueTargetSortKey(a);
  const keyB = issueTargetSortKey(b);
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

/** Internal-only sort key (sourceSheet/sourceCell never leave this file). */
function issueTargetSortKey(issue: OperationalIssue): string {
  if (issue.targetEvent) return `${issue.targetEvent.sourceSheet}!${issue.targetEvent.sourceCell}`;
  return issue.events.map((event) => `${event.sourceSheet}!${event.sourceCell}`).join(",");
}

/**
 * An issue is relevant if it's dated today or later, or if its evidence is
 * a still-current overnight shift dated yesterday -- the same
 * carry-forward rule as `upcomingEvents`, so a still-active overnight
 * shift's coverage issue is never lost merely because `issue.date` is
 * yesterday.
 */
function isIssueRelevant(issue: OperationalIssue, schedule: ShiftSchedule, now: LocalNow): boolean {
  const evidenceEvent = issue.targetEvent ?? issue.events.find((event) => event.date === issue.date) ?? null;
  if (!evidenceEvent) return issue.date >= now.date;
  return isEventStillRelevant(evidenceEvent, schedule, now);
}

// ---------------------------------------------------------------------------
// Safe projections
// ---------------------------------------------------------------------------

/** Exported so the orchestration loader can project a Person into a safe profile outside a full read model (e.g. for `configuration_error`). */
export function toPersonalProfile(person: Person): PersonalProfile {
  return {
    id: person.id,
    name: person.name,
    isManager: person.isManager,
    isTechnician: person.isTechnician,
    isSupervisor: person.isSupervisor,
    personnelType: person.personnelType,
  };
}

function toEventView(event: Event, schedule: ShiftSchedule, now: LocalNow): PersonalEventView {
  return {
    date: event.date,
    title: event.title,
    rawValue: event.rawValue,
    category: event.category,
    certainty: event.certainty,
    role: event.role,
    period: event.period,
    slot: event.slot,
    shadow: event.shadow,
    startTimeOverride: event.startTimeOverride,
    endTimeOverride: event.endTimeOverride,
    dutyFamily: event.dutyFamily,
    absenceKind: event.absenceKind,
    changeNote: event.changeNote,
    timing: computeAssignmentTiming(event, schedule, now),
  };
}

/**
 * Every `category === "shift"` Event bucketed by its own `date`. Built once
 * per read model so `buildShiftCompanions` below can look at only the three
 * dates a shift can possibly overlap, instead of re-filtering the full
 * server-side Event set for every single calendar shift.
 */
function indexShiftEventsByDate(events: readonly Event[]): Map<string, Event[]> {
  const byDate = new Map<string, Event[]>();
  for (const event of events) {
    if (event.category !== "shift") continue;
    const bucket = byDate.get(event.date);
    if (bucket) bucket.push(event);
    else byDate.set(event.date, [event]);
  }
  return byDate;
}

/**
 * The only dates a shift dated `date` can overlap: its own, the previous,
 * and the next. A shift interval starts within its own date and runs at
 * most 12 hours past the end of it (`nightEndMinute` never reaches 2880 --
 * see `shiftSchedule.ts`), so anything two or more days out is
 * structurally unable to overlap, whatever its time overrides say. An
 * unparseable date yields just its own bucket -- `shiftsOverlapInTime`
 * falls back to its structural date+period rule there anyway.
 */
function candidateShiftEventsAround(date: string, shiftEventsByDate: Map<string, Event[]>): Event[] {
  const parsed = parseCalendarDate(date);
  const dates =
    parsed === null
      ? [date]
      : [
          formatCalendarDate(subtractCalendarDays(parsed, 1)),
          date,
          formatCalendarDate(addCalendarDays(parsed, 1)),
        ];

  return dates.flatMap((candidateDate) => shiftEventsByDate.get(candidateDate) ?? []);
}

/**
 * "מי איתי במשמרת" for ONE of the viewed person's own shifts: every other
 * person whose shift genuinely overlaps it in time (see
 * `findOverlappingShiftCompanionEvents` -- never same-date alone, and
 * correct across midnight), collapsed to one row per person by the same
 * `sortAndDedupeRoster` the dashboard's own מי איתי roster already uses, so
 * a split-shift colleague with two Events is listed once.
 */
function buildShiftCompanions(
  target: Event,
  shiftEventsByDate: Map<string, Event[]>,
  schedule: ShiftSchedule,
): PersonalShiftCompanion[] {
  const candidates = candidateShiftEventsAround(target.date, shiftEventsByDate);
  const overlapping = findOverlappingShiftCompanionEvents(target, candidates, schedule);
  return sortAndDedupeRoster(overlapping, schedule).map(toShiftCompanion);
}

function toShiftCompanion(event: Event): PersonalShiftCompanion {
  const title = event.title.trim();
  return {
    personId: event.personId,
    personName: event.personName,
    // The colleague's own recorded shift text, never recomposed from
    // role+period (which would turn "טכנאית צל" into "טכנאי · לילה").
    // `rawValue` only ever backstops a structurally-impossible empty title.
    shiftLabel: title !== "" ? title : event.rawValue.trim(),
  };
}

function toCalendarEventView(
  event: Event,
  schedule: ShiftSchedule,
  now: LocalNow,
  shiftEventsByDate: Map<string, Event[]>,
): PersonalCalendarEventView {
  return {
    ...toEventView(event, schedule, now),
    shiftCompanions:
      event.category === "shift" ? buildShiftCompanions(event, shiftEventsByDate, schedule) : null,
  };
}

function toAssignmentView(event: Event, schedule: ShiftSchedule, now: LocalNow): PersonalAssignmentView {
  return {
    ...toEventView(event, schedule, now),
    temporalState: classifyAssignmentTemporalState(event, schedule, now),
  };
}

function toCounterpart(event: Event): PersonalCounterpart {
  return {
    personId: event.personId,
    personName: event.personName,
    role: event.role,
    certainty: event.certainty,
    shadow: event.shadow,
    period: event.period,
    startTimeOverride: event.startTimeOverride,
    endTimeOverride: event.endTimeOverride,
  };
}

/**
 * Sorted (see `compareCounterpartEvents`), then collapsed to one Event per
 * distinct `personId` -- a genuine split-shift colleague with two Events
 * for the same date+period shows as ONE roster row (their earliest-starting
 * segment, since sorting runs first), never two. Domain-level
 * `buildShiftRoster` deliberately keeps every real Event; this dedup is a
 * read-model presentation decision, not a structural one.
 */
function sortAndDedupeRoster(events: readonly Event[], schedule: ShiftSchedule): Event[] {
  const sorted = [...events].sort((a, b) => compareCounterpartEvents(a, b, schedule));
  const seenPersonIds = new Set<string>();
  const deduped: Event[] = [];
  for (const event of sorted) {
    if (seenPersonIds.has(event.personId)) continue;
    seenPersonIds.add(event.personId);
    deduped.push(event);
  }
  return deduped;
}

function buildShiftContext(
  target: Event,
  allEvents: readonly Event[],
  schedule: ShiftSchedule,
): PersonalShiftContext {
  // Coverage validity (does the OPPOSITE role adequately cover me, including
  // the multi-supervisor staffing waiver) and roster/companionship (who else
  // is actually on this shift, any role) are deliberately two separate
  // domain questions -- see `analyzeShiftCounterparts` vs `buildShiftRoster`.
  // "מי איתי" must never be read as an implicit coverage algorithm: the
  // people listed below can include same-role colleagues that this
  // `coverageStatus` never counts as coverage for either role.
  const coverage = analyzeShiftCounterparts(target, allEvents, schedule);
  const roster = buildShiftRoster(target, allEvents);

  return {
    date: target.date,
    period: target.period,
    role: target.role,
    coverageStatus: coverage.coverageStatus,
    missingIntervals: coverage.missingIntervals,
    primaryCounterparts: sortAndDedupeRoster(roster.primaryRoster, schedule).map(toCounterpart),
    shadowCounterparts: sortAndDedupeRoster(roster.shadowRoster, schedule).map(toCounterpart),
  };
}

/**
 * מי לפניי / מי אחריי -- the staffing of `target`'s immediately preceding
 * and following shift on the canonical day/night timeline, resolved via
 * `previousShiftPeriod`/`nextShiftPeriod` (never a hardcoded day→night→day
 * assumption) and `findShiftGroupEvents` (no target-person concept needed,
 * unlike `buildShiftRoster`). Quiet by construction: `previous`/`next` is
 * `null` whenever the period has no canonical adjacency (morning/
 * unspecified) or nobody is staffed on the adjacent shift -- never an
 * empty-but-present block.
 */
function buildAdjacentShiftContext(
  target: Event,
  allEvents: readonly Event[],
  schedule: ShiftSchedule,
): PersonalAdjacentShiftContext {
  return {
    date: target.date,
    period: target.period,
    role: target.role,
    previous: resolveAdjacentShift(previousShiftPeriod(target.date, target.period), allEvents, schedule),
    next: resolveAdjacentShift(nextShiftPeriod(target.date, target.period), allEvents, schedule),
  };
}

function resolveAdjacentShift(
  adjacent: { date: string; period: "day" | "night" } | null,
  allEvents: readonly Event[],
  schedule: ShiftSchedule,
): PersonalAdjacentShift | null {
  if (!adjacent) return null;

  const groupEvents = findShiftGroupEvents(allEvents, adjacent.date, adjacent.period);
  if (groupEvents.length === 0) return null;

  return {
    date: adjacent.date,
    period: adjacent.period,
    people: sortAndDedupeRoster(groupEvents, schedule).map(toCounterpart),
  };
}

/**
 * Total, deterministic order for a target shift's roster Events -- both
 * `analyzeShiftCounterparts` and `buildShiftRoster` preserve whatever order
 * their input Event array happened to have, so this is what keeps the
 * serialized counterpart/roster lists stable regardless of the full
 * server-side Event set's order. `sourceSheet`/`sourceCell` are used only
 * as the final internal tie-break; neither is ever present on the exposed
 * `PersonalCounterpart`.
 */
function compareCounterpartEvents(a: Event, b: Event, schedule: ShiftSchedule): number {
  const startA = effectiveStartMinuteForSort(a, schedule);
  const startB = effectiveStartMinuteForSort(b, schedule);
  if (startA !== startB) return startA - startB;

  if (a.personId !== b.personId) return a.personId < b.personId ? -1 : 1;

  const roleCmp = compareNullableString(a.role, b.role);
  if (roleCmp !== 0) return roleCmp;

  if (a.period !== b.period) return a.period < b.period ? -1 : 1;

  const startOverrideCmp = compareNullableString(a.startTimeOverride, b.startTimeOverride);
  if (startOverrideCmp !== 0) return startOverrideCmp;

  const endOverrideCmp = compareNullableString(a.endTimeOverride, b.endTimeOverride);
  if (endOverrideCmp !== 0) return endOverrideCmp;

  if (a.sourceSheet !== b.sourceSheet) return a.sourceSheet < b.sourceSheet ? -1 : 1;
  return a.sourceCell < b.sourceCell ? -1 : a.sourceCell > b.sourceCell ? 1 : 0;
}

/** null sorts before any string -- a stable rule for comparing optional text fields. */
function compareNullableString(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

function toIssueTargetSummary(event: Event): PersonalIssueTargetSummary {
  return {
    date: event.date,
    category: event.category,
    title: event.title,
    role: event.role,
    period: event.period,
    dutyFamily: event.dutyFamily,
  };
}

function toPersonalIssue(issue: OperationalIssue): PersonalIssue {
  return {
    reason: issue.reason,
    severity: issue.severity,
    date: issue.date,
    missingIntervals: issue.missingIntervals,
    metadata: issue.metadata,
    targetEvent: issue.targetEvent ? toIssueTargetSummary(issue.targetEvent) : null,
  };
}

function toDutyBlockView(block: DutyBlock): PersonalDutyBlock {
  return {
    dutyFamily: block.dutyFamily,
    slot: block.slot,
    startDate: block.startDate,
    endDate: block.endDate,
    dates: block.dates,
    certainty: block.certainty,
    dayCount: block.dayCount,
    weekendCompleteness: block.weekendCompleteness,
  };
}

function toDutyActionView(action: DerivedDutyAction): PersonalDutyAction {
  return {
    type: action.type,
    date: action.date,
    localTime: action.localTime,
    dutyFamily: action.dutyBlock.dutyFamily,
    slot: action.dutyBlock.slot,
  };
}
