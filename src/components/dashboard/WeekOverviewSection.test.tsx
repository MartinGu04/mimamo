import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PersonalWeekOverview } from "@/lib/presentation/personalWeekOverview";
import { WeekOverviewSection } from "./WeekOverviewSection";

afterEach(() => {
  cleanup();
});

function emptyOverview(todayDate = "2026-08-19"): PersonalWeekOverview {
  const dates = ["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"];
  return {
    weekStart: dates[0],
    weekEnd: dates[6],
    days: dates.map((date) => ({ date, isToday: date === todayDate, events: [] })),
  };
}

describe("WeekOverviewSection", () => {
  it("renders exactly seven day units, one per operational-week date", () => {
    render(<WeekOverviewSection overview={emptyOverview()} />);
    expect(screen.getByRole("list", { name: "סקירת השבוע, ראשון עד שבת" }).children).toHaveLength(7);
  });

  it("renders a calm empty state for a day with no events, and still shows the day itself", () => {
    render(<WeekOverviewSection overview={emptyOverview()} />);
    expect(screen.getAllByText("אין אירועים")).toHaveLength(7);
  });

  it("marks today with a non-color-only indicator", () => {
    render(<WeekOverviewSection overview={emptyOverview("2026-08-19")} />);
    expect(screen.getByText("היום")).toBeInTheDocument();
    const todayItem = screen.getByText("היום").closest("li");
    expect(todayItem).toHaveAttribute("aria-current", "date");
  });

  it("renders multiple same-day events without collapsing them", () => {
    const overview = emptyOverview();
    const monday = overview.days.find((day) => day.date === "2026-08-17")!;
    monday.events = [
      {
        key: "1",
        title: "טכנאי יום",
        emoji: "☀️",
        subtitle: null,
        category: "shift",
        timing: { status: "not_evaluable" },
        tentative: false,
      },
      {
        key: "2",
        title: "שומר 1",
        emoji: "💂",
        subtitle: "שמירה 1",
        category: "duty",
        timing: { status: "not_evaluable" },
        tentative: false,
      },
    ];

    render(<WeekOverviewSection overview={overview} />);
    expect(screen.getByText("טכנאי יום")).toBeInTheDocument();
    expect(screen.getByText("שומר 1")).toBeInTheDocument();
  });

  it("shows a resolved shift's real start/end time, never inventing one for unresolved timing", () => {
    const overview = emptyOverview();
    const today = overview.days.find((day) => day.isToday)!;
    today.events = [
      {
        key: "resolved",
        title: "טכנאי יום",
        emoji: "☀️",
        subtitle: null,
        category: "shift",
        timing: {
          status: "resolved",
          startLocalTime: "07:30",
          endLocalTime: "19:30",
          durationMinutes: 720,
          elapsedMinutesAtLoad: 0,
          remainingMinutesAtLoad: 720,
          progressPercentAtLoad: 0,
          minutesUntilStartAtLoad: 0,
        },
        tentative: false,
      },
    ];

    render(<WeekOverviewSection overview={overview} />);
    expect(screen.getByText("07:30 — 19:30")).toBeInTheDocument();
  });

  it("preserves the 'משוער' tentative badge", () => {
    const overview = emptyOverview();
    const today = overview.days.find((day) => day.isToday)!;
    today.events = [
      {
        key: "tentative",
        title: "טכנאי לילה",
        emoji: "🌙",
        subtitle: null,
        category: "shift",
        timing: { status: "not_evaluable" },
        tentative: true,
      },
    ];

    render(<WeekOverviewSection overview={overview} />);
    expect(screen.getByText("משוער")).toBeInTheDocument();
  });

  it("renders one responsive list, not a separate desktop-only element (no hidden duplicate 7-column structure)", () => {
    render(<WeekOverviewSection overview={emptyOverview()} />);
    const rail = screen.getByRole("list", { name: "סקירת השבוע, ראשון עד שבת" });
    expect(rail.className).toContain("overflow-x-auto");
    expect(rail.className).toContain("snap-x");
    expect(rail.className).toContain("lg:grid");
    expect(rail.className).toContain("lg:grid-cols-7");
    // Exactly one list in the whole section -- never a second desktop grid.
    expect(screen.getAllByRole("list", { name: "סקירת השבוע, ראשון עד שבת" })).toHaveLength(1);
  });

  it("shows the Hebrew weekday and compact date for each day", () => {
    render(<WeekOverviewSection overview={emptyOverview()} />);
    const rail = screen.getByRole("list", { name: "סקירת השבוע, ראשון עד שבת" });
    expect(within(rail).getByText("יום ראשון")).toBeInTheDocument();
    expect(within(rail).getByText("16.8")).toBeInTheDocument();
    expect(within(rail).getByText("יום שבת")).toBeInTheDocument();
    expect(within(rail).getByText("22.8")).toBeInTheDocument();
  });

  it("no longer carries its own 'צוות השבוע' Team Week shortcut -- moved to TeamWeekQuickAction (Home quick-action cards pass, see that component's own tests)", () => {
    render(<WeekOverviewSection overview={emptyOverview()} />);
    expect(screen.queryByRole("link", { name: /צוות השבוע/ })).toBeNull();
  });
});
