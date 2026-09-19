import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ManagerAdoptionPersonView, ManagerPersonSummary } from "@/lib/readModels/managerTypes";

const getRequestNotificationCenterContext = vi.fn();
vi.mock("@/lib/readModels/getRequestNotificationCenterContext", () => ({ getRequestNotificationCenterContext }));

const linkStatus = { pending: false };
vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();
  return { ...actual, useLinkStatus: () => linkStatus };
});

const composerProps = vi.fn();
vi.mock("@/components/manager/ManagerBroadcastComposer", () => ({
  ManagerBroadcastComposer: (props: Record<string, unknown>) => {
    composerProps(props);
    return <div data-testid="composer-now" />;
  },
}));

const scheduleSectionProps = vi.fn();
vi.mock("@/components/notifications/NotificationScheduleSection", () => ({
  NotificationScheduleSection: (props: Record<string, unknown>) => {
    scheduleSectionProps(props);
    return <div data-testid="schedule-section" />;
  },
}));

vi.mock("@/components/notifications/NotificationHistorySection", () => ({
  NotificationHistorySection: () => <div data-testid="history-section" />,
}));

const fixedSectionProps = vi.fn();
vi.mock("@/components/manager/ManagerFixedNotificationsSection", () => ({
  ManagerFixedNotificationsSection: (props: Record<string, unknown>) => {
    fixedSectionProps(props);
    return <div data-testid="fixed-section" />;
  },
}));

const { default: NotificationCenterPage } = await import("./page");

afterEach(() => {
  cleanup();
  linkStatus.pending = false;
});

beforeEach(() => {
  getRequestNotificationCenterContext.mockReset();
  composerProps.mockReset();
  scheduleSectionProps.mockReset();
  fixedSectionProps.mockReset();
});

const ROSTER: ManagerPersonSummary[] = [
  { id: "p_martin", name: "מרטין בדיקה", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null },
];
const ADOPTION: ManagerAdoptionPersonView[] = [
  { personId: "p_martin", personName: "מרטין בדיקה", avatarUrl: null, loginStatus: "logged_in", notificationStatus: "ready", dataIssue: null, needsNudge: false },
];

function okResult(overrides: Partial<{ roster: ManagerPersonSummary[]; adoptionPeople: ManagerAdoptionPersonView[] }> = {}) {
  return { status: "ok" as const, context: { roster: ROSTER, adoptionPeople: ADOPTION, ...overrides } };
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  const element = await NotificationCenterPage({ searchParams: Promise.resolve(searchParams) });
  return render(element);
}

describe("NotificationCenterPage — authorization", () => {
  it("forbidden: shows the manager-only denial state, never notification data", async () => {
    getRequestNotificationCenterContext.mockResolvedValue({ status: "forbidden" });
    await renderPage();
    expect(screen.getByText("המסך הזה מיועד למנהלים בלבד")).toBeInTheDocument();
    expect(screen.queryByText("מרכז התראות")).toBeNull();
  });

  it.each(["unauthenticated", "missing_email", "unmapped", "ambiguous_identity"] as const)(
    "%s: also fails closed to the manager-only denial state",
    async (status) => {
      getRequestNotificationCenterContext.mockResolvedValue({ status });
      await renderPage();
      expect(screen.getByText("המסך הזה מיועד למנהלים בלבד")).toBeInTheDocument();
    },
  );
});

describe("NotificationCenterPage — section routing", () => {
  it("defaults to עכשיו with no search params", async () => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage();
    expect(screen.getByTestId("composer-now")).toBeInTheDocument();
    expect(screen.queryByTestId("schedule-section")).toBeNull();
    expect(screen.queryByTestId("history-section")).toBeNull();
    expect(screen.queryByTestId("fixed-section")).toBeNull();
    expect(composerProps.mock.calls.at(-1)?.[0].mode).toBe("now");
  });

  it("section=schedule renders only the schedule coordinator", async () => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage({ section: "schedule" });
    expect(screen.getByTestId("schedule-section")).toBeInTheDocument();
    expect(screen.queryByTestId("composer-now")).toBeNull();
    expect(screen.queryByTestId("history-section")).toBeNull();
    expect(screen.queryByTestId("fixed-section")).toBeNull();
  });

  it("section=history renders only the history section", async () => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage({ section: "history" });
    expect(screen.getByTestId("history-section")).toBeInTheDocument();
    expect(screen.queryByTestId("composer-now")).toBeNull();
    expect(screen.queryByTestId("schedule-section")).toBeNull();
    expect(screen.queryByTestId("fixed-section")).toBeNull();
  });

  it("section=fixed renders only the fixed-notifications section", async () => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage({ section: "fixed" });
    expect(screen.getByTestId("fixed-section")).toBeInTheDocument();
    expect(screen.queryByTestId("composer-now")).toBeNull();
    expect(screen.queryByTestId("schedule-section")).toBeNull();
    expect(screen.queryByTestId("history-section")).toBeNull();
  });

  it("an invalid section value falls back safely to עכשיו, never a crash", async () => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage({ section: "bogus" });
    expect(screen.getByTestId("composer-now")).toBeInTheDocument();
  });

  it("shows the four-tab nav and the standalone header on every section", async () => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage({ section: "history" });
    expect(screen.getByRole("heading", { name: "מרכז התראות", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "היסטוריה" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "עכשיו" })).toBeInTheDocument();
  });
});

describe("NotificationCenterPage — data threading", () => {
  it("passes roster/adoptionPeople through to the עכשיו composer", async () => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage();
    expect(composerProps.mock.calls.at(-1)?.[0]).toMatchObject({ roster: ROSTER, adoptionPeople: ADOPTION });
  });

  it("passes roster/adoptionPeople through to the תזמון coordinator", async () => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage({ section: "schedule" });
    expect(scheduleSectionProps.mock.calls.at(-1)?.[0]).toMatchObject({ roster: ROSTER, adoptionPeople: ADOPTION });
  });

  it("passes roster/adoptionPeople through to the קבועות section", async () => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage({ section: "fixed" });
    expect(fixedSectionProps.mock.calls.at(-1)?.[0]).toMatchObject({ roster: ROSTER, adoptionPeople: ADOPTION });
  });

  it("calls getRequestNotificationCenterContext with needsRosterAndAdoption=true for now/schedule/fixed", async () => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage({ section: "now" });
    expect(getRequestNotificationCenterContext).toHaveBeenCalledWith(true);
    await renderPage({ section: "schedule" });
    expect(getRequestNotificationCenterContext).toHaveBeenCalledWith(true);
    await renderPage({ section: "fixed" });
    expect(getRequestNotificationCenterContext).toHaveBeenCalledWith(true);
  });

  it("calls getRequestNotificationCenterContext with needsRosterAndAdoption=false for history", async () => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage({ section: "history" });
    expect(getRequestNotificationCenterContext).toHaveBeenCalledWith(false);
  });
});

describe("NotificationCenterPage — heading hierarchy (Phase 3 fix: h1 -> h3/h4 per section)", () => {
  it.each([
    ["now" as const, "עכשיו"],
    ["schedule" as const, "תזמון"],
    ["history" as const, "היסטוריה"],
    ["fixed" as const, "קבועות"],
  ])("section=%s exposes an h2 matching the active tab, under the page's own h1", async (section, label) => {
    getRequestNotificationCenterContext.mockResolvedValue(okResult());
    await renderPage(section === "now" ? {} : { section });

    expect(screen.getByRole("heading", { level: 1, name: "מרכז התראות" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: label })).toBeInTheDocument();
  });
});
