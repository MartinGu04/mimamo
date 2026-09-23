import type { Event } from "@/lib/domain/event";
import type { LocalNow } from "@/lib/domain/localNow";
import type { OperationalWeek } from "@/lib/domain/operationalWeek";
import type { PotentialAllocation } from "@/lib/domain/potentialAllocation";
import { buildPotentialDutyEventsForRoster } from "@/lib/domain/potentialDutyEvents";
import type { ShiftSchedule } from "@/lib/domain/shiftSchedule";
import type { Person } from "@/lib/domain/types";
import { buildPersonalScheduleReadModel } from "./buildPersonalScheduleReadModel";
import { buildScheduleTeamWeekView } from "./buildScheduleTeamWeekView";
import { buildManagerAbsenceEntries, buildManagerDutyEntries, buildShiftStaffingOverview } from "./managerEventProjections";
import type { ScheduleEveryoneReadModel, ScheduleReadModel, ScheduleRosterOption, ScheduleTeamWeekView } from "./scheduleTypes";
import type { PersonalScheduleReadModel } from "./types";

/**
 * Wraps the authenticated person's own `PersonalScheduleReadModel` as a
 * "self" `ScheduleReadModel` with no manager scope at all. Used for:
 * (1) every mapped viewer's default "self" request (manager or not --
 * `?person=` absent), (2) a non-manager's `?person=<anything other than
 * "all">` -- always normalizes/falls back to self, never that other
 * person's schedule, and (3) the fail-closed fallback when a manager's
 * fresh re-authorization (see `schedule.ts`) can't be re-proven for this
 * request. `manager: null` / `roster: []` is exactly what tells the page
 * to render zero manager UI -- never a client-side `isManager` flag.
 */
export function buildSelfOnlyScheduleReadModel(model: PersonalScheduleReadModel): ScheduleReadModel {
  return {
    fetchedAt: model.fetchedAt,
    localNow: model.localNow,
    manager: null,
    roster: [],
    perspective: "self",
    selectedPersonId: null,
    selectedPersonName: null,
    personal: model,
    everyone: null,
    teamWeek: null,
  };
}

export interface BuildManagerScheduleReadModelInput {
  /** The authenticated manager -- already verified `isManager === true` and freshly re-checked by the caller (see `managerWorkbookContext.ts`). */
  manager: Person;
  /** Full parsed personnel list -- everyone visible to the manager. */
  people: readonly Person[];
  /** Full parsed internal Event[] (every person). */
  events: readonly Event[];
  shiftSchedule: ShiftSchedule;
  fetchedAt: string;
  now: LocalNow;
  /** Every calendar date in the displayed month -- scopes "all" perspective's staffing/duties/absences. Unused for "self"/"person" (`PersonalScheduleReadModel` carries its own full, unscoped `calendarEvents`, filtered by month at the page like today). */
  monthDates: readonly string[];
  /** The resolved Sunday-Saturday operational week -- scopes "all" perspective's `teamWeek` matrix ONLY (see `buildScheduleTeamWeekView`). Independent of `monthDates`/the displayed calendar month; unused for "self"/"person". */
  week: OperationalWeek;
  /**
   * Raw, unvalidated `?person=` value -- `null`/omitted means "self", the
   * literal string `"all"` means "everyone", anything else is a candidate
   * person id. NEVER trusted without validating against `people` --
   * see `resolveSchedulePerspective`.
   */
  requestedPersonId: string | null;
  /**
   * Combined H1 + H2 Potential/תקשא"ס allocations, structurally parsed —
   * threaded straight through to `buildPersonalScheduleReadModel` for the
   * "self"/"person" perspectives (see there for exactly which sections it
   * feeds). Optional/defaults to empty. The "all" perspective also reads
   * this now, but ONLY for `everyone.duties` (via
   * `buildPotentialDutyEventsForRoster`) -- `everyone.staffing` keeps
   * reading the raw `events` untouched, so this can never affect shift
   * staffing/coverage, which stays out of scope for this source.
   */
  potentialAllocations?: readonly PotentialAllocation[];
}

type ResolvedSchedulePerspective =
  | { kind: "self" }
  | { kind: "all" }
  | { kind: "person"; person: Person };

/**
 * Fail-closed resolution of the raw `?person=` param (PR #24 §9): an
 * unknown id, a stale id, malformed input, or an id outside `people` (the
 * manager's own currently-authorized roster) all fall back to SELF -- never
 * to "everyone", and never by throwing. Selecting the manager's own id
 * also normalizes to "self" (PR #24 §8: self mode prefers no `person`
 * param at all over an explicit self-referencing one).
 */
function resolveSchedulePerspective(
  requestedPersonId: string | null,
  people: readonly Person[],
  managerId: string,
): ResolvedSchedulePerspective {
  if (requestedPersonId === null) return { kind: "self" };
  if (requestedPersonId === "all") return { kind: "all" };

  const person = people.find((candidate) => candidate.id === requestedPersonId);
  if (!person || person.id === managerId) return { kind: "self" };
  return { kind: "person", person };
}

/** By name, then id as a stable tiebreak -- duplicate names stay a safe, deterministic order (the URL always selects by id, never by name). Same convention as `ManagerOverviewReadModel.roster`. */
function compareRosterOptions(a: ScheduleRosterOption, b: ScheduleRosterOption): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Every person visible to the manager EXCEPT the manager themselves (PR #24 §6 -- they already have the explicit "אני" entry, never shown twice). */
function buildRosterOptions(people: readonly Person[], managerId: string): ScheduleRosterOption[] {
  return people
    .filter((person) => person.id !== managerId)
    .map(
      (person): ScheduleRosterOption => ({
        id: person.id,
        name: person.name,
        personnelType: person.personnelType,
        isSupervisor: person.isSupervisor,
        isTechnician: person.isTechnician,
      }),
    )
    .sort(compareRosterOptions);
}

interface BuildEveryoneTeamViewInput {
  people: readonly Person[];
  events: readonly Event[];
  shiftSchedule: ShiftSchedule;
  monthDates: readonly string[];
  week: OperationalWeek;
  potentialAllocations?: readonly PotentialAllocation[];
}

interface EveryoneTeamView {
  everyone: ScheduleEveryoneReadModel;
  teamWeek: ScheduleTeamWeekView;
}

/**
 * The pure "everyone"/"שבוע צוות" projection, factored out so there is
 * exactly ONE place that decides what "team staffing"/"team week" means
 * from a given events/people/week snapshot -- shared by EVERY caller that
 * ever builds the "all" perspective, an authorized manager
 * (`buildManagerScheduleReadModel`'s own "all" branch) and an authorized
 * non-manager mapped viewer (`buildMappedEveryoneScheduleReadModel`) alike.
 * Never two independently maintained copies of this projection that could
 * quietly drift apart from each other.
 */
function buildEveryoneTeamView(input: BuildEveryoneTeamViewInput): EveryoneTeamView {
  const dates = new Set(input.monthDates);
  const peopleById = new Map(input.people.map((person) => [person.id, person]));

  // Same `buildPotentialDutyEventsForRoster` duty-completeness widening
  // `buildManagerScheduleReadModel`'s own "all" branch always applied --
  // see that function's own docstring for why this feeds ONLY `duties`,
  // never `staffing`.
  const eventsWithPotentialDuties = [
    ...input.events,
    ...buildPotentialDutyEventsForRoster(input.potentialAllocations ?? [], input.people, input.events),
  ];

  return {
    everyone: {
      staffing: buildShiftStaffingOverview(input.events, input.shiftSchedule, dates),
      duties: buildManagerDutyEntries(eventsWithPotentialDuties, peopleById, dates),
      absences: buildManagerAbsenceEntries(input.events, peopleById, dates),
    },
    teamWeek: buildScheduleTeamWeekView(input.events, input.people, input.week),
  };
}

/**
 * Pure, deterministic construction of a manager's `ScheduleReadModel` from
 * already-parsed domain data -- no network, no auth, no Date/UTC, mirrors
 * `buildManagerOverviewReadModel`'s purity contract. Never mutates any
 * input array.
 *
 * "self" and "person" both reuse `buildPersonalScheduleReadModel` outright
 * (PR #24 §11) -- the SAME architectural idea `ManagerOverviewReadModel.
 * selectedPerson` already uses -- rather than reimplementing any personal
 * domain logic. "self" is simply that call with `person = manager`, so a
 * manager's own view is byte-for-byte what a normal user with the same
 * Events would see. "all" builds a separate, explicitly-typed team
 * staffing projection (`buildShiftStaffingOverview` et al.) instead of
 * forcing per-date staffing into `PersonalEventView` (PR #24 §14).
 * `everyone.duties` additionally gets תקשא"ס period (Potential) duty
 * completeness the same way Manager Overview's roster-wide `duties` list
 * does (`buildPotentialDutyEventsForRoster`, reused outright) -- a
 * calendar-visible duty entry only, never mixed into `everyone.staffing`.
 */
export function buildManagerScheduleReadModel(input: BuildManagerScheduleReadModelInput): ScheduleReadModel {
  const {
    manager,
    people,
    events,
    shiftSchedule,
    fetchedAt,
    now,
    monthDates,
    week,
    requestedPersonId,
    potentialAllocations,
  } = input;

  const roster = buildRosterOptions(people, manager.id);
  const perspective = resolveSchedulePerspective(requestedPersonId, people, manager.id);

  if (perspective.kind === "all") {
    const { everyone, teamWeek } = buildEveryoneTeamView({ people, events, shiftSchedule, monthDates, week, potentialAllocations });

    return {
      fetchedAt,
      localNow: now,
      manager: { id: manager.id, name: manager.name },
      roster,
      perspective: "all",
      selectedPersonId: null,
      selectedPersonName: null,
      personal: null,
      everyone,
      teamWeek,
    };
  }

  const targetPerson = perspective.kind === "person" ? perspective.person : manager;
  const personal = buildPersonalScheduleReadModel({
    person: targetPerson,
    people,
    events,
    shiftSchedule,
    fetchedAt,
    now,
    potentialAllocations,
  });

  return {
    fetchedAt,
    localNow: now,
    manager: { id: manager.id, name: manager.name },
    roster,
    perspective: perspective.kind === "person" ? "person" : "self",
    selectedPersonId: perspective.kind === "person" ? targetPerson.id : null,
    selectedPersonName: perspective.kind === "person" ? targetPerson.name : null,
    personal,
    everyone: null,
    teamWeek: null,
  };
}

export interface BuildMappedEveryoneScheduleReadModelInput {
  /** Full parsed personnel list -- every mapped viewer sees the SAME roster-wide "all" projection, regardless of who's looking. */
  people: readonly Person[];
  /** Full parsed internal Event[] (every person). */
  events: readonly Event[];
  shiftSchedule: ShiftSchedule;
  fetchedAt: string;
  now: LocalNow;
  /** Every calendar date in the displayed month -- scopes `everyone`'s staffing/duties/absences, same contract as `BuildManagerScheduleReadModelInput.monthDates`. */
  monthDates: readonly string[];
  /** The resolved Sunday-Saturday operational week -- scopes `teamWeek` ONLY, same contract as `BuildManagerScheduleReadModelInput.week`. */
  week: OperationalWeek;
  /** Same contract as `BuildManagerScheduleReadModelInput.potentialAllocations` -- feeds ONLY `everyone.duties`, never `everyone.staffing`. */
  potentialAllocations?: readonly PotentialAllocation[];
}

/**
 * The "all" perspective's `ScheduleReadModel` for ANY authenticated,
 * uniquely-mapped viewer -- manager or not. This is the deliberate
 * authorization split this whole module exists to make explicit: viewing
 * the safe, read-only team month/"שבוע צוות" projection is a permission
 * every mapped person has, while `manager`/`roster` (and everything an
 * actual manager gets beyond this -- the arbitrary-person picker, Manager
 * Area, Fairness, Report 1, ...) stay a SEPARATE, strictly narrower
 * permission this function never grants.
 *
 * `manager: null` / `roster: []`, unconditionally, always -- this function
 * is never a source of manager UI. `perspective` is always `"all"` (the
 * ONLY perspective this function ever builds; there is no `requestedPersonId`
 * param here at all, unlike `buildManagerScheduleReadModel` -- "self"/
 * "person" for a non-manager viewer is `buildSelfOnlyScheduleReadModel`'s
 * job, resolved by the caller in `schedule.ts` BEFORE this function is ever
 * reached, never by inspecting the requested person id here).
 *
 * `everyone`/`teamWeek` reuse the EXACT SAME `buildEveryoneTeamView`
 * projection `buildManagerScheduleReadModel`'s own "all" branch uses --
 * never a second, independently-maintained definition of what "team
 * staffing"/"team week" means.
 */
export function buildMappedEveryoneScheduleReadModel(input: BuildMappedEveryoneScheduleReadModelInput): ScheduleReadModel {
  const { everyone, teamWeek } = buildEveryoneTeamView(input);

  return {
    fetchedAt: input.fetchedAt,
    localNow: input.now,
    manager: null,
    roster: [],
    perspective: "all",
    selectedPersonId: null,
    selectedPersonName: null,
    personal: null,
    everyone,
    teamWeek,
  };
}
