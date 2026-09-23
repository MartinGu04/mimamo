import type { ScheduleTeamWeekView } from "@/lib/readModels/scheduleTypes";

/**
 * "שבוע צוות" people-visibility filter -- a PRESENTATION-only concern.
 *
 * `"active"` (the default) is NOT "everyone with an item this week" --
 * that would hide an entire אחמ״שים/טכנאים section merely because those
 * regular-duty (חובה) people happen to have zero assignments in one
 * particular week, which is a real, misleading gap, not a genuine "no
 * one's around" state. So `"active"` means:
 * - every `serviceCategory === "regular"` person, ALWAYS -- regardless of
 *   whether they have any item this week. Regular duty personnel are the
 *   department's standing roster; they belong on the matrix every week.
 * - every `serviceCategory === "reserve"` person ONLY when they have at
 *   least one relevant item somewhere in the displayed week (via
 *   `activeTeamWeekPersonIds`) -- reserve personnel rotate in and out, so
 *   hiding an inactive one is the genuinely useful decluttering this
 *   filter exists for.
 *
 * `"all"` shows every eligible regular/reserve supervisor/technician
 * `buildScheduleTeamWeekView` already put on the roster, even an inactive
 * reserve with every cell empty. Never a third definition of eligibility
 * -- `buildScheduleTeamWeekView` already decided WHO belongs on the
 * roster at all (item 1's permanent-personnel exclusion, plus the
 * regular/reserve `serviceCategory` classification carried on each
 * person); this only decides which of THOSE people are worth showing
 * right now, and never re-classifies/re-infers `serviceCategory` itself.
 */
export type TeamWeekPeopleFilter = "active" | "all";

const VALID_FILTERS: ReadonlySet<TeamWeekPeopleFilter> = new Set(["active", "all"]);

/**
 * Parses the `?people=` URL param, falling back to `"active"` for anything
 * missing/unrecognized -- never a crash, never a silent "all" default that
 * would defeat the whole point of the filter.
 */
export function parseTeamWeekPeopleFilter(raw: string | null): TeamWeekPeopleFilter {
  return raw !== null && VALID_FILTERS.has(raw as TeamWeekPeopleFilter) ? (raw as TeamWeekPeopleFilter) : "active";
}

/**
 * Which person IDs have at least one item in ANY of the week's cells --
 * reads directly off `teamWeek.cells`, the exact same items
 * `buildScheduleTeamWeekView` already populated using its one relevance
 * rule (shift/duty/absence, plus the narrow recognized "other" activities
 * in `lib/domain/operationalActivityKeywords.ts`). Never a second,
 * independently-maintained notion of "active" -- this is purely a read of
 * data that rule already produced.
 *
 * This says nothing about `serviceCategory` on its own -- it's computed
 * for every person regardless of regular/reserve. `filterTeamWeekPeople`
 * is the one place that decides this only matters for reserve personnel.
 */
export function activeTeamWeekPersonIds(teamWeek: ScheduleTeamWeekView): ReadonlySet<string> {
  const active = new Set<string>();
  for (const person of teamWeek.people) {
    const byDate = teamWeek.cells[person.id];
    if (!byDate) continue;
    const hasAnyItem = Object.values(byDate).some((items) => items.length > 0);
    if (hasAnyItem) active.add(person.id);
  }
  return active;
}

/**
 * The people to actually render for a given filter -- always a subset of
 * `teamWeek.people`, in the same roster order (supervisors first, then
 * technicians, each group's own roster order preserved). Never mutates
 * `teamWeek` itself: the underlying team-week projection (`cells`, every
 * eligible person's own entry in `people`) is completely untouched, so a
 * later switch back to `"all"` always has the full picture available.
 *
 * `"active"` keeps every `serviceCategory === "regular"` person
 * unconditionally -- activity-based hiding applies ONLY to
 * `serviceCategory === "reserve"` people (see `TeamWeekPeopleFilter`'s own
 * docs for why). `serviceCategory` is read verbatim off each
 * `ScheduleTeamWeekPerson` -- never re-derived here.
 */
export function filterTeamWeekPeople(
  teamWeek: ScheduleTeamWeekView,
  filter: TeamWeekPeopleFilter,
): ScheduleTeamWeekView["people"] {
  if (filter === "all") return teamWeek.people;
  const active = activeTeamWeekPersonIds(teamWeek);
  return teamWeek.people.filter((person) => person.serviceCategory === "regular" || active.has(person.id));
}
