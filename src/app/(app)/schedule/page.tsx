import { ConfigurationErrorState } from "@/components/dashboard/ConfigurationErrorState";
import { EmergencyUnavailableState } from "@/components/emergencyMode/EmergencyUnavailableState";
import { MonthNav } from "@/components/schedule/MonthNav";
import { EmergencyEveryoneScheduleList } from "@/components/schedule/EmergencyEveryoneScheduleList";
import { EmergencyPersonalScheduleList } from "@/components/schedule/EmergencyPersonalScheduleList";
import { EmergencyScheduleRangeSelector } from "@/components/schedule/EmergencyScheduleRangeSelector";
import { ScheduleCalendar } from "@/components/schedule/ScheduleCalendar";
import { ScheduleEveryoneCalendar } from "@/components/schedule/ScheduleEveryoneCalendar";
import { ScheduleHeader } from "@/components/schedule/ScheduleHeader";
import { ScheduleManagerSelector } from "@/components/schedule/ScheduleManagerSelector";
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
import { formatHebrewCalendarDate, formatHebrewMonthRange, getHolidayContext } from "@/lib/presentation/hebrewCalendar";
import { formatHebrewMonthYear, formatHebrewWeekdayAndDate } from "@/lib/presentation/hebrewDate";
import { parseEmergencyScheduleRangeParam, type EmergencyScheduleRangeKey } from "@/lib/presentation/emergencyAgenda";
import { buildScheduleEveryoneDayViews } from "@/lib/presentation/scheduleEveryone";
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
  searchParams: Promise<{ month?: SearchParamValue; person?: SearchParamValue; date?: SearchParamValue; range?: SearchParamValue }>;
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
 * "הלוח שלי" -- the personal monthly calendar (formerly "לוח משמרות", a
 * shift-only calendar; see `CalendarGrid`/`SelectedDayPanel`/
 * `calendarEvents` for the shift+duty+absence+holiday widening, and
 * `isPersonalCalendarActivityEvent` for the further display-only-activity
 * widening -- e.g. סוגר/שלב 9/כנס בטיחות). For a
 * normal user this is still exactly the personal calendar it always was:
 * `model.manager` is always null, `model.perspective` is always "self",
 * and no manager UI ever renders, no matter what `?person=` the URL
 * carries (the server-side floor lives in `getRequestSchedule` and its
 * orchestration layer, never here).
 *
 * For an authorized manager, `getRequestSchedule` additionally resolves
 * which of the three perspectives (self / everyone / one person) to show,
 * already fail-closed-validated against the manager's own authorized
 * roster -- this page never re-validates `?person=` itself. "self" and
 * "person" both reuse the exact same `ScheduleCalendar` the normal
 * personal experience uses (never a separate "manager calendar"); "all"
 * renders the dedicated team-staffing `ScheduleEveryoneCalendar` instead,
 * since "who staffs day/night" is a different question than "what are
 * MY shifts" (PR #24 §14).
 */
export default async function SchedulePage({ searchParams }: SchedulePageProps) {
  const params = await searchParams;
  const rawMonth = firstParam(params.month) ?? null;
  const rawPerson = firstParam(params.person) ?? null;
  const rawDate = firstParam(params.date) ?? null;

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

  const result = await getRequestSchedule(effectiveRawMonth, rawPerson);
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

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ScheduleHeader
          monthLabel={monthLabel}
          monthRangeSubtitle={formatHebrewMonthRange(displayMonthKey.year, displayMonthKey.month)}
        />
        <MonthNav
          prevHref={prevHref}
          nextHref={nextHref}
          todayHref={todayHref}
          isOnCurrentMonth={isOnCurrentMonth}
          monthLabel={monthLabel}
        />
      </div>

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

      {model.perspective === "all" && model.everyone ? (
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
