import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { CalendarGridCell } from "@/lib/domain/calendarMonth";
import type { PersonalCalendarEventView } from "@/lib/readModels/types";
import { ScheduleCalendar } from "./ScheduleCalendar";
import type { DayMeta } from "./types";

afterEach(() => {
  cleanup();
});

const WEEK_DATES = [
  "2026-08-09",
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
];

const WEEK_GRID: CalendarGridCell[] = WEEK_DATES.map((date) => ({ date, inMonth: true }));

function dayMeta(date: string, overrides: Partial<DayMeta> = {}): DayMeta {
  const day = Number(date.slice(8, 10));
  return {
    date,
    dayNumber: day,
    isToday: false,
    isPast: false,
    dateLabel: `יום · ${day} באוגוסט`,
    holiday: null,
    ...overrides,
  };
}

function weekDays(overrides: Record<string, Partial<DayMeta>> = {}): Record<string, DayMeta> {
  const days: Record<string, DayMeta> = {};
  for (const date of WEEK_DATES) days[date] = dayMeta(date, overrides[date]);
  return days;
}

function shiftEvent(overrides: Partial<PersonalCalendarEventView> = {}): PersonalCalendarEventView {
  return {
    date: "2026-08-12",
    title: "טכנאי יום",
    rawValue: "טכנאי יום",
    category: "shift",
    certainty: "confirmed",
    role: "technician",
    period: "day",
    slot: null,
    shadow: false,
    startTimeOverride: null,
    endTimeOverride: null,
    dutyFamily: null,
    absenceKind: null,
    changeNote: null,
    timing: { status: "not_evaluable" },
    shiftCompanions: [],
    ...overrides,
  };
}

/** The selected-day detail panel only -- scoped so assertions never accidentally match the calendar grid's own in-cell event labels (Design Pass PR #20). */
function selectedDayPanel() {
  return within(screen.getByRole("region", { name: "פרטי היום הנבחר" }));
}

describe("ScheduleCalendar", () => {
  it("shows the default-selected day's details on first render", () => {
    render(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[shiftEvent({ date: "2026-08-12" })]}
        defaultSelectedDate="2026-08-12"
        activeShiftDates={[]}
      />,
    );
    expect(selectedDayPanel().getByText("טכנאי יום")).toBeInTheDocument();
  });

  it("clicking a different day updates the selected-day panel", () => {
    render(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[
          shiftEvent({ date: "2026-08-12", title: "טכנאי יום" }),
          shiftEvent({ date: "2026-08-13", title: "טכנאי לילה", period: "night" }),
        ]}
        defaultSelectedDate="2026-08-12"
        activeShiftDates={[]}
      />,
    );

    expect(selectedDayPanel().getByText("טכנאי יום")).toBeInTheDocument();
    expect(selectedDayPanel().queryByText("טכנאי לילה")).toBeNull();

    act(() => {
      screen.getByRole("button", { name: /13 באוגוסט/ }).click();
    });

    expect(selectedDayPanel().getByText("טכנאי לילה")).toBeInTheDocument();
    expect(selectedDayPanel().queryByText("טכנאי יום")).toBeNull();
  });

  it("still shows the calendar grid's own compact indicator for a date, even once it's no longer selected", () => {
    render(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[shiftEvent({ date: "2026-08-12", title: "טכנאי יום", period: "day" })]}
        defaultSelectedDate="2026-08-12"
        activeShiftDates={[]}
      />,
    );

    act(() => {
      screen.getByRole("button", { name: /13 באוגוסט/ }).click();
    });

    // The 12th's own cell still shows its compact indicator; only the panel moved.
    expect(screen.getByRole("button", { name: /12 באוגוסט/ }).textContent).toContain("יום");
  });

  it("shows the free-day message when the selected day has nothing scheduled", () => {
    render(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[]}
        defaultSelectedDate="2026-08-12"
        activeShiftDates={[]}
      />,
    );
    expect(selectedDayPanel().getByText("היום פנוי אצלך 😌")).toBeInTheDocument();
  });

  it("renders no selected-day panel when defaultSelectedDate is null", () => {
    render(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[]}
        defaultSelectedDate={null}
        activeShiftDates={[]}
      />,
    );
    expect(screen.queryByRole("region", { name: "פרטי היום הנבחר" })).toBeNull();
  });

  it("shows a duty in the selected-day panel -- not just shifts (הלוח שלי)", () => {
    const dutyEvent = shiftEvent({
      date: "2026-08-12",
      title: "שומר 1",
      category: "duty",
      role: null,
      period: "unspecified",
      dutyFamily: "guard",
      slot: 1,
    });
    render(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[dutyEvent]}
        defaultSelectedDate="2026-08-12"
        activeShiftDates={[]}
      />,
    );
    expect(selectedDayPanel().getByText("שומר 1")).toBeInTheDocument();
  });

  it("shows an absence in the selected-day panel", () => {
    const absence = shiftEvent({
      date: "2026-08-12",
      title: "חופש",
      category: "absence",
      role: null,
      period: "unspecified",
      absenceKind: "vacation",
    });
    render(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[absence]}
        defaultSelectedDate="2026-08-12"
        activeShiftDates={[]}
      />,
    );
    expect(selectedDayPanel().getAllByText("חופש").length).toBeGreaterThan(0);
  });

  it("12. a server re-render with fresh props (simulating an automatic revalidation) never resets the user's selected day", () => {
    const { rerender } = render(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[
          shiftEvent({ date: "2026-08-12", title: "טכנאי יום" }),
          shiftEvent({ date: "2026-08-13", title: "טכנאי לילה", period: "night" }),
        ]}
        defaultSelectedDate="2026-08-12"
        activeShiftDates={[]}
      />,
    );

    act(() => {
      screen.getByRole("button", { name: /13 באוגוסט/ }).click();
    });
    expect(selectedDayPanel().getByText("טכנאי לילה")).toBeInTheDocument();

    // The page always passes the SAME `defaultSelectedDate` -- it's the
    // server's original resolved "today"/first-of-month pick, not something
    // that tracks the user's in-browser click. A revalidation re-renders
    // this same component instance (same `key`, see ScheduleCalendar's own
    // docstring) with fresh event data but that identical prop -- selection
    // state must survive because React never re-initializes `useState` on a
    // prop change alone.
    rerender(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[
          shiftEvent({ date: "2026-08-12", title: "טכנאי יום" }),
          shiftEvent({ date: "2026-08-13", title: "טכנאי לילה", period: "night" }),
          shiftEvent({ date: "2026-08-13", title: "עדכון חדש", period: "night" }),
        ]}
        defaultSelectedDate="2026-08-12"
        activeShiftDates={[]}
      />,
    );

    expect(selectedDayPanel().getByText("טכנאי לילה")).toBeInTheDocument();
    expect(selectedDayPanel().getByText("עדכון חדש")).toBeInTheDocument();
    expect(selectedDayPanel().queryByText("טכנאי יום")).toBeNull();
  });

  it("a genuinely NEW defaultSelectedDate (e.g. a search deep-link navigation) DOES update the selection, unlike an unchanged revalidation re-render", () => {
    const { rerender } = render(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[
          shiftEvent({ date: "2026-08-12", title: "טכנאי יום" }),
          shiftEvent({ date: "2026-08-14", title: "טכנאי לילה", period: "night" }),
        ]}
        defaultSelectedDate="2026-08-12"
        activeShiftDates={[]}
      />,
    );
    expect(selectedDayPanel().getByText("טכנאי יום")).toBeInTheDocument();

    // Same month (same key upstream), but a NEW defaultSelectedDate value --
    // simulates clicking a global-search date result while already on this month.
    rerender(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[
          shiftEvent({ date: "2026-08-12", title: "טכנאי יום" }),
          shiftEvent({ date: "2026-08-14", title: "טכנאי לילה", period: "night" }),
        ]}
        defaultSelectedDate="2026-08-14"
        activeShiftDates={[]}
      />,
    );

    expect(selectedDayPanel().getByText("טכנאי לילה")).toBeInTheDocument();
    expect(selectedDayPanel().queryByText("טכנאי יום")).toBeNull();
  });

  it("only ever renders events belonging to this month's monthEvents prop -- no unrelated data", () => {
    const { container } = render(
      <ScheduleCalendar
        grid={WEEK_GRID}
        days={weekDays()}
        monthEvents={[shiftEvent({ date: "2026-08-12" })]}
        defaultSelectedDate="2026-08-12"
        activeShiftDates={[]}
      />,
    );
    expect(container.textContent).not.toContain("@");
  });
});
