/**
 * Manager-facing links into the ALREADY-EXISTING manager-only `/schedule`
 * perspectives (PR #24) -- never a parallel calendar. `/schedule` itself
 * derives the displayed month from `?date=` when no explicit `?month=` is
 * given (see `app/(app)/schedule/page.tsx`'s `dateMonthOverride`), so
 * neither builder here needs to compute/pass a month separately.
 */

interface ScheduleSelfHrefParams {
  /** "YYYY-MM-DD" -- pre-selects that day in the viewer's OWN personal calendar. Omitted entirely lands on today's month with nothing pre-selected. */
  date?: string | null;
}

/** Builds a plain `/schedule` URL -- the viewer's own personal calendar (no `?person=` at all, which `SchedulePage` already resolves to the "self" perspective). */
export function scheduleSelfHref(params: ScheduleSelfHrefParams = {}): string {
  const search = new URLSearchParams();
  if (params.date) search.set("date", params.date);
  const query = search.toString();
  return query ? `/schedule?${query}` : "/schedule";
}

interface ScheduleEveryoneHrefParams {
  /** "YYYY-MM-DD" -- pre-selects that day in the team staffing calendar. Omitted entirely lands on today's month with nothing pre-selected. */
  date?: string | null;
}

/** Builds a `/schedule?person=all` URL -- the team-wide day/night coverage calendar. */
export function scheduleEveryoneHref(params: ScheduleEveryoneHrefParams = {}): string {
  const search = new URLSearchParams({ person: "all" });
  if (params.date) search.set("date", params.date);
  return `/schedule?${search.toString()}`;
}

/**
 * The canonical "צוות השבוע" (Team Week) URL -- `/schedule?person=all&view=team-week`,
 * deliberately with no `?week=` anchor, resolving through the read model's
 * own "current operational week" fallback (see `schedule.ts`'s `rawWeek`
 * handling). Available to EVERY authenticated, uniquely-mapped viewer, not
 * manager-only -- see `scheduleTypes.ts`'s own docs. The ONE constant
 * behind every one-click Team Week shortcut in the app (Home's
 * `WeekOverviewSection`, `PermanentManagerHome`) so they can never drift
 * apart from each other or from `/schedule` itself.
 */
export function scheduleTeamWeekHref(): string {
  return "/schedule?person=all&view=team-week";
}

interface SchedulePersonHrefParams {
  personId: string;
  /** "YYYY-MM-DD", same contract as `ScheduleEveryoneHrefParams.date`. */
  date?: string | null;
}

/** Builds a `/schedule?person=<id>` URL -- that team member's own real personal calendar. */
export function schedulePersonHref({ personId, date }: SchedulePersonHrefParams): string {
  const search = new URLSearchParams({ person: personId });
  if (date) search.set("date", date);
  return `/schedule?${search.toString()}`;
}
