import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PersonalScheduleReadModel } from "@/lib/readModels/types";

/**
 * A focused companion to `page.test.tsx` (which already exhaustively
 * covers WHICH component each `DashboardPage` branch renders) -- this file
 * only checks that `withHomeContentReady`'s `ScrollHomeToTopOnContentReady`
 * marker (see that component's own docstring) actually ends up in the
 * resolved output, for a representative sample of branches. All six of
 * `page.tsx`'s return points go through the SAME `withHomeContentReady`
 * helper, so this deliberately doesn't re-assert the same wiring six times
 * -- the real behavioral coverage (loading fallback -> resolved content,
 * once-per-page-load gating, resume handling) lives in
 * `ScrollHomeToTopOnContentReady.test.tsx`.
 *
 * `vi.resetModules()` + a fresh dynamic `import("./page")` per test is
 * required here (unlike `page.test.tsx`'s single static import): the
 * marker's "once per page load" flag is module-scoped, so reusing the same
 * module instance `page.test.tsx`'s many tests already render through
 * would only ever observe the very first render actually calling
 * `scrollTo` -- registered `vi.mock` factories survive `resetModules()`
 * (only cached module INSTANCES are cleared), so the fresh import still
 * resolves against the same mocked read models below.
 */
const getRequestPersonalSchedule = vi.fn();
vi.mock("@/lib/readModels/getRequestPersonalSchedule", () => ({ getRequestPersonalSchedule }));

const getRequestDashboardVisitRecap = vi.fn();
vi.mock("@/lib/readModels/getRequestRecentDashboardChanges", () => ({ getRequestDashboardVisitRecap }));

vi.mock("@/lib/readModels/getRequestPermanentManagerHome", () => ({ getRequestPermanentManagerHome: vi.fn() }));
vi.mock("@/lib/readModels/managerEmergencyOverview", () => ({ loadManagerEmergencyOverview: vi.fn() }));
vi.mock("@/lib/readModels/getRequestReportOneTomorrow", () => ({ getRequestReportOneTomorrow: vi.fn() }));
vi.mock("@/lib/dashboardVisit/actions", () => ({ recordDashboardVisitAction: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/calendar/feedStore", () => ({
  getCalendarFeedForCurrentUser: vi.fn().mockResolvedValue({ enabled: false, token: null }),
}));
vi.mock("@/lib/notifications/actions", () => ({
  enablePushNotificationsAction: vi.fn(),
  disablePushNotificationsAction: vi.fn(),
  getPushSubscriptionStatusAction: vi.fn(),
  sendTestNotificationAction: vi.fn(),
}));
vi.mock("@/lib/push/publicConfig", () => ({ getVapidPublicKey: () => "test-public-key" }));
vi.mock("@/lib/reportOne/actions", () => ({ setReserveInclusionPreferenceAction: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function loadFreshDashboardPage() {
  const { default: DashboardPage } = await import("./page");
  return DashboardPage;
}

describe("DashboardPage — ScrollHomeToTopOnContentReady is wired into the resolved output", () => {
  it("is present when the normal personal Dashboard resolves", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    getRequestPersonalSchedule.mockResolvedValue({ status: "ok", model: model() });
    getRequestDashboardVisitRecap.mockResolvedValue({ visitStartedAt: "2026-08-25T10:00:00.000Z", items: [], totalCount: 0 });
    const DashboardPage = await loadFreshDashboardPage();

    const element = await DashboardPage();
    render(element);

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("is present when the personal schedule fails (ConfigurationErrorState)", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    getRequestPersonalSchedule.mockResolvedValue({ status: "configuration_error", message: "boom" });
    const DashboardPage = await loadFreshDashboardPage();

    const element = await DashboardPage();
    render(element);

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("is present when Emergency Mode is unavailable (EmergencyUnavailableState)", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    getRequestPersonalSchedule.mockResolvedValue({
      status: "emergency_unavailable",
      message: "boom",
      person: { id: "p_1", name: "דני בדיקה", isManager: false },
      userId: "u1",
      avatarUrl: null,
      accountCreatedAt: "2020-01-01T00:00:00.000Z",
    });
    const DashboardPage = await loadFreshDashboardPage();

    const element = await DashboardPage();
    render(element);

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("only fires once per resolved render, even though the marker appears in a fresh module instance each time", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    getRequestPersonalSchedule.mockResolvedValue({ status: "configuration_error", message: "boom" });
    const DashboardPage = await loadFreshDashboardPage();

    const element = await DashboardPage();
    render(element);

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });
});
