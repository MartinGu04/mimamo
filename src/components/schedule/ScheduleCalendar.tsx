"use client";

import { useMemo, useState } from "react";
import type { CalendarGridCell } from "@/lib/domain/calendarMonth";
import type { PersonalCalendarEventView } from "@/lib/readModels/types";
import { Panel } from "@/components/ui/Panel";
import { CalendarGrid } from "./CalendarGrid";
import { SelectedDayPanel } from "./SelectedDayPanel";
import type { DayMeta } from "./types";

interface ScheduleCalendarProps {
  grid: CalendarGridCell[];
  days: Record<string, DayMeta>;
  /** The displayed month's own shift/duty/absence Events only -- never the full read model. Each shift carries its own already-resolved "מי איתי במשמרת" roster (see `SelectedDayPanel`); nothing here is ever re-derived client-side. */
  monthEvents: PersonalCalendarEventView[];
  defaultSelectedDate: string | null;
  /** Event dates (not necessarily today) of every currently-running personal shift -- see CalendarGrid. */
  activeShiftDates: string[];
}

/**
 * The only client boundary on "הלוח שלי" (`/schedule`): owns which day is
 * selected. Receives nothing beyond this month's already-safe shift/duty/
 * absence Events and presentation-safe calendar metadata (`DayMeta`) --
 * never the full `PersonalScheduleReadModel`, never counterpart/coworker
 * data.
 *
 * Desktop: a two-column layout -- the calendar leads (roughly 70% of the
 * width), the selected day's detail sits beside it in a ~380px side
 * column, never as a giant full-width card stacked below. Mobile keeps
 * the simpler stacked layout (detail below the calendar).
 *
 * Switching months is a normal server navigation (see `MonthNav`). This
 * component is deliberately NEVER remounted for a month change (PR #38 --
 * the page no longer keys it by the month param) so the browser keeps
 * diffing/patching the SAME calendar instance instead of destroying and
 * recreating the whole subtree, which is what caused a visible page jump.
 * `selectedDate` still needs to reset to the new month's own default,
 * though -- `defaultSelectedDate` re-syncs whenever its VALUE actually
 * changes (whether from a month change OR a genuine external navigation to
 * a specific day, e.g. global search's `?date=` deep link, PR #35), using
 * React's own "adjusting state when a prop changes" pattern (a setState
 * call during render, guarded by comparing against a tracked previous
 * value) rather than an effect -- no extra render pass, no risk of the
 * stale selection flashing first. This never fights an in-page click or an
 * automatic revalidation (PR #34): revalidating the SAME URL re-renders
 * with the exact same `defaultSelectedDate` string, so the guard never
 * re-fires.
 */
export function ScheduleCalendar({
  grid,
  days,
  monthEvents,
  defaultSelectedDate,
  activeShiftDates,
}: ScheduleCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(defaultSelectedDate);
  const [syncedDefaultSelectedDate, setSyncedDefaultSelectedDate] = useState(defaultSelectedDate);

  if (defaultSelectedDate !== syncedDefaultSelectedDate) {
    setSyncedDefaultSelectedDate(defaultSelectedDate);
    setSelectedDate(defaultSelectedDate);
  }

  const eventsByDate = useMemo(() => {
    const map: Record<string, PersonalCalendarEventView[]> = {};
    for (const event of monthEvents) {
      (map[event.date] ??= []).push(event);
    }
    return map;
  }, [monthEvents]);

  const selectedDayMeta = selectedDate ? (days[selectedDate] ?? null) : null;
  const selectedDayEvents = selectedDate ? (eventsByDate[selectedDate] ?? []) : [];

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
      <Panel variant="panel" glass="subtle" className="calendar-surface">
        <CalendarGrid
          grid={grid}
          days={days}
          eventsByDate={eventsByDate}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          activeShiftDates={activeShiftDates}
        />
      </Panel>
      <SelectedDayPanel dayMeta={selectedDayMeta} events={selectedDayEvents} />
    </div>
  );
}
