import type { CalendarGridCell } from "@/lib/domain/calendarMonth";
import { buildDayIndicators, type CalendarDayIndicator } from "@/lib/presentation/calendarDayIndicator";
import type { PersonalEventView } from "@/lib/readModels/types";
import {
  CalendarDayCell,
  CalendarWeekRow,
  CalendarWeekdayHeader,
  IndicatorChip,
  OverflowChip,
  OutOfMonthCell,
  cellBorderClasses,
  chunkIntoWeeks,
} from "./CalendarSurface";
import type { DayMeta } from "./types";

interface CalendarGridProps {
  /** Sunday-first, always exactly 6 complete weeks (42 cells) -- see `buildMonthGrid`. */
  grid: CalendarGridCell[];
  days: Record<string, DayMeta>;
  eventsByDate: Record<string, PersonalEventView[]>;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  /**
   * Event dates of every currently-running personal shift. Deliberately
   * keyed by the shift's own Event date, not `localNow.date` -- an
   * overnight shift still active after midnight keeps its (now-yesterday)
   * date, so the live accent stays on that date's cell, never on "today"'s
   * cell unless a shift's own date actually IS today.
   */
  activeShiftDates: string[];
}

/**
 * At most this many compact PERSONAL-EVENT indicators (shift/duty/absence)
 * show inside one day cell before the rest collapse into a "+N" overflow.
 * A day's holiday is rendered separately, next to the day number -- it's
 * calendar context about the date, not something the person is doing, so
 * it never consumes one of these slots or counts toward the overflow.
 */
const MAX_INDICATORS_PER_DAY = 2;

/** Spoken when a day has no personal shift/duty/absence at all -- the screen-reader equivalent of the cell's own visually-empty content area. */
const NO_SHIFTS_LABEL = "אין משמרות";

/**
 * The full accessible name for one day cell: date, holiday (if any), then
 * every personal-event indicator for that day (never just the up-to-2
 * VISIBLE ones -- a screen reader user gets the complete list, the same one
 * `SelectedDayPanel` would show), each flagged "(משוער)" when tentative, or
 * `NO_SHIFTS_LABEL` when the day has none. Built from the SAME `indicators`
 * array the cell's own `IndicatorChips` renders, so the two can never
 * disagree about what a day contains.
 */
function dayAccessibleLabel(meta: DayMeta, indicators: CalendarDayIndicator[]): string {
  const segments = [meta.dateLabel];
  if (meta.holiday) segments.push(meta.holiday.label);
  segments.push(
    indicators.length > 0
      ? indicators.map((indicator) => (indicator.tentative ? `${indicator.label} (משוער)` : indicator.label)).join(", ")
      : NO_SHIFTS_LABEL,
  );
  return segments.join(", ");
}

function IndicatorChips({ indicators }: { indicators: CalendarDayIndicator[] }) {
  const visibleIndicators = indicators.slice(0, MAX_INDICATORS_PER_DAY);
  const mobileOverflow = Math.max(indicators.length - 1, 0);
  const wideOverflow = Math.max(indicators.length - MAX_INDICATORS_PER_DAY, 0);

  if (visibleIndicators.length === 0) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
      {visibleIndicators[0] ? (
        <IndicatorChip
          emoji={visibleIndicators[0].emoji}
          label={visibleIndicators[0].label}
          categoryBgClassName={visibleIndicators[0].colorClassName ?? undefined}
        />
      ) : null}
      {visibleIndicators[1] ? (
        <IndicatorChip
          emoji={visibleIndicators[1].emoji}
          label={visibleIndicators[1].label}
          categoryBgClassName={visibleIndicators[1].colorClassName ?? undefined}
          className="hidden sm:flex"
        />
      ) : null}
      {mobileOverflow > 0 ? <OverflowChip count={mobileOverflow} className="sm:hidden" /> : null}
      {wideOverflow > 0 ? <OverflowChip count={wideOverflow} className="hidden sm:block" /> : null}
    </div>
  );
}

/**
 * The Sunday-first month grid for "הלוח שלי" -- optimized for scanning, not
 * reading. Every day cell shows the day number, its holiday emoji right
 * beside it when the date has one (calendar context, same idea as
 * `EveryoneMonthGrid`'s own holiday placement -- never competing with the
 * person's own events for space), plus at most two compact PERSONAL-EVENT
 * indicators covering shifts/duties/absences, then a "+N" overflow rather
 * than an ever-growing list. The FULL breakdown for a day lives only in
 * `SelectedDayPanel`, next to/below this grid -- this component never tries
 * to say everything about a day, only enough to recognize it at a glance.
 * Purely presentational -- selection state lives in the client parent
 * (`ScheduleCalendar`) so this component has no state of its own and is
 * trivial to render/test in isolation. Indicator labels come from the
 * shared `buildDayIndicators` helper (never invented here), so a day cell
 * and the selected-day detail always agree on what a given event actually
 * is.
 *
 * Every structural piece (weekday header, week rows, cell shell, height
 * budget, indicator chips) comes from `CalendarSurface` (PR #38 shell-
 * unification round) -- the exact same primitives `EveryoneMonthGrid` uses,
 * so the two calendar surfaces can never drift into different geometry.
 * Only the CONTENT this component feeds into that shell (personal event
 * indicators, via `buildDayIndicators`) is its own.
 *
 * Each indicator's chip also carries a semantic per-event-type soft color
 * tint (`CalendarDayIndicator.colorClassName`, from
 * `lib/presentation/eventColor.ts`) -- this is what makes "הלוח שלי"
 * (always a single person: the viewer themselves or a manager's selected
 * person) visually distinguish shift/duty/absence TYPES, never applied to
 * `EveryoneMonthGrid`'s own department-wide "כולם" grid, which stays on its
 * existing coverage-status coloring untouched (this component and that one
 * are simply never rendered for the same perspective -- see
 * `app/(app)/schedule/page.tsx`).
 */
export function CalendarGrid({
  grid,
  days,
  eventsByDate,
  selectedDate,
  onSelectDate,
  activeShiftDates,
}: CalendarGridProps) {
  const activeShiftDateSet = new Set(activeShiftDates);
  const weeks = chunkIntoWeeks(grid);

  return (
    <div>
      <CalendarWeekdayHeader />

      <div className="flex flex-col pt-2">
        {weeks.map((week, weekIndex) => {
          const isFirstRow = weekIndex === 0;
          const isLastRow = weekIndex === weeks.length - 1;

          return (
            <CalendarWeekRow key={weekIndex} week={week} isFirstRow={isFirstRow} isLastRow={isLastRow}>
              {week.map((cell, index) => {
                if (!cell.inMonth) {
                  return <OutOfMonthCell key={cell.date} cell={cell} columnIndex={index} isFirstRow={isFirstRow} />;
                }

                const date = cell.date;
                const meta = days[date];
                if (!meta) {
                  return (
                    <div key={date} aria-hidden="true" className={cellBorderClasses(index, isFirstRow)} />
                  );
                }

                const dayEvents = eventsByDate[date] ?? [];
                const indicators = buildDayIndicators(dayEvents);
                const hasTentative = dayEvents.some((event) => event.certainty === "tentative");
                const isSelected = date === selectedDate;

                return (
                  <CalendarDayCell
                    key={date}
                    date={date}
                    meta={meta}
                    columnIndex={index}
                    isFirstRow={isFirstRow}
                    isSelected={isSelected}
                    onSelect={onSelectDate}
                    accessibleLabel={dayAccessibleLabel(meta, indicators)}
                    dayNumberActive={activeShiftDateSet.has(date)}
                    headerExtra={
                      <>
                        {meta.holiday ? (
                          <span aria-hidden="true" className="text-[10px] sm:text-xs">
                            {meta.holiday.emoji}
                          </span>
                        ) : null}
                        {hasTentative ? (
                          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                        ) : null}
                      </>
                    }
                  >
                    <IndicatorChips indicators={indicators} />
                  </CalendarDayCell>
                );
              })}
            </CalendarWeekRow>
          );
        })}
      </div>
    </div>
  );
}
