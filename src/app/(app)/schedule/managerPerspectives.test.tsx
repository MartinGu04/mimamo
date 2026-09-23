import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ManagerAbsenceEntry, ManagerDutyEntry, ManagerShiftOverviewEntry } from "@/lib/readModels/managerTypes";
import type { ScheduleReadModel, ScheduleRosterOption, ScheduleTeamWeekView } from "@/lib/readModels/scheduleTypes";
import type { PersonalScheduleReadModel } from "@/lib/readModels/types";

const getRequestSchedule = vi.fn();
vi.mock("@/lib/readModels/getRequestSchedule", () => ({ getRequestSchedule }));

const useRouterPush = vi.fn();
const useSearchParamsValue = vi.fn(() => new URLSearchParams());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: useRouterPush, refresh: vi.fn() }),
  useSearchParams: () => useSearchParamsValue(),
}));

vi.mock("@/components/ui/DataFreshnessStatus", () => ({
  DataFreshnessStatus: ({ fetchedAt }: { fetchedAt: string }) => <div data-testid="freshness">{fetchedAt}</div>,
}));

const { default: SchedulePage } = await import("./page");

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  getRequestSchedule.mockReset();
  useRouterPush.mockReset();
  useSearchParamsValue.mockReturnValue(new URLSearchParams());
});

function personalModel(overrides: Partial<PersonalScheduleReadModel> = {}): PersonalScheduleReadModel {
  return {
    person: { id: "p_martin", name: "מרטין גוסין", isManager: true, isTechnician: false, isSupervisor: false, personnelType: null },
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

function roster(): ScheduleRosterOption[] {
  return [
    { id: "p_daniel", name: "דניאל כהן", personnelType: null, isSupervisor: false, isTechnician: false },
    { id: "p_eitan", name: "איתן דוגמה", personnelType: null, isSupervisor: false, isTechnician: false },
  ];
}

function scheduleModel(overrides: Partial<ScheduleReadModel> = {}): ScheduleReadModel {
  return {
    fetchedAt: "2026-08-12T08:00:00.000Z",
    localNow: { date: "2026-08-12", minuteOfDay: 600 },
    manager: null,
    roster: [],
    perspective: "self",
    selectedPersonId: null,
    selectedPersonName: null,
    personal: personalModel(),
    everyone: null,
    teamWeek: null,
    ...overrides,
  };
}

// Both fixture people carry at least one item on 2026-08-11 -- the default
// team-week view is `?people=active` (see `lib/presentation/teamWeekFilter.ts`),
// so a genuinely empty-celled fixture would have BOTH people silently
// filtered out of the matrix by default, breaking every test below that
// isn't specifically exercising the active/all filter itself.
function teamWeekView(overrides: Partial<ScheduleTeamWeekView> = {}): ScheduleTeamWeekView {
  return {
    weekStart: "2026-08-09",
    weekEnd: "2026-08-15",
    dates: ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"],
    people: [
      { id: "p_eitan", name: "איתן דוגמה", roleGroup: "supervisor" },
      { id: "p_daniel", name: "דניאל כהן", roleGroup: "technician" },
    ],
    cells: {
      p_eitan: {
        ...Object.fromEntries(
          ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"].map(
            (date) => [date, []],
          ),
        ),
        "2026-08-11": [
          {
            key: "eitan-1",
            title: 'אחמ"ש יום',
            category: "shift" as const,
            period: "day" as const,
            dutyFamily: null,
            absenceKind: null,
            tentative: false,
            shadow: false,
          },
        ],
      },
      p_daniel: {
        ...Object.fromEntries(
          ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"].map(
            (date) => [date, []],
          ),
        ),
        "2026-08-11": [
          {
            key: "daniel-1",
            title: "טכנאי יום",
            category: "shift" as const,
            period: "day" as const,
            dutyFamily: null,
            absenceKind: null,
            tentative: false,
            shadow: false,
          },
        ],
      },
    },
    ...overrides,
  };
}

function managerSelfModel(overrides: Partial<ScheduleReadModel> = {}): ScheduleReadModel {
  return scheduleModel({
    manager: { id: "p_martin", name: "מרטין גוסין" },
    roster: roster(),
    perspective: "self",
    personal: personalModel(),
    ...overrides,
  });
}

function okResult(model: ScheduleReadModel) {
  return { status: "ok" as const, model };
}

function searchParams(params: { month?: string; person?: string; view?: string; week?: string } = {}) {
  return Promise.resolve(params);
}

function staffingEntry(overrides: Partial<ManagerShiftOverviewEntry> = {}): ManagerShiftOverviewEntry {
  return {
    date: "2026-08-13",
    period: "day",
    technicians: [{ personId: "p_daniel", personName: "דניאל כהן", certainty: "confirmed", startTimeOverride: null, endTimeOverride: null }],
    supervisors: [{ personId: "p_eitan", personName: "איתן דוגמה", certainty: "confirmed", startTimeOverride: null, endTimeOverride: null }],
    shadowTechnicians: [],
    shadowSupervisors: [],
    coverageStatus: "full",
    missingIntervals: [],
    roleCoverage: {
      technician: { status: "full", missingIntervals: [] },
      supervisor: { status: "full", missingIntervals: [] },
    },
    ...overrides,
  };
}

describe("SchedulePage — normal user never sees manager UI (PR #24 §3)", () => {
  it("renders no perspective selector for a normal user", async () => {
    getRequestSchedule.mockResolvedValue(okResult(scheduleModel({ personal: personalModel({ person: { ...personalModel().person, isManager: false } }) })));
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(screen.queryByText("מציג לוח עבור")).toBeNull();
  });

  it("a normal user requesting ?person=all still only receives model.manager === null (server-side floor, tested at the read-model layer; this asserts the page trusts and never overrides it)", async () => {
    getRequestSchedule.mockResolvedValue(okResult(scheduleModel()));
    const element = await SchedulePage({ searchParams: searchParams({ person: "all" }) });
    render(element);
    expect(screen.queryByText("מציג לוח עבור")).toBeNull();
    expect(screen.queryByText("כולם")).toBeNull();
  });
});

describe("SchedulePage — manager selector (PR #24 §4/§5)", () => {
  it("renders the selector for a manager, defaulting to 'אני — <name>'", async () => {
    getRequestSchedule.mockResolvedValue(okResult(managerSelfModel()));
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(screen.getByText("מציג לוח עבור")).toBeInTheDocument();
    expect(screen.getByText("אני — מרטין גוסין")).toBeInTheDocument();
  });

  it("shows 'כולם' as the current selection in everyone perspective", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "all",
          personal: null,
          everyone: { staffing: [], duties: [], absences: [] },
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ person: "all" }) });
    render(element);
    expect(screen.getByText("כולם")).toBeInTheDocument();
  });

  it("shows the selected colleague's name as the current selection in person perspective", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "person",
          selectedPersonId: "p_daniel",
          selectedPersonName: "דניאל כהן",
          personal: personalModel({ person: { id: "p_daniel", name: "דניאל כהן", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null } }),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ person: "p_daniel" }) });
    render(element);
    // "דניאל כהן" appears both as the selector's current value and as the trigger's accessible label.
    expect(screen.getAllByText("דניאל כהן").length).toBeGreaterThan(0);
  });
});

describe("SchedulePage — everyone mode renders team staffing (PR #24 §14/§15)", () => {
  it("renders the everyone calendar with day/night staffing", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "all",
          personal: null,
          everyone: { staffing: [staffingEntry()], duties: [], absences: [] },
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08", person: "all" }) });
    render(element);
    const cell = screen.getByRole("button", { name: /13 באוגוסט/ });
    expect(cell.textContent).toContain("דניאל כהן");
  });
});

describe("SchedulePage — semantic event colors: single-person mode vs. 'כולם' (calendar color feature)", () => {
  function dayShiftEvent(): PersonalScheduleReadModel["calendarEvents"][number] {
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
    };
  }

  it("'self' perspective (a normal user's own calendar) shows the semantic color for a day shift", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(scheduleModel({ personal: personalModel({ calendarEvents: [dayShiftEvent()] }) })),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08" }) });
    render(element);
    const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
    expect(cell.innerHTML).toMatch(/bg-event-shift-day-soft/);
  });

  it("'person' perspective (a manager viewing another person) shows the EXACT same semantic color as 'self' -- no special-casing of 'me'", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "person",
          selectedPersonId: "p_daniel",
          selectedPersonName: "דניאל כהן",
          personal: personalModel({
            person: { id: "p_daniel", name: "דניאל כהן", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null },
            calendarEvents: [dayShiftEvent()],
          }),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08", person: "p_daniel" }) });
    render(element);
    const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
    expect(cell.innerHTML).toMatch(/bg-event-shift-day-soft/);
  });

  it("'all' perspective ('כולם') never shows any semantic per-event-type color, even with the same underlying staffing", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "all",
          personal: null,
          everyone: { staffing: [staffingEntry()], duties: [], absences: [] },
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08", person: "all" }) });
    const { container } = render(element);
    expect(container.innerHTML).not.toMatch(/bg-event-/);
  });
});

describe("SchedulePage — selected-person empty month (PR #24 §12)", () => {
  it("shows the calm contextual note and still renders the calendar", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "person",
          selectedPersonId: "p_daniel",
          selectedPersonName: "דניאל כהן",
          personal: personalModel({
            person: { id: "p_daniel", name: "דניאל כהן", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null },
            calendarEvents: [],
          }),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ person: "p_daniel" }) });
    render(element);
    expect(screen.getByText("אין לדניאל כהן משמרות בתקופה הזו")).toBeInTheDocument();
    // The calendar grid itself is still present (dates render as buttons).
    expect(screen.getAllByRole("button").length).toBeGreaterThan(20);
  });

  it("does not show the empty note in self mode even with zero shifts", async () => {
    getRequestSchedule.mockResolvedValue(okResult(managerSelfModel({ personal: personalModel({ calendarEvents: [] }) })));
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(screen.queryByText(/משמרות בתקופה הזו/)).toBeNull();
  });
});

describe("SchedulePage — MonthNav preserves the selected perspective (PR #24 §29)", () => {
  it("preserves person=all across month navigation", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "all",
          personal: null,
          everyone: { staffing: [], duties: [], absences: [] },
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08", person: "all" }) });
    render(element);
    const nextLink = screen.getByRole("link", { name: "חודש הבא" });
    expect(nextLink.getAttribute("href")).toBe("/schedule?month=2026-09&person=all");
    const todayLink = screen.getByRole("link", { name: "היום" });
    expect(todayLink.getAttribute("href")).toBe("/schedule?person=all");
  });

  it("preserves a selected person across month navigation", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "person",
          selectedPersonId: "p_daniel",
          selectedPersonName: "דניאל כהן",
          personal: personalModel({ person: { id: "p_daniel", name: "דניאל כהן", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null } }),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08", person: "p_daniel" }) });
    render(element);
    const prevLink = screen.getByRole("link", { name: "חודש קודם" });
    expect(prevLink.getAttribute("href")).toBe("/schedule?month=2026-07&person=p_daniel");
  });

  it("self mode never writes a person param onto MonthNav hrefs", async () => {
    getRequestSchedule.mockResolvedValue(okResult(managerSelfModel()));
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08" }) });
    render(element);
    const nextLink = screen.getByRole("link", { name: "חודש הבא" });
    expect(nextLink.getAttribute("href")).toBe("/schedule?month=2026-09");
  });
});

describe("SchedulePage — privacy regression (PR #24 §37)", () => {
  it("never renders a colleague email or raw workbook keys, even in everyone mode", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "all",
          personal: null,
          everyone: {
            staffing: [staffingEntry()],
            duties: [{ personId: "p_daniel", personName: "דניאל כהן", date: "2026-08-13", dutyFamily: "guard", slot: 1, certainty: "confirmed" } satisfies ManagerDutyEntry],
            absences: [{ personId: "p_eitan", personName: "איתן דוגמה", date: "2026-08-13", absenceKind: "vacation", certainty: "confirmed" } satisfies ManagerAbsenceEntry],
          },
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08", person: "all" }) });
    const { container } = render(element);
    expect(container.textContent).not.toContain("@");
    expect(container.textContent).not.toContain("sourceSheet");
    expect(container.textContent).not.toContain("sourceCell");
  });
});

describe('SchedulePage — "מי איתי במשמרת" works for whoever is selected in "מציג לוח עבור"', () => {
  function shiftWithCompanions(
    overrides: Partial<PersonalScheduleReadModel["calendarEvents"][number]> = {},
  ): PersonalScheduleReadModel["calendarEvents"][number] {
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
      shiftCompanions: [{ personId: "p_eitan", personName: "איתן דוגמה", shiftLabel: 'אחמ"ש יום' }],
      ...overrides,
    };
  }

  it("10. shows the selected person's own companions when a manager views someone other than אני", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "person",
          selectedPersonId: "p_daniel",
          selectedPersonName: "דניאל כהן",
          personal: personalModel({
            person: { id: "p_daniel", name: "דניאל כהן", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null },
            calendarEvents: [shiftWithCompanions()],
          }),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08", person: "p_daniel" }) });
    render(element);

    const panel = within(screen.getByRole("region", { name: "פרטי היום הנבחר" }));
    expect(panel.getByText("מי איתי במשמרת")).toBeInTheDocument();
    expect(panel.getByText('איתן דוגמה — אחמ"ש יום')).toBeInTheDocument();
  });

  it("shows the same section for the manager's own 'אני' view -- identical composition, never a special case", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(managerSelfModel({ personal: personalModel({ calendarEvents: [shiftWithCompanions()] }) })),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08" }) });
    render(element);

    const panel = within(screen.getByRole("region", { name: "פרטי היום הנבחר" }));
    expect(panel.getByText("מי איתי במשמרת")).toBeInTheDocument();
    expect(panel.getByText('איתן דוגמה — אחמ"ש יום')).toBeInTheDocument();
  });

  it("never puts companion names into a calendar cell -- the grid stays exactly as compact as before", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "person",
          selectedPersonId: "p_daniel",
          selectedPersonName: "דניאל כהן",
          personal: personalModel({
            person: { id: "p_daniel", name: "דניאל כהן", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null },
            calendarEvents: [shiftWithCompanions()],
          }),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08", person: "p_daniel" }) });
    render(element);

    const cell = screen.getByRole("button", { name: /12 באוגוסט/ });
    expect(cell.textContent).not.toContain("איתן דוגמה");
    expect(cell.textContent).not.toContain("מי איתי במשמרת");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("SchedulePage — team-week matrix entry point (13/14 month default, view switch)", () => {
  it("13. renders the month grid (not the matrix table) by default", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "all",
          personal: null,
          everyone: { staffing: [staffingEntry()], duties: [], absences: [] },
          teamWeek: teamWeekView(),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08", person: "all" }) });
    render(element);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: /13 באוגוסט/ })).toBeInTheDocument();
  });

  it("shows the חודש | שבוע צוות switch only for the 'all' perspective, and shows the matrix once ?view=team-week is requested", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "all",
          personal: null,
          everyone: { staffing: [], duties: [], absences: [] },
          teamWeek: teamWeekView(),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ person: "all", view: "team-week" }) });
    render(element);
    expect(screen.getByText("חודש")).toBeInTheDocument();
    expect(screen.getByText("שבוע צוות")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("איתן דוגמה")).toBeInTheDocument();
    expect(screen.getByText("דניאל כהן")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /13 באוגוסט/ })).toBeNull(); // the month grid never also renders
  });

  it("does not show the view switch for 'self'/'person' perspectives", async () => {
    getRequestSchedule.mockResolvedValue(okResult(managerSelfModel()));
    const element = await SchedulePage({ searchParams: searchParams() });
    render(element);
    expect(screen.queryByText("שבוע צוות")).toBeNull();
  });

  it("5. groups columns under אחמ\"שים / טכנאים headers", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "all",
          personal: null,
          everyone: { staffing: [], duties: [], absences: [] },
          teamWeek: teamWeekView(),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ person: "all", view: "team-week" }) });
    render(element);
    expect(screen.getByRole("columnheader", { name: 'אחמ"שים' })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "טכנאים" })).toBeInTheDocument();
  });
});

describe("SchedulePage — team-week URL behavior (nav preserves person=all&view=team-week)", () => {
  it("14/16. an unrecognized ?view= value safely falls back to the month calendar, never crashes", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "all",
          personal: null,
          everyone: { staffing: [staffingEntry()], duties: [], absences: [] },
          teamWeek: teamWeekView(),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ month: "2026-08", person: "all", view: "not-a-real-view" }) });
    render(element);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: /13 באוגוסט/ })).toBeInTheDocument();
  });

  it("week navigation links preserve person=all and view=team-week, only changing week", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "all",
          personal: null,
          everyone: { staffing: [], duties: [], absences: [] },
          teamWeek: teamWeekView(),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ person: "all", view: "team-week", week: "2026-08-09" }) });
    render(element);

    const nextLink = screen.getByRole("link", { name: "שבוע הבא" });
    expect(nextLink.getAttribute("href")).toBe("/schedule?person=all&view=team-week&week=2026-08-16");
    const prevLink = screen.getByRole("link", { name: "שבוע קודם" });
    expect(prevLink.getAttribute("href")).toBe("/schedule?person=all&view=team-week&week=2026-08-02");
    const todayLink = screen.getByRole("link", { name: "היום" });
    expect(todayLink.getAttribute("href")).toBe("/schedule?person=all&view=team-week");
  });

  it("switching back to 'חודש' resets to a plain /schedule?person=all, dropping view/week entirely", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        managerSelfModel({
          perspective: "all",
          personal: null,
          everyone: { staffing: [], duties: [], absences: [] },
          teamWeek: teamWeekView(),
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ person: "all", view: "team-week", week: "2026-08-09" }) });
    render(element);
    const monthTab = screen.getByText("חודש").closest("a");
    expect(monthTab?.getAttribute("href")).toBe("/schedule?person=all");
  });
});

describe("SchedulePage — team-week authorization (15, byte-for-byte self-only for a non-manager)", () => {
  it("15. a non-manager's ?person=all&view=team-week never renders the switch or the matrix, and the model the page trusts carries zero team data", async () => {
    getRequestSchedule.mockResolvedValue(
      okResult(
        scheduleModel({
          manager: null,
          roster: [],
          perspective: "self",
          personal: personalModel({ person: { ...personalModel().person, isManager: false } }),
          everyone: null,
          teamWeek: null,
        }),
      ),
    );
    const element = await SchedulePage({ searchParams: searchParams({ person: "all", view: "team-week", week: "2026-08-09" }) });
    render(element);
    expect(screen.queryByText("שבוע צוות")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("מציג לוח עבור")).toBeNull();
  });
});
