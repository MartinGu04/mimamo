import { afterEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@/lib/domain/event";
import type { Person } from "@/lib/domain/types";
import { buildShiftSchedule } from "@/lib/domain/shiftSchedule";
import { getOperationalWeek } from "@/lib/domain/operationalWeek";
import type { LocalNow } from "@/lib/domain/localNow";
import type { RecipientResolution } from "./recipients";
import type { BaselineStateSnapshot } from "./store";

function person(overrides: Partial<Person> & Pick<Person, "id" | "name">): Person {
  return { email: null, isManager: false, isTechnician: false, isSupervisor: false, personnelType: null, dischargeDate: null, enlistmentDate: null, ...overrides };
}

function event(overrides: Partial<Event> & Pick<Event, "personId" | "date" | "category">): Event {
  return {
    personName: overrides.personId,
    title: "",
    rawValue: "",
    certainty: "confirmed",
    role: null,
    period: "unspecified",
    sourceSheet: "sheet",
    sourceCell: "A1",
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

const schedule = buildShiftSchedule("07:00");
const now: LocalNow = { date: "2026-08-19", minuteOfDay: 600 };
const week = getOperationalWeek(now);

function emptyResolution(): RecipientResolution {
  return { resolved: new Map(), unmappedCount: 0, ambiguousEmailCount: 0, noEmailCount: 0 };
}

const store = {
  advanceNotificationBaseline: vi.fn(),
  applyPendingChanges: vi.fn(async () => {}),
  claimDuePendingChanges: vi.fn<() => Promise<import("./store").ClaimedPendingChange[]>>(async () => []),
  claimNotificationBaselineReseed: vi.fn(async () => true),
  clearWeekState: vi.fn(async () => {}),
  countOpenPendingChanges: vi.fn(async () => 0),
  deletePendingChange: vi.fn(async () => {}),
  getObservedFacts: vi.fn(async () => new Map()),
  insertNotificationJobIfAbsent: vi.fn(async () => true),
  peekBaselineState: vi.fn<() => Promise<BaselineStateSnapshot>>(async () => ({
    initialized: true,
    currentWeekStart: week.weekStart,
    updatedAt: "2026-08-19T00:00:00.000Z",
  })),
  peekDuePendingChangesCount: vi.fn(async () => 0),
  quarantineNotificationFloodJobs: vi.fn(async () => 0),
  seedObservedFacts: vi.fn(async () => {}),
  setObservedFact: vi.fn(async () => {}),
};

afterEach(() => {
  vi.clearAllMocks();
  store.peekBaselineState.mockResolvedValue({
    initialized: true,
    currentWeekStart: week.weekStart,
    updatedAt: "2026-08-19T00:00:00.000Z",
  });
  vi.resetModules();
});

async function loadModule() {
  vi.doMock("./store", () => store);
  return import("./changeDetection");
}

describe("runChangeDetection -- baseline transitions", () => {
  it("first-ever run silently seeds the baseline and sends nothing", async () => {
    store.peekBaselineState.mockResolvedValue({ initialized: false, currentWeekStart: null, updatedAt: null });
    store.advanceNotificationBaseline.mockResolvedValue({ action: "initialized", previousWeekStart: null });
    const { runChangeDetection } = await loadModule();

    const summary = await runChangeDetection({
      events: [event({ personId: "p1", date: week.weekStart, category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
    });

    expect(summary.baselineAction).toBe("initialized");
    expect(summary.semanticChangesDetected).toBe(0);
    expect(summary.jobsCreated).toBe(0);
    expect(store.seedObservedFacts).toHaveBeenCalledTimes(1);
    expect(store.claimNotificationBaselineReseed.mock.invocationCallOrder[0]).toBeLessThan(
      store.seedObservedFacts.mock.invocationCallOrder[0],
    );
    expect(store.seedObservedFacts.mock.invocationCallOrder[0]).toBeLessThan(
      store.advanceNotificationBaseline.mock.invocationCallOrder[0],
    );
    expect(store.getObservedFacts).not.toHaveBeenCalled();
    expect(store.insertNotificationJobIfAbsent).not.toHaveBeenCalled();
  });

  it("week rollover clears the PREVIOUS week's state, silently re-seeds the new week, and sends nothing", async () => {
    store.peekBaselineState.mockResolvedValue({ initialized: true, currentWeekStart: "2026-08-09", updatedAt: "2026-08-09T00:00:00.000Z" });
    store.advanceNotificationBaseline.mockResolvedValue({ action: "rolled_over", previousWeekStart: "2026-08-09" });
    const { runChangeDetection } = await loadModule();

    const summary = await runChangeDetection({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
    });

    expect(summary.baselineAction).toBe("rolled_over");
    expect(summary.jobsCreated).toBe(0);
    expect(store.clearWeekState).toHaveBeenCalledWith("2026-08-09");
    expect(store.seedObservedFacts).toHaveBeenCalledTimes(1);
    expect(store.claimNotificationBaselineReseed.mock.invocationCallOrder[0]).toBeLessThan(
      store.seedObservedFacts.mock.invocationCallOrder[0],
    );
    expect(store.seedObservedFacts.mock.invocationCallOrder[0]).toBeLessThan(
      store.advanceNotificationBaseline.mock.invocationCallOrder[0],
    );
    expect(store.insertNotificationJobIfAbsent).not.toHaveBeenCalled();
  });

  it("does not advance the week marker when reseeding fails, so the next tick retries silently", async () => {
    store.peekBaselineState.mockResolvedValue({ initialized: true, currentWeekStart: "2026-08-09", updatedAt: "2026-08-09T00:00:00.000Z" });
    store.seedObservedFacts.mockRejectedValueOnce(new Error("timeout"));
    const { runChangeDetection } = await loadModule();

    await expect(
      runChangeDetection({
        events: [],
        people: [],
        shiftSchedule: schedule,
        week,
        persist: true,
        recipientResolution: emptyResolution(),
        personNameById: new Map(),
      }),
    ).rejects.toThrow("timeout");

    expect(store.advanceNotificationBaseline).not.toHaveBeenCalled();
    expect(store.claimNotificationBaselineReseed).toHaveBeenCalledTimes(1);
  });

  it("dry-run mode never calls a single mutating store function", async () => {
    store.peekBaselineState.mockResolvedValue({ initialized: true, currentWeekStart: week.weekStart, updatedAt: "2026-08-19T00:00:00.000Z" });
    const { runChangeDetection } = await loadModule();

    await runChangeDetection({
      events: [event({ personId: "p1", date: week.weekStart, category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      persist: false,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
    });

    expect(store.advanceNotificationBaseline).not.toHaveBeenCalled();
    expect(store.claimNotificationBaselineReseed).not.toHaveBeenCalled();
    expect(store.applyPendingChanges).not.toHaveBeenCalled();
    expect(store.claimDuePendingChanges).not.toHaveBeenCalled();
    expect(store.seedObservedFacts).not.toHaveBeenCalled();
    expect(store.setObservedFact).not.toHaveBeenCalled();
    expect(store.insertNotificationJobIfAbsent).not.toHaveBeenCalled();
  });

  it("silently retries an interrupted same-week reseed instead of entering ordinary diff", async () => {
    store.peekBaselineState.mockResolvedValue({
      initialized: false,
      currentWeekStart: week.weekStart,
      updatedAt: "2026-08-19T00:01:00.000Z",
    });
    const { runChangeDetection } = await loadModule();

    const summary = await runChangeDetection({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
    });

    expect(summary.baselineAction).toBe("rolled_over");
    expect(store.clearWeekState).toHaveBeenCalledWith(week.weekStart);
    expect(store.seedObservedFacts).toHaveBeenCalledTimes(1);
    expect(store.advanceNotificationBaseline).toHaveBeenCalledWith(week.weekStart);
    expect(store.getObservedFacts).not.toHaveBeenCalled();
    expect(store.applyPendingChanges).not.toHaveBeenCalled();
  });

  it("quarantines the bounded incident jobs and reseeds silently before marking recovery complete", async () => {
    const incidentNow: LocalNow = { date: "2026-09-13", minuteOfDay: 60 };
    const incidentWeek = getOperationalWeek(incidentNow);
    store.peekBaselineState.mockResolvedValue({
      initialized: true,
      currentWeekStart: incidentWeek.weekStart,
      updatedAt: "2026-09-12T21:05:00.000Z",
    });
    const { runChangeDetection } = await loadModule();

    const summary = await runChangeDetection({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week: incidentWeek,
      persist: true,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
    });

    expect(summary.baselineAction).toBe("rolled_over");
    expect(summary.semanticChangesDetected).toBe(0);
    expect(store.quarantineNotificationFloodJobs).toHaveBeenCalledWith(
      "2026-09-12T21:00:00.000Z",
      "2026-09-12T21:51:00.000Z",
    );
    expect(store.clearWeekState).toHaveBeenCalledWith(incidentWeek.weekStart);
    expect(store.seedObservedFacts).toHaveBeenCalledTimes(1);
    expect(store.quarantineNotificationFloodJobs.mock.invocationCallOrder[0]).toBeLessThan(
      store.advanceNotificationBaseline.mock.invocationCallOrder[0],
    );
    expect(store.seedObservedFacts.mock.invocationCallOrder[0]).toBeLessThan(
      store.advanceNotificationBaseline.mock.invocationCallOrder[0],
    );
    expect(store.advanceNotificationBaseline).toHaveBeenCalledWith(incidentWeek.weekStart);
    expect(store.insertNotificationJobIfAbsent).not.toHaveBeenCalled();
  });
});

describe("runChangeDetection -- settled shift change", () => {
  it("a settled shift-period change creates exactly one job for the resolved recipient", async () => {
    store.advanceNotificationBaseline.mockResolvedValue({ action: "unchanged", previousWeekStart: week.weekStart });
    store.getObservedFacts.mockResolvedValue(
      new Map([
        [
          "shift:p1:2026-08-19",
          { factKey: "shift:p1:2026-08-19", category: "shift", value: { entries: [{ period: "day", role: "technician", shadow: false }] } },
        ],
      ]),
    );
    store.claimDuePendingChanges.mockResolvedValue([
      {
        id: "pending-1",
        weekStartDate: week.weekStart,
        factKey: "shift:p1:2026-08-19",
        category: "shift",
        originalValue: { entries: [{ period: "day", role: "technician", shadow: false }] },
        latestValue: { entries: [{ period: "night", role: "technician", shadow: false }] },
      },
    ]);

    const { runChangeDetection } = await loadModule();
    const resolution: RecipientResolution = {
      resolved: new Map([["p1", { personId: "p1", email: "p1@example.com", userId: "user-p1" }]]),
      unmappedCount: 0,
      ambiguousEmailCount: 0,
      noEmailCount: 0,
    };

    const summary = await runChangeDetection({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "night" })],
      people: [person({ id: "p1", name: "P1" })],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: resolution,
      personNameById: new Map([["p1", "P1"]]),
    });

    expect(summary.settledChanges).toBe(1);
    expect(summary.jobsCreated).toBe(1);
    expect(store.insertNotificationJobIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "shift_change",
        recipientUserId: "user-p1",
        dedupeKey: "settle:pending-1:user-p1",
      }),
    );
    expect(store.setObservedFact).toHaveBeenCalledWith(
      week.weekStart,
      "shift:p1:2026-08-19",
      "shift",
      { entries: [{ period: "night", role: "technician", shadow: false }] },
    );
    expect(store.deletePendingChange).toHaveBeenCalledWith("pending-1");
  });

  it("an unresolvable recipient (no matching Supabase user) never creates a job -- fails closed, not a guess", async () => {
    store.advanceNotificationBaseline.mockResolvedValue({ action: "unchanged", previousWeekStart: week.weekStart });
    store.getObservedFacts.mockResolvedValue(new Map());
    store.claimDuePendingChanges.mockResolvedValue([
      {
        id: "pending-2",
        weekStartDate: week.weekStart,
        factKey: "shift:p1:2026-08-19",
        category: "shift",
        originalValue: null,
        latestValue: { entries: [{ period: "day", role: "technician", shadow: false }] },
      },
    ]);

    const { runChangeDetection } = await loadModule();
    const summary = await runChangeDetection({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
    });

    expect(summary.jobsCreated).toBe(0);
    expect(store.insertNotificationJobIfAbsent).not.toHaveBeenCalled();
  });
});

describe("runChangeDetection -- coverage gap gating", () => {
  it("only a valid -> missing transition creates a manager job", async () => {
    store.advanceNotificationBaseline.mockResolvedValue({ action: "unchanged", previousWeekStart: week.weekStart });
    store.getObservedFacts.mockResolvedValue(new Map());
    store.claimDuePendingChanges.mockResolvedValue([
      {
        id: "pending-3",
        weekStartDate: week.weekStart,
        factKey: "coverage:2026-08-19:night",
        category: "coverage",
        originalValue: { status: "full", missingTechnician: false, missingSupervisor: false },
        latestValue: { status: "missing", missingTechnician: false, missingSupervisor: true },
      },
    ]);

    const { runChangeDetection } = await loadModule();
    const manager = person({ id: "m1", name: "Manager", isManager: true });
    const resolution: RecipientResolution = {
      resolved: new Map([["m1", { personId: "m1", email: "m1@example.com", userId: "user-m1" }]]),
      unmappedCount: 0,
      ambiguousEmailCount: 0,
      noEmailCount: 0,
    };

    const summary = await runChangeDetection({
      events: [],
      people: [manager],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: resolution,
      personNameById: new Map(),
    });

    expect(summary.jobsCreated).toBe(1);
    expect(store.insertNotificationJobIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ category: "coverage_gap", recipientUserId: "user-m1" }),
    );
  });

  it("an already-missing -> still-missing transition never re-notifies", async () => {
    store.advanceNotificationBaseline.mockResolvedValue({ action: "unchanged", previousWeekStart: week.weekStart });
    store.getObservedFacts.mockResolvedValue(new Map());
    store.claimDuePendingChanges.mockResolvedValue([
      {
        id: "pending-4",
        weekStartDate: week.weekStart,
        factKey: "coverage:2026-08-19:night",
        category: "coverage",
        originalValue: { status: "missing", missingTechnician: false, missingSupervisor: true },
        latestValue: { status: "missing", missingTechnician: false, missingSupervisor: true },
      },
    ]);

    const { runChangeDetection } = await loadModule();
    const manager = person({ id: "m1", name: "Manager", isManager: true });
    const resolution: RecipientResolution = {
      resolved: new Map([["m1", { personId: "m1", email: "m1@example.com", userId: "user-m1" }]]),
      unmappedCount: 0,
      ambiguousEmailCount: 0,
      noEmailCount: 0,
    };

    const summary = await runChangeDetection({
      events: [],
      people: [manager],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: resolution,
      personNameById: new Map(),
    });

    expect(summary.jobsCreated).toBe(0);
    expect(store.insertNotificationJobIfAbsent).not.toHaveBeenCalled();
    // The observed fact is still updated -- the current truth is tracked
    // even when no notification fires.
    expect(store.setObservedFact).toHaveBeenCalled();
  });

  it("a resolved gap -> full transition never notifies", async () => {
    store.advanceNotificationBaseline.mockResolvedValue({ action: "unchanged", previousWeekStart: week.weekStart });
    store.getObservedFacts.mockResolvedValue(new Map());
    store.claimDuePendingChanges.mockResolvedValue([
      {
        id: "pending-5",
        weekStartDate: week.weekStart,
        factKey: "coverage:2026-08-19:night",
        category: "coverage",
        originalValue: { status: "missing", missingTechnician: false, missingSupervisor: true },
        latestValue: { status: "full", missingTechnician: false, missingSupervisor: false },
      },
    ]);

    const { runChangeDetection } = await loadModule();
    const summary = await runChangeDetection({
      events: [],
      people: [person({ id: "m1", name: "Manager", isManager: true })],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
    });

    expect(summary.jobsCreated).toBe(0);
    expect(store.insertNotificationJobIfAbsent).not.toHaveBeenCalled();
  });

  it("ordinary (non-manager) resolved recipients never receive a coverage-gap job", async () => {
    store.advanceNotificationBaseline.mockResolvedValue({ action: "unchanged", previousWeekStart: week.weekStart });
    store.getObservedFacts.mockResolvedValue(new Map());
    store.claimDuePendingChanges.mockResolvedValue([
      {
        id: "pending-6",
        weekStartDate: week.weekStart,
        factKey: "coverage:2026-08-19:night",
        category: "coverage",
        originalValue: { status: "full", missingTechnician: false, missingSupervisor: false },
        latestValue: { status: "missing", missingTechnician: false, missingSupervisor: true },
      },
    ]);

    const { runChangeDetection } = await loadModule();
    const nonManager = person({ id: "u1", name: "Regular", isManager: false });
    const resolution: RecipientResolution = {
      resolved: new Map([["u1", { personId: "u1", email: "u1@example.com", userId: "user-u1" }]]),
      unmappedCount: 0,
      ambiguousEmailCount: 0,
      noEmailCount: 0,
    };

    await runChangeDetection({
      events: [],
      people: [nonManager],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: resolution,
      personNameById: new Map(),
    });

    expect(store.insertNotificationJobIfAbsent).not.toHaveBeenCalled();
  });
});

describe("runChangeDetection -- Emergency Mode (spec section 22/23)", () => {
  it("computes emergency_shift/emergency_team facts from emergencyAssignments, not events, when operationalMode is 'emergency'", async () => {
    store.advanceNotificationBaseline.mockResolvedValue({ action: "unchanged", previousWeekStart: week.weekStart });
    store.getObservedFacts.mockResolvedValue(new Map());
    const { runChangeDetection } = await loadModule();

    await runChangeDetection({
      events: [event({ personId: "p1", date: week.weekStart, category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
      operationalMode: "emergency",
      emergencyAssignments: [
        { date: week.weekStart, period: "day", desk: "הוגוורט", personId: "p1", personName: "אחד", sourceCell: "C2" },
      ],
    });

    // diffSemanticFacts compares against empty observed facts -- the fresh
    // emergency_shift fact for p1 shows up as a genuine new change, never
    // the regular "shift" category (which would require the events array
    // to have been consulted, and it must NOT be while in emergency mode).
    const [changes] = store.applyPendingChanges.mock.calls[0].slice(1) as unknown as [Array<{ category: string; factKey: string }>];
    expect(changes.some((change) => change.category === "shift")).toBe(false);
    expect(changes.some((change) => change.category === "coverage")).toBe(false);
    expect(changes.some((change) => change.factKey === `emergency_shift:p1:${week.weekStart}`)).toBe(true);
  });

  it("regular mode (the default) is completely unaffected -- omitting operationalMode/emergencyAssignments behaves byte-for-byte as before", async () => {
    store.advanceNotificationBaseline.mockResolvedValue({ action: "unchanged", previousWeekStart: week.weekStart });
    store.getObservedFacts.mockResolvedValue(new Map());
    const { runChangeDetection } = await loadModule();

    await runChangeDetection({
      events: [event({ personId: "p1", date: week.weekStart, category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
    });

    const [changes] = store.applyPendingChanges.mock.calls[0].slice(1) as unknown as [Array<{ category: string; factKey: string }>];
    expect(changes.some((change) => change.factKey === `shift:p1:${week.weekStart}`)).toBe(true);
    expect(changes.some((change) => change.category.startsWith("emergency"))).toBe(false);
  });

  it("operationalGenerationTransitioned forces the SAME silent clear+reseed treatment as a week rollover -- no diff, no notification, even though the baseline RPC itself reports 'unchanged'", async () => {
    store.advanceNotificationBaseline.mockResolvedValue({ action: "unchanged", previousWeekStart: week.weekStart });
    const { runChangeDetection } = await loadModule();

    const summary = await runChangeDetection({
      events: [event({ personId: "p1", date: week.weekStart, category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
      operationalGenerationTransitioned: true,
    });

    expect(summary.baselineAction).toBe("rolled_over");
    expect(summary.semanticChangesDetected).toBe(0);
    expect(summary.jobsCreated).toBe(0);
    // Clears THIS week's own state (never a different week's -- there was
    // no real week rollover here, only a generation change).
    expect(store.clearWeekState).toHaveBeenCalledWith(week.weekStart);
    expect(store.seedObservedFacts).toHaveBeenCalledTimes(1);
    expect(store.getObservedFacts).not.toHaveBeenCalled();
    expect(store.insertNotificationJobIfAbsent).not.toHaveBeenCalled();
  });

  it("a generation transition happening on the SAME tick as a genuine week rollover still only clears/reseeds once, using the real previous week", async () => {
    store.peekBaselineState.mockResolvedValue({ initialized: true, currentWeekStart: "2026-08-09", updatedAt: "2026-08-09T00:00:00.000Z" });
    store.advanceNotificationBaseline.mockResolvedValue({ action: "rolled_over", previousWeekStart: "2026-08-09" });
    const { runChangeDetection } = await loadModule();

    await runChangeDetection({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
      operationalGenerationTransitioned: true,
    });

    expect(store.clearWeekState).toHaveBeenCalledWith("2026-08-09");
    expect(store.clearWeekState).toHaveBeenCalledTimes(1);
  });

  it("operationalGenerationTransitioned=false (the default) never forces a silent reset on an ordinary unchanged tick", async () => {
    store.advanceNotificationBaseline.mockResolvedValue({ action: "unchanged", previousWeekStart: week.weekStart });
    store.getObservedFacts.mockResolvedValue(new Map());
    const { runChangeDetection } = await loadModule();

    const summary = await runChangeDetection({
      events: [event({ personId: "p1", date: week.weekStart, category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      persist: true,
      recipientResolution: emptyResolution(),
      personNameById: new Map(),
    });

    expect(summary.baselineAction).toBe("unchanged");
    expect(store.clearWeekState).not.toHaveBeenCalled();
    expect(store.seedObservedFacts).not.toHaveBeenCalled();
  });
});
