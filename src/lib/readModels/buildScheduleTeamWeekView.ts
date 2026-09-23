import type { Event, EventCategory } from "@/lib/domain/event";
import { isRecognizedOperationalActivityEvent } from "@/lib/domain/operationalActivityKeywords";
import { classifyPersonnelType, classifyRoleGroup, isShiftCapable } from "@/lib/domain/personnelType";
import type { OperationalWeek } from "@/lib/domain/operationalWeek";
import type { Person } from "@/lib/domain/types";
import type { ScheduleTeamWeekCellItem, ScheduleTeamWeekPerson, ScheduleTeamWeekView } from "./scheduleTypes";

/**
 * The three typed Event categories a team-week cell always shows -- the
 * exact same scope `ScheduleEveryoneReadModel` (staffing/duties/absences)
 * already covers, so "who's on the roster this week" never surfaces a
 * category (constraint/status/context/change_note/unknown) that isn't
 * meaningful team-wide operational data.
 *
 * `category: "other"` is NOT blanket-included here -- most "other" text is
 * genuinely not schedule-relevant. But a real schedule-cell activity like
 * "מטווחים" (a shooting range session) IS meaningful operational
 * information with no dedicated `DutyFamily`/category of its own (see
 * `lib/domain/operationalActivityKeywords.ts`, the same narrow, explicit
 * keyword detectors `lib/domain/reportOne.ts` already relies on for the
 * exact same reason) -- see `isRelevantTeamWeekEvent` below for how the
 * two checks combine.
 */
const RELEVANT_CATEGORIES: ReadonlySet<EventCategory> = new Set(["shift", "duty", "absence"]);

/**
 * Whether one Event belongs in the team-week matrix at all: always true
 * for the three typed categories above, PLUS the narrow, explicit set of
 * recognized "other"-category operational activities (`isRecognizedOperationalActivityEvent`)
 * -- never a blanket "any 'other' text is fine" rule. This is what lets
 * "אחמ\"ש יום - צל" (shift) and "מטווחים" (other, but recognized) both
 * survive in the same person/date cell, while an unrelated, unrecognized
 * "other" string still never reaches the matrix.
 */
function isRelevantTeamWeekEvent(event: Event): boolean {
  return RELEVANT_CATEGORIES.has(event.category) || isRecognizedOperationalActivityEvent(event);
}

/**
 * Every roster person who belongs on the matrix at all, in FINAL display
 * order: every supervisor first (roster order preserved), then every
 * technician (roster order preserved) -- never re-sorted, never grouped by
 * anything else. A permanent/unrelated person with neither capability flag
 * (`classifyRoleGroup` -> "other") never gets a column, matching
 * `isShiftCapable`'s existing "can this person be rostered onto a shift at
 * all" contract used elsewhere in this codebase -- never a title-string
 * match.
 *
 * Team Week is scoped to actual operational shift workers only: a person
 * must ALSO classify as `"regular"` (חובה) or `"reserve"` (מילואים) via
 * `classifyPersonnelType`. A permanent (קבע) or unclassified person is
 * excluded even when `isSupervisor`/`isTechnician` is true -- permanent
 * personnel don't belong in this rotating-shift view.
 */
function buildTeamWeekPeople(people: readonly Person[]): ScheduleTeamWeekPerson[] {
  const supervisors: ScheduleTeamWeekPerson[] = [];
  const technicians: ScheduleTeamWeekPerson[] = [];

  for (const person of people) {
    const serviceCategory = classifyPersonnelType(person.personnelType);
    if (serviceCategory !== "regular" && serviceCategory !== "reserve") continue;
    if (!isShiftCapable(person)) continue;
    const roleGroup = classifyRoleGroup(person);
    // Structurally unreachable given the `isShiftCapable` guard above
    // (isSupervisor || isTechnician already implies a real role group) --
    // guarded explicitly rather than an unsafe cast, so the pushed
    // `roleGroup` stays a real "supervisor" | "technician" to the type
    // checker too.
    if (roleGroup === "other") continue;

    const teamWeekPerson: ScheduleTeamWeekPerson = { id: person.id, name: person.name, roleGroup };
    if (roleGroup === "supervisor") supervisors.push(teamWeekPerson);
    else technicians.push(teamWeekPerson);
  }

  return [...supervisors, ...technicians];
}

/**
 * Pure, deterministic construction of the "שבוע צוות" team-week matrix
 * from the manager's already-authorized, UNSCOPED `events`/`people`
 * snapshot -- the exact same inputs `buildManagerScheduleReadModel`'s
 * "all" branch already has in hand for `everyone`, never a second fetch
 * and never a reverse-engineering of the aggregated staffing/duties/
 * absences lists. Scoped ONLY to `week.dates` (a Sunday-Saturday range
 * that may cross a calendar month or even a year boundary) -- deliberately
 * independent of whatever month the "חודש" presentation happens to be
 * displaying.
 *
 * `cells` is always densely populated: every person in the returned
 * `people` list gets an entry for every one of the week's seven dates
 * (an empty array when nothing applies), so a consumer never needs a
 * defensive/optional lookup. Items within one cell preserve `events`'
 * own encounter order (already a stable, deterministic parse order) --
 * never re-sorted.
 */
export function buildScheduleTeamWeekView(
  events: readonly Event[],
  people: readonly Person[],
  week: OperationalWeek,
): ScheduleTeamWeekView {
  const weekDates = new Set(week.dates);
  const teamWeekPeople = buildTeamWeekPeople(people);

  const cells: Record<string, Record<string, ScheduleTeamWeekCellItem[]>> = {};
  for (const person of teamWeekPeople) {
    const byDate: Record<string, ScheduleTeamWeekCellItem[]> = {};
    for (const date of week.dates) byDate[date] = [];
    cells[person.id] = byDate;
  }

  let itemIndex = 0;
  for (const event of events) {
    if (!isRelevantTeamWeekEvent(event)) continue;
    if (!weekDates.has(event.date)) continue;

    const personCells = cells[event.personId];
    if (!personCells) continue; // not a shift-capable roster member -- no column to place this in.
    const dateCell = personCells[event.date];
    if (!dateCell) continue; // defensive only -- every week date was seeded above.

    dateCell.push({
      key: `${event.personId}-${event.date}-${itemIndex++}`,
      title: event.title,
      category: event.category,
      period: event.period,
      dutyFamily: event.dutyFamily,
      absenceKind: event.absenceKind,
      tentative: event.certainty === "tentative",
      shadow: event.shadow,
    });
  }

  return {
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    dates: week.dates,
    people: teamWeekPeople,
    cells,
  };
}
