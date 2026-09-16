import type { AssignmentTemporalState } from "@/lib/domain/assignmentTemporalState";
import type { AssignmentTiming } from "@/lib/domain/assignmentTiming";
import type { DerivedDutyActionType } from "@/lib/domain/dutyActions";
import type { DutyBlockCertainty, WeekendCompleteness } from "@/lib/domain/dutyBlocks";
import type {
  AbsenceKind,
  DutyFamily,
  EventCategory,
  EventCertainty,
  EventPeriod,
  EventRole,
} from "@/lib/domain/event";
import type { LocalNow } from "@/lib/domain/localNow";
import type { IssueReason, IssueSeverity, RoleCapabilityMismatchMetadata } from "@/lib/domain/operationalIssues";
import type { CoverageStatus } from "@/lib/domain/shiftCoverage";
import type { MinuteInterval } from "@/lib/domain/shiftSchedule";

/**
 * The authenticated person's own safe profile. Deliberately excludes
 * `email` — the authenticated email belongs to the auth boundary, not the
 * presentation/read-model layer.
 */
export interface PersonalProfile {
  id: string;
  name: string;
  isManager: boolean;
  isTechnician: boolean;
  isSupervisor: boolean;
  personnelType: string | null;
}

/**
 * A client-safe projection of one of the authenticated person's own
 * `Event`s. `rawValue` is included (unlike any colleague-facing
 * projection) because unknown/free-text assignments must stay displayable
 * verbatim for the person they belong to. Never includes `sourceSheet`,
 * `sourceCell`, `personId`, or `personName` — those are workbook-origin /
 * identity fields with no place in a serialized read model.
 *
 * `timing` is server-resolved once against `localNow` (never re-derived
 * from raw text in the UI) so any timed display -- the today timeline in
 * particular -- can place an event correctly without recomputing shift
 * rules client-side. `status === "not_evaluable"` for every non-shift
 * category and for any shift whose exact hour can't be resolved -- no
 * invented start/end/duration.
 */
export interface PersonalEventView {
  date: string;
  title: string;
  rawValue: string;
  category: EventCategory;
  certainty: EventCertainty;
  role: EventRole;
  period: EventPeriod;
  slot: number | null;
  shadow: boolean;
  startTimeOverride: string | null;
  endTimeOverride: string | null;
  dutyFamily: DutyFamily | null;
  absenceKind: AbsenceKind | null;
  changeNote: string | null;
  timing: AssignmentTiming;
}

/** A shift/duty `PersonalEventView`, additionally annotated with its resolved temporal state relative to `localNow`. */
export interface PersonalAssignmentView extends PersonalEventView {
  temporalState: AssignmentTemporalState;
}

/**
 * One person working at the same time as one of the viewed person's own
 * shifts -- "מי איתי במשמרת" on the personal calendar.
 *
 * Deliberately NARROWER than `PersonalCounterpart` (itself already the
 * minimal colleague projection): no certainty, no shadow flag, no period,
 * no time overrides, and -- as everywhere in this layer -- no email, no
 * manager/capability flags, no personnelType, no unrelated Events, no
 * sourceSheet/sourceCell. Just who, and what they're doing on that shift.
 *
 * `shiftLabel` is the colleague's OWN shift text as the schedule records
 * it (`Event.title`, the parser's normalized display form of the raw cell)
 * -- e.g. "טכנאי יום", 'אחמ"ש צל', "טכנאית צל". Never recomposed from
 * `role`+`period`, which would flatten every one of those real variants
 * into the same two generic words.
 */
export interface PersonalShiftCompanion {
  personId: string;
  personName: string;
  shiftLabel: string;
}

/**
 * A `PersonalEventView` as it appears on "הלוח שלי" (`/schedule`), where a
 * shift additionally carries who else is on it.
 *
 * A separate type rather than a widening of `PersonalEventView` itself, so
 * roster context reaches ONLY the personal calendar's own events -- never
 * `todayEvents`/`upcomingEvents`/`currentAssignments`, never the ICS feed,
 * and never any other consumer of the base shape (all of which keep
 * accepting these values unchanged, since this only extends it).
 *
 * `shiftCompanions` is `null` for every non-shift event -- a duty,
 * absence, הפנייה or display-only activity has no shift to share, so the
 * question is never asked, which is distinct from asking it and finding
 * nobody (`[]`).
 */
export interface PersonalCalendarEventView extends PersonalEventView {
  shiftCompanions: PersonalShiftCompanion[] | null;
}

/**
 * The earliest upcoming assignment date/time group after
 * `currentAssignments`. May contain more than one Event when several
 * assignments share the same next logical date/start.
 */
export interface PersonalNextAssignmentGroup {
  date: string;
  events: PersonalAssignmentView[];
}

/**
 * Minimal colleague projection for "who is with me?" — deliberately
 * excludes email, manager flag, technician/supervisor capability flags,
 * personnelType, unrelated Events, and sourceSheet/sourceCell. `role` is
 * ANY role, not necessarily the opposite of the viewer's own -- a same-role
 * colleague (e.g. a second supervisor on the same shift) is a legitimate
 * roster entry here, not filtered out (see `PersonalShiftContext`).
 */
export interface PersonalCounterpart {
  personId: string;
  personName: string;
  role: EventRole;
  certainty: EventCertainty;
  shadow: boolean;
  period: EventPeriod;
  startTimeOverride: string | null;
  endTimeOverride: string | null;
}

/**
 * Roster + coverage context for one of the authenticated person's own
 * shifts -- two deliberately separate questions living side by side:
 * `primaryCounterparts`/`shadowCounterparts` answer "who else is actually
 * on this shift with me?" (`buildShiftRoster` — ANY role, same-role
 * colleagues included, never itself a coverage signal), while
 * `coverageStatus`/`missingIntervals` answer "is staffing adequate?"
 * (`analyzeShiftCounterparts` — specifically the OPPOSITE role, including
 * the multi-supervisor staffing waiver). Never infer one from the other:
 * a shift can legitimately show a same-role-only roster (e.g. two
 * supervisors, no technician) alongside a `"full"` `coverageStatus`.
 */
export interface PersonalShiftContext {
  date: string;
  period: EventPeriod;
  role: EventRole;
  coverageStatus: CoverageStatus;
  missingIntervals: MinuteInterval[];
  primaryCounterparts: PersonalCounterpart[];
  shadowCounterparts: PersonalCounterpart[];
}

/** Sanitized target-Event summary for a `PersonalIssue` — never the raw Event. */
export interface PersonalIssueTargetSummary {
  date: string;
  category: EventCategory;
  title: string;
  role: EventRole;
  period: EventPeriod;
  dutyFamily: DutyFamily | null;
}

/**
 * A safe projection of an `OperationalIssue` scoped to the authenticated
 * person. Never carries `sourceSheet`/`sourceCell` or unrelated personnel
 * data — no raw evidence `Event[]`, just a sanitized target summary.
 */
export interface PersonalIssue {
  reason: IssueReason;
  severity: IssueSeverity;
  date: string;
  missingIntervals: MinuteInterval[] | null;
  metadata: RoleCapabilityMismatchMetadata | null;
  targetEvent: PersonalIssueTargetSummary | null;
}

/** Safe `DutyBlock` projection — no `personId`, no raw `events`. */
export interface PersonalDutyBlock {
  dutyFamily: DutyFamily;
  slot: number | null;
  startDate: string;
  endDate: string;
  dates: string[];
  certainty: DutyBlockCertainty;
  dayCount: number;
  weekendCompleteness: WeekendCompleteness;
}

/** Safe `DerivedDutyAction` projection — no `personId`, no nested block/source Events. */
export interface PersonalDutyAction {
  type: DerivedDutyActionType;
  date: string;
  localTime: string;
  dutyFamily: DutyFamily;
  slot: number | null;
}

/**
 * The staffing of a shift immediately adjacent (on the canonical day/night
 * timeline -- see `previousShiftPeriod`/`nextShiftPeriod`) to one of the
 * authenticated person's own current shifts. Reuses `PersonalCounterpart`
 * for `people` since it's the same "who's on this shift" shape already
 * used for מי איתי, just resolved for a shift the person isn't on.
 */
export interface PersonalAdjacentShift {
  date: string;
  period: "day" | "night";
  people: PersonalCounterpart[];
}

/**
 * מי לפניי / מי אחריי context for one of the authenticated person's own
 * current shifts. `date`/`period`/`role` identify which current shift this
 * belongs to (matched the same way as `PersonalShiftContext` — by
 * date+role+period, never array index). `previous`/`next` are `null`
 * whenever the adjacent shift can't be confidently resolved (no canonical
 * adjacency for this period, or nobody is staffed on it) — the UI omits
 * that half quietly rather than rendering an empty state.
 */
export interface PersonalAdjacentShiftContext {
  date: string;
  period: EventPeriod;
  role: EventRole;
  previous: PersonalAdjacentShift | null;
  next: PersonalAdjacentShift | null;
}

/**
 * The full server-computed, per-person, already-filtered view of the
 * schedule. Explicitly safe to serialize to the authenticated person's own
 * browser session — never carries other people's Events, raw workbook
 * objects, or identity fields beyond this person's own safe profile.
 */
export interface PersonalScheduleReadModel {
  person: PersonalProfile;
  fetchedAt: string;
  localNow: LocalNow;

  todayEvents: PersonalEventView[];
  upcomingEvents: PersonalEventView[];

  /**
   * The authenticated person's own shift, duty, and absence Events -- past,
   * current, and future, every one present in the parsed schedule (unlike
   * `upcomingEvents`, which deliberately excludes finished history). Powers
   * "הלוח שלי" (`/schedule`), the personal monthly calendar. Deliberately
   * excludes every other `EventCategory` (constraint/status/context/
   * change_note/other/unknown) -- those aren't calendar-worthy entries on
   * their own. Deterministically ordered, same as every other array here.
   *
   * Each shift additionally carries its own "מי איתי במשמרת" roster (see
   * `PersonalCalendarEventView`), resolved once here from the same
   * server-side Event set every other section reads -- never a per-day or
   * per-person follow-up request from the calendar UI.
   */
  calendarEvents: PersonalCalendarEventView[];

  currentAssignments: PersonalAssignmentView[];
  nextAssignmentGroup: PersonalNextAssignmentGroup | null;

  currentShiftContexts: PersonalShiftContext[];
  nextShiftContexts: PersonalShiftContext[];
  /** מי לפניי / מי אחריי context, one entry per `currentShiftContexts` entry (same match key). */
  currentAdjacentShiftContexts: PersonalAdjacentShiftContext[];

  issues: PersonalIssue[];

  dutyBlocks: PersonalDutyBlock[];
  dutyActions: PersonalDutyAction[];
}
