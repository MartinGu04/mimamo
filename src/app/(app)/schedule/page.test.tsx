import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type {
  PersonalAssignmentView,
  PersonalCalendarEventView,
  PersonalScheduleReadModel,
} from "@/lib/readModels/types";

const getRequestPersonalSchedule = vi.fn();
vi.mock("@/lib/readModels/getRequestPersonalSchedule", () => ({ getRequestPersonalSchedule }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/DataFreshnessStatus", () => ({
  DataFreshnessStatus: ({ fetchedAt }: { fetchedAt: string }) => <div data-testid="freshness">{fetchedAt}</div>,
}));

const { default: SchedulePage } = await import("./page");

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  getRequestPersonalSchedule.mockReset();
});

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

function assignmentEvent(overrides: Partial<PersonalAssignmentView> = {}): PersonalAssignmentView {
  return { ...shiftEvent(), temporalState: "current", ...overrides };
}

function model(overrides: Partial<PersonalScheduleReadModel> = {}): PersonalScheduleReadModel {
  return {
    person: { id: "p_1", name: "דני בדיקה", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null },
    fetchedAt: "2026-08-12T08:00:00.000Z",
    localNow: { date: "2026-08-12", minuteOfDay: 600 },
    todayEvents: [],
    upcomingEvents: [],
    calendarEvents: [],
    currentAssignments: [],
    nextAssignmentGroup: null,
    currentShiftContexts: [],
    nextShiftContexts: [],
    currentAdjacentShiftContexts: [],
    issues: [],
    dutyBlocks: [],
    dutyActions: [],
    ...overrides,
  };
}

function okResult(m: PersonalScheduleReadModel) {
  return { status: "ok" as const, model: m };
}

function searchParams(month?: string) {
  return Promise.resolve(month ? { month } : {});
}

/** The selected-day detail panel only -- scoped so assertions never accidentally match the calendar grid's own in-cell event labels (Design Pass PR #20). */
function selectedDayPanel() {
  return within(screen.getByRole("region", { name: "פרטי היום הנבחר" }));
}

describe("SchedulePage — month resolution", () => {
  it("defaults to the month containing localNow.date when no month param is given", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(model()));
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(screen.getAllByText("אוגוסט 2026").length).toBeGreaterThan(0);
  });

  it("uses a valid explicit month param", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(model()));
    const element = await SchedulePage({ searchParams: searchParams("2026-12") });
    render(element);
    expect(screen.getAllByText("דצמבר 2026").length).toBeGreaterThan(0);
  });

  it("falls back safely to the current month for an invalid month param, never crashes", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(model()));
    const element = await SchedulePage({ searchParams: searchParams("not-a-month") });
    render(element);
    expect(screen.getAllByText("אוגוסט 2026").length).toBeGreaterThan(0);
  });

  it("falls back safely for an out-of-range month param", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(model()));
    const element = await SchedulePage({ searchParams: searchParams("2026-13") });
    render(element);
    expect(screen.getAllByText("אוגוסט 2026").length).toBeGreaterThan(0);
  });
});

describe("SchedulePage — selected day resets on month change (regression)", () => {
  it("does not carry a stale selected day forward when the parent re-renders with a new month's props", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(
        model({
          calendarEvents: [
            shiftEvent({ date: "2026-08-20", title: "משמרת אוגוסט מיוחדת" }),
            shiftEvent({ date: "2026-09-01", title: "משמרת ספטמבר" }),
          ],
        }),
      ),
    );

    // Render August (default month, since localNow.date is 2026-08-12) using the
    // SAME parent composition the real app uses -- SchedulePage itself, which keys
    // <ScheduleCalendar key={monthParam} .../> by the displayed month.
    const augustElement = await SchedulePage({ searchParams: searchParams("2026-08") });
    const { rerender } = render(augustElement);

    // Select a day OTHER than August's default (today, the 12th).
    act(() => {
      screen.getByRole("button", { name: /20 באוגוסט/ }).click();
    });
    expect(selectedDayPanel().getByText("משמרת אוגוסט מיוחדת")).toBeInTheDocument();

    // Transition to September via a rerender on the SAME mounted tree -- this is
    // exactly the scenario a client-side Next.js navigation produces: new server
    // props arrive, but nothing forces a remount unless the composition keys the
    // client component by month.
    const septemberElement = await SchedulePage({ searchParams: searchParams("2026-09") });
    rerender(septemberElement);

    // September's own default-selected day (the 1st, since today isn't in this
    // month) must be shown -- never a leftover reference to August's selection.
    expect(selectedDayPanel().getByText("משמרת ספטמבר")).toBeInTheDocument();
    expect(selectedDayPanel().queryByText("משמרת אוגוסט מיוחדת")).toBeNull();
  });
});

describe("SchedulePage — ?date= deep link (global search navigation, PR #35)", () => {
  it("23. selects the requested date when it falls within the displayed month", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(
        model({
          calendarEvents: [
            shiftEvent({ date: "2026-08-12", title: "משמרת ברירת מחדל" }),
            shiftEvent({ date: "2026-08-22", title: "משמרת מבוקשת" }),
          ],
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: Promise.resolve({ month: "2026-08", date: "2026-08-22" }) });
    render(element);

    expect(selectedDayPanel().getByText("משמרת מבוקשת")).toBeInTheDocument();
    expect(selectedDayPanel().queryByText("משמרת ברירת מחדל")).toBeNull();
  });

  it("ignores a ?date= outside the displayed month, falling back to the existing today-or-first default", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(
        model({
          calendarEvents: [shiftEvent({ date: "2026-08-12", title: "משמרת ברירת מחדל" })],
        }),
      ),
    );
    // The requested date belongs to September, but the displayed month is August.
    const element = await SchedulePage({ searchParams: Promise.resolve({ month: "2026-08", date: "2026-09-05" }) });
    render(element);

    expect(selectedDayPanel().getByText("משמרת ברירת מחדל")).toBeInTheDocument();
  });

  it("25. preserves the existing month/person params alongside ?date=, never resetting an unrelated filter", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(model()));
    const element = await SchedulePage({ searchParams: Promise.resolve({ month: "2026-12", date: "2026-12-05" }) });
    render(element);
    expect(screen.getAllByText("דצמבר 2026").length).toBeGreaterThan(0);
  });

  it("never crashes on a garbage ?date= value, including a prototype-pollution-style key", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(model({ calendarEvents: [shiftEvent({ date: "2026-08-12", title: "משמרת ברירת מחדל" })] })),
    );
    const element = await SchedulePage({
      searchParams: Promise.resolve({ month: "2026-08", date: "__proto__" }),
    });
    expect(() => render(element)).not.toThrow();
    expect(selectedDayPanel().getByText("משמרת ברירת מחדל")).toBeInTheDocument();
  });

  it("August -> September: a ?date= in a later month with NO explicit ?month= opens that month, not the current one", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(
        model({
          localNow: { date: "2026-08-12", minuteOfDay: 600 }, // "today" is August
          calendarEvents: [shiftEvent({ date: "2026-09-01", title: "משמרת ספטמבר" })],
        }),
      ),
    );
    // No `month` param at all -- only `date`, in a different month than today.
    const element = await SchedulePage({ searchParams: Promise.resolve({ date: "2026-09-01" }) });
    render(element);

    expect(screen.getAllByText("ספטמבר 2026").length).toBeGreaterThan(0);
    expect(selectedDayPanel().getByText("משמרת ספטמבר")).toBeInTheDocument();
  });

  it("December -> January: a ?date= crossing a YEAR boundary with no explicit ?month= opens the right year too", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(
        model({
          localNow: { date: "2026-12-15", minuteOfDay: 600 }, // "today" is December 2026
          calendarEvents: [shiftEvent({ date: "2027-01-05", title: "משמרת ינואר" })],
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: Promise.resolve({ date: "2027-01-05" }) });
    render(element);

    expect(screen.getAllByText("ינואר 2027").length).toBeGreaterThan(0);
    expect(selectedDayPanel().getByText("משמרת ינואר")).toBeInTheDocument();
  });

  it("a shared-shift-style deep link (bare ?date=, no ?month=) across a month boundary opens that month/date, exactly like a plain date result", async () => {
    // Mirrors the exact URL shape resolveSearchIntent's shared_shift/person
    // results produce: /schedule?date=YYYY-MM-DD, no month param at all.
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(
        model({
          localNow: { date: "2026-08-05", minuteOfDay: 600 },
          calendarEvents: [shiftEvent({ date: "2026-09-22", title: "משמרת משותפת", period: "night" })],
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: Promise.resolve({ date: "2026-09-22" }) });
    render(element);

    expect(screen.getAllByText("ספטמבר 2026").length).toBeGreaterThan(0);
    expect(selectedDayPanel().getByText("משמרת משותפת")).toBeInTheDocument();
  });

  it("an invalid ?date= with NO explicit ?month= falls back safely to the current month, never crashes", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(
        model({
          localNow: { date: "2026-08-12", minuteOfDay: 600 },
          calendarEvents: [shiftEvent({ date: "2026-08-12", title: "משמרת ברירת מחדל" })],
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: Promise.resolve({ date: "not-a-date" }) });
    expect(() => render(element)).not.toThrow();

    expect(screen.getAllByText("אוגוסט 2026").length).toBeGreaterThan(0);
    expect(selectedDayPanel().getByText("משמרת ברירת מחדל")).toBeInTheDocument();
  });

  it("an explicit ?month= still wins over a ?date= implying a different month", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(
        model({
          calendarEvents: [shiftEvent({ date: "2026-09-01", title: "משמרת ספטמבר" })],
        }),
      ),
    );
    const element = await SchedulePage({
      searchParams: Promise.resolve({ month: "2026-08", date: "2026-09-01" }),
    });
    render(element);

    expect(screen.getAllByText("אוגוסט 2026").length).toBeGreaterThan(0);
  });
});

describe("SchedulePage — active shift accent is event-date-aware, not tied to civil today", () => {
  it("a current same-day day shift: its own date gets the active accent", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(
        model({
          localNow: { date: "2026-08-12", minuteOfDay: 600 },
          calendarEvents: [shiftEvent({ date: "2026-08-12" })],
          currentAssignments: [assignmentEvent({ date: "2026-08-12" })],
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams("2026-08") });
    render(element);
    const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
    expect(cell.innerHTML).toMatch(/bg-primary/);
  });

  it("an overnight shift still current after midnight: the shift's OWN (previous) date gets the accent, not today's cell", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(
        model({
          // "Now" is 02:00 on the 13th, but the still-running overnight shift's Event date is the 12th.
          localNow: { date: "2026-08-13", minuteOfDay: 2 * 60 },
          calendarEvents: [shiftEvent({ date: "2026-08-12", period: "night" })],
          currentAssignments: [assignmentEvent({ date: "2026-08-12", period: "night" })],
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams("2026-08") });
    render(element);

    const shiftDateCell = screen.getByRole("button", { name: /12 באוגוסט/ });
    expect(shiftDateCell.innerHTML).toMatch(/bg-primary/);

    const todayCell = screen.getByRole("button", { name: /13 באוגוסט/ });
    expect(todayCell.innerHTML).toMatch(/ring-primary/);
    expect(todayCell.innerHTML).not.toMatch(/bg-primary/);
  });

  it("no current shift: no cell gets the active-shift accent", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(model({ localNow: { date: "2026-08-12", minuteOfDay: 600 }, currentAssignments: [] })),
    );
    const element = await SchedulePage({ searchParams: searchParams("2026-08") });
    render(element);
    const todayCell = screen.getByRole("button", { name: /12 באוגוסט/ });
    expect(todayCell.innerHTML).toMatch(/ring-primary/);
    expect(todayCell.innerHTML).not.toMatch(/bg-primary/);
  });

  it("a current DUTY (not a shift) never triggers the shift active-accent", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(
        model({
          localNow: { date: "2026-08-12", minuteOfDay: 600 },
          currentAssignments: [assignmentEvent({ date: "2026-08-12", category: "duty" })],
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams("2026-08") });
    render(element);
    const todayCell = screen.getByRole("button", { name: /12 באוגוסט/ });
    expect(todayCell.innerHTML).not.toMatch(/bg-primary/);
  });
});

describe("SchedulePage — configuration_error", () => {
  it("renders the configuration-error state instead of a calendar", async () => {
    getRequestPersonalSchedule.mockResolvedValue({
      status: "configuration_error",
      message: "Missing shift start time configuration.",
      person: { id: "p_1", name: "דני בדיקה", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null },
    });
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(screen.getByText("לא ניתן לחשב כרגע את שעות המשמרות")).toBeInTheDocument();
    expect(screen.queryByText(/2026/)).toBeNull();
  });
});

describe("SchedulePage — content", () => {
  it("renders the month's shift events and the selected-day panel by default on today", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(model({ calendarEvents: [shiftEvent({ date: "2026-08-12" })] })),
    );
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(selectedDayPanel().getByText("טכנאי יום")).toBeInTheDocument();
  });

  it("does not render a shift from a different month", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(model({ calendarEvents: [shiftEvent({ date: "2026-09-05", title: "טכנאי ספטמבר" })] })),
    );
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(screen.queryByText("טכנאי ספטמבר")).toBeNull();
  });

  it("never leaks raw workbook/identity keys or an email into the rendered output", async () => {
    getRequestPersonalSchedule.mockResolvedValue(
      okResult(model({ calendarEvents: [shiftEvent({ date: "2026-08-12" })] })),
    );
    const element = await SchedulePage({ searchParams: searchParams() });
    const { container } = render(element);
    expect(container.textContent).not.toContain("@");
    expect(container.textContent).not.toContain("sourceSheet");
    expect(container.textContent).not.toContain("sourceCell");
  });

  it("renders only its own content -- the shell (sidebar) is the protected layout's job, not the page's", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(model()));
    const element = await SchedulePage({ searchParams: searchParams() });
    const { container } = render(element);
    expect(container.querySelector("aside")).toBeNull();
  });

  it("shows the 'הלוח שלי' page title, not the old 'לוח משמרות' framing", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(model()));
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(screen.getByRole("heading", { name: "הלוח שלי" })).toBeInTheDocument();
  });
});

describe("SchedulePage — הלוח שלי represents more than shifts alone", () => {
  it("shows a duty in the selected-day panel end-to-end, from the real read model through the real page", async () => {
    const duty = shiftEvent({
      date: "2026-08-12",
      title: "שומר 1",
      category: "duty",
      role: null,
      period: "unspecified",
      dutyFamily: "guard",
      slot: 1,
    });
    getRequestPersonalSchedule.mockResolvedValue(okResult(model({ calendarEvents: [duty] })));
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(selectedDayPanel().getByText("שומר 1")).toBeInTheDocument();
    // The compact grid cell shows the duty family's own short label, not the full duty title.
    const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
    expect(cell.textContent).toContain("שמירה");
    expect(cell.textContent).not.toContain("שומר 1");
  });

  it("shows an absence in the selected-day panel end-to-end", async () => {
    const absence = shiftEvent({
      date: "2026-08-12",
      title: "חופש",
      category: "absence",
      role: null,
      period: "unspecified",
      absenceKind: "vacation",
    });
    getRequestPersonalSchedule.mockResolvedValue(okResult(model({ calendarEvents: [absence] })));
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(selectedDayPanel().getAllByText("חופש").length).toBeGreaterThan(0);
  });

  it("shows the day's holiday context end-to-end, compactly (emoji beside the day number) in the grid and in full in the selected-day panel", async () => {
    // 2026-09-12 is Rosh Hashana (see hebrewCalendar.test.ts).
    getRequestPersonalSchedule.mockResolvedValue(okResult(model({ localNow: { date: "2026-09-12", minuteOfDay: 600 } })));
    const element = await SchedulePage({ searchParams: searchParams("2026-09") });
    render(element);
    const cell = screen.getByRole("button", { name: /12 בספטמבר/ });
    // Holiday is calendar context, not a personal-event indicator -- shown
    // as just the emoji beside the day number, never the specific name.
    expect(cell.textContent).toContain("🍎");
    expect(cell.textContent).not.toContain("ראש השנה");
    expect(selectedDayPanel().getByText("ראש השנה")).toBeInTheDocument();
  });
});

describe("SchedulePage — data freshness uses PersonalScheduleReadModel.fetchedAt (PR #17 §10/§19)", () => {
  it("the freshness status receives this page's own model.fetchedAt", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(model({ fetchedAt: "2026-08-13T10:45:00.000Z" })));
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(screen.getByTestId("freshness")).toHaveTextContent("2026-08-13T10:45:00.000Z");
  });
});
