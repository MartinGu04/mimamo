import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type {
  PersonalAssignmentView,
  PersonalDutyBlock,
  PersonalEventView,
  PersonalScheduleReadModel,
  PersonalShiftContext,
} from "@/lib/readModels/types";
import { Dashboard } from "./Dashboard";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/DataFreshnessStatus", () => ({
  DataFreshnessStatus: ({ fetchedAt }: { fetchedAt: string }) => <div data-testid="freshness">{fetchedAt}</div>,
}));
const recordDashboardVisitAction = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
vi.mock("@/lib/dashboardVisit/actions", () => ({ recordDashboardVisitAction }));
vi.mock("@/lib/reportOne/actions", () => ({ setReserveInclusionPreferenceAction: vi.fn().mockResolvedValue({ ok: true }) }));
// SetupSection (nav redesign pass) mounts usePushSubscription, which imports
// these "use server" actions -- mocked defensively so a real (unmocked)
// server-action module is never evaluated in this jsdom test environment,
// same as NotificationBell.test.tsx already does for the same hook.
vi.mock("@/lib/notifications/actions", () => ({
  enablePushNotificationsAction: vi.fn(),
  disablePushNotificationsAction: vi.fn(),
  getPushSubscriptionStatusAction: vi.fn(),
  sendTestNotificationAction: vi.fn(),
}));
vi.mock("@/lib/push/publicConfig", () => ({ getVapidPublicKey: () => "test-public-key" }));

beforeEach(() => {
  recordDashboardVisitAction.mockClear();
});

afterEach(() => {
  cleanup();
});

function baseEvent(overrides: Partial<PersonalEventView> = {}): PersonalEventView {
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

function assignment(overrides: Partial<PersonalAssignmentView> = {}): PersonalAssignmentView {
  return { ...baseEvent(), temporalState: "current", ...overrides };
}

function dutyAssignment(overrides: Partial<PersonalAssignmentView> = {}): PersonalAssignmentView {
  return assignment({
    category: "duty",
    role: null,
    period: "unspecified",
    dutyFamily: "guard",
    slot: 1,
    title: "שומר 1",
    rawValue: "שומר 1",
    ...overrides,
  });
}

function shiftContext(overrides: Partial<PersonalShiftContext> = {}): PersonalShiftContext {
  return {
    date: "2026-08-12",
    period: "day",
    role: "technician",
    coverageStatus: "full",
    missingIntervals: [],
    primaryCounterparts: [
      {
        personId: "p_2",
        personName: "נועה דוגמה",
        role: "supervisor",
        certainty: "confirmed",
        shadow: false,
        period: "day",
        startTimeOverride: null,
        endTimeOverride: null,
      },
    ],
    shadowCounterparts: [],
    ...overrides,
  };
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

describe("Dashboard composition — counterpart binding (issue 1)", () => {
  it("a duty-only next group must not receive a later shift's counterpart context", () => {
    const duty = dutyAssignment({ date: "2026-08-13", temporalState: "upcoming" });
    const laterShiftContext = shiftContext({ date: "2026-08-15", period: "day", role: "technician" });

    render(
      <Dashboard
        model={model({
          nextAssignmentGroup: { date: "2026-08-13", events: [duty] },
          nextShiftContexts: [laterShiftContext],
        })}
      />,
    );

    expect(screen.getByText("הבא שלך")).toBeInTheDocument();
    expect(screen.queryByText("מי איתי?")).toBeNull();
    expect(screen.queryByText("נועה דוגמה")).toBeNull();
  });
});

describe("Dashboard composition — Upcoming exclusion (issue 2)", () => {
  it("the exact current-hero shift is not repeated in Upcoming, but a later same-date shift is", () => {
    const dayShift = assignment({ date: "2026-08-12", period: "day", title: "טכנאי יום" });
    const nightShift = baseEvent({ date: "2026-08-12", period: "night", title: "טכנאי לילה" });

    render(
      <Dashboard
        model={model({
          currentAssignments: [dayShift],
          upcomingEvents: [dayShift, nightShift],
        })}
      />,
    );

    // The day shift appears once (in the hero) -- not duplicated in Upcoming.
    expect(screen.getAllByText("טכנאי יום")).toHaveLength(1);
    // The later, unrelated night shift still shows up in Upcoming.
    expect(screen.getByText("טכנאי לילה")).toBeInTheDocument();
  });

  it("a current overnight shift dated yesterday is not misclassified/duplicated as upcoming", () => {
    const overnight = assignment({ date: "2026-08-11", period: "night", title: "טכנאי לילה" });

    render(
      <Dashboard
        model={model({
          localNow: { date: "2026-08-12", minuteOfDay: 120 },
          currentAssignments: [overnight],
          upcomingEvents: [overnight],
        })}
      />,
    );

    expect(screen.getAllByText("טכנאי לילה")).toHaveLength(1);
    expect(screen.getByText("אין פריטים נוספים באופק הקרוב.")).toBeInTheDocument();
  });

  it("a current duty block is not shown again as an upcoming duplicate", () => {
    const currentDuty = dutyAssignment({ date: "2026-08-12" });
    const block: PersonalDutyBlock = {
      dutyFamily: "guard",
      slot: 1,
      startDate: "2026-08-11",
      endDate: "2026-08-13",
      dates: ["2026-08-11", "2026-08-12", "2026-08-13"],
      certainty: "confirmed",
      dayCount: 3,
      weekendCompleteness: "not_applicable",
    };

    render(
      <Dashboard
        model={model({
          currentAssignments: [currentDuty],
          dutyBlocks: [block],
        })}
      />,
    );

    expect(screen.getByText("אין פריטים נוספים באופק הקרוב.")).toBeInTheDocument();
  });
});

describe("Dashboard composition — vacation state wiring", () => {
  it("a blocking absence today with nothing current becomes the vacation hero", () => {
    const vacation = baseEvent({
      category: "absence",
      role: null,
      absenceKind: "vacation",
      title: "חופש",
      rawValue: "חופש",
    });

    render(<Dashboard model={model({ todayEvents: [vacation] })} />);

    expect(screen.getByText("היום שלך פנוי")).toBeInTheDocument();
  });

  it("a current assignment still leads even when today also has a blocking absence (conflict case)", () => {
    const vacation = baseEvent({
      category: "absence",
      role: null,
      absenceKind: "vacation",
      title: "חופש",
      rawValue: "חופש",
    });
    const currentShift = assignment({ title: "טכנאי יום" });

    render(
      <Dashboard model={model({ todayEvents: [vacation], currentAssignments: [currentShift] })} />,
    );

    expect(screen.getByText("פעיל עכשיו")).toBeInTheDocument();
    expect(screen.queryByText("היום שלך פנוי")).toBeNull();
  });

  it("a non-blocking absence kind ('after') never triggers the vacation hero", () => {
    const partial = baseEvent({ category: "absence", role: null, absenceKind: "after", title: "אפטר" });

    render(<Dashboard model={model({ todayEvents: [partial] })} />);

    expect(screen.queryByText("היום שלך פנוי")).toBeNull();
    expect(screen.getByText("הכול שקט כרגע")).toBeInTheDocument();
  });
});

describe("Dashboard — data freshness uses PersonalScheduleReadModel.fetchedAt (PR #17 §10/§19)", () => {
  it("the freshness status receives this model's own fetchedAt", () => {
    render(<Dashboard model={model({ fetchedAt: "2026-08-13T10:45:00.000Z" })} />);
    expect(screen.getByTestId("freshness")).toHaveTextContent("2026-08-13T10:45:00.000Z");
  });
});

describe("Dashboard — 'מה השתנה מאז הפעם הקודמת' visit recap wiring", () => {
  it("regression: no visitRecap prop at all renders no trace of the recap (existing callers/tests are unaffected)", () => {
    render(<Dashboard model={model()} />);
    expect(screen.queryByText("מה השתנה מאז הפעם הקודמת")).toBeNull();
  });

  it("an explicit null visitRecap (ineligible personnel) renders no trace of the recap, and never mounts the visit marker", async () => {
    render(<Dashboard model={model()} visitRecap={null} />);
    expect(screen.queryByText("מה השתנה מאז הפעם הקודמת")).toBeNull();
    await Promise.resolve();
    expect(recordDashboardVisitAction).not.toHaveBeenCalled();
  });

  it("an eligible visitor with zero items renders no trace of the recap panel, but still mounts the visit marker", async () => {
    render(<Dashboard model={model()} visitRecap={{ visitStartedAt: "2026-08-25T10:00:00.000Z", items: [], totalCount: 0 }} />);
    expect(screen.queryByText("מה השתנה מאז הפעם הקודמת")).toBeNull();
    await Promise.resolve();
    expect(recordDashboardVisitAction).toHaveBeenCalledWith("2026-08-25T10:00:00.000Z");
  });

  it("a populated visitRecap renders the recap heading, without hiding/replacing the Hero", () => {
    const currentShift = assignment({ title: "טכנאי יום" });
    render(
      <Dashboard
        model={model({ currentAssignments: [currentShift] })}
        visitRecap={{
          visitStartedAt: "2026-08-25T10:00:00.000Z",
          totalCount: 1,
          items: [
            {
              key: "change:job_1",
              category: "shift",
              title: "⚠️ שינוי בשיבוץ",
              body: "השיבוץ שלך ליום חמישי השתנה: יום → לילה",
              happenedAt: "2026-08-12T07:42:00.000Z",
              href: "/schedule?date=2026-08-19",
              date: "2026-08-19",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("מה השתנה מאז הפעם הקודמת")).toBeInTheDocument();
    expect(screen.getByText("פעיל עכשיו")).toBeInTheDocument(); // Hero's own current-assignment story, still present
    expect(screen.getByText("השיבוץ שלך ליום חמישי השתנה: יום → לילה")).toBeInTheDocument();
  });
});

describe("Dashboard — 'השבוע הקרוב' weekly overview", () => {
  it("renders alongside every other existing section, none of them removed", () => {
    const currentShift = assignment({ title: "טכנאי יום" });
    render(
      <Dashboard
        model={model({
          currentAssignments: [currentShift],
          todayEvents: [currentShift],
          calendarEvents: [{ ...currentShift, shiftCompanions: [] }],
        })}
        visitRecap={{
          visitStartedAt: "2026-08-25T10:00:00.000Z",
          totalCount: 1,
          items: [
            {
              key: "change:job_1",
              category: "shift",
              title: "⚠️ שינוי בשיבוץ",
              body: "השיבוץ שלך השתנה",
              happenedAt: "2026-08-12T07:42:00.000Z",
              href: "/schedule?date=2026-08-19",
              date: "2026-08-19",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("פעיל עכשיו")).toBeInTheDocument(); // Hero
    expect(screen.queryByText("היום שלי")).toBeNull(); // TodayTimeline removed from Dashboard (UX cleanup pass)
    expect(screen.getByText("מה השתנה מאז הפעם הקודמת")).toBeInTheDocument(); // RecentChangesPanel
    expect(screen.getByText("הסידור שלך נראה תקין")).toBeInTheDocument(); // IssuesPanel (no issues)
    expect(screen.getByText("הקרובים שלי")).toBeInTheDocument(); // UpcomingSection
    expect(screen.getByText("השבוע הקרוב")).toBeInTheDocument(); // new weekly overview
    // The current shift appears both in the Hero and in the complete week
    // overview -- deliberate contextual repetition, not a bug.
    expect(screen.getAllByText("טכנאי יום").length).toBeGreaterThanOrEqual(2);
  });

  it("builds the week strictly from calendarEvents, not upcomingEvents -- an earlier-this-week event still shows", () => {
    const mondayShift = baseEvent({ date: "2026-08-17", title: "משמרת שני" }); // earlier in the same operational week as 2026-08-19
    render(
      <Dashboard
        model={model({
          localNow: { date: "2026-08-19", minuteOfDay: 600 },
          calendarEvents: [{ ...mondayShift, shiftCompanions: [] }],
          upcomingEvents: [], // deliberately empty -- proves the week section didn't source from here
        })}
      />,
    );

    expect(screen.getByText("משמרת שני")).toBeInTheDocument();
  });

  it("renders the mobile snap-scroll rail structure, not a squeezed desktop 7-column grid, by default", () => {
    render(<Dashboard model={model()} />);
    const rail = screen.getByRole("list", { name: "סקירת השבוע, ראשון עד שבת" });
    expect(rail.className).toContain("overflow-x-auto");
    expect(rail.className).toContain("snap-x");
  });
});
