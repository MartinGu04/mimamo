import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type {
  ManagerAbsenceEntry,
  ManagerDutyEntry,
  ManagerIssue,
  ManagerOverviewReadModel,
  ManagerPotentialRequirementView,
  ManagerShiftOverviewEntry,
} from "@/lib/readModels/managerTypes";
import type { ShiftSnapshotTriad } from "@/lib/readModels/shiftSnapshot";
import type { PersonalScheduleReadModel } from "@/lib/readModels/types";

const getRequestManagerOverview = vi.fn();
vi.mock("@/lib/readModels/getRequestManagerOverview", () => ({ getRequestManagerOverview }));

const resolveOperationalMode = vi.fn();
const loadManagerEmergencyOverview = vi.fn();
vi.mock("@/lib/emergencyMode/state", () => ({ resolveOperationalMode }));
vi.mock("@/lib/readModels/managerEmergencyOverview", () => ({ loadManagerEmergencyOverview }));

const usePathname = vi.fn(() => "/manager");
const useSearchParams = vi.fn(() => new URLSearchParams());
const useRouter = vi.fn(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
  useSearchParams: () => useSearchParams(),
  useRouter: () => useRouter(),
}));

vi.mock("@/components/ui/DataFreshnessStatus", () => ({
  DataFreshnessStatus: ({ fetchedAt }: { fetchedAt: string }) => <div data-testid="freshness">{fetchedAt}</div>,
}));

// The system-level Emergency Mode control is a self-contained async
// Server Component (resolves its own OperationalMode via
// `resolveOperationalMode()`) -- entirely orthogonal to what this file
// tests (ManagerPage's regular read-model rendering), so it's stubbed
// out rather than exercised here. See `EmergencyModeControlClient.test.tsx`
// for its own behavior coverage.
vi.mock("@/components/manager/EmergencyModeControl", () => ({
  EmergencyModeControl: () => <div data-testid="emergency-mode-control-stub" />,
}));

const { default: ManagerPage } = await import("./page");

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  getRequestManagerOverview.mockReset();
  resolveOperationalMode.mockReset();
  resolveOperationalMode.mockResolvedValue({ kind: "regular" });
  loadManagerEmergencyOverview.mockReset();
});

function issue(overrides: Partial<ManagerIssue> = {}): ManagerIssue {
  return {
    personId: "p_martin",
    personName: "מרטין בדיקה",
    reason: "shift_coverage_missing",
    severity: "critical",
    date: "2026-08-13",
    missingIntervals: null,
    metadata: null,
    targetEvent: null,
    recommendation: null,
    ...overrides,
  };
}

function shiftGroup(overrides: Partial<ManagerShiftOverviewEntry> = {}): ManagerShiftOverviewEntry {
  return {
    date: "2026-08-13",
    period: "day",
    technicians: [],
    supervisors: [],
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

function duty(overrides: Partial<ManagerDutyEntry> = {}): ManagerDutyEntry {
  return {
    personId: "p_martin",
    personName: "מרטין בדיקה",
    date: "2026-08-13",
    dutyFamily: "guard",
    slot: 1,
    certainty: "confirmed",
    ...overrides,
  };
}

function absence(overrides: Partial<ManagerAbsenceEntry> = {}): ManagerAbsenceEntry {
  return {
    personId: "p_martin",
    personName: "מרטין בדיקה",
    date: "2026-08-13",
    absenceKind: "vacation",
    certainty: "confirmed",
    ...overrides,
  };
}

function potentialRow(overrides: Partial<ManagerPotentialRequirementView> = {}): ManagerPotentialRequirementView {
  return {
    date: "2026-08-13",
    dutyFamily: "evacuation_on_call",
    slot: null,
    columnLabel: "כונן פינויים",
    sourceAllocationLabel: "מרטין בדיקה",
    resolvedSourcePersonId: "p_martin",
    resolvedSourcePersonName: "מרטין בדיקה",
    status: "missing",
    actualAssignees: [],
    sourceConflict: "blocking_absence",
    ...overrides,
  };
}

function shiftSnapshotShift(overrides: Partial<ShiftSnapshotTriad["previousShift"]> = {}): ShiftSnapshotTriad["previousShift"] {
  return {
    date: "2026-08-13",
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

function shiftSnapshotTriad(overrides: Partial<ShiftSnapshotTriad> = {}): ShiftSnapshotTriad {
  return {
    previousShift: shiftSnapshotShift({ date: "2026-08-12", period: "night", startLocalTime: "19:30", endLocalTime: "07:30" }),
    currentShift: {
      ...shiftSnapshotShift(),
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
    nextShift: shiftSnapshotShift({ period: "night", startLocalTime: "19:30", endLocalTime: "07:30" }),
    ...overrides,
  };
}

function personalModel(overrides: Partial<PersonalScheduleReadModel> = {}): PersonalScheduleReadModel {
  return {
    person: { id: "p_martin", name: "מרטין בדיקה", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null },
    // Deliberately DIFFERENT from the manager model's own fetchedAt below --
    // proves the freshness status never accidentally borrows this nested
    // personal timestamp (PR #17 §10/§19).
    fetchedAt: "2026-08-13T07:00:00.000Z",
    localNow: { date: "2026-08-13", minuteOfDay: 600 },
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

function model(overrides: Partial<ManagerOverviewReadModel> = {}): ManagerOverviewReadModel {
  return {
    manager: { id: "p_manager", name: "דני מנהל", avatarUrl: null },
    fetchedAt: "2026-08-13T08:00:00.000Z",
    localNow: { date: "2026-08-13", minuteOfDay: 600 },
    range: { key: "7d", startDate: "2026-08-13", endDate: "2026-08-19", month: null },
    roster: [
      { id: "p_martin", name: "מרטין בדיקה", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null },
      { id: "p_eitan", name: "איתן דוגמה", isManager: false, isTechnician: false, isSupervisor: true, personnelType: null },
    ],
    selectedPersonId: null,
    issues: [],
    coverageOverview: [],
    duties: [],
    absences: [],
    potentialRequirements: [],
    selectedPerson: null,
    selectedPersonRangeAbsences: [],
    adoption: { status: "skipped" },
    rosterAvatarByPersonId: new Map(),
    managerShiftSnapshot: null,
    ...overrides,
  };
}

function okResult(m: ManagerOverviewReadModel) {
  return { status: "ok" as const, model: m };
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  const element = await ManagerPage({ searchParams: Promise.resolve(searchParams) });
  return render(element);
}

describe("ManagerPage — authorization states", () => {
  it("forbidden: shows the manager-only denial state, never manager data", async () => {
    getRequestManagerOverview.mockResolvedValue({ status: "forbidden" });
    await renderPage();
    expect(screen.getByText("המסך הזה מיועד למנהלים בלבד")).toBeInTheDocument();
    expect(screen.queryByText("מבט מנהל")).toBeNull();
  });

  it("configuration_error: shows the shared configuration-error state", async () => {
    getRequestManagerOverview.mockResolvedValue({ status: "configuration_error", message: "bad config" });
    await renderPage();
    expect(screen.getByText("לא ניתן לחשב כרגע את שעות המשמרות")).toBeInTheDocument();
  });
});

describe("ManagerPage — request scope", () => {
  it("passes parsed search params through to getRequestManagerOverview -- the raw category string itself is never sent, only the derived needsAdoptionReadiness/needsRosterAvatars flags (both false for a non-logins/non-personnel category like shifts)", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage({ person: "p_martin", range: "30d", category: "shifts" });
    expect(getRequestManagerOverview).toHaveBeenCalledWith("p_martin", "30d", null, false, false);
  });

  it("passes needsAdoptionReadiness=true only for category=logins, needsRosterAvatars stays false", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage({ category: "logins" });
    expect(getRequestManagerOverview).toHaveBeenCalledWith(null, "7d", null, true, false);
  });

  it("passes needsRosterAvatars=true only for category=personnel, needsAdoptionReadiness stays false", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage({ category: "personnel" });
    expect(getRequestManagerOverview).toHaveBeenCalledWith(null, "7d", null, false, true);
  });

  it("defaults: no search params -> everyone, 7d, no month, needsAdoptionReadiness=false, needsRosterAvatars=false (default category is overview)", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage();
    expect(getRequestManagerOverview).toHaveBeenCalledWith(null, "7d", null, false, false);
  });
});

describe("ManagerPage — category navigation", () => {
  it("renders all five category tabs, Overview active by default", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage();
    expect(screen.getByRole("link", { name: "סקירה" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "משמרות" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "כוח אדם" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "תורנויות והיעדרויות" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "התחברויות" })).toBeInTheDocument();
  });

  it("Overview (default): shows דורש טיפול, never the other categories' sections", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ issues: [issue()], coverageOverview: [shiftGroup()], duties: [duty()] })),
    );
    await renderPage();
    expect(screen.getByText("דורש טיפול")).toBeInTheDocument();
    expect(screen.queryByText("כיסוי משמרות")).toBeNull();
    expect(screen.queryByText("תורנויות")).toBeNull();
    expect(screen.queryByText("צוות")).toBeNull();
  });

  it("Shifts category: shows coverage + Potential, never the Overview/Duties/Personnel sections", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ issues: [issue()], coverageOverview: [shiftGroup()], duties: [duty()] })),
    );
    await renderPage({ category: "shifts" });
    expect(screen.getByText("כיסוי משמרות")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ללוח הצוות המלא ←" })).toHaveAttribute("href", "/schedule?person=all");
    expect(screen.queryByText("דורש טיפול")).toBeNull();
    expect(screen.queryByText("תורנויות")).toBeNull();
    expect(screen.queryByText("צוות")).toBeNull();
  });

  it("Personnel category: shows the roster, never the Overview/Shifts/Duties sections", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ issues: [issue()], coverageOverview: [shiftGroup()] })));
    await renderPage({ category: "personnel" });
    expect(screen.getByText("צוות")).toBeInTheDocument();
    expect(screen.queryByText("דורש טיפול")).toBeNull();
    expect(screen.queryByText("כיסוי משמרות")).toBeNull();
  });

  it("Duties & Absences category: shows duties/absences, never the Overview/Shifts/Personnel sections", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ issues: [issue()], coverageOverview: [shiftGroup()], duties: [duty()] })),
    );
    await renderPage({ category: "duties" });
    expect(screen.getByText("תורנויות")).toBeInTheDocument();
    expect(screen.queryByText("דורש טיפול")).toBeNull();
    expect(screen.queryByText("כיסוי משמרות")).toBeNull();
    expect(screen.queryByText("צוות")).toBeNull();
  });

  it("Logins category: shows the adoption summary + section, never the Overview/Shifts/Personnel/Duties sections, and never the notification-management UI (that now lives at /notifications)", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [issue()],
          coverageOverview: [shiftGroup()],
          duties: [duty()],
          adoption: {
            status: "available",
            view: {
              summary: {
                totalCount: 1,
                loggedInCount: 0,
                notLoggedInCount: 1,
                notificationReadyCount: 0,
                loggedInNotReadyCount: 0,
                dataIssueCount: 0,
              },
              people: [
                {
                  personId: "p_martin",
                  personName: "מרטין בדיקה",
                  avatarUrl: null,
                  loginStatus: "not_logged_in",
                  notificationStatus: null,
                  dataIssue: null,
                  needsNudge: true,
                },
              ],
            },
          },
        }),
      ),
    );
    const { container } = await renderPage({ category: "logins" });
    expect(screen.getByText("טרם נכנסו למערכת")).toBeInTheDocument();
    expect(screen.queryByText("דורש טיפול")).toBeNull();
    expect(screen.queryByText("כיסוי משמרות")).toBeNull();
    expect(screen.queryByText("תורנויות")).toBeNull();
    expect(screen.queryByText("צוות")).toBeNull();
    // The notification-management UI (immediate composer, scheduled list, recent
    // history, fixed/recurring rules) no longer renders inside Logins at all --
    // it moved to the standalone "מרכז התראות" (`/notifications`).
    expect(container.querySelector('[data-testid="manager-broadcast-composer"]')).toBeNull();
    expect(container.querySelector('[data-testid="manager-scheduled-broadcasts"]')).toBeNull();
    expect(container.querySelector('[data-testid="manager-recent-broadcasts"]')).toBeNull();
    expect(container.querySelector('[data-testid="manager-fixed-notifications"]')).toBeNull();
    expect(screen.queryByText("📣 שליחת התראה")).toBeNull();
    expect(screen.queryByText("📌 התראות קבועות")).toBeNull();
  });

  it("an unknown category value falls back to Overview, never a crash", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ issues: [issue()] })));
    await renderPage({ category: "bogus" });
    expect(screen.getByText("דורש טיפול")).toBeInTheDocument();
  });

  it("switching category preserves the current range", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ range: { key: "30d", startDate: "2026-08-01", endDate: "2026-08-30", month: null } })));
    await renderPage({ range: "30d" });
    expect(screen.getByRole("link", { name: "משמרות" })).toHaveAttribute("href", "/manager?range=30d&category=shifts");
  });

  it("no problems-only toggle exists anywhere -- Overview owns that job now", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage();
    expect(screen.queryByRole("link", { name: "הצג רק בעיות" })).toBeNull();
    expect(screen.queryByRole("link", { name: "מציג רק בעיות" })).toBeNull();
  });
});

describe("ManagerPage — Overview: אזור מנהל identity", () => {
  it("shows the אזור מנהל title (no מנהל chip) and no leftover subnav (PR #4 -- ManagerSubNav removed, Fairness moved to /fairness)", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage();
    expect(screen.getByRole("heading", { name: "אזור מנהל", level: 1 })).toBeInTheDocument();
    expect(screen.queryByText("מנהל")).toBeNull();
    expect(screen.queryByRole("link", { name: "טבלת צדק" })).toBeNull();
  });

  it("empty state: no problems shows the calm success panel", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage();
    expect(screen.getByText("אין כרגע דברים שדורשים טיפול בטווח שנבחר")).toBeInTheDocument();
  });

  it("shows several critical/review issues, grouped by severity", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [
            issue({ severity: "critical", personName: "מרטין בדיקה" }),
            issue({ severity: "review", personName: "איתן דוגמה", reason: "invalid_shift_time" }),
          ],
        }),
      ),
    );
    await renderPage();
    expect(screen.getAllByText("מרטין בדיקה", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/מרטין בדיקה|איתן דוגמה/).length).toBeGreaterThan(0);
  });

  it("never renders the personal 'שלך' issue phrasing for someone else's issue", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ issues: [issue()] })));
    const { container } = await renderPage();
    expect(container.textContent).not.toContain("שלך");
  });
});

describe("ManagerPage — Overview: managerShiftSnapshot section (shift-capable manager only)", () => {
  it("renders the shift snapshot section when the read model provides one (a shift-capable manager)", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ managerShiftSnapshot: shiftSnapshotTriad() })));
    await renderPage();
    expect(screen.getByText("תמונת מצב משמרות")).toBeInTheDocument();
    expect(screen.getByText("הקודמת")).toBeInTheDocument();
    expect(screen.getByText("עכשיו")).toBeInTheDocument();
    expect(screen.getByText("הבאה")).toBeInTheDocument();
  });

  it("does not render the shift snapshot section for a permanent/non-shift manager (managerShiftSnapshot: null)", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ managerShiftSnapshot: null })));
    await renderPage();
    expect(screen.queryByText("תמונת מצב משמרות")).toBeNull();
  });

  it("only renders on the Overview category, never on Shifts/Personnel/Duties/Logins", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ managerShiftSnapshot: shiftSnapshotTriad() })));
    await renderPage({ category: "shifts" });
    expect(screen.queryByText("תמונת מצב משמרות")).toBeNull();
  });

  it("still renders the rest of the Overview (attention section) alongside the shift snapshot", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ managerShiftSnapshot: shiftSnapshotTriad(), issues: [issue()] })),
    );
    await renderPage();
    expect(screen.getByText("תמונת מצב משמרות")).toBeInTheDocument();
    expect(screen.getByText("דורש טיפול")).toBeInTheDocument();
  });
});

describe("ManagerPage — Shifts category: coverage + Potential", () => {
  it("shows a covered Potential requirement (inside the collapsed disclosure) with its actual internal assignee", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          potentialRequirements: [
            potentialRow({
              status: "covered",
              sourceConflict: null,
              actualAssignees: [{ personId: "p_eitan", personName: "איתן דוגמה", certainty: "confirmed" }],
            }),
          ],
        }),
      ),
    );
    await renderPage({ category: "shifts" });
    expect(screen.getAllByText(/מכוסה/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/איתן דוגמה/).length).toBeGreaterThan(0);
  });

  it("shows the not_evaluable state for a genuinely unsupported requirement schema", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ potentialRequirements: [potentialRow({ status: "not_evaluable", sourceConflict: null })] })),
    );
    await renderPage({ category: "shifts" });
    expect(screen.getAllByText(/לא ניתן להצליב אוטומטית/).length).toBeGreaterThan(0);
  });

  it("shows a missing Potential requirement with the named-source conflict note", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ potentialRequirements: [potentialRow()] })));
    await renderPage({ category: "shifts" });
    expect(screen.getAllByText(/חסר/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/היעדרות חוסמת/).length).toBeGreaterThan(0);
  });

  it("never shows the Potential source label as the actual scheduled person", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          potentialRequirements: [
            potentialRow({
              status: "covered",
              sourceConflict: null,
              sourceAllocationLabel: "סייבר",
              actualAssignees: [{ personId: "p_eitan", personName: "איתן דוגמה", certainty: "confirmed" }],
            }),
          ],
        }),
      ),
    );
    await renderPage({ category: "shifts" });
    expect(screen.getAllByText("סייבר").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/איתן דוגמה/).length).toBeGreaterThan(0);
  });

  it("shows the exact Potential column label for a multiplicity family, never the bare family name", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          potentialRequirements: [
            potentialRow({
              dutyFamily: "oxid",
              slot: null,
              columnLabel: "אוקסיד 3",
              status: "missing",
              sourceConflict: null,
            }),
            potentialRow({
              dutyFamily: "full_kitchen",
              slot: null,
              columnLabel: "מטבח מלא 2",
              status: "covered",
              sourceConflict: null,
              actualAssignees: [{ personId: "p_martin", personName: "מרטין בדיקה", certainty: "confirmed" }],
            }),
          ],
        }),
      ),
    );
    await renderPage({ category: "shifts" });
    expect(screen.getAllByText("אוקסיד 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("מטבח מלא 2").length).toBeGreaterThan(0);
    // The bare family label alone (without its Potential-side number) is never shown for these rows.
    expect(screen.queryByText("אוקסיד", { exact: true })).toBeNull();
    expect(screen.queryByText("מטבח מלא", { exact: true })).toBeNull();
  });

  it("preserves multiple people on the same shift, never collapsed to one", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          coverageOverview: [
            shiftGroup({
              technicians: [
                { personId: "a", personName: "מרטין בדיקה", certainty: "confirmed", startTimeOverride: null, endTimeOverride: null },
                { personId: "b", personName: "נועה דוגמה", certainty: "confirmed", startTimeOverride: null, endTimeOverride: null },
              ],
            }),
          ],
        }),
      ),
    );
    await renderPage({ category: "shifts" });
    expect(screen.getByText(/מרטין בדיקה, נועה דוגמה/)).toBeInTheDocument();
  });

  it("pairs day+night shift groups for the same date into one day card", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          coverageOverview: [
            shiftGroup({ date: "2026-08-13", period: "day" }),
            shiftGroup({ date: "2026-08-13", period: "night" }),
          ],
        }),
      ),
    );
    const { container } = await renderPage({ category: "shifts" });
    expect(container.querySelectorAll('a[href^="/schedule?person=all&date="]').length).toBe(1);
  });
});

describe("ManagerPage — Duties & Absences category", () => {
  it("shows several duties and absences", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          duties: [duty({ personName: "מרטין בדיקה" }), duty({ personName: "איתן דוגמה", personId: "p_eitan", dutyFamily: "oxid", slot: null })],
          absences: [absence({ personName: "נועה דוגמה", personId: "p_noa", absenceKind: "medical" })],
        }),
      ),
    );
    await renderPage({ category: "duties" });
    expect(screen.getByText("תורנויות")).toBeInTheDocument();
    expect(screen.getByText("היעדרויות")).toBeInTheDocument();
  });
});

describe("ManagerPage — Personnel category", () => {
  it("the roster section links to each person by id, preserving range/category", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage({ category: "personnel" });
    const link = screen.getAllByRole("link", { name: /מרטין בדיקה/ })[0];
    expect(link).toHaveAttribute("href", "/manager?person=p_martin&category=personnel");
  });

  it("shows a real photo for the manager's own roster row when one is available", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ manager: { id: "p_martin", name: "מרטין בדיקה", avatarUrl: "https://example.invalid/photo.jpg" } })),
    );
    const { container } = await renderPage({ category: "personnel" });
    expect(container.querySelectorAll('img[data-testid="avatar-photo"]')).toHaveLength(1);
  });

  it("shows a real photo for a non-manager roster member who is logged in and has a Google avatar, wired from model.rosterAvatarByPersonId", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          rosterAvatarByPersonId: new Map([["p_eitan", "https://example.invalid/eitan.jpg"]]),
        }),
      ),
    );
    const { container } = await renderPage({ category: "personnel" });
    const photos = container.querySelectorAll('img[data-testid="avatar-photo"]');
    expect(photos).toHaveLength(1);
    expect(photos[0].closest("a")).toHaveAttribute("href", expect.stringContaining("person=p_eitan"));
  });

  it("a roster member with no entry in rosterAvatarByPersonId (never logged in / unmapped / no photo) falls back to initials", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ rosterAvatarByPersonId: new Map() })));
    const { container } = await renderPage({ category: "personnel" });
    expect(container.querySelectorAll('img[data-testid="avatar-photo"]')).toHaveLength(0);
  });
});

describe("ManagerPage — PR #37 recommendation wiring", () => {
  it("41. an everyone-wide coverage issue with a recommendation shows the collapsed 'פעולה מומלצת' disclosure", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [
            issue({
              recommendation: {
                missingRole: "technician",
                primaryCandidates: [{ personId: "p_extra", personName: "איתי אוליר" }],
                fallbackCandidates: [],
              },
            }),
          ],
        }),
      ),
    );
    const { container } = await renderPage();
    const summary = screen.getByText("פעולה מומלצת");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    // The candidate name renders as a link to their own manager drill-down (see the
    // "candidate name links" describe block below for the dedicated coverage of this);
    // the surrounding sentence copy is unchanged, just split around that link now.
    const candidateLink = screen.getByRole("link", { name: "איתי אוליר" });
    expect(candidateLink).toHaveAttribute("href", "/manager?person=p_extra");
    expect(container.textContent).toContain("לפי הסידור הקיים, אפשר לבדוק עם איתי אוליר לגבי הכיסוי.");
    expect(screen.getByText("ייתכנו אילוצים אישיים שלא מופיעים במערכת.")).toBeInTheDocument();
  });

  it("an everyone-wide issue with no recommendation shows no disclosure at all", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ issues: [issue({ recommendation: null })] })));
    await renderPage();
    expect(screen.queryByText("פעולה מומלצת")).toBeNull();
  });

  it("41. the technician last-resort nested disclosure renders through the real page wiring", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [
            issue({
              recommendation: {
                missingRole: "technician",
                primaryCandidates: [],
                fallbackCandidates: [{ personId: "p_dual", personName: "טוביה כהן" }],
              },
            }),
          ],
        }),
      ),
    );
    const { container } = await renderPage();
    expect(screen.getByText("לא נמצאו טכנאים מתאימים לפי המידע הקיים.")).toBeInTheDocument();
    expect(screen.getByText("מוצא אחרון · הצג אפשרויות נוספות")).toBeInTheDocument();
    // The fallback/last-resort candidate is ALSO a clickable link to their own drill-down.
    const candidateLink = screen.getByRole("link", { name: "טוביה כהן" });
    expect(candidateLink).toHaveAttribute("href", "/manager?person=p_dual");
    expect(container.textContent).toContain(
      "לא נמצאו טכנאים רגילים מתאימים. לפי הסידור הקיים, אפשר לבדוק גם עם טוביה כהן, שמסומן גם כבעל יכולת טכנית.",
    );
  });

  it("42. the everyone-wide 'דורש טיפול' structure (severity grouping, empty state) remains intact regardless of recommendations", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [
            issue({
              severity: "critical",
              recommendation: {
                missingRole: "technician",
                primaryCandidates: [{ personId: "p_extra", personName: "איתי אוליר" }],
                fallbackCandidates: [],
              },
            }),
          ],
        }),
      ),
    );
    await renderPage();
    expect(screen.getByText("דורש טיפול")).toBeInTheDocument();
    expect(screen.getByText("דחוף", { exact: false })).toBeInTheDocument();
  });

  it("41. the selected-person drill-down (PersonalIssue-based) never shows a manager recommendation, even for the same coverage reason", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          selectedPersonId: "p_martin",
          selectedPerson: personalModel({
            issues: [
              {
                reason: "shift_coverage_missing",
                severity: "critical",
                date: "2026-08-13",
                missingIntervals: null,
                metadata: null,
                targetEvent: { date: "2026-08-13", category: "shift", title: "טכנאי יום", role: "technician", period: "day" , dutyFamily: null },
              },
            ],
          }),
        }),
      ),
    );
    await renderPage({ person: "p_martin" });
    expect(screen.queryByText("פעולה מומלצת")).toBeNull();
    expect(screen.queryByText(/לפי הסידור הקיים/)).toBeNull();
  });
});

describe("ManagerPage — Overview issue wording matches the domain's own role-coverage diagnostic", () => {
  it("technician missing: attention says 'חסר טכנאי למשמרת'", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [
            issue({
              reason: "shift_coverage_missing",
              personName: "טוביה פרי",
              targetEvent: { date: "2026-08-13", category: "shift", title: "יום", role: "technician", period: "day" , dutyFamily: null },
            }),
          ],
          coverageOverview: [
            shiftGroup({
              coverageStatus: "missing",
              technicians: [],
              roleCoverage: {
                technician: { status: "missing", missingIntervals: [] },
                supervisor: { status: "full", missingIntervals: [] },
              },
            }),
          ],
        }),
      ),
    );
    await renderPage();
    expect(screen.getAllByText("טוביה פרי", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText(/חסר טכנאי למשמרת/)).toBeInTheDocument();
    expect(screen.queryByText(/חסר כיסוי למשמרת/)).toBeNull();
  });

  it('supervisor missing: attention says \'חסר אחמ"ש למשמרת\'', async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [
            issue({
              reason: "shift_coverage_missing",
              personName: "דנה כהן",
              targetEvent: { date: "2026-08-13", category: "shift", title: "יום", role: "supervisor", period: "day" , dutyFamily: null },
            }),
          ],
          coverageOverview: [
            shiftGroup({
              coverageStatus: "missing",
              supervisors: [],
              roleCoverage: {
                technician: { status: "full", missingIntervals: [] },
                supervisor: { status: "missing", missingIntervals: [] },
              },
            }),
          ],
        }),
      ),
    );
    await renderPage();
    expect(screen.getAllByText("דנה כהן", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByText(/חסר אחמ"ש למשמרת/)).toBeInTheDocument();
  });

  it('both roles provably missing: attention says \'חסרים טכנאי ואחמ"ש למשמרת\', honestly representing the whole gap', async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [
            issue({
              reason: "shift_coverage_missing",
              personName: "רון קבוע",
              targetEvent: { date: "2026-08-13", category: "shift", title: "יום", role: "technician", period: "day" , dutyFamily: null },
            }),
          ],
          coverageOverview: [
            shiftGroup({
              coverageStatus: "missing",
              technicians: [],
              supervisors: [],
              roleCoverage: {
                technician: { status: "missing", missingIntervals: [] },
                supervisor: { status: "missing", missingIntervals: [] },
              },
            }),
          ],
        }),
      ),
    );
    await renderPage();
    expect(screen.getByText(/חסרים טכנאי ואחמ"ש למשמרת/)).toBeInTheDocument();
  });

  it("not_evaluable roleCoverage never invents a specific missing role -- keeps the truthful generic wording", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [
            issue({
              reason: "shift_coverage_missing",
              personName: "מרטין בדיקה",
              targetEvent: { date: "2026-08-13", category: "shift", title: "יום", role: "technician", period: "day" , dutyFamily: null },
            }),
          ],
          coverageOverview: [
            shiftGroup({
              coverageStatus: "not_evaluable",
              roleCoverage: {
                technician: { status: "not_evaluable", missingIntervals: [] },
                supervisor: { status: "not_evaluable", missingIntervals: [] },
              },
            }),
          ],
        }),
      ),
    );
    await renderPage();
    expect(screen.getByText(/חסר כיסוי למשמרת/)).toBeInTheDocument();
    expect(screen.queryByText(/חסר טכנאי/)).toBeNull();
    expect(screen.queryByText(/חסר אחמ"ש/)).toBeNull();
  });

  it("a partial technician gap: attention says 'כיסוי טכנאי חלקי במשמרת', the existing interval callout still shows separately", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [
            issue({
              reason: "shift_coverage_partial",
              personName: "גיל טכנאי",
              missingIntervals: [{ startMinute: 330, endMinute: 450 }],
              targetEvent: { date: "2026-08-13", category: "shift", title: "יום", role: "technician", period: "day" , dutyFamily: null },
            }),
          ],
          coverageOverview: [
            shiftGroup({
              coverageStatus: "partial",
              roleCoverage: {
                technician: { status: "partial", missingIntervals: [{ startMinute: 330, endMinute: 450 }] },
                supervisor: { status: "full", missingIntervals: [] },
              },
            }),
          ],
        }),
      ),
    );
    await renderPage();
    expect(screen.getByText(/כיסוי טכנאי חלקי במשמרת/)).toBeInTheDocument();
    expect(screen.getAllByText(/05:30–07:30/).length).toBeGreaterThan(0);
  });

  it("existing issue severity is unchanged by the reworded reason label", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [
            issue({
              reason: "shift_coverage_missing",
              severity: "critical",
              personName: "טוביה פרי",
              targetEvent: { date: "2026-08-13", category: "shift", title: "יום", role: "technician", period: "day" , dutyFamily: null },
            }),
          ],
          coverageOverview: [
            shiftGroup({
              coverageStatus: "missing",
              roleCoverage: {
                technician: { status: "missing", missingIntervals: [] },
                supervisor: { status: "full", missingIntervals: [] },
              },
            }),
          ],
        }),
      ),
    );
    await renderPage();
    expect(screen.getByText("דחוף")).toBeInTheDocument();
  });

  it("an issue reason unrelated to coverage is never rewritten by the roleCoverage lookup", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [issue({ reason: "invalid_shift_time", personName: "מרטין בדיקה", targetEvent: null })],
          coverageOverview: [
            shiftGroup({
              coverageStatus: "missing",
              roleCoverage: {
                technician: { status: "missing", missingIntervals: [] },
                supervisor: { status: "full", missingIntervals: [] },
              },
            }),
          ],
        }),
      ),
    );
    await renderPage();
    expect(screen.getByText(/שעות המשמרת דורשות בדיקה/)).toBeInTheDocument();
  });
});

describe("ManagerPage — Logins (התחברויות) category", () => {
  function adoptionState(overrides: {
    loggedIn?: number;
    notLoggedIn?: number;
    ready?: number;
    notReady?: number;
    dataIssue?: number;
    people?: Array<{
      personId: string;
      personName: string;
      loginStatus: "logged_in" | "not_logged_in" | null;
      notificationStatus: "ready" | "not_enabled" | null;
      dataIssue: "missing_email" | "ambiguous_email" | null;
    }>;
  } = {}) {
    const people = overrides.people ?? [];
    return {
      status: "available" as const,
      view: {
        summary: {
          totalCount: (overrides.loggedIn ?? 0) + (overrides.notLoggedIn ?? 0) + (overrides.dataIssue ?? 0),
          loggedInCount: overrides.loggedIn ?? 0,
          notLoggedInCount: overrides.notLoggedIn ?? 0,
          notificationReadyCount: overrides.ready ?? 0,
          loggedInNotReadyCount: overrides.notReady ?? 0,
          dataIssueCount: overrides.dataIssue ?? 0,
        },
        people: people.map((p) => ({ avatarUrl: null, needsNudge: p.loginStatus !== "logged_in" || p.notificationStatus === "not_enabled", ...p })),
      },
    };
  }

  it("skipped: renders nothing", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ adoption: { status: "skipped" } })));
    await renderPage({ category: "logins" });
    expect(screen.queryByText("סה״כ אנשי צוות")).toBeNull();
  });

  it("unavailable: shows the small neutral notice", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ adoption: { status: "unavailable" } })));
    await renderPage({ category: "logins" });
    expect(screen.getByText("לא ניתן לבדוק כרגע את מצב ההתחברויות וההתראות")).toBeInTheDocument();
  });

  it("available, everyone ready: STILL renders the summary (unlike the old inline aside, this is a full category page)", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          adoption: adoptionState({
            loggedIn: 2,
            ready: 2,
            people: [
              { personId: "p_martin", personName: "מרטין בדיקה", loginStatus: "logged_in", notificationStatus: "ready", dataIssue: null },
              { personId: "p_eitan", personName: "איתן דוגמה", loginStatus: "logged_in", notificationStatus: "ready", dataIssue: null },
            ],
          }),
        }),
      ),
    );
    await renderPage({ category: "logins" });
    expect(screen.getByText("סה״כ אנשי צוות")).toBeInTheDocument();
  });

  it("shows the two nudge groups (not logged in / notifications off) grouped separately", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          adoption: adoptionState({
            notLoggedIn: 1,
            loggedIn: 1,
            notReady: 1,
            people: [
              { personId: "p_martin", personName: "מרטין בדיקה", loginStatus: "not_logged_in", notificationStatus: null, dataIssue: null },
              { personId: "p_eitan", personName: "איתן דוגמה", loginStatus: "logged_in", notificationStatus: "not_enabled", dataIssue: null },
            ],
          }),
        }),
      ),
    );
    await renderPage({ category: "logins" });
    const adoptionSection = within(screen.getByTestId("manager-adoption-section"));
    expect(adoptionSection.getByText("טרם נכנסו למערכת")).toBeInTheDocument();
    expect(adoptionSection.getByText("מרטין בדיקה")).toBeInTheDocument();
    expect(adoptionSection.getByText("נכנסו למערכת אך לא הפעילו התראות")).toBeInTheDocument();
    expect(adoptionSection.getByText("איתן דוגמה")).toBeInTheDocument();
  });

  it("frames a missing/ambiguous email as a roster data issue, distinct from 'hasn't logged in'", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          adoption: adoptionState({
            dataIssue: 1,
            people: [
              { personId: "p_martin", personName: "מרטין בדיקה", loginStatus: null, notificationStatus: null, dataIssue: "missing_email" },
            ],
          }),
        }),
      ),
    );
    await renderPage({ category: "logins" });
    expect(screen.getAllByText("בעיית נתונים בכ״א").length).toBeGreaterThan(0);
    expect(screen.queryByText("טרם נכנסו למערכת")).toBeNull();
  });

  it("never appears in the selected-person drilldown", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          selectedPersonId: "p_martin",
          selectedPerson: personalModel(),
          adoption: { status: "skipped" },
        }),
      ),
    );
    await renderPage({ person: "p_martin" });
    expect(screen.queryByText("סה״כ אנשי צוות")).toBeNull();
    expect(screen.queryByText("לא ניתן לבדוק כרגע את מצב ההתחברויות וההתראות")).toBeNull();
  });

  it("never appears outside its own category", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ adoption: { status: "unavailable" } })));
    await renderPage({ category: "shifts" });
    expect(screen.queryByText("לא ניתן לבדוק כרגע את מצב ההתחברויות וההתראות")).toBeNull();
  });

  it("no longer lives in Overview -- the old מצב התראות aside is gone from there", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [issue()],
          adoption: adoptionState({
            notLoggedIn: 1,
            people: [
              { personId: "p_martin", personName: "מרטין בדיקה", loginStatus: "not_logged_in", notificationStatus: null, dataIssue: null },
            ],
          }),
        }),
      ),
    );
    await renderPage();
    expect(screen.getByText("דורש טיפול")).toBeInTheDocument();
    expect(screen.queryByText("טרם נכנסו למערכת")).toBeNull();
    expect(screen.queryByText("סה״כ אנשי צוות")).toBeNull();
  });

  it("hides the person/range filter controls -- this category is a current snapshot, not scoped by a date range or a person", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage({ category: "logins" });
    expect(screen.queryByRole("button", { name: /כולם/ })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "טווח תאריכים" })).toBeNull();
    expect(screen.queryByText("היום")).toBeNull();
    expect(screen.queryByText("7 ימים")).toBeNull();
    expect(screen.queryByText("30 יום")).toBeNull();
    expect(screen.queryByText("החודש")).toBeNull();
  });

  it("still shows the Google Sheets freshness status and refresh control", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage({ category: "logins" });
    expect(screen.getByTestId("freshness")).toBeInTheDocument();
  });
});

describe("ManagerPage — filter controls restore when leaving Logins / Personnel", () => {
  it("Overview shows the person/range filters", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage();
    expect(screen.getByRole("button", { name: /כולם/ })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "טווח תאריכים" })).toBeInTheDocument();
  });

  it("Shifts shows the person/range filters", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage({ category: "shifts" });
    expect(screen.getByRole("button", { name: /כולם/ })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "טווח תאריכים" })).toBeInTheDocument();
  });

  it("Duties & Absences shows the person/range filters", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage({ category: "duties" });
    expect(screen.getByRole("button", { name: /כולם/ })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "טווח תאריכים" })).toBeInTheDocument();
  });
});

describe("ManagerPage — Personnel (כוח אדם) hides person/date filters, keeps freshness status", () => {
  it("hides the person/range filter controls -- Personnel is a straightforward workforce/roster page, not scoped by a date range or a person", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage({ category: "personnel" });
    expect(screen.queryByRole("button", { name: /כולם/ })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "טווח תאריכים" })).toBeNull();
    expect(screen.queryByText("היום")).toBeNull();
    expect(screen.queryByText("7 ימים")).toBeNull();
    expect(screen.queryByText("30 יום")).toBeNull();
    expect(screen.queryByText("החודש")).toBeNull();
  });

  it("still shows the Google Sheets freshness status and refresh control", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    await renderPage({ category: "personnel" });
    expect(screen.getByTestId("freshness")).toBeInTheDocument();
  });
});

describe("ManagerPage — selected person view", () => {
  it("shows the person-scoped header, never the everyone controls sections", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          selectedPersonId: "p_martin",
          selectedPerson: personalModel(),
        }),
      ),
    );
    await renderPage({ person: "p_martin" });
    expect(screen.getByText(/מבט על מרטין בדיקה/)).toBeInTheDocument();
    expect(screen.queryByText("כיסוי משמרות")).toBeNull();
  });

  it("a person with no upcoming assignments shows the calm empty state", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ selectedPersonId: "p_martin", selectedPerson: personalModel() })),
    );
    await renderPage({ person: "p_martin" });
    expect(screen.getByText("אין שיבוצים קרובים לאדם זה.")).toBeInTheDocument();
  });

  it("shows the selected person's own range-scoped absences, not everyone's", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          selectedPersonId: "p_martin",
          selectedPerson: personalModel(),
          selectedPersonRangeAbsences: [absence({ personId: "p_martin", personName: "מרטין בדיקה" })],
          absences: [absence({ personId: "p_martin" }), absence({ personId: "p_noa", personName: "נועה דוגמה" })],
        }),
      ),
    );
    await renderPage({ person: "p_martin" });
    expect(screen.getByText("היעדרויות בטווח")).toBeInTheDocument();
    expect(screen.queryByText("נועה דוגמה")).toBeNull();
  });

  it("still shows the shared אזור מנהל header on the selected-person view", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ selectedPersonId: "p_martin", selectedPerson: personalModel() })),
    );
    await renderPage({ person: "p_martin" });
    expect(screen.getByRole("heading", { name: "אזור מנהל", level: 1 })).toBeInTheDocument();
  });

  it("selecting a person never renders a sign-out affordance or changes identity chrome", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ selectedPersonId: "p_martin", selectedPerson: personalModel() })),
    );
    const { container } = await renderPage({ person: "p_martin" });
    expect(screen.queryByRole("button", { name: "התנתקות" })).toBeNull();
    expect(container.querySelector("aside")).toBeNull();
  });

  it("names the missing role for a coverage issue, the SAME role-aware wording the dashboard uses -- never the generic 'חסר כיסוי' fallback", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          selectedPersonId: "p_martin",
          selectedPerson: personalModel({
            issues: [
              {
                reason: "shift_coverage_missing",
                severity: "critical",
                date: "2026-08-13",
                missingIntervals: null,
                metadata: null,
                targetEvent: { date: "2026-08-13", category: "shift", title: "טכנאי יום", role: "technician", period: "day" , dutyFamily: null },
              },
            ],
          }),
        }),
      ),
    );
    await renderPage({ person: "p_martin" });
    expect(screen.getByText('חסר אחמ"ש למשמרת שלך')).toBeInTheDocument();
    expect(screen.queryByText("חסר כיסוי למשמרת שלך")).toBeNull();
  });

  it("gateways into the person's real Schedule and Fairness detail, never reproducing either here", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ selectedPersonId: "p_martin", selectedPerson: personalModel() })),
    );
    await renderPage({ person: "p_martin" });
    expect(screen.getByRole("link", { name: /לוח מלא/ })).toHaveAttribute("href", "/schedule?person=p_martin");
    expect(screen.getByRole("link", { name: /מצב הוגנות/ })).toHaveAttribute("href", "/fairness?person=p_martin");
  });

  it("shows the manager's own photo only when the drilled-down person IS the manager", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          manager: { id: "p_martin", name: "מרטין בדיקה", avatarUrl: "https://example.invalid/photo.jpg" },
          selectedPersonId: "p_martin",
          selectedPerson: personalModel(),
        }),
      ),
    );
    const { container } = await renderPage({ person: "p_martin" });
    expect(container.querySelectorAll('img[data-testid="avatar-photo"]')).toHaveLength(1);
  });

  it("never shows another person's photo, even if the manager has one", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          manager: { id: "p_manager", name: "דני מנהל", avatarUrl: "https://example.invalid/photo.jpg" },
          selectedPersonId: "p_martin",
          selectedPerson: personalModel(),
        }),
      ),
    );
    const { container } = await renderPage({ person: "p_martin" });
    expect(container.querySelectorAll('img[data-testid="avatar-photo"]')).toHaveLength(0);
  });
});

describe("ManagerPage — data freshness uses ManagerOverviewReadModel.fetchedAt (PR #17 §10/§19)", () => {
  it("everyone view: the freshness status receives the manager model's own fetchedAt", async () => {
    getRequestManagerOverview.mockResolvedValue(okResult(model({ fetchedAt: "2026-08-13T09:30:00.000Z" })));
    await renderPage();
    expect(screen.getByTestId("freshness")).toHaveTextContent("2026-08-13T09:30:00.000Z");
  });

  it("selected-person view: STILL uses the manager model's own fetchedAt, never the nested selectedPerson's personal timestamp", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          fetchedAt: "2026-08-13T09:30:00.000Z",
          selectedPersonId: "p_martin",
          selectedPerson: personalModel({ fetchedAt: "2026-08-13T01:00:00.000Z" }),
        }),
      ),
    );
    await renderPage({ person: "p_martin" });
    expect(screen.getByTestId("freshness")).toHaveTextContent("2026-08-13T09:30:00.000Z");
    expect(screen.queryByText("2026-08-13T01:00:00.000Z")).toBeNull();
  });
});

describe("ManagerPage — privacy", () => {
  it("never leaks sourceSheet/sourceCell/email/spreadsheet details", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          issues: [issue()],
          coverageOverview: [shiftGroup()],
          duties: [duty()],
          absences: [absence()],
          potentialRequirements: [potentialRow()],
        }),
      ),
    );
    const { container } = await renderPage({ category: "shifts" });
    expect(container.textContent).not.toContain("sourceSheet");
    expect(container.textContent).not.toContain("sourceCell");
    expect(container.textContent).not.toContain("@");
    expect(container.textContent).not.toContain("spreadsheetId");
  });

  it("never leaks a person's internal id or raw status string from the התחברויות category", async () => {
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          adoption: {
            status: "available",
            view: {
              summary: {
                totalCount: 1,
                loggedInCount: 1,
                notLoggedInCount: 0,
                notificationReadyCount: 0,
                loggedInNotReadyCount: 1,
                dataIssueCount: 0,
              },
              people: [
                {
                  personId: "p_martin_internal_id",
                  personName: "מרטין בדיקה",
                  avatarUrl: null,
                  loginStatus: "logged_in",
                  notificationStatus: "not_enabled",
                  dataIssue: null,
                  needsNudge: true,
                },
              ],
            },
          },
        }),
      ),
    );
    const { container } = await renderPage({ category: "logins" });
    expect(container.textContent).not.toContain("p_martin_internal_id");
    expect(container.textContent).not.toContain("no_push_subscription");
    expect(container.textContent).not.toContain("not_enabled");
    expect(container.textContent).not.toContain("logged_in");
  });
});

const EMERGENCY_PERIOD = {
  id: "period_1",
  activatedAt: "2026-08-13T06:00:00.000Z",
  activatedByUserId: "u_manager",
  activatedByPersonId: "p_manager",
  activatedByPersonName: "דני מנהל",
  startDate: "2026-08-13",
  deactivatedAt: null,
  deactivatedByUserId: null,
  deactivatedByPersonId: null,
  deactivatedByPersonName: null,
  endDate: null,
};

describe("ManagerPage — Emergency Mode: desk staffing replaces regular coverage/duties/potential/roster-drill-down (spec section 13)", () => {
  it("takes precedence over the category switch -- the everyone perspective renders desk staffing, never the regular coverage/potential sections, even with ?category=shifts", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "emergency" });
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ coverageOverview: [shiftGroup()], potentialRequirements: [potentialRow()] })),
    );
    loadManagerEmergencyOverview.mockResolvedValue({
      status: "ok",
      model: {
        fetchedAt: "2026-08-13T09:00:00.000Z",
        localNow: { date: "2026-08-13", minuteOfDay: 600 },
        period: EMERGENCY_PERIOD,
        diagnostics: [],
        manager: { id: "p_manager", name: "דני מנהל" },
        roster: [],
        perspective: "all",
        selectedPersonId: null,
        selectedPersonName: null,
        personalShifts: null,
        everyoneShifts: [
          {
            date: "2026-08-13",
            period: "day",
            desks: [{ desk: 'רת"ק', personId: "p_martin", personName: "מרטין בדיקה" }],
          },
        ],
      },
      operationalOverview: {
        previous: null,
        current: {
          date: "2026-08-13",
          period: "day",
          desks: [{ desk: 'רת"ק', personId: "p_martin", personName: "מרטין בדיקה" }],
        },
        next: null,
      },
    });

    await renderPage({ category: "shifts" });

    // The operational triad (previous/current/next) is the FIRST thing shown -- never the regular coverage sections.
    expect(screen.getByTestId("emergency-manager-operational-overview")).toBeInTheDocument();
    expect(screen.getByText("משמרת נוכחית")).toBeInTheDocument();
    expect(within(screen.getByTestId("emergency-manager-shift-current")).getByText('רת"ק')).toBeInTheDocument();
    expect(screen.queryByText("כיסוי משמרות")).toBeNull();
    expect(loadManagerEmergencyOverview).toHaveBeenCalledWith({ id: "p_manager", name: "דני מנהל" }, null);
  });

  it("the full historical schedule stays reachable behind a collapsed secondary section, not shown as the default view", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "emergency" });
    getRequestManagerOverview.mockResolvedValue(okResult(model()));
    loadManagerEmergencyOverview.mockResolvedValue({
      status: "ok",
      model: {
        fetchedAt: "2026-08-13T09:00:00.000Z",
        localNow: { date: "2026-08-13", minuteOfDay: 600 },
        period: EMERGENCY_PERIOD,
        diagnostics: [],
        manager: { id: "p_manager", name: "דני מנהל" },
        roster: [],
        perspective: "all",
        selectedPersonId: null,
        selectedPersonName: null,
        personalShifts: null,
        everyoneShifts: [
          { date: "2026-02-10", period: "day", desks: [{ desk: 'רת"ק', personId: null, personName: null }] },
        ],
      },
      operationalOverview: { previous: null, current: null, next: null },
    });

    await renderPage({ category: "shifts" });

    const history = screen.getByTestId("emergency-manager-full-schedule");
    expect(history).not.toHaveAttribute("open");
  });

  it("a selected person renders their own desk assignments (person perspective), never the regular selected-person drill-down", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "emergency" });
    getRequestManagerOverview.mockResolvedValue(
      okResult(
        model({
          selectedPersonId: "p_martin",
          selectedPerson: personalModel(),
        }),
      ),
    );
    loadManagerEmergencyOverview.mockResolvedValue({
      status: "ok",
      model: {
        fetchedAt: "2026-08-13T09:00:00.000Z",
        localNow: { date: "2026-08-13", minuteOfDay: 600 },
        period: EMERGENCY_PERIOD,
        diagnostics: [],
        manager: { id: "p_manager", name: "דני מנהל" },
        roster: [],
        perspective: "person",
        selectedPersonId: "p_martin",
        selectedPersonName: "מרטין בדיקה",
        personalShifts: [
          { date: "2026-08-13", period: "day", ownDesks: ['רת"ק'], roster: [] },
        ],
        everyoneShifts: null,
      },
    });

    await renderPage({ person: "p_martin" });

    expect(screen.getByTestId("emergency-personal-schedule-list")).toBeInTheDocument();
    expect(screen.getByText(/רת"ק/)).toBeInTheDocument();
    expect(screen.queryByTestId("emergency-everyone-schedule-list")).toBeNull();
    expect(loadManagerEmergencyOverview).toHaveBeenCalledWith({ id: "p_manager", name: "דני מנהל" }, "p_martin");
  });

  it("renders the shared unavailable state when the emergency workbook itself is broken -- never falls back to regular coverage data", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "emergency" });
    getRequestManagerOverview.mockResolvedValue(
      okResult(model({ coverageOverview: [shiftGroup()] })),
    );
    loadManagerEmergencyOverview.mockResolvedValue({
      status: "emergency_unavailable",
      message: "Missing GOOGLE_EMERGENCY_SPREADSHEET_ID.",
    });

    await renderPage({ category: "shifts" });

    expect(screen.getByText(/נתוני החירום אינם זמינים/)).toBeInTheDocument();
    expect(screen.queryByTestId("emergency-everyone-schedule-list")).toBeNull();
    expect(screen.queryByText("כיסוי משמרות")).toBeNull();
  });

  it("regular mode (the default) is unaffected -- loadManagerEmergencyOverview is never called", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "regular" });
    getRequestManagerOverview.mockResolvedValue(okResult(model({ coverageOverview: [shiftGroup()] })));

    await renderPage({ category: "shifts" });

    expect(screen.getByText("כיסוי משמרות")).toBeInTheDocument();
    expect(loadManagerEmergencyOverview).not.toHaveBeenCalled();
  });
});
