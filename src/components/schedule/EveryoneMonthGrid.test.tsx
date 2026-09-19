import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CalendarGridCell } from "@/lib/domain/calendarMonth";
import type { CoverageStatus } from "@/lib/domain/shiftCoverage";
import { coverageStatusLabel } from "@/lib/presentation/labels";
import { CALENDAR_CELL_HEIGHT_CLASSES } from "./CalendarSurface";
import type { ScheduleEveryoneDayView } from "@/lib/presentation/scheduleEveryone";
import { EveryoneMonthGrid } from "./EveryoneMonthGrid";
import type { DayMeta } from "./types";

afterEach(() => {
  cleanup();
});

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

describe("EveryoneMonthGrid", () => {
  it("renders a leading out-of-month cell as a non-interactive, dimmed date -- never a button, never blank", () => {
    const grid: CalendarGridCell[] = [{ date: "2026-08-08", inMonth: false }, ...WEEK_GRID];
    render(<EveryoneMonthGrid grid={grid} days={weekDays()} dayViews={{}} selectedDate={null} onSelectDate={noop} />);
    expect(screen.getAllByRole("button")).toHaveLength(7);
    expect(screen.queryByRole("button", { name: /8/ })).toBeNull();
    const outsideCell = screen.getByText("8", { selector: "span" });
    expect(outsideCell.className).toMatch(/opacity-40/);
    expect(outsideCell.closest("div[aria-hidden='true']")?.className).not.toMatch(/opacity-40/);
  });

  it("calls onSelectDate with the clicked day's date", () => {
    const onSelectDate = vi.fn();
    render(
      <EveryoneMonthGrid grid={WEEK_GRID} days={weekDays()} dayViews={{}} selectedDate={null} onSelectDate={onSelectDate} />,
    );
    screen.getByRole("button", { name: /12 באוגוסט/ }).click();
    expect(onSelectDate).toHaveBeenCalledWith("2026-08-12");
  });

  it("marks the selected day as pressed", () => {
    render(
      <EveryoneMonthGrid grid={WEEK_GRID} days={weekDays()} dayViews={{}} selectedDate="2026-08-12" onSelectDate={noop} />,
    );
    expect(screen.getByRole("button", { name: /12 באוגוסט/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("marks today distinctly from other days", () => {
    render(
      <EveryoneMonthGrid
        grid={WEEK_GRID}
        days={weekDays({ "2026-08-12": { isToday: true } })}
        dayViews={{}}
        selectedDate={null}
        onSelectDate={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /12 באוגוסט/ }).innerHTML).toMatch(/ring-primary/);
  });

  describe("weekend distinction (past/future structural parity)", () => {
    it("gives an unselected weekend day cell the same background wash a weekday cell doesn't get", () => {
      render(<EveryoneMonthGrid grid={WEEK_GRID} days={weekDays()} dayViews={{}} selectedDate={null} onSelectDate={noop} />);
      // 2026-08-14 is a Friday (weekend); 2026-08-12 is a Wednesday (weekday).
      const weekendCell = screen.getByRole("button", { name: /14 באוגוסט/ });
      const weekdayCell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(weekendCell.className).toMatch(/bg-weekend-tint/);
      expect(weekdayCell.className).not.toMatch(/bg-weekend-tint/);
    });

    it("a selected weekend day uses the normal selection background, not the weekend wash", () => {
      render(
        <EveryoneMonthGrid grid={WEEK_GRID} days={weekDays()} dayViews={{}} selectedDate="2026-08-14" onSelectDate={noop} />,
      );
      const cell = screen.getByRole("button", { name: /14 באוגוסט/ });
      expect(cell.className).toMatch(/bg-overlay-strong/);
      expect(cell.className).not.toMatch(/bg-weekend-tint/);
    });

    it("a PAST weekend cell keeps the exact same structural weekend-tint class as a FUTURE weekend cell", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-14": { isPast: true } })}
          dayViews={{}}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const pastWeekendCell = screen.getByRole("button", { name: /14 באוגוסט/ });
      const futureWeekendCell = screen.getByRole("button", { name: /15 באוגוסט/ });
      expect(pastWeekendCell.className).toMatch(/bg-weekend-tint/);
      expect(futureWeekendCell.className).toMatch(/bg-weekend-tint/);
      expect(pastWeekendCell.className).not.toMatch(/opacity-60/);
      const pastContentWrapper = pastWeekendCell.firstElementChild as HTMLElement;
      expect(pastContentWrapper.className).toMatch(/opacity-60/);
    });

    it("visually quiets a past day's CONTENT, never the cell's own background/border", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-09": { isPast: true } })}
          dayViews={{}}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /9 באוגוסט/ });
      expect(cell.className).not.toMatch(/opacity-60/);
      const contentWrapper = cell.firstElementChild as HTMLElement;
      expect(contentWrapper.className).toMatch(/opacity-60/);
    });

    it("does not quiet a future day's content at all", () => {
      render(<EveryoneMonthGrid grid={WEEK_GRID} days={weekDays()} dayViews={{}} selectedDate={null} onSelectDate={noop} />);
      const cell = screen.getByRole("button", { name: /15 באוגוסט/ });
      const contentWrapper = cell.firstElementChild as HTMLElement;
      expect(contentWrapper.className).not.toMatch(/opacity-60/);
    });

    it("a selected PAST weekend cell overrides both the weekend wash and the past de-emphasis", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-14": { isPast: true } })}
          dayViews={{}}
          selectedDate="2026-08-14"
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /14 באוגוסט/ });
      expect(cell.className).toMatch(/bg-overlay-strong/);
      expect(cell.className).not.toMatch(/bg-weekend-tint/);
      const contentWrapper = cell.firstElementChild as HTMLElement;
      expect(contentWrapper.className).not.toMatch(/opacity-60/);
    });
  });

  describe("stable grid geometry across months (PR #38 calendar stability)", () => {
    function daysForGrid(grid: CalendarGridCell[]): Record<string, DayMeta> {
      const days: Record<string, DayMeta> = {};
      for (const cell of grid) {
        if (cell.inMonth) days[cell.date] = dayMeta(cell.date);
      }
      return days;
    }

    it("always renders exactly 6 week rows (42 cells) regardless of month shape", async () => {
      const { buildMonthGrid } = await import("@/lib/domain/calendarMonth");
      for (const [year, month] of [[2026, 9], [2026, 8], [2026, 11]] as const) {
        cleanup();
        const grid = buildMonthGrid(year, month);
        const { container } = render(
          <EveryoneMonthGrid grid={grid} days={daysForGrid(grid)} dayViews={{}} selectedDate={null} onSelectDate={noop} />,
        );
        const weekLabels = container.querySelectorAll('[aria-label^="שבוע "]');
        expect(weekLabels).toHaveLength(6);
        const buttons = container.querySelectorAll("button");
        const outsideCells = container.querySelectorAll('div[aria-hidden="true"]');
        expect(buttons.length + outsideCells.length).toBe(42);
      }
    });

    it("out-of-month cells are never interactive buttons", async () => {
      const { buildMonthGrid } = await import("@/lib/domain/calendarMonth");
      const grid = buildMonthGrid(2026, 9);
      const { container } = render(
        <EveryoneMonthGrid grid={grid} days={daysForGrid(grid)} dayViews={{}} selectedDate={null} onSelectDate={noop} />,
      );
      const outsideCells = container.querySelectorAll('div[aria-hidden="true"]');
      expect(outsideCells.length).toBeGreaterThan(0);
      for (const cell of outsideCells) {
        expect(cell.tagName).not.toBe("BUTTON");
        expect(cell.textContent?.trim()).toMatch(/^\d{1,2}$/);
      }
    });
  });

  describe("staffing content is preserved (event/staffing semantics unchanged by the structural redesign)", () => {
    function dayView(overrides: Partial<ScheduleEveryoneDayView> = {}): ScheduleEveryoneDayView {
      return {
        date: "2026-08-12",
        day: null,
        night: null,
        genericSupervisorNames: [],
        genericTechnicianNames: [],
        duties: [],
        absences: [],
        ...overrides,
      };
    }

    it("never applies any per-event-type semantic color class -- the shared 'כולם' calendar keeps its existing coverage-status styling exactly, unaffected by the single-person calendar's new color system", () => {
      const { container } = render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{
            "2026-08-12": dayView({
              day: {
                period: "day",
                label: "יום",
                emoji: "☀️",
                technicians: { people: [{ key: "p1", name: "דניאל כהן", tentative: false }], status: "full", message: null },
                supervisors: { people: [], status: "not_evaluable", message: null },
                shadowTechnicianNames: [],
                shadowSupervisorNames: [],
                coverageStatus: "full",
              },
              night: {
                period: "night",
                label: "לילה",
                emoji: "🌙",
                technicians: { people: [], status: "missing", message: null },
                supervisors: { people: [], status: "missing", message: null },
                shadowTechnicianNames: [],
                shadowSupervisorNames: [],
                coverageStatus: "missing",
              },
              duties: [{ key: "d1", personName: "דניאל כהן", title: "שומר 1", emoji: "💂" }],
            }),
          }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      expect(container.innerHTML).not.toMatch(/bg-event-/);
    });

    it("shows the day-period staffing summary text inside the cell", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{
            "2026-08-12": dayView({
              day: {
                period: "day",
                label: "יום",
                emoji: "☀️",
                technicians: { people: [{ key: "p1", name: "דניאל כהן", tentative: false }], status: "full", message: null },
                supervisors: { people: [], status: "not_evaluable", message: null },
                shadowTechnicianNames: [],
                shadowSupervisorNames: [],
                coverageStatus: "full",
              },
            }),
          }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("דניאל כהן");
    });

    it("shows an extra-activity '+N' chip when duties/absences exist for a date", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{
            "2026-08-12": dayView({
              duties: [{ key: "d1", personName: "איתן דוגמה", title: "שומר", emoji: "🛡️" }],
            }),
          }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("+1");
    });

    it("shows the night-period staffing summary text inside the cell too, not just day", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{
            "2026-08-12": dayView({
              night: {
                period: "night",
                label: "לילה",
                emoji: "🌙",
                technicians: { people: [{ key: "p2", name: "עומר פרץ", tentative: false }], status: "full", message: null },
                supervisors: { people: [], status: "not_evaluable", message: null },
                shadowTechnicianNames: [],
                shadowSupervisorNames: [],
                coverageStatus: "full",
              },
            }),
          }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("עומר פרץ");
    });

    it("colors the mobile-only status dot by coverage status -- missing coverage gets the critical color, never a generic neutral one", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{
            "2026-08-12": dayView({
              day: {
                period: "day",
                label: "יום",
                emoji: "☀️",
                technicians: { people: [], status: "missing", message: "חסר טכנאי" },
                supervisors: { people: [], status: "not_evaluable", message: null },
                shadowTechnicianNames: [],
                shadowSupervisorNames: [],
                coverageStatus: "missing",
              },
            }),
          }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.querySelector(".bg-critical")).not.toBeNull();
    });

    it("a day with no staffing data at all shows 'אין נתונים' rather than a blank/missing summary", () => {
      render(
        <EveryoneMonthGrid grid={WEEK_GRID} days={weekDays()} dayViews={{}} selectedDate={null} onSelectDate={noop} />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("אין נתונים");
    });
  });

  describe('role presentation order: אחמ"ש before טכנאי (never independently reordered per-consumer)', () => {
    function dayView(overrides: Partial<ScheduleEveryoneDayView> = {}): ScheduleEveryoneDayView {
      return { date: "2026-08-12", day: null, night: null, genericSupervisorNames: [], genericTechnicianNames: [], duties: [], absences: [], ...overrides };
    }

    it('lists names in "אחמ"ש first, טכנאי second" order when both roles are staffed and full', () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{
            "2026-08-12": dayView({
              day: {
                period: "day",
                label: "יום",
                emoji: "☀️",
                technicians: { people: [{ key: "p1", name: "גדעון פולין", tentative: false }], status: "full", message: null },
                supervisors: { people: [{ key: "p2", name: "איתי אוליר", tentative: false }], status: "full", message: null },
                shadowTechnicianNames: [],
                shadowSupervisorNames: [],
                coverageStatus: "full",
              },
            }),
          }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      const text = cell.textContent ?? "";
      expect(text).toContain("איתי אוליר, גדעון פולין");
      // Never the reverse order.
      expect(text).not.toContain("גדעון פולין, איתי אוליר");
      expect(text.indexOf("איתי אוליר")).toBeLessThan(text.indexOf("גדעון פולין"));
    });

    it('lists the coverage-status MESSAGES in "אחמ"ש first, טכנאי second" order too, when both roles are short-staffed', () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{
            "2026-08-12": dayView({
              night: {
                period: "night",
                label: "לילה",
                emoji: "🌙",
                technicians: { people: [], status: "missing", message: "חסר טכנאי" },
                supervisors: { people: [], status: "missing", message: 'חסר אחמ"ש' },
                shadowTechnicianNames: [],
                shadowSupervisorNames: [],
                coverageStatus: "missing",
              },
            }),
          }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      const text = cell.textContent ?? "";
      expect(text.indexOf('חסר אחמ"ש')).toBeGreaterThanOrEqual(0);
      expect(text.indexOf('חסר אחמ"ש')).toBeLessThan(text.indexOf("חסר טכנאי"));
    });
  });

  describe("mobile day/night coverage visibility (correctness fix: night status must never disappear below sm:)", () => {
    function periodView(period: "day" | "night", coverageStatus: CoverageStatus): NonNullable<ScheduleEveryoneDayView["day"]> {
      return {
        period,
        label: period === "day" ? "יום" : "לילה",
        emoji: period === "day" ? "☀️" : "🌙",
        technicians:
          coverageStatus === "missing"
            ? { people: [], status: "missing", message: "חסר טכנאי" }
            : { people: [{ key: "p1", name: "איש כלשהו", tentative: false }], status: "full", message: null },
        supervisors: { people: [], status: "not_evaluable", message: null },
        shadowTechnicianNames: [],
        shadowSupervisorNames: [],
        coverageStatus,
      };
    }

    function dayView(overrides: Partial<ScheduleEveryoneDayView> = {}): ScheduleEveryoneDayView {
      return { date: "2026-08-12", day: null, night: null, genericSupervisorNames: [], genericTechnicianNames: [], duties: [], absences: [], ...overrides };
    }

    /** The mobile-only labeled-dot group (`role="group"`) for a rendered cell, scoped so assertions never accidentally match the sm:+ text lines. */
    function mobileSummary(cell: HTMLElement) {
      const group = cell.querySelector('[role="group"]');
      if (!group) throw new Error("mobile staffing summary group not found");
      return group as HTMLElement;
    }

    it("1. exposes both day and night coverage states in the mobile-only summary, each with its own accessible label", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{ "2026-08-12": dayView({ day: periodView("day", "full"), night: periodView("night", "partial") }) }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      const summary = mobileSummary(cell);
      expect(summary.className).toMatch(/sm:hidden/);
      const labels = [...summary.querySelectorAll(".sr-only")].map((el) => el.textContent);
      expect(labels.some((label) => label?.startsWith("יום:"))).toBe(true);
      expect(labels.some((label) => label?.startsWith("לילה:"))).toBe(true);
      expect(summary.querySelector(".bg-success")).not.toBeNull();
      expect(summary.querySelector(".bg-warning")).not.toBeNull();
    });

    it("2. day full + night missing does NOT present as only a full/green state -- the critical night dot is still there", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{ "2026-08-12": dayView({ day: periodView("day", "full"), night: periodView("night", "missing") }) }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      const summary = mobileSummary(cell);
      expect(summary.querySelector(".bg-success")).not.toBeNull();
      expect(summary.querySelector(".bg-critical")).not.toBeNull();
      const nightLabel = [...summary.querySelectorAll(".sr-only")].find((el) => el.textContent?.startsWith("לילה:"));
      expect(nightLabel?.textContent).toContain("אין כיסוי");
    });

    it("3. day missing + night full works symmetrically -- the critical day dot is still there", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{ "2026-08-12": dayView({ day: periodView("day", "missing"), night: periodView("night", "full") }) }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      const summary = mobileSummary(cell);
      expect(summary.querySelector(".bg-critical")).not.toBeNull();
      expect(summary.querySelector(".bg-success")).not.toBeNull();
      const dayLabel = [...summary.querySelectorAll(".sr-only")].find((el) => el.textContent?.startsWith("יום:"));
      expect(dayLabel?.textContent).toContain("אין כיסוי");
    });

    it("4. an extra duty/absence count still fits in the mobile summary without changing the cell's shared height budget", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{
            "2026-08-12": dayView({
              day: periodView("day", "full"),
              night: periodView("night", "full"),
              duties: [{ key: "d1", personName: "איתן דוגמה", title: "שומר", emoji: "🛡️" }],
              absences: [{ key: "a1", personName: "מאיה לוי", label: "חופש", emoji: "🏖️" }],
            }),
          }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      const summary = mobileSummary(cell);
      expect(summary.textContent).toContain("+2");
      // The cell itself still carries exactly the shared height budget --
      // fitting the overflow chip into the existing mobile row never adds
      // a taller/extra height class.
      for (const token of CALENDAR_CELL_HEIGHT_CLASSES.split(" ")) {
        expect(cell.className).toContain(token);
      }
    });

    it("5. desktop (sm:+) presentation is unchanged -- two full text lines, day then night, still present", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{ "2026-08-12": dayView({ day: periodView("day", "full"), night: periodView("night", "missing") }) }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      // The label text sits in its OWN inner span (`hidden truncate sm:inline`)
      // -- the chip's `hidden sm:flex` visibility class lives one level up,
      // on its immediate parent.
      const dayLine = screen.getByText("איש כלשהו").parentElement;
      const nightLine = screen.getByText("חסר טכנאי").parentElement;
      expect(dayLine?.className).toMatch(/hidden/);
      expect(dayLine?.className).toMatch(/sm:flex/);
      expect(nightLine?.className).toMatch(/hidden/);
      expect(nightLine?.className).toMatch(/sm:flex/);
      // The desktop lines are a separate DOM subtree from the mobile-only
      // summary -- both exist, neither replaces the other in markup, only
      // Tailwind's responsive classes decide which one paints.
      expect(cell.querySelector('[role="group"]')).not.toBeNull();
    });
  });

  describe('regression: a generic (period-unspecified) אחמ"ש assignment renders once in the compact calendar cell, never omitted, never duplicated onto both period lines', () => {
    it("through the REAL production pipeline (Event[] -> buildShiftStaffingOverview -> buildScheduleEveryoneDayViews), a date staffed with real technicians and only a generic supervisor shows full coverage on both day and night cells, with the generic supervisor's name shown EXACTLY ONCE", async () => {
      const { buildShiftSchedule } = await import("@/lib/domain/shiftSchedule");
      const { buildShiftStaffingOverview } = await import("@/lib/readModels/managerEventProjections");
      const { buildScheduleEveryoneDayViews } = await import("@/lib/presentation/scheduleEveryone");
      const schedule = buildShiftSchedule("07:30");

      function event(overrides: Partial<import("@/lib/domain/event").Event>): import("@/lib/domain/event").Event {
        return {
          personId: "p_default",
          personName: "ברירת מחדל",
          date: "2026-08-12",
          title: "",
          rawValue: "",
          category: "shift",
          certainty: "confirmed",
          role: null,
          period: "unspecified",
          sourceSheet: "משמרות + תורנויות",
          sourceCell: "C2",
          slot: null,
          shadow: false,
          startTimeOverride: null,
          endTimeOverride: null,
          changeNote: null,
          dutyFamily: null,
          absenceKind: null,
          ...overrides,
        };
      }

      const events = [
        event({ personId: "p_tech_day", personName: "טכנאי יום", role: "technician", period: "day" }),
        event({ personId: "p_tech_night", personName: "טכנאי לילה", role: "technician", period: "night" }),
        event({ personId: "p_ilay", personName: "עילאי שפירא", role: "supervisor", period: "unspecified" }),
      ];

      const overview = buildShiftStaffingOverview(events, schedule, new Set(["2026-08-12"]));
      const views = buildScheduleEveryoneDayViews(["2026-08-12"], overview, [], []);

      render(
        <EveryoneMonthGrid grid={WEEK_GRID} days={weekDays()} dayViews={views} selectedDate={null} onSelectDate={noop} />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      // עילאי שפירא is rendered EXACTLY ONCE in the cell -- the dedicated
      // generic-assignment line, shown once above the day/night lines --
      // never omitted, and never duplicated once on the "☀️" line and
      // again on the "🌙" line as if it were two separate shifts.
      expect(within(cell).getAllByText("עילאי שפירא")).toHaveLength(1);
      expect(cell.textContent).not.toContain("חסר אחמ");
      expect(cell.querySelector(".bg-critical")).toBeNull();
      // Technician staffing (unaffected by this change) still shows.
      expect(cell.textContent).toContain("טכנאי יום");
      expect(cell.textContent).toContain("טכנאי לילה");
    });

    it("a date staffed ONLY by a generic supervisor (no other shift Events at all) still shows the name once, with no missing-SUPERVISOR warning on either period (technician is still genuinely missing -- the generic supervisor never spills over into covering that different role)", async () => {
      const { buildShiftSchedule } = await import("@/lib/domain/shiftSchedule");
      const { buildShiftStaffingOverview } = await import("@/lib/readModels/managerEventProjections");
      const { buildScheduleEveryoneDayViews } = await import("@/lib/presentation/scheduleEveryone");
      const schedule = buildShiftSchedule("07:30");

      function event(overrides: Partial<import("@/lib/domain/event").Event>): import("@/lib/domain/event").Event {
        return {
          personId: "p_default",
          personName: "ברירת מחדל",
          date: "2026-08-12",
          title: "",
          rawValue: "",
          category: "shift",
          certainty: "confirmed",
          role: null,
          period: "unspecified",
          sourceSheet: "משמרות + תורנויות",
          sourceCell: "C2",
          slot: null,
          shadow: false,
          startTimeOverride: null,
          endTimeOverride: null,
          changeNote: null,
          dutyFamily: null,
          absenceKind: null,
          ...overrides,
        };
      }

      const events = [event({ personId: "p_ilay", personName: "עילאי שפירא", role: "supervisor", period: "unspecified" })];
      const overview = buildShiftStaffingOverview(events, schedule, new Set(["2026-08-12"]));
      const views = buildScheduleEveryoneDayViews(["2026-08-12"], overview, [], []);

      render(
        <EveryoneMonthGrid grid={WEEK_GRID} days={weekDays()} dayViews={views} selectedDate={null} onSelectDate={noop} />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.textContent).toContain("עילאי שפירא");
      expect(within(cell).getAllByText("עילאי שפירא")).toHaveLength(1);
      // No missing-SUPERVISOR message anywhere -- the generic assignment
      // covers that role fully on both periods.
      expect(cell.textContent).not.toContain("חסר אחמ");
      // Technician is still genuinely missing on both periods (there are
      // no technician Events at all in this scenario) -- that's correct,
      // unaffected behavior, not something the generic supervisor should
      // paper over.
      expect(cell.textContent).toContain("חסר טכנאי");
    });
  });

  describe("REGRESSION: day-cell accessible name carries the full staffing content, not just the date", () => {
    function dayView(overrides: Partial<ScheduleEveryoneDayView> = {}): ScheduleEveryoneDayView {
      return { date: "2026-08-12", day: null, night: null, genericSupervisorNames: [], genericTechnicianNames: [], duties: [], absences: [], ...overrides };
    }

    it("a day with no staffing data at all announces 'אין נתונים' for both periods, never just the bare date", () => {
      render(
        <EveryoneMonthGrid grid={WEEK_GRID} days={weekDays()} dayViews={{}} selectedDate={null} onSelectDate={noop} />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      const name = cell.getAttribute("aria-label") ?? "";
      expect(name).toContain("יום: אין נתונים");
      expect(name).toContain("לילה: אין נתונים");
    });

    it("announces each period's real coverage status by name, e.g. 'יום: מלא' / 'לילה: חסר'", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{
            "2026-08-12": dayView({
              day: {
                period: "day",
                label: "יום",
                emoji: "☀️",
                technicians: { people: [{ key: "p1", name: "דניאל כהן", tentative: false }], status: "full", message: null },
                supervisors: { people: [], status: "not_evaluable", message: null },
                shadowTechnicianNames: [],
                shadowSupervisorNames: [],
                coverageStatus: "full",
              },
              night: {
                period: "night",
                label: "לילה",
                emoji: "🌙",
                technicians: { people: [], status: "missing", message: "חסר טכנאי" },
                supervisors: { people: [], status: "missing", message: null },
                shadowTechnicianNames: [],
                shadowSupervisorNames: [],
                coverageStatus: "missing",
              },
            }),
          }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      const name = cell.getAttribute("aria-label") ?? "";
      expect(name).toContain(`יום: ${coverageStatusLabel("full")}`);
      expect(name).toContain(`לילה: ${coverageStatusLabel("missing")}`);
    });

    it("includes a duties/absences count in the accessible name when present", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{
            "2026-08-12": dayView({
              duties: [{ key: "d1", personName: "איתן דוגמה", title: "שומר", emoji: "🛡️" }],
              absences: [{ key: "a1", personName: "מאיה לוי", label: "חופש", emoji: "🏖️" }],
            }),
          }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell).toHaveAccessibleName(/2 תורנויות והיעדרויות נוספות/);
    });

    it("includes the holiday's full label in the accessible name", () => {
      const HOLIDAY = { emoji: "🍎", label: "ראש השנה", kind: "holiday" as const, shortLabel: "חג" };
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays({ "2026-08-12": { holiday: HOLIDAY } })}
          dayViews={{}}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell).toHaveAccessibleName(/ראש השנה/);
    });

    it("includes a generic (period-unspecified) assignment's names in the accessible name", () => {
      render(
        <EveryoneMonthGrid
          grid={WEEK_GRID}
          days={weekDays()}
          dayViews={{ "2026-08-12": dayView({ genericSupervisorNames: ["עילאי שפירא"] }) }}
          selectedDate={null}
          onSelectDate={noop}
        />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell).toHaveAccessibleName(/עילאי שפירא/);
    });

    it("the accessible name still starts with the date, so existing name-based lookups by date keep working", () => {
      render(
        <EveryoneMonthGrid grid={WEEK_GRID} days={weekDays()} dayViews={{}} selectedDate={null} onSelectDate={noop} />,
      );
      const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
      expect(cell.getAttribute("aria-label")).toMatch(/^יום · 12 באוגוסט/);
    });
  });
});
