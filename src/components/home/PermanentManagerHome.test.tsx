import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PermanentManagerHomeReadModel } from "@/lib/readModels/permanentManagerHomeTypes";
import { PermanentManagerHome } from "./PermanentManagerHome";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/DataFreshnessStatus", () => ({
  DataFreshnessStatus: ({ fetchedAt }: { fetchedAt: string }) => <div data-testid="freshness">{fetchedAt}</div>,
}));
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

const FETCHED_AT = "2026-08-12T08:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FETCHED_AT));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function shift(overrides: Partial<PermanentManagerHomeReadModel["previousShift"]> = {}): PermanentManagerHomeReadModel["previousShift"] {
  return {
    date: "2026-08-12",
    period: "day",
    startLocalTime: "07:30",
    endLocalTime: "19:30",
    supervisors: [],
    technicians: [],
    genericSupervisors: [],
    genericTechnicians: [],
    coverageStatus: "full",
    missingIntervals: [],
    roleCoverage: {
      technician: { status: "full", missingIntervals: [] },
      supervisor: { status: "full", missingIntervals: [] },
    },
    ...overrides,
  };
}

function model(overrides: Partial<PermanentManagerHomeReadModel> = {}): PermanentManagerHomeReadModel {
  return {
    person: { id: "p_mgr", name: "מנהל בדיקה", isManager: true, isTechnician: false, isSupervisor: false, personnelType: "קבע" },
    fetchedAt: FETCHED_AT,
    localNow: { date: "2026-08-12", minuteOfDay: 480 },
    previousShift: shift({ date: "2026-08-11", period: "night", startLocalTime: "19:30", endLocalTime: "07:30" }),
    currentShift: {
      ...shift(),
      timing: {
        status: "resolved",
        startLocalTime: "07:30",
        endLocalTime: "19:30",
        durationMinutes: 720,
        elapsedMinutesAtLoad: 30,
        remainingMinutesAtLoad: 690,
        progressPercentAtLoad: 4,
        minutesUntilStartAtLoad: 0,
      },
    },
    nextShift: shift({ period: "night", startLocalTime: "19:30", endLocalTime: "07:30" }),
    todayDuties: [],
    todayAbsences: [],
    ...overrides,
  };
}

describe("PermanentManagerHome — composition", () => {
  it("renders the operational headline and all three shift cards", () => {
    render(<PermanentManagerHome model={model()} />);
    expect(screen.getByText("מה קורה עכשיו במחלקה?")).toBeInTheDocument();
    expect(screen.getByText("הקודמת")).toBeInTheDocument();
    expect(screen.getByText("המשמרת עכשיו")).toBeInTheDocument();
    expect(screen.getByText("הבא", { exact: false })).toBeInTheDocument();
  });

  it("26. renders a direct 'צוות השבוע' Team Week shortcut, linking to the canonical route, without disrupting the operational headline", () => {
    render(<PermanentManagerHome model={model()} />);
    expect(screen.getByText("מה קורה עכשיו במחלקה?")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /צוות השבוע/ });
    expect(link).toHaveAttribute("href", "/schedule?person=all&view=team-week");
  });

  it("renders exactly one live progress bar, for the current shift only", () => {
    render(<PermanentManagerHome model={model()} />);
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  });

  it("renders today's duties/absences section below the shift snapshot", () => {
    render(
      <PermanentManagerHome
        model={model({
          todayDuties: [{ personId: "p_1", personName: "שומר בדיקה", dutyFamily: "guard", slot: 1 }],
          todayAbsences: [{ personId: "p_2", personName: "נעדר בדיקה", absenceKind: "vacation" }],
        })}
      />,
    );
    expect(screen.getByText("תורנויות היום")).toBeInTheDocument();
    expect(screen.getByText("היעדרויות היום")).toBeInTheDocument();
    expect(screen.getByText("שומר בדיקה")).toBeInTheDocument();
    expect(screen.getByText("נעדר בדיקה")).toBeInTheDocument();
  });

  it("empty duties and absences render calm empty states, not missing sections", () => {
    render(<PermanentManagerHome model={model()} />);
    expect(screen.getByText("אין תורנויות היום.")).toBeInTheDocument();
    expect(screen.getByText("אין היעדרויות היום.")).toBeInTheDocument();
  });

  it("empty staffing on the current shift still renders full context, never a broken/blank card", () => {
    render(
      <PermanentManagerHome
        model={model({
          currentShift: {
            ...shift({
              coverageStatus: "missing",
              roleCoverage: {
                technician: { status: "missing", missingIntervals: [{ startMinute: 450, endMinute: 1170 }] },
                supervisor: { status: "missing", missingIntervals: [{ startMinute: 450, endMinute: 1170 }] },
              },
            }),
            timing: {
              status: "resolved",
              startLocalTime: "07:30",
              endLocalTime: "19:30",
              durationMinutes: 720,
              elapsedMinutesAtLoad: 30,
              remainingMinutesAtLoad: 690,
              progressPercentAtLoad: 4,
              minutesUntilStartAtLoad: 0,
            },
          },
        })}
      />,
    );
    expect(screen.getByText('חסר אחמ"ש')).toBeInTheDocument();
    expect(screen.getByText("חסר טכנאי")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });
});
