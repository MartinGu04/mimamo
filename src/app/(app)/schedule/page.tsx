import { ConfigurationErrorState } from "@/components/dashboard/ConfigurationErrorState";
import { EmergencyUnavailableState } from "@/components/emergencyMode/EmergencyUnavailableState";
import { MonthNav } from "@/components/schedule/MonthNav";
import { EmergencyEveryoneScheduleList } from "@/components/schedule/EmergencyEveryoneScheduleList";
import { EmergencyPersonalScheduleList } from "@/components/schedule/EmergencyPersonalScheduleList";
import { EmergencyScheduleRangeSelector } from "@/components/schedule/EmergencyScheduleRangeSelector";
import { ScheduleCalendar } from "@/components/schedule/ScheduleCalendar";
import { ScheduleEveryoneCalendar } from "@/components/schedule/ScheduleEveryoneCalendar";
import { ScheduleEveryoneViewSwitch, type ScheduleEveryoneView } from "@/components/schedule/ScheduleEveryoneViewSwitch";
import { ScheduleHeader } from "@/components/schedule/ScheduleHeader";
import { ScheduleManagerSelector } from "@/components/schedule/ScheduleManagerSelector";
import { SchedulePerspectiveSwitch } from "@/components/schedule/SchedulePerspectiveSwitch";
import { TeamWeekMatrix } from "@/components/schedule/TeamWeekMatrix";
import { TeamWeekNav } from "@/components/schedule/TeamWeekNav";
import { TeamWeekPeopleFilterSwitch } from "@/components/schedule/TeamWeekPeopleFilterSwitch";
import type { DayMeta } from "@/components/schedule/types";
import { DataFreshnessStatus } from "@/components/ui/DataFreshnessStatus";
import { Panel } from "@/components/ui/Panel";
import {
  buildMonthGrid,
  calendarMonthOfLocalNow,
  formatMonthParam,
  parseMonthParam,
  shiftCalendarMonth,
  type CalendarGridCell,
  type CalendarMonthKey,
} from "@/lib/domain/calendarMonth";
import { parseCalendarDate } from "@/lib/domain/dutyBlocks";
import { getNextOperationalWeek, getOperationalWeek, getPreviousOperationalWeek } from "@/lib/domain/operationalWeek";
import { formatHebrewCalendarDate, formatHebrewMonthRange, getHolidayContext } from "@/lib/presentation/hebrewCalendar";
import { formatHebrewMonthYear, formatHebrewWeekRangeLabel, formatHebrewWeekdayAndDate } from "@/lib/presentation/hebrewDate";
import { parseEmergencyScheduleRangeParam, type EmergencyScheduleRangeKey } from "@/lib/presentation/emergencyAgenda";
import { buildScheduleEveryoneDayViews } from "@/lib/presentation/scheduleEveryone";
import { parseTeamWeekPeopleFilter, type TeamWeekPeopleFilter } from "@/lib/presentation/teamWeekFilter";
import { getRequestSchedule } from "@/lib/readModels/getRequestSchedule";
import type { EmergencyScheduleReadModel } from "@/lib/readModels/emergencyScheduleTypes";
import type { SchedulePerspective } from "@/lib/readModels/scheduleTypes";
import type { PersonalCalendarEventView } from "@/lib/readModels/types";

function buildDayMeta(date: string, todayDate: string): DayMeta {
  const day = Number(date.slice(8, 10));
  const gregorianLabel = formatHebrewWeekdayAndDate(date);
  const hebrewCalendarLabel = formatHebrewCalendarDate(date);
  const dateLabel = [gregorianLabel, hebrewCalendarLabel].filter(Boolean).join(" · ");

  return {
    date,
    dayNumber: day,
    isToday: date === todayDate,
    isPast: date < todayDate,
    dateLabel,
    holiday: getHolidayContext(date),
  };
}

type SearchParamValue = string | string[] | undefined;

interface SchedulePageProps {
  searchParams: Promise<{
    month?: SearchParamValue;
    person?: SearchParamValue;
    date?: SearchParamValue;
    range?: SearchParamValue;
    /** "team-week" opts the "כולם" perspective into the team-week matrix; anything else (including missing) means the existing month calendar. Only ever consulted when `model.perspective === "all"` -- see `SchedulePage`. */
    view?: SearchParamValue;
    /** "YYYY-MM-DD" week anchor for the team-week matrix -- see `ScheduleParams.rawWeek`. Ignored outside `view=team-week`. */
    week?: SearchParamValue;
    /** "active" (default) | "all" -- the team-week matrix's people-visibility filter. See `parseTeamWeekPeopleFilter`. Ignored outside `view=team-week`. */
    people?: SearchParamValue;
  }>;
}

function firstParam(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Builds a `/schedule` URL preserving both `month` and the manager
 * perspective (PR #24 §8/§29) -- self mode omits `person` entirely rather
 * than writing `person=self` (the URL contract's preferred self shape).
 * `monthKey: null` omits `month` too, resolving through the page's own
 * Jerusalem-local "today" fallback -- exactly what `todayHref` needs so
 * "today" never resets the selected perspective.
 */
function scheduleHref(
  monthKey: CalendarMonthKey | null,
  perspective: SchedulePerspective,
  selectedPersonId: string | null,
): string {
  const params = new URLSearchParams();
  if (monthKey) params.set("month", formatMonthParam(monthKey));
  if (perspective === "all") params.set("person", "all");
  else if (perspective === "person" && selectedPersonId) params.set("person", selectedPersonId);

  const query = params.toString();
  return query ? `/schedule?${query}` : "/schedule";
}

/**
 * Builds a "כולם" perspective URL for either presentation -- always
 * `person=all` (this is only ever reachable once the page already
 * resolved perspective "all", i.e. an already-verified manager), and for
 * "team-week" an explicit `?week=` anchor when given (omitted entirely
 * resolves through the loader's own "today" fallback, exactly like
 * `scheduleHref`'s `monthKey: null`/`todayHref` convention above). The
 * "month" target never carries `view`/`week` at all -- switching back to
 * the calendar is a full reset of this presentation's own state, not a
 * merge with whatever week was selected.
 */
function scheduleEveryoneViewHref(view: ScheduleEveryoneView, weekStart: string | null): string {
  const params = new URLSearchParams({ person: "all" });
  if (view === "team-week") {
    params.set("view", "team-week");
    if (weekStart) params.set("week", weekStart);
  }
  return `/schedule?${params.toString()}`;
}

/**
 * Builds a team-week matrix URL for a given week anchor + people filter --
 * always `person=all&view=team-week`. The ONE shared builder behind every
 * team-week link on this page (week nav AND the people-filter switch), so
 * the two controls can never drift apart: week navigation must carry the
 * CURRENTLY selected filter forward (a prev/next/today click is a pure week
 * change, never an implicit filter reset), and the filter switch must carry
 * the CURRENTLY displayed week forward (switching פעילים/כולם is a pure
 * filter change, never an implicit jump back to the current week) --
 * both cases are just "this one param changes, everything else survives",
 * the same convention `scheduleHref`/`scheduleEveryoneViewHref` already
 * establish for their own params.
 *
 * `?people=` is OMITTED for the default `"active"` filter (never written
 * as `people=active`) and only ever appears for `"all"` -- the same
 * "omit the default" convention `scheduleHref` already uses for the "self"
 * perspective (no `?person=self` either). `parseTeamWeekPeopleFilter`
 * already treats a missing param as `"active"`, so this omission round-trips
 * exactly.
 */
function teamWeekHref(weekStart: string | null, peopleFilter: TeamWeekPeopleFilter): string {
  const params = new URLSearchParams({ person: "all", view: "team-week" });
  if (weekStart) params.set("week", weekStart);
  if (peopleFilter !== "active") params.set("people", peopleFilter);
  return `/schedule?${params.toString()}`;
}

/**
 * Contextual page title (Team Schedule visibility is no longer manager-only,
 * so the page must never keep saying "הלוח שלי" while actually showing the
 * team's data): "self" stays "הלוח שלי" for every viewer, "all" + month is
 * "לוח הצוות", "all" + team-week is "צוות השבוע". Never three separate page
 * shells -- only this one string, fed into the same `ScheduleHeader`.
 */
function scheduleTitle(perspective: SchedulePerspective, isTeamWeekView: boolean): string {
  if (perspective !== "all") return "הלוח שלי";
  return isTeamWeekView ? "צוות השבוע" : "לוח הצוות";
}

/**
 * `/schedule` -- the personal monthly calendar (formerly "לוח משמרות", a
 * shift-only calendar; see `CalendarGrid`/`SelectedDayPanel`/
 * `calendarEvents` for the shift+duty+absence+holiday widening, and
 * `isPersonalCalendarActivityEvent` for the further display-only-activity
 * widening -- e.g. סוגר/שלב 9/כנס בטיחות) PLUS the read-only Team Schedule
 * ("all") perspective, available to EVERY authenticated, uniquely-mapped
 * viewer -- a deliberate authorization change, no longer manager-only. Two
 * SEPARATE authorization concepts decide what renders here, matching
 * `ScheduleReadModel`'s own docs:
 *
 * 1. **Team Schedule visibility** (`model.perspective === "all"`,
 *    `model.everyone`, `model.teamWeek`) -- every mapped viewer gets this;
 *    the server-side floor lives entirely in `getRequestSchedule`'s
 *    orchestration layer (`schedule.ts`), never here. `"self"` (the
 *    default, no `?person=`) always reuses the exact same `ScheduleCalendar`
 *    the personal experience always used; `"all"` renders the dedicated
 *    team-staffing `ScheduleEveryoneCalendar` instead, since "who staffs
 *    day/night" is a different question than "what are MY shifts".
 * 2. **Manager authorization** (`model.manager !== null`, `model.roster`,
 *    `model.perspective === "person"`) -- strictly narrower, unchanged: an
 *    authorized manager ADDITIONALLY gets the arbitrary-person
 *    `ScheduleManagerSelector` (a non-manager instead gets the compact
 *    `SchedulePerspectiveSwitch`, "שלי | כולם" -- never both, see the
 *    toolbar below); `"person"` reuses the same `ScheduleCalendar` too.
 *    This page never re-validates `?person=` itself either way -- both
 *    paths are already fail-closed-validated by the read-model layer.
 *
 * "all" additionally gets an OPTIONAL second presentation, "שבוע צוות"
 * (`?view=team-week`, `TeamWeekMatrix`) -- a person × date roster matrix
 * inspired by the original Sheet's own weekly layout, never a replacement
 * for the month calendar (`ScheduleEveryoneViewSwitch` toggles between the
 * two; "חודש" stays the default). `model.teamWeek` is populated by the
 * SAME "all"-branch projection that populates `model.everyone` (see
 * `buildEveryoneTeamView` in `buildScheduleReadModel.ts`), for EVERY mapped
 * viewer -- so there is no separate authorization path for `?view=`/
 * `?week=` to bypass -- a viewer not currently on "all" always gets
 * `teamWeek: null` and this page never renders the matrix or its view
 * switch for them, whatever the URL says. `scheduleTitle` picks the page's
 * contextual title from `perspective`/`isTeamWeekView` alone, independent
 * of `model.manager` -- the title reflects WHAT is showing, never WHO is
 * looking at it.
 */
export default async function SchedulePage({ searchParams }: SchedulePageProps) {
  const params = await searchParams;
  const rawMonth = firstParam(params.month) ?? null;
  const rawPerson = firstParam(params.person) ?? null;
  const rawDate = firstParam(params.date) ?? null;
  const rawWeek = firstParam(params.week) ?? null;
  // Unknown/malformed values (or plain absence) both safely mean "month" --
  // this is a strict equality check, never a fuzzy parse, so there is
  // nothing here that could crash or fall through unexpectedly.
  const requestedTeamWeekView = firstParam(params.view) === "team-week";
  // Presentation-only: `parseTeamWeekPeopleFilter` already falls back to
  // "active" for anything missing/unrecognized -- see that function.
  const peopleFilter = parseTeamWeekPeopleFilter(firstParam(params.people) ?? null);

  // `?date=` is self-sufficient: when a valid date is supplied and no
  // explicit `?month=` overrides it, the displayed/requested month is
  // derived from the date itself -- otherwise a cross-month/year search
  // result (e.g. `?date=2026-09-01` while August is the resolved default)
  // would silently open the WRONG month and the date would never be found
  // in that month's grid. An explicit `?month=` (valid or not) always wins
  // -- its own existing fallback-to-current-month behavior for an invalid
  // value is unchanged.
  const requestedDateMonth = rawMonth === null && rawDate ? parseCalendarDate(rawDate) : null;
  const dateMonthOverride = requestedDateMonth
    ? formatMonthParam({ year: requestedDateMonth.year, month: requestedDateMonth.month })
    : null;
  const effectiveRawMonth = dateMonthOverride ?? rawMonth;

  const result = await getRequestSchedule(effectiveRawMonth, rawPerson, rawWeek);
  if (result.status === "emergency_unavailable") {
    return <EmergencyUnavailableState />;
  }
  if (result.status === "emergency") {
    const range = parseEmergencyScheduleRangeParam(firstParam(params.range));
    return <EmergencySchedulePage model={result.model} range={range} />;
  }
  if (result.status !== "ok") {
    return <ConfigurationErrorState />;
  }

  const { model } = result;

  const currentMonthKey = calendarMonthOfLocalNow(model.localNow);
  const displayMonthKey = parseMonthParam(effectiveRawMonth) ?? currentMonthKey;
  const monthParam = formatMonthParam(displayMonthKey);

  const grid = buildMonthGrid(displayMonthKey.year, displayMonthKey.month);
  const inMonthDates = grid.filter((cell) => cell.inMonth).map((cell) => cell.date);

  const days: Record<string, DayMeta> = {};
  for (const date of inMonthDates) {
    days[date] = buildDayMeta(date, model.localNow.date);
  }

  const isOnCurrentMonth = displayMonthKey.year === currentMonthKey.year && displayMonthKey.month === currentMonthKey.month;
  const prevMonthKey = shiftCalendarMonth(displayMonthKey, -1);
  const nextMonthKey = shiftCalendarMonth(displayMonthKey, 1);

  const prevHref = scheduleHref(prevMonthKey, model.perspective, model.selectedPersonId);
  const nextHref = scheduleHref(nextMonthKey, model.perspective, model.selectedPersonId);
  const todayHref = scheduleHref(null, model.perspective, model.selectedPersonId);

  // A deep-linked `?date=` (e.g. from global search) selects that day, but
  // only when it's actually a real, in-grid date -- `Object.hasOwn` (never
  // plain `days[rawDate]`) so an adversarial param can't reach up the
  // prototype chain. An out-of-month or garbage `?date=` is silently
  // ignored, falling back to the existing today-or-first-of-month default,
  // never a crash and never a fabricated selection.
  const requestedDate = rawDate && Object.hasOwn(days, rawDate) ? rawDate : null;
  const defaultSelectedDate = requestedDate ?? (days[model.localNow.date] ? model.localNow.date : (inMonthDates[0] ?? null));

  // `displayMonthKey.month` always comes from a validated CalendarMonthKey
  // (1-12, via `parseMonthParam`/`calendarMonthOfLocalNow`), so this never
  // actually falls back in practice -- the `?? ""` only satisfies
  // `formatHebrewMonthYear`'s defensive `string | null` return type.
  const monthLabel = formatHebrewMonthYear(displayMonthKey.year, displayMonthKey.month) ?? "";

  // Only ever meaningful for `perspective === "all"` -- `model.teamWeek` is
  // null for every other perspective (see `buildScheduleReadModel.ts`), so
  // this is the SAME server-side floor `model.everyone`/`ScheduleEveryoneCalendar`
  // already relies on: a non-manager (or a manager not currently viewing
  // "all") can never reach this branch no matter what `?view=`/`?week=` the
  // URL carries.
  const isTeamWeekView = model.perspective === "all" && model.teamWeek !== null && requestedTeamWeekView;

  const teamWeekLabel = model.teamWeek ? (formatHebrewWeekRangeLabel(model.teamWeek.weekStart, model.teamWeek.weekEnd) ?? "") : "";
  const isOnCurrentWeek = model.teamWeek ? model.teamWeek.weekStart === getOperationalWeek(model.localNow).weekStart : false;
  const prevWeekHref = model.teamWeek
    ? teamWeekHref(getPreviousOperationalWeek(model.teamWeek).weekStart, peopleFilter)
    : "/schedule";
  const nextWeekHref = model.teamWeek
    ? teamWeekHref(getNextOperationalWeek(model.teamWeek).weekStart, peopleFilter)
    : "/schedule";
  const todayWeekHref = teamWeekHref(null, peopleFilter);
  const activePeopleFilterHref = teamWeekHref(model.teamWeek?.weekStart ?? null, "active");
  const allPeopleFilterHref = teamWeekHref(model.teamWeek?.weekStart ?? null, "all");

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <ScheduleHeader
        title={scheduleTitle(model.perspective, isTeamWeekView)}
        monthLabel={isTeamWeekView ? teamWeekLabel : monthLabel}
        monthRangeSubtitle={isTeamWeekView ? "תצוגת מטריצה שבועית" : formatHebrewMonthRange(displayMonthKey.year, displayMonthKey.month)}
      />

      {/* One consolidated toolbar: perspective control, view switch, people
          filter, and date navigation all read as one set of controls, with
          data freshness visually separated but still in this same region.
          Exactly ONE of ScheduleManagerSelector (an actual manager) or
          SchedulePerspectiveSwitch (every other mapped viewer) ever renders
          -- never both, never neither, for a mapped viewer. */}
      <Panel variant="inline" className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {model.manager ? (
            <ScheduleManagerSelector
              managerName={model.manager.name}
              people={model.roster}
              perspective={model.perspective}
              selectedPersonId={model.selectedPersonId}
            />
          ) : (
            <SchedulePerspectiveSwitch
              activePerspective={model.perspective === "all" ? "all" : "self"}
              selfHref={scheduleHref(null, "self", null)}
              allHref={scheduleHref(null, "all", null)}
            />
          )}
          {model.perspective === "all" ? (
            <ScheduleEveryoneViewSwitch
              activeView={isTeamWeekView ? "team-week" : "month"}
              monthHref={scheduleEveryoneViewHref("month", null)}
              teamWeekHref={scheduleEveryoneViewHref("team-week", null)}
            />
          ) : null}
          {isTeamWeekView ? (
            <TeamWeekPeopleFilterSwitch
              activeFilter={peopleFilter}
              activeHref={activePeopleFilterHref}
              allHref={allPeopleFilterHref}
            />
          ) : null}
          {isTeamWeekView ? (
            <TeamWeekNav
              prevHref={prevWeekHref}
              nextHref={nextWeekHref}
              todayHref={todayWeekHref}
              isOnCurrentWeek={isOnCurrentWeek}
              weekLabel={teamWeekLabel}
            />
          ) : (
            <MonthNav
              prevHref={prevHref}
              nextHref={nextHref}
              todayHref={todayHref}
              isOnCurrentMonth={isOnCurrentMonth}
              monthLabel={monthLabel}
            />
          )}
        </div>
        <DataFreshnessStatus fetchedAt={model.fetchedAt} className="sm:w-auto" />
      </Panel>

      {isTeamWeekView && model.teamWeek ? (
        <TeamWeekMatrix teamWeek={model.teamWeek} todayDate={model.localNow.date} peopleFilter={peopleFilter} />
      ) : model.perspective === "all" && model.everyone ? (
        <ScheduleEveryoneCalendar
          grid={grid}
          days={days}
          dayViews={buildScheduleEveryoneDayViews(
            inMonthDates,
            model.everyone.staffing,
            model.everyone.duties,
            model.everyone.absences,
          )}
          defaultSelectedDate={defaultSelectedDate}
        />
      ) : model.personal ? (
        <PersonalPerspective
          grid={grid}
          days={days}
          defaultSelectedDate={defaultSelectedDate}
          monthEvents={model.personal.calendarEvents.filter((event) => event.date.startsWith(`${monthParam}-`))}
          activeShiftDates={model.personal.currentAssignments
            .filter((assignment) => assignment.category === "shift")
            .map((assignment) => assignment.date)}
          emptyStateName={model.perspective === "person" ? model.selectedPersonName : null}
        />
      ) : null}
    </div>
  );
}

interface PersonalPerspectiveProps {
  grid: CalendarGridCell[];
  days: Record<string, DayMeta>;
  defaultSelectedDate: string | null;
  monthEvents: PersonalCalendarEventView[];
  activeShiftDates: string[];
  /** Set only for perspective "person" -- the selected colleague's name, used for the empty-month message (PR #24 §12). Null for "self" (a manager viewing their own empty month is not a noteworthy state). */
  emptyStateName: string | null;
}

/**
 * "self"/"person" perspectives -- byte-for-byte the same
 * `ScheduleCalendar` the normal personal experience renders (PR #24 §13),
 * with one addition: a calm contextual note (never a full-screen empty
 * state -- the calendar itself stays useful for dates/holidays) when a
 * selected colleague has no shifts this month at all.
 */
function PersonalPerspective({
  grid,
  days,
  defaultSelectedDate,
  monthEvents,
  activeShiftDates,
  emptyStateName,
}: PersonalPerspectiveProps) {
  const showEmptyNote = emptyStateName !== null && monthEvents.length === 0;

  return (
    <>
      {showEmptyNote ? (
        <Panel variant="compact" className="text-sm text-muted">
          אין ל{emptyStateName} משמרות בתקופה הזו
        </Panel>
      ) : null}
      <ScheduleCalendar
        grid={grid}
        days={days}
        monthEvents={monthEvents}
        defaultSelectedDate={defaultSelectedDate}
        activeShiftDates={activeShiftDates}
      />
    </>
  );
}

/**
 * Emergency Mode's `/schedule` presentation (spec section 10) -- desk-
 * based staffing, never regular Event/role coverage. The "self"/"person"
 * perspective renders a real calendar/schedule presentation modeled on
 * the regular schedule's own equivalent for a fixed date range (see
 * `EmergencyPersonalScheduleList`'s own docs) rather than the month-grid
 * calendar (`CalendarGridCell`/`PersonalEventView` semantics), plus its
 * own "היום | מחר | 7 ימים | 30 יום" range selector
 * (`EmergencyScheduleRangeSelector`) -- an Emergency Mode period is
 * typically a short, bounded window rather than a full recurring monthly
 * schedule, so a rolling range fits better than month pagination. The
 * "all" perspective (`EmergencyEveryoneScheduleList`) is unaffected --
 * it stays the full unscoped team roster, no range selector.
 */
function EmergencySchedulePage({ model, range }: { model: EmergencyScheduleReadModel; range: EmergencyScheduleRangeKey }) {
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <ScheduleHeader monthLabel="סידור חירום" monthRangeSubtitle="משמרות חירום לפי דסקים" />

      {model.manager ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ScheduleManagerSelector
            managerName={model.manager.name}
            people={model.roster}
            perspective={model.perspective}
            selectedPersonId={model.selectedPersonId}
          />
          <DataFreshnessStatus fetchedAt={model.fetchedAt} className="sm:w-auto" />
        </div>
      ) : (
        <DataFreshnessStatus fetchedAt={model.fetchedAt} />
      )}

      {model.perspective === "all" && model.everyoneShifts ? (
        <EmergencyEveryoneScheduleList shifts={model.everyoneShifts} />
      ) : (
        <>
          <EmergencyScheduleRangeSelector basePath="/schedule" personId={model.selectedPersonId} currentRange={range} />
          <EmergencyPersonalScheduleList
            shifts={model.personalShifts ?? []}
            emptyStateName={model.perspective === "person" ? model.selectedPersonName : null}
            range={range}
            localNow={model.localNow}
          />
        </>
      )}
    </div>
  );
}
