import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CalendarGridCell } from "@/lib/domain/calendarMonth";
import { parseCalendarDate } from "@/lib/domain/dutyBlocks";
import { weekOfYear } from "@/lib/domain/weekOfYear";
import type { PersonalEventView } from "@/lib/readModels/types";
import type { HolidayContext } from "@/lib/presentation/hebrewCalendar";
import { CalendarGrid } from "./CalendarGrid";
import type { DayMeta } from "./types";

afterEach(() => {
  cleanup();
});

function shiftEvent(overrides: Partial<PersonalEventView> = {}): PersonalEventView {
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
    ...overrides,
  };
}

function dutyEvent(overrides: Partial<PersonalEventView> = {}): PersonalEventView {
  return shiftEvent({
    title: "שומר 1",
    rawValue: "שומר 1",
    category: "duty",
    role: null,
    period: "unspecified",
    dutyFamily: "guard",
    slot: 1,
    ...overrides,
  });
}

function absenceEvent(overrides: Partial<PersonalEventView> = {}): PersonalEventView {
  return shiftEvent({
    title: "חופש",
    rawValue: "חופש",
    category: "absence",
    role: null,
    period: "unspecified",
    absenceKind: "vacation",
    ...overrides,
  });
}

function activityEvent(overrides: Partial<PersonalEventView> = {}): PersonalEventView {
  return shiftEvent({
    title: "סוגר",
    rawValue: "סוגר",
    category: "status",
    role: null,
    period: "unspecified",
    ...overrides,
  });
}

const HOLIDAY: HolidayContext = { emoji: "🍎", label: "ראש השנה", kind: "holiday", shortLabel: "חג" };

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

// A minimal one-week grid: 2026-08-09 (Sun) .. 2026-08-15 (Sat), all "in month".
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

function weekDays(overrides: Record<string, Partial<DayMeta>> = {}): Record<string, DayMeta> {
  const days: Record<string, DayMeta> = {};
  for (const date of WEEK_DATES) {
    days[date] = dayMeta(date, overrides[date]);
  }
  return days;
}

const noop = () => {};

describe("CalendarGrid", () => {
  it("renders a leading out-of-month cell as a non-interactive, dimmed date -- never a button, never blank", () => {
    const grid: CalendarGridCell[] = [{ date: "2026-08-08", inMonth: false }, ...WEEK_GRID];
    render(
      <CalendarGrid
        grid={grid}
        days={weekDays()}
        eventsByDate={{}}
        selectedDate={null}
        onSelectDate={noop}
        activeShiftDates={[]}
      />,
    );
    // Only the 7 real in-month dates are interactive buttons.
    expect(screen.getAllByRole("button")).toHaveLength(7);
    // The out-of-month cell still shows a real day number, just not as a button.
    expect(screen.queryByRole("button", { name: /8/ })).toBeNull();
    // The day-number text itself is de-emphasized (content layer), but the
    // cell's own surface (the aria-hidden div) is never faded -- only its
    // content is (PR #38 follow-up: structure vs. content opacity split).
    const outsideCell = screen.getByText("8", { selector: "span" });
    expect(outsideCell.className).toMatch(/opacity-40/);
    expect(outsideCell.closest("div[aria-hidden='true']")?.className).not.toMatch(/opacity-40/);
  });

  it("shows a day-shift emoji indicator", () => {
    render(
      <CalendarGrid
        grid={WEEK_GRID}
        days={weekDays()}
        eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", period: "day" })] }}
        selectedDate={null}
        onSelectDate={noop}
        activeShiftDates={[]}
      />,
    );
    const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
    expect(cell.textContent).toContain("☀️");
  });

  it("shows a night-shift emoji indicator", () => {
    render(
      <CalendarGrid
        grid={WEEK_GRID}
        days={weekDays()}
        eventsByDate={{ "2026-08-13": [shiftEvent({ date: "2026-08-13", period: "night" })] }}
        selectedDate={null}
        onSelectDate={noop}
        activeShiftDates={[]}
      />,
    );
    const cell = screen.getByRole("button", { name: /13 באוגוסט/ });
    expect(cell.textContent).toContain("🌙");
  });

  it("shows both emojis and no duplicates for two different shifts on the same date", () => {
    render(
      <CalendarGrid
        grid={WEEK_GRID}
        days={weekDays()}
        eventsByDate={{
          "2026-08-12": [
            shiftEvent({ date: "2026-08-12", period: "day" }),
            shiftEvent({ date: "2026-08-12", period: "night" }),
          ],
        }}
        selectedDate={null}
        onSelectDate={noop}
        activeShiftDates={[]}
      />,
    );
    const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
    expect(cell.textContent).toContain("☀️");
    expect(cell.textContent).toContain("🌙");
  });

  it("shows a tentative marker for a tentative shift", () => {
    const { container } = render(
      <CalendarGrid
        grid={WEEK_GRID}
        days={weekDays()}
        eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", certainty: "tentative" })] }}
        selectedDate={null}
        onSelectDate={noop}
        activeShiftDates={[]}
      />,
    );
    expect(container.querySelector(".bg-warning")).not.toBeNull();
  });

  it("marks today distinctly from other days", () => {
    render(
      <CalendarGrid
        grid={WEEK_GRID}
        days={weekDays({ "2026-08-12": { isToday: true } })}
        eventsByDate={{}}
        selectedDate={null}
        onSelectDate={noop}
        activeShiftDates={[]}
      />,
    );
    const todayCell = screen.getByRole("button", { name: /12 באוגוסט/ });
    expect(todayCell.innerHTML).toMatch(/ring-primary|bg-primary/);
  });

  describe("active-shift accent (event-date-aware, not tied to isToday)", () => {
    it("1. a current same-day day shift: its own date gets the active accent", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-12": { isToday: true } })}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={["2026-08-12"]}
        />,
      );
      expect(screen.getByRole("button", { name: /12 באוגוסט/ }).innerHTML).toMatch(/bg-primary/);
    });

    it("2. a previous-date overnight shift still current after midnight: the PREVIOUS date gets the active accent, not today's cell", () => {
      // "Today" is the 13th, but the still-running overnight shift's own Event date is the 12th.
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-13": { isToday: true } })}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={["2026-08-12"]}
        />,
      );
      expect(screen.getByRole("button", { name: /12 באוגוסט/ }).innerHTML).toMatch(/bg-primary/);
    });

    it("3. civil today keeps the normal today ring but is NOT given the active-shift fill unless a shift actually belongs to that date", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-13": { isToday: true } })}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={["2026-08-12"]}
        />,
      );
      const todayCell = screen.getByRole("button", { name: /13 באוגוסט/ });
      expect(todayCell.innerHTML).toMatch(/ring-primary/);
      expect(todayCell.innerHTML).not.toMatch(/bg-primary/);
    });

    it("4. no current shift: no cell gets the active-shift accent", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-12": { isToday: true } })}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const todayCell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(todayCell.innerHTML).toMatch(/ring-primary/);
      expect(todayCell.innerHTML).not.toMatch(/bg-primary/);
    });
  });

  it("visually quiets a past day's CONTENT, never the cell's own background/border", () => {
    render(
      <CalendarGrid
        grid={WEEK_GRID}
        days={weekDays({ "2026-08-09": { isPast: true } })}
        eventsByDate={{}}
        selectedDate={null}
        onSelectDate={noop}
        activeShiftDates={[]}
      />,
    );
    const cell = screen.getByRole("button", { name: /9 באוגוסט/ });
    // The cell/button element itself (background, border, hover state) is
    // never faded -- only an inner content wrapper is (PR #38 follow-up).
    expect(cell.className).not.toMatch(/opacity-60/);
    const contentWrapper = cell.firstElementChild as HTMLElement;
    expect(contentWrapper.className).toMatch(/opacity-60/);
  });

  it("does not quiet a future day's content at all", () => {
    render(
      <CalendarGrid
        grid={WEEK_GRID}
        days={weekDays()}
        eventsByDate={{}}
        selectedDate={null}
        onSelectDate={noop}
        activeShiftDates={[]}
      />,
    );
    const cell = screen.getByRole("button", { name: /15 באוגוסט/ });
    expect(cell.className).not.toMatch(/opacity-60/);
    const contentWrapper = cell.firstElementChild as HTMLElement;
    expect(contentWrapper.className).not.toMatch(/opacity-60/);
  });

  it("a SELECTED past day is never quieted -- selection always overrides past de-emphasis", () => {
    render(
      <CalendarGrid
        grid={WEEK_GRID}
        days={weekDays({ "2026-08-09": { isPast: true } })}
        eventsByDate={{}}
        selectedDate="2026-08-09"
        onSelectDate={noop}
        activeShiftDates={[]}
      />,
    );
    const cell = screen.getByRole("button", { name: /9 באוגוסט/ });
    const contentWrapper = cell.firstElementChild as HTMLElement;
    expect(contentWrapper.className).not.toMatch(/opacity-60/);
  });

  it("renders an empty day (no events) with no emoji indicator", () => {
    render(
      <CalendarGrid
        grid={WEEK_GRID}
        days={weekDays()}
        eventsByDate={{}}
        selectedDate={null}
        onSelectDate={noop}
        activeShiftDates={[]}
      />,
    );
    const cell = screen.getByRole("button", { name: /11 באוגוסט/ });
    expect(cell.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
  });

  it("calls onSelectDate with the clicked day's date", async () => {
    const onSelectDate = vi.fn();
    render(
      <CalendarGrid
        grid={WEEK_GRID}
        days={weekDays()}
        eventsByDate={{}}
        selectedDate={null}
        onSelectDate={onSelectDate}
        activeShiftDates={[]}
      />,
    );
    screen.getByRole("button", { name: /12 באוגוסט/ }).click();
    expect(onSelectDate).toHaveBeenCalledWith("2026-08-12");
  });

  it("marks the selected day as pressed", () => {
    render(
      <CalendarGrid
        grid={WEEK_GRID}
        days={weekDays()}
        eventsByDate={{}}
        selectedDate="2026-08-12"
        onSelectDate={noop}
        activeShiftDates={[]}
      />,
    );
    expect(screen.getByRole("button", { name: /12 באוגוסט/ })).toHaveAttribute("aria-pressed", "true");
  });

  describe("no longer relies on square desktop cells (Design Pass PR #20)", () => {
    it("cells use a fixed, non-square height class, not aspect-square", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.className).not.toMatch(/aspect-square/);
      expect(cell.className).toMatch(/h-\[/);
    });
  });

  describe("in-cell indicators are compact and generic ('הלוח שלי' density pass)", () => {
    it("shows a short generic label ('יום'), never the full assignment title, inside the cell", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", period: "day", title: "טכנאי יום" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("יום");
      expect(cell.textContent).not.toContain("טכנאי יום");
    });

    it("labels a duty with its own duty-family label ('שמירה'), never the raw title", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [dutyEvent({ date: "2026-08-12" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("שמירה");
      expect(cell.textContent).not.toContain("שומר 1");
    });

    it("labels a full_kitchen duty 'מטבח מלא', never the generic 'תורנות'", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [dutyEvent({ date: "2026-08-12", dutyFamily: "full_kitchen", slot: null })],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("מטבח מלא");
      expect(cell.textContent).not.toContain("תורנות");
    });

    it("labels a daily_kitchen duty 'מטבח יומי'", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [dutyEvent({ date: "2026-08-12", dutyFamily: "daily_kitchen", slot: null })],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("מטבח יומי");
    });

    it("labels a rasar duty '🧹 רס\"ר'", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [dutyEvent({ date: "2026-08-12", dutyFamily: "rasar", slot: null })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain('רס"ר');
      expect(cell.textContent).toContain("🧹");
    });

    it("labels an oxid duty '📄 אוקסיד'", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [dutyEvent({ date: "2026-08-12", dutyFamily: "oxid", slot: null })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("אוקסיד");
      expect(cell.textContent).toContain("📄");
    });

    it("labels an absence with its own kind ('חופש')", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [absenceEvent({ date: "2026-08-12" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("חופש");
    });

    it("on wide layouts, shows up to 2 indicators plus a '+N' overflow chip marked visible only from sm: up", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [
              shiftEvent({ date: "2026-08-12", period: "day" }),
              shiftEvent({ date: "2026-08-12", period: "night" }),
              dutyEvent({ date: "2026-08-12" }),
            ],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("יום");
      expect(cell.textContent).toContain("לילה");
      expect(cell.textContent).not.toContain("שמירה");

      // Wide overflow ("+1", counting past the 2 visible-on-wide indicators)
      // is present and marked wide-only.
      const wideOverflow = screen.getByText("+1");
      expect(wideOverflow.className).toMatch(/sm:block/);
      expect(wideOverflow.className).toMatch(/hidden/);
    });

    it("on narrow layouts, only 1 indicator is meant to show, with a deeper '+N' overflow marked mobile-only", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [
              shiftEvent({ date: "2026-08-12", period: "day" }),
              shiftEvent({ date: "2026-08-12", period: "night" }),
              dutyEvent({ date: "2026-08-12" }),
            ],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      // The second indicator's OUTER chip wrapper is present in the DOM (so
      // a real sm:+ viewport can show it) but marked hidden below sm:.
      const secondIndicatorChip = screen.getByText("לילה").parentElement;
      expect(secondIndicatorChip?.className).toMatch(/hidden/);
      expect(secondIndicatorChip?.className).toMatch(/sm:flex/);

      // Mobile overflow ("+2", counting past only the 1 indicator meant to
      // show on a narrow layout) is present and marked mobile-only.
      const mobileOverflow = screen.getByText("+2");
      expect(mobileOverflow.className).toMatch(/sm:hidden/);
    });

    it("shows no wide-layout overflow when there are exactly 2 indicators -- both fit the wide budget", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [
              shiftEvent({ date: "2026-08-12", period: "day" }),
              shiftEvent({ date: "2026-08-12", period: "night" }),
            ],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      // Exactly 2 indicators fit the wide-layout budget of 2, so there's no
      // "hidden sm:block" wide overflow chip at all -- only the mobile-only
      // "+1" (since a narrow layout still shows just 1 indicator) exists.
      expect(screen.queryByText("+1")).not.toBeNull();
      expect(screen.getByText("+1").className).toMatch(/sm:hidden/);
    });

    it("shows no overflow at all, on either layout, when there is exactly 1 indicator", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", period: "day" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).not.toMatch(/\+\d/);
    });

    it("a day with no events and no holiday shows no indicator at all", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /11 באוגוסט/ });
      expect(cell.textContent?.trim()).toBe("11");
    });

  });

  describe("personal activities (status/other -- display-only informational entries)", () => {
    it("shows a 'סוגר' status activity's original title and lock emoji, never the generic pin", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [activityEvent({ date: "2026-08-12", category: "status", title: "סוגר" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("סוגר");
      expect(cell.textContent).toContain("🔒");
    });

    it("shows a 'שלב 9' other activity with its graduation-cap emoji", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [activityEvent({ date: "2026-08-12", category: "other", title: "שלב 9" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("שלב 9");
      expect(cell.textContent).toContain("🎓");
    });

    it("shows an unrecognized non-empty activity's ORIGINAL title with the generic pin fallback -- never disappears from the grid", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [activityEvent({ date: "2026-08-12", category: "other", title: "פעילות חדשה שלא ראינו" })],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("פעילות חדשה שלא ראינו");
      expect(cell.textContent).toContain("📌");
    });

    it("an activity coexists with a real shift on the same day -- both indicators show, neither hides the other", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [
              shiftEvent({ date: "2026-08-12", period: "day" }),
              activityEvent({ date: "2026-08-12", category: "status", title: "סוגר" }),
            ],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("יום");
      expect(cell.textContent).toContain("סוגר");
    });

    it("an activity's emoji is always shown, with its title hidden below sm: -- same mobile treatment as any other indicator", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [activityEvent({ date: "2026-08-12", category: "status", title: "סוגר" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const label = screen.getByText("סוגר");
      expect(label.className).toMatch(/hidden/);
      expect(label.className).toMatch(/sm:inline/);
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("🔒");
    });
  });

  describe("holiday is calendar context, never a personal-event indicator (polish pass)", () => {
    it("shows the holiday emoji beside the day number, not as a chip in the personal-event stack", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-12": { holiday: HOLIDAY } })}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("🍎");
      // Never the generic "חג" short label, nor the specific holiday name --
      // just the emoji, matching the "כולם" calendar's own holiday placement.
      expect(cell.textContent).not.toContain("חג");
      expect(cell.textContent).not.toContain("ראש השנה");
    });

    it("a holiday alone (no personal events) never renders an overflow chip", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-12": { holiday: HOLIDAY } })}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).not.toMatch(/\+\d/);
    });

    it("does not consume one of the 2 wide-layout personal-event slots -- both shifts still show, no wide overflow", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-12": { holiday: HOLIDAY } })}
          eventsByDate={{
            "2026-08-12": [
              shiftEvent({ date: "2026-08-12", period: "day" }),
              shiftEvent({ date: "2026-08-12", period: "night" }),
            ],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("🍎");
      expect(cell.textContent).toContain("יום");
      expect(cell.textContent).toContain("לילה");
      // Both personal events fit the wide budget of 2 -- the holiday didn't
      // take a slot, so there's no wide-layout ("hidden sm:block") overflow
      // chip at all. The mobile-only "+1" (from showing just 1 of 2 events
      // below sm:) is a separate, expected thing and is not what's asserted
      // here -- see the "mobile indicators" describe block below for that.
      const wideOverflow = [...cell.querySelectorAll("span")].find(
        (el) => el.textContent === "+1" && /hidden/.test(el.className) && /sm:block/.test(el.className),
      );
      expect(wideOverflow).toBeUndefined();
    });

    it("does not contribute to the personal-event overflow count", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-12": { holiday: HOLIDAY } })}
          eventsByDate={{
            "2026-08-12": [
              shiftEvent({ date: "2026-08-12", period: "day" }),
              shiftEvent({ date: "2026-08-12", period: "night" }),
              dutyEvent({ date: "2026-08-12" }),
            ],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("🍎");
      // 3 personal events, 2 visible on wide -- the wide overflow chip is
      // "+1" (the 3rd event only), never "+2" -- the holiday never inflates it.
      const wideOverflow = [...cell.querySelectorAll("span")].find(
        (el) => /hidden/.test(el.className) && /sm:block/.test(el.className) && el.getAttribute("dir") === "ltr",
      );
      expect(wideOverflow?.textContent).toBe("+1");
    });

    it("holiday and personal events both stay visible together -- neither hides the other", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-12": { holiday: HOLIDAY } })}
          eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", period: "night" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("🍎");
      expect(cell.textContent).toContain("🌙");
      expect(cell.textContent).toContain("לילה");
    });
  });

  describe("mobile indicators never rely on truncated text (polish pass)", () => {
    it("an indicator with a semantic emoji shows the emoji at every width, with its text label hidden below sm:", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", period: "night" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const label = screen.getByText("לילה");
      // The label text itself is never visible below sm: -- only from sm: up.
      expect(label.className).toMatch(/hidden/);
      expect(label.className).toMatch(/sm:inline/);
      // Nothing here ever truncates with an ellipsis-style class combined
      // with hidden text -- the emoji (not the label) is what mobile shows.
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("🌙");
    });

    it("an indicator with no semantic emoji (e.g. a 'גימלים' medical absence) shows a small non-truncated fallback dot instead of clipped text", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [absenceEvent({ date: "2026-08-12", absenceKind: "medical", title: "גימלים" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      // The label text is present in the DOM (for sm:+) but hidden below sm:.
      const label = screen.getByText("גימלים");
      expect(label.className).toMatch(/hidden/);
      expect(label.className).toMatch(/sm:inline/);
      // A small fallback dot exists for the mobile-only, non-text representation.
      const fallbackDot = cell.querySelector(".rounded-full.bg-border-strong");
      expect(fallbackDot).not.toBeNull();
      expect(fallbackDot?.className).toMatch(/sm:hidden/);
    });

    it("never applies a truncating ellipsis class to anything visible below sm: -- truncate only ever wraps the sm:-only label", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [dutyEvent({ date: "2026-08-12" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const label = screen.getByText("שמירה");
      expect(label.className).toMatch(/truncate/);
      // The truncate class lives on the label span itself, which is hidden
      // below sm: -- it never applies to the always-visible emoji/fallback.
      expect(label.className).toMatch(/hidden/);
    });
  });

  describe("weekend distinction (Thursday-Saturday, tasteful and subtle)", () => {
    it("gives the Thursday/Friday/Saturday weekday header labels a distinct, non-quiet tone", () => {
      const { container } = render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const headerLabels = container.querySelectorAll("div.grid.flex-1.grid-cols-7 > span");
      expect(headerLabels).toHaveLength(7);
      // Sunday (index 0) stays the quiet weekday tone.
      expect(headerLabels[0].className).toMatch(/text-muted-2/);
      // Thursday/Friday/Saturday (indices 4-6) get the distinct weekend tone.
      expect(headerLabels[4].className).toMatch(/text-muted(?!-2)/);
      expect(headerLabels[5].className).toMatch(/text-muted(?!-2)/);
      expect(headerLabels[6].className).toMatch(/text-muted(?!-2)/);
    });

    it("gives an unselected weekend day cell a subtle background wash a weekday cell doesn't get", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      // 2026-08-14 is a Friday (weekend); 2026-08-12 is a Wednesday (weekday).
      const weekendCell = screen.getByRole("button", { name: /14 באוגוסט/ });
      const weekdayCell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(weekendCell.className).toMatch(/bg-weekend-tint/);
      expect(weekdayCell.className).not.toMatch(/bg-weekend-tint/);
    });

    it("a selected weekend day uses the normal selection background, not the weekend wash", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{}}
          selectedDate="2026-08-14"
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /14 באוגוסט/ });
      expect(cell.className).toMatch(/bg-overlay-strong/);
      expect(cell.className).not.toMatch(/bg-weekend-tint/);
    });

    it("a PAST weekend cell keeps the exact same structural weekend-tint class as a FUTURE weekend cell -- past/future never changes the structural treatment", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-14": { isPast: true } })}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      // 2026-08-14 (past Friday) and 2026-08-15 (future Saturday) are both weekend cells.
      const pastWeekendCell = screen.getByRole("button", { name: /14 באוגוסט/ });
      const futureWeekendCell = screen.getByRole("button", { name: /15 באוגוסט/ });
      expect(pastWeekendCell.className).toMatch(/bg-weekend-tint/);
      expect(futureWeekendCell.className).toMatch(/bg-weekend-tint/);
      // Only the inner content wrapper differs (past de-emphasis), never the
      // cell's own background/border classes.
      expect(pastWeekendCell.className).not.toMatch(/opacity-60/);
      const pastContentWrapper = pastWeekendCell.firstElementChild as HTMLElement;
      expect(pastContentWrapper.className).toMatch(/opacity-60/);
    });

    it("today on a weekend keeps its today emphasis (ring) while still sitting on the weekend wash", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-14": { isToday: true } })}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /14 באוגוסט/ });
      expect(cell.className).toMatch(/bg-weekend-tint/);
      expect(cell.innerHTML).toMatch(/ring-primary/);
    });

    it("a selected PAST weekend cell overrides both the weekend wash and the past de-emphasis", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-14": { isPast: true } })}
          eventsByDate={{}}
          selectedDate="2026-08-14"
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /14 באוגוסט/ });
      expect(cell.className).toMatch(/bg-overlay-strong/);
      expect(cell.className).not.toMatch(/bg-weekend-tint/);
      const contentWrapper = cell.firstElementChild as HTMLElement;
      expect(contentWrapper.className).not.toMatch(/opacity-60/);
    });

    it("an outside-month weekend cell keeps its structural weekend tint regardless of past/future -- only the day number fades", () => {
      // 2026-08-15 (Saturday, column index 6 -- the weekend column) marked
      // out-of-month, so its cell lands in a genuinely weekend COLUMN
      // position (unlike prepending a padding date, which would land in
      // column 0 -- Sunday -- regardless of what weekday the date itself is).
      const grid: CalendarGridCell[] = WEEK_DATES.map((date, index) => ({ date, inMonth: index !== 6 }));
      render(
        <CalendarGrid
          grid={grid}
          days={weekDays()}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const outsideCell = screen.getByText("15", { selector: "span" }).closest("div[aria-hidden='true']");
      expect(outsideCell?.className).toMatch(/bg-weekend-tint/);
      expect(outsideCell?.className).not.toMatch(/opacity-40/);
    });
  });

  describe("semantic event colors (single-person mode -- CalendarGrid is only ever rendered for 'self'/'person', never 'כולם')", () => {
    it("a day shift's chip gets the shift-day soft-tint background", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", period: "day" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("יום").parentElement;
      expect(chip?.className).toMatch(/bg-event-shift-day-soft/);
    });

    it("a night shift's chip gets a DIFFERENT soft-tint background than a day shift", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-13": [shiftEvent({ date: "2026-08-13", period: "night" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("לילה").parentElement;
      expect(chip?.className).toMatch(/bg-event-shift-night-soft/);
      expect(chip?.className).not.toMatch(/bg-event-shift-day-soft/);
    });

    it("a vacation absence's chip gets the vacation soft-tint background", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [absenceEvent({ date: "2026-08-12", absenceKind: "vacation" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("חופש").parentElement;
      expect(chip?.className).toMatch(/bg-event-vacation-soft/);
    });

    it("an 'after' absence's chip gets a color distinct from vacation", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [absenceEvent({ date: "2026-08-12", absenceKind: "after", title: "אפטר" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("אפטר").parentElement;
      expect(chip?.className).toMatch(/bg-event-after-soft/);
      expect(chip?.className).not.toMatch(/bg-event-vacation-soft/);
    });

    it("a referral absence's chip gets its own distinct color", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [absenceEvent({ date: "2026-08-12", absenceKind: "referral", title: "הפנייה" })],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("הפנייה").parentElement;
      expect(chip?.className).toMatch(/bg-event-referral-soft/);
    });

    it("a guard duty's chip gets the guard soft-tint background", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [dutyEvent({ date: "2026-08-12", dutyFamily: "guard" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("שמירה").parentElement;
      expect(chip?.className).toMatch(/bg-event-guard-soft/);
    });

    it("an evacuation on-call duty's chip gets its own distinct color from guard", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [dutyEvent({ date: "2026-08-12", dutyFamily: "evacuation_on_call", slot: null })],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("כונן פינויים").parentElement;
      expect(chip?.className).toMatch(/bg-event-evacuation-soft/);
      expect(chip?.className).not.toMatch(/bg-event-guard-soft/);
    });

    it("a kitchen duty's chip gets the kitchen soft-tint background", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [dutyEvent({ date: "2026-08-12", dutyFamily: "daily_kitchen", slot: null })],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("מטבח יומי").parentElement;
      expect(chip?.className).toMatch(/bg-event-kitchen-soft/);
    });

    it("an unmapped/unclassified event (rasar duty) degrades safely to the default neutral chip background, never a broken/missing class", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [dutyEvent({ date: "2026-08-12", dutyFamily: "rasar" })],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText('רס"ר').parentElement;
      expect(chip?.className).toMatch(/bg-overlay-soft/);
      expect(chip?.className).not.toMatch(/bg-event-/);
    });

    it("a medical absence's chip gets the medical-rest soft-tint background (previously neutral -- follow-up mapping)", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [absenceEvent({ date: "2026-08-12", absenceKind: "medical", title: "גימלים" })],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("גימלים").parentElement;
      expect(chip?.className).toMatch(/bg-event-medical-rest-soft/);
    });

    it("a day_off absence's chip gets the SAME medical-rest color as a medical absence -- one shared color, not two", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [absenceEvent({ date: "2026-08-12", absenceKind: "day_off", title: "יום ד'" })],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("יום ד").parentElement;
      expect(chip?.className).toMatch(/bg-event-medical-rest-soft/);
    });

    it("a reserve duty's chip gets the reserve soft-tint background (previously neutral -- follow-up mapping)", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [dutyEvent({ date: "2026-08-12", dutyFamily: "reserve" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("עתודה").parentElement;
      expect(chip?.className).toMatch(/bg-event-reserve-soft/);
    });

    it("a callup duty's chip gets the SAME reserve color as a reserve duty -- one shared color, not two", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [dutyEvent({ date: "2026-08-12", dutyFamily: "callup" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("הקפצה").parentElement;
      expect(chip?.className).toMatch(/bg-event-reserve-soft/);
    });

    it("a morning shift's chip gets its own shift-morning soft-tint background, distinct from day and night", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", period: "morning" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const chip = screen.getByText("בוקר").parentElement;
      expect(chip?.className).toMatch(/bg-event-shift-morning-soft/);
      expect(chip?.className).not.toMatch(/bg-event-shift-day-soft/);
      expect(chip?.className).not.toMatch(/bg-event-shift-night-soft/);
    });

    it("emoji and label rendering are completely unaffected by the color addition", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", period: "day" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("☀️");
      expect(cell.textContent).toContain("יום");
    });
  });

  describe("week numbers (Design Pass PR #20, Sunday-first convention)", () => {
    it("shows the Sunday-first week-of-year number beside the row, matching the weekOfYear helper", () => {
      const { container } = render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const expectedWeek = weekOfYear(parseCalendarDate("2026-08-09")!);
      expect(container.querySelector(`[aria-label="שבוע ${expectedWeek}"]`)).not.toBeNull();
    });

    it("a week straddling a month boundary still gets exactly one week number for the whole row", () => {
      // 2026-08-30 (Sun) .. 2026-09-05 (Sat) -- August's own dates, then real
      // (out-of-month) September padding dates, exactly what buildMonthGrid
      // produces for August's final row.
      const grid: CalendarGridCell[] = [
        { date: "2026-08-30", inMonth: true },
        { date: "2026-08-31", inMonth: true },
        { date: "2026-09-01", inMonth: false },
        { date: "2026-09-02", inMonth: false },
        { date: "2026-09-03", inMonth: false },
        { date: "2026-09-04", inMonth: false },
        { date: "2026-09-05", inMonth: false },
      ];
      const days: Record<string, DayMeta> = {
        "2026-08-30": dayMeta("2026-08-30"),
        "2026-08-31": dayMeta("2026-08-31"),
      };
      const { container } = render(
        <CalendarGrid
          grid={grid}
          days={days}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const expectedWeek = weekOfYear(parseCalendarDate("2026-08-30")!);
      expect(container.querySelectorAll(`[aria-label="שבוע ${expectedWeek}"]`).length).toBe(1);
    });
  });

  describe("stable grid geometry across months (PR #38 calendar stability)", () => {
    /** Builds the exact `days` map buildMonthGrid's own in-month cells need, mirroring the page's buildDayMeta. */
    function daysForGrid(grid: CalendarGridCell[]): Record<string, DayMeta> {
      const days: Record<string, DayMeta> = {};
      for (const cell of grid) {
        if (cell.inMonth) days[cell.date] = dayMeta(cell.date);
      }
      return days;
    }

    it("always renders exactly 6 week rows (42 cells) regardless of month shape -- a 5-week-looking month, a 6-week month, and months starting on different weekdays", async () => {
      const { buildMonthGrid } = await import("@/lib/domain/calendarMonth");
      // 2026-09: starts Tuesday, 30 days (fits in 5 visual weeks of real dates).
      // 2026-08: starts Saturday, 31 days (spans 6 rows of real dates already).
      // 2026-11: starts Sunday (no leading padding at all).
      for (const [year, month] of [[2026, 9], [2026, 8], [2026, 11]] as const) {
        cleanup();
        const grid = buildMonthGrid(year, month);
        const { container } = render(
          <CalendarGrid
            grid={grid}
            days={daysForGrid(grid)}
            eventsByDate={{}}
            selectedDate={null}
            onSelectDate={noop}
            activeShiftDates={[]}
          />,
        );
        // 6 week-number badges -- one per row, always.
        const weekLabels = container.querySelectorAll('[aria-label^="שבוע "]');
        expect(weekLabels).toHaveLength(6);
        // Total cells (buttons + non-interactive out-of-month divs) is always 42.
        const buttons = container.querySelectorAll("button");
        const outsideCells = container.querySelectorAll('div[aria-hidden="true"]');
        expect(buttons.length + outsideCells.length).toBe(42);
      }
    });

    it("out-of-month cells are never interactive buttons, and always show a real (not blank) date number", async () => {
      const { buildMonthGrid } = await import("@/lib/domain/calendarMonth");
      const grid = buildMonthGrid(2026, 9); // September starts mid-week -- guarantees leading padding.
      const { container } = render(
        <CalendarGrid
          grid={grid}
          days={daysForGrid(grid)}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const outsideCells = container.querySelectorAll('div[aria-hidden="true"]');
      expect(outsideCells.length).toBeGreaterThan(0);
      for (const cell of outsideCells) {
        expect(cell.tagName).not.toBe("BUTTON");
        expect(cell.textContent?.trim()).toMatch(/^\d{1,2}$/);
        // The date number itself is de-emphasized, but the cell's own
        // background/border is not -- only content is faded.
        expect(cell.className).not.toMatch(/opacity-40/);
        expect(cell.querySelector("span")?.className).toMatch(/opacity-40/);
      }
    });
  });

  describe("REGRESSION: day-cell accessible name carries the full visible content, not just the date", () => {
    it("a day with no events at all announces an explicit 'no shifts' state, never just the bare date", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /11 באוגוסט/ });
      expect(cell).toHaveAccessibleName(/אין משמרות/);
    });

    it("announces every shift/duty indicator for the day, not only the up-to-2 visually shown", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{
            "2026-08-12": [
              shiftEvent({ date: "2026-08-12", period: "day" }),
              shiftEvent({ date: "2026-08-12", period: "night" }),
              dutyEvent({ date: "2026-08-12" }),
            ],
          }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      const name = cell.getAttribute("aria-label") ?? "";
      // All three -- including the 3rd, which only shows visually as a "+1"
      // overflow chip -- must reach a screen reader.
      expect(name).toContain("יום");
      expect(name).toContain("לילה");
      expect(name).toContain("שמירה");
    });

    it("flags a tentative shift with '(משוער)' in the accessible name", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", certainty: "tentative" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell).toHaveAccessibleName(/משוער/);
    });

    it("never adds the tentative flag to a confirmed event's own name", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays()}
          eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", certainty: "confirmed" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell).not.toHaveAccessibleName(/משוער/);
    });

    it("includes the holiday's full label in the accessible name -- even though the cell only shows the emoji visually", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-12": { holiday: HOLIDAY } })}
          eventsByDate={{}}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell).toHaveAccessibleName(/ראש השנה/);
    });

    it("the accessible name still starts with the date, so existing name-based lookups by date keep working", () => {
      render(
        <CalendarGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-12": { holiday: HOLIDAY } })}
          eventsByDate={{ "2026-08-12": [shiftEvent({ date: "2026-08-12", period: "day" })] }}
          selectedDate={null}
          onSelectDate={noop}
          activeShiftDates={[]}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.getAttribute("aria-label")).toMatch(/^יום · 12 באוגוסט/);
    });
  });
});
