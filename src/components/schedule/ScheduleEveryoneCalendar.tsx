"use client";

import { useState } from "react";
import type { CalendarGridCell } from "@/lib/domain/calendarMonth";
import { Panel } from "@/components/ui/Panel";
import type { ScheduleEveryoneDayView } from "@/lib/presentation/scheduleEveryone";
import { EveryoneMonthGrid } from "./EveryoneMonthGrid";
import { EveryoneSelectedDayPanel } from "./EveryoneSelectedDayPanel";
import type { DayMeta } from "./types";

interface ScheduleEveryoneCalendarProps {
  grid: CalendarGridCell[];
  days: Record<string, DayMeta>;
  dayViews: Record<string, ScheduleEveryoneDayView>;
  defaultSelectedDate: string | null;
}

/**
 * "כולם" mode's client boundary -- owns which day is selected, same
 * pattern as `ScheduleCalendar`. Receives only the already-safe, already
 * month-scoped `ScheduleEveryoneDayView` projection -- never a full
 * `Person`/`Event`, never email (PR #24 §24). Never remounted for a month
 * change (PR #38, matching `ScheduleCalendar`) -- `selectedDate` re-syncs
 * whenever `defaultSelectedDate`'s VALUE actually changes, via React's
 * "adjusting state when a prop changes" pattern (a setState call during
 * render, guarded against a tracked previous value), so a fresh month's own
 * default is picked up without destroying/recreating the calendar subtree.
 */
export function ScheduleEveryoneCalendar({ grid, days, dayViews, defaultSelectedDate }: ScheduleEveryoneCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(defaultSelectedDate);
  const [syncedDefaultSelectedDate, setSyncedDefaultSelectedDate] = useState(defaultSelectedDate);

  if (defaultSelectedDate !== syncedDefaultSelectedDate) {
    setSyncedDefaultSelectedDate(defaultSelectedDate);
    setSelectedDate(defaultSelectedDate);
  }

  const selectedDayMeta = selectedDate ? (days[selectedDate] ?? null) : null;
  const selectedDayView = selectedDate ? (dayViews[selectedDate] ?? null) : null;

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
      <Panel variant="panel" glass="subtle" className="calendar-surface">
        <EveryoneMonthGrid
          grid={grid}
          days={days}
          dayViews={dayViews}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      </Panel>
      <EveryoneSelectedDayPanel dayMeta={selectedDayMeta} dayView={selectedDayView} />
    </div>
  );
}
