import { afterEach, describe, expect, it, vi } from "vitest";

const peekAnyManagerScheduledBroadcastWorkDue = vi.fn();
const peekBaselineState = vi.fn();
const peekDueJobsCount = vi.fn();
const fetchFreshPersonnelRead = vi.fn();
const runDueScheduledBroadcastDispatch = vi.fn();
const runDelivery = vi.fn();
const loadNotificationRuleConfig = vi.fn();
const findDueCustomWeeklyOccurrences = vi.fn();
const runDueCustomWeeklyRuleDispatch = vi.fn();

vi.mock("./store", () => ({
  peekAnyManagerScheduledBroadcastWorkDue: (...args: unknown[]) => peekAnyManagerScheduledBroadcastWorkDue(...args),
  peekBaselineState: (...args: unknown[]) => peekBaselineState(...args),
  peekDueJobsCount: (...args: unknown[]) => peekDueJobsCount(...args),
}));
vi.mock("./freshRead", () => ({
  fetchFreshPersonnelRead: (...args: unknown[]) => fetchFreshPersonnelRead(...args),
}));
vi.mock("./scheduledBroadcast", () => ({
  runDueScheduledBroadcastDispatch: (...args: unknown[]) => runDueScheduledBroadcastDispatch(...args),
}));
vi.mock("./delivery", () => ({ runDelivery: (...args: unknown[]) => runDelivery(...args) }));
vi.mock("./ruleConfig", () => ({ loadNotificationRuleConfig: (...args: unknown[]) => loadNotificationRuleConfig(...args) }));
vi.mock("./recurringRuleDispatch", () => ({
  findDueCustomWeeklyOccurrences: (...args: unknown[]) => findDueCustomWeeklyOccurrences(...args),
  runDueCustomWeeklyRuleDispatch: (...args: unknown[]) => runDueCustomWeeklyRuleDispatch(...args),
}));

async function loadModule() {
  return import("./scheduledWorker");
}

const PEOPLE = [{ id: "p_1", name: "אחד", email: null, isManager: false, isTechnician: false, isSupervisor: false, personnelType: null }];

const ZERO_DELIVERY_SUMMARY = {
  jobsClaimed: 0,
  deliveriesSucceeded: 0,
  deliveriesFailedPermanent: 0,
  deliveriesFailedTransient: 0,
  subscriptionsRemoved: 0,
  jobsCompleted: 0,
  jobsFailed: 0,
  jobsSkipped: 0,
  jobsPending: 0,
};

/** Every test gets an empty rule config / zero due recurring occurrences unless it explicitly overrides one -- keeps the pre-existing scheduled-broadcast-only tests below untouched by this feature's addition. */
function setupRuleConfigDefaults() {
  peekBaselineState.mockResolvedValue({ initialized: true, currentWeekStart: "2026-08-16", updatedAt: "2026-08-16T00:00:00.000Z" });
  loadNotificationRuleConfig.mockResolvedValue({ systemRules: new Map(), customWeeklyRules: [] });
  findDueCustomWeeklyOccurrences.mockResolvedValue([]);
  runDueCustomWeeklyRuleDispatch.mockResolvedValue({ dispatched: 0, failed: 0 });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
});

describe("runScheduledBroadcastWorkerTick -- zero due/recoverable work", () => {
  it("fails closed before due-job delivery while the incident baseline still needs recovery", async () => {
    // This test models the fixed 2026-09-13 notification-flood incident
    // (see NOTIFICATION_FLOOD_INCIDENT in ./notificationFloodRecovery) --
    // the guard under test only fires while the REAL current operational
    // week (getJerusalemLocalNow() -> getOperationalWeek()) is that exact
    // incident week, so the system clock must be frozen inside it or this
    // guard silently stops triggering once the real calendar moves past
    // 2026-09-19 and the test falls through into the (deliberately
    // unmocked, in this test) fetchFreshPersonnelRead() stage instead.
    // 2026-09-15T08:00:00Z is 11:00 in Asia/Jerusalem (UTC+3, DST) on
    // 2026-09-15 -- a Tuesday inside the Sunday-based incident week
    // ("2026-09-13" .. "2026-09-19"), comfortably clear of either edge.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T08:00:00.000Z"));

    setupRuleConfigDefaults();
    peekBaselineState.mockResolvedValue({
      initialized: true,
      currentWeekStart: "2026-09-13",
      updatedAt: "2026-09-12T21:05:00.000Z",
    });

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    const summary = await runScheduledBroadcastWorkerTick();

    expect(summary.skipped).toBe(true);
    expect(peekAnyManagerScheduledBroadcastWorkDue).not.toHaveBeenCalled();
    expect(peekDueJobsCount).not.toHaveBeenCalled();
    expect(runDelivery).not.toHaveBeenCalled();
    expect(fetchFreshPersonnelRead).not.toHaveBeenCalled();
  });

  it("performs NO personnel read, NO dispatch, and NO delivery when ALL THREE pre-checks find nothing (true no-op)", async () => {
    setupRuleConfigDefaults();
    peekAnyManagerScheduledBroadcastWorkDue.mockResolvedValue(0);
    peekDueJobsCount.mockResolvedValue(0);

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    const summary = await runScheduledBroadcastWorkerTick();

    expect(summary.skipped).toBe(true);
    expect(summary.scheduledBroadcastsDue).toBe(0);
    expect(summary.scheduledBroadcastsDispatched).toBe(0);
    expect(summary.scheduledBroadcastsFailed).toBe(0);
    expect(summary.recurringRulesDispatched).toBe(0);
    expect(summary.recurringRulesFailed).toBe(0);
    expect(summary.jobsClaimed).toBe(0);
    expect(fetchFreshPersonnelRead).not.toHaveBeenCalled();
    expect(runDueScheduledBroadcastDispatch).not.toHaveBeenCalled();
    expect(runDueCustomWeeklyRuleDispatch).not.toHaveBeenCalled();
    expect(runDelivery).not.toHaveBeenCalled();
  });
});

describe("runScheduledBroadcastWorkerTick -- due/recoverable scheduled broadcast exists", () => {
  it("fetches personnel ONLY (never schedule/settings), dispatches, then runs delivery in the SAME invocation", async () => {
    setupRuleConfigDefaults();
    peekAnyManagerScheduledBroadcastWorkDue.mockResolvedValue(1);
    peekDueJobsCount.mockResolvedValue(0);
    fetchFreshPersonnelRead.mockResolvedValue({ people: PEOPLE, fetchedAt: "2026-08-21T17:32:00.000Z" });

    const callOrder: string[] = [];
    runDueScheduledBroadcastDispatch.mockImplementation(async () => {
      callOrder.push("dispatch");
      return { claimed: 2, dispatched: 1, failed: 1 };
    });
    runDelivery.mockImplementation(async () => {
      callOrder.push("delivery");
      return { ...ZERO_DELIVERY_SUMMARY, jobsClaimed: 4 };
    });

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    const summary = await runScheduledBroadcastWorkerTick();

    expect(fetchFreshPersonnelRead).toHaveBeenCalledTimes(1);
    expect(runDueScheduledBroadcastDispatch).toHaveBeenCalledWith(PEOPLE);
    expect(callOrder).toEqual(["dispatch", "delivery"]);
    expect(summary).toEqual({
      skipped: false,
      scheduledBroadcastsDue: 2,
      scheduledBroadcastsDispatched: 1,
      scheduledBroadcastsFailed: 1,
      recurringRulesDispatched: 0,
      recurringRulesFailed: 0,
      jobsClaimed: 4,
      durationMs: expect.any(Number),
    });
  });

  it("never calls runDelivery before dispatch has been claimed -- freshly-created jobs must exist before delivery tries to claim them", async () => {
    setupRuleConfigDefaults();
    peekAnyManagerScheduledBroadcastWorkDue.mockResolvedValue(1);
    peekDueJobsCount.mockResolvedValue(0);
    fetchFreshPersonnelRead.mockResolvedValue({ people: PEOPLE, fetchedAt: "2026-08-21T17:32:00.000Z" });
    runDueScheduledBroadcastDispatch.mockResolvedValue({ claimed: 1, dispatched: 1, failed: 0 });
    runDelivery.mockResolvedValue(ZERO_DELIVERY_SUMMARY);

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    await runScheduledBroadcastWorkerTick();

    const dispatchOrder = runDueScheduledBroadcastDispatch.mock.invocationCallOrder[0];
    const deliveryOrder = runDelivery.mock.invocationCallOrder[0];
    expect(dispatchOrder).toBeLessThan(deliveryOrder);
  });

  it("still fetches personnel/dispatches/delivers even when due notification jobs ALSO exist alongside the scheduled broadcast", async () => {
    setupRuleConfigDefaults();
    peekAnyManagerScheduledBroadcastWorkDue.mockResolvedValue(1);
    peekDueJobsCount.mockResolvedValue(3);
    fetchFreshPersonnelRead.mockResolvedValue({ people: PEOPLE, fetchedAt: "2026-08-21T17:32:00.000Z" });
    runDueScheduledBroadcastDispatch.mockResolvedValue({ claimed: 1, dispatched: 1, failed: 0 });
    runDelivery.mockResolvedValue({ ...ZERO_DELIVERY_SUMMARY, jobsClaimed: 4 });

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    const summary = await runScheduledBroadcastWorkerTick();

    expect(fetchFreshPersonnelRead).toHaveBeenCalledTimes(1);
    expect(runDueScheduledBroadcastDispatch).toHaveBeenCalledTimes(1);
    expect(runDelivery).toHaveBeenCalledTimes(1);
    expect(summary.skipped).toBe(false);
    expect(summary.jobsClaimed).toBe(4);
  });
});

describe("runScheduledBroadcastWorkerTick -- due custom weekly recurring rule occurrence exists", () => {
  it("fetches personnel, dispatches the recurring rule (no scheduled-broadcast dispatch), then runs delivery", async () => {
    peekAnyManagerScheduledBroadcastWorkDue.mockResolvedValue(0);
    peekDueJobsCount.mockResolvedValue(0);
    loadNotificationRuleConfig.mockResolvedValue({ systemRules: new Map(), customWeeklyRules: [{ id: "rule-1" }] });
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    findDueCustomWeeklyOccurrences.mockResolvedValue([occurrence]);
    fetchFreshPersonnelRead.mockResolvedValue({ people: PEOPLE, fetchedAt: "2026-08-22T18:00:00.000Z" });

    const callOrder: string[] = [];
    runDueCustomWeeklyRuleDispatch.mockImplementation(async () => {
      callOrder.push("recurring");
      return { dispatched: 1, failed: 0 };
    });
    runDelivery.mockImplementation(async () => {
      callOrder.push("delivery");
      return { ...ZERO_DELIVERY_SUMMARY, jobsClaimed: 3 };
    });

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    const summary = await runScheduledBroadcastWorkerTick();

    expect(fetchFreshPersonnelRead).toHaveBeenCalledTimes(1);
    expect(runDueScheduledBroadcastDispatch).not.toHaveBeenCalled();
    expect(runDueCustomWeeklyRuleDispatch).toHaveBeenCalledWith([occurrence], PEOPLE);
    expect(callOrder).toEqual(["recurring", "delivery"]);
    expect(summary).toEqual({
      skipped: false,
      scheduledBroadcastsDue: 0,
      scheduledBroadcastsDispatched: 0,
      scheduledBroadcastsFailed: 0,
      recurringRulesDispatched: 1,
      recurringRulesFailed: 0,
      jobsClaimed: 3,
      durationMs: expect.any(Number),
    });
  });

  it("dispatches BOTH a due scheduled broadcast and a due recurring-rule occurrence in the same tick", async () => {
    peekAnyManagerScheduledBroadcastWorkDue.mockResolvedValue(1);
    peekDueJobsCount.mockResolvedValue(0);
    loadNotificationRuleConfig.mockResolvedValue({ systemRules: new Map(), customWeeklyRules: [{ id: "rule-1" }] });
    findDueCustomWeeklyOccurrences.mockResolvedValue([{ ruleId: "rule-1", occurrenceDate: "2026-08-22" }]);
    fetchFreshPersonnelRead.mockResolvedValue({ people: PEOPLE, fetchedAt: "2026-08-22T18:00:00.000Z" });
    runDueScheduledBroadcastDispatch.mockResolvedValue({ claimed: 1, dispatched: 1, failed: 0 });
    runDueCustomWeeklyRuleDispatch.mockResolvedValue({ dispatched: 1, failed: 0 });
    runDelivery.mockResolvedValue(ZERO_DELIVERY_SUMMARY);

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    const summary = await runScheduledBroadcastWorkerTick();

    expect(fetchFreshPersonnelRead).toHaveBeenCalledTimes(1);
    expect(runDueScheduledBroadcastDispatch).toHaveBeenCalledTimes(1);
    expect(runDueCustomWeeklyRuleDispatch).toHaveBeenCalledTimes(1);
    expect(summary.scheduledBroadcastsDispatched).toBe(1);
    expect(summary.recurringRulesDispatched).toBe(1);
  });

  it("a rule-config/lookup failure for recurring rules never blocks scheduled-broadcast dispatch or delivery -- isolated, fail-safe, logged", async () => {
    peekAnyManagerScheduledBroadcastWorkDue.mockResolvedValue(1);
    peekDueJobsCount.mockResolvedValue(0);
    loadNotificationRuleConfig.mockRejectedValue(new Error("boom"));
    fetchFreshPersonnelRead.mockResolvedValue({ people: PEOPLE, fetchedAt: "2026-08-22T18:00:00.000Z" });
    runDueScheduledBroadcastDispatch.mockResolvedValue({ claimed: 1, dispatched: 1, failed: 0 });
    runDelivery.mockResolvedValue(ZERO_DELIVERY_SUMMARY);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    const summary = await runScheduledBroadcastWorkerTick();

    expect(runDueScheduledBroadcastDispatch).toHaveBeenCalledTimes(1);
    expect(runDelivery).toHaveBeenCalledTimes(1);
    expect(summary.scheduledBroadcastsDispatched).toBe(1);
    expect(summary.recurringRulesDispatched).toBe(0);
    expect(runDueCustomWeeklyRuleDispatch).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

describe("runScheduledBroadcastWorkerTick -- NO scheduled broadcast/recurring occurrence but due notification jobs exist (stranded-job recovery)", () => {
  it("skips the personnel read and scheduled-broadcast/recurring dispatch entirely, and calls runDelivery() directly", async () => {
    setupRuleConfigDefaults();
    peekAnyManagerScheduledBroadcastWorkDue.mockResolvedValue(0);
    peekDueJobsCount.mockResolvedValue(13);
    runDelivery.mockResolvedValue({ ...ZERO_DELIVERY_SUMMARY, jobsClaimed: 13 });

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    const summary = await runScheduledBroadcastWorkerTick();

    expect(fetchFreshPersonnelRead).not.toHaveBeenCalled();
    expect(runDueScheduledBroadcastDispatch).not.toHaveBeenCalled();
    expect(runDueCustomWeeklyRuleDispatch).not.toHaveBeenCalled();
    expect(runDelivery).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({
      skipped: false,
      scheduledBroadcastsDue: 0,
      scheduledBroadcastsDispatched: 0,
      scheduledBroadcastsFailed: 0,
      recurringRulesDispatched: 0,
      recurringRulesFailed: 0,
      jobsClaimed: 13,
      durationMs: expect.any(Number),
    });
  });

  it("a due recurring-rule occurrence ALSO counts as recoverable work -- does NOT take the stranded-job-only shortcut", async () => {
    peekAnyManagerScheduledBroadcastWorkDue.mockResolvedValue(0);
    peekDueJobsCount.mockResolvedValue(0);
    loadNotificationRuleConfig.mockResolvedValue({ systemRules: new Map(), customWeeklyRules: [{ id: "rule-1" }] });
    findDueCustomWeeklyOccurrences.mockResolvedValue([{ ruleId: "rule-1", occurrenceDate: "2026-08-22" }]);
    fetchFreshPersonnelRead.mockResolvedValue({ people: PEOPLE, fetchedAt: "2026-08-22T18:00:00.000Z" });
    runDueCustomWeeklyRuleDispatch.mockResolvedValue({ dispatched: 1, failed: 0 });
    runDelivery.mockResolvedValue(ZERO_DELIVERY_SUMMARY);

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    const summary = await runScheduledBroadcastWorkerTick();

    expect(summary.skipped).toBe(false);
    expect(fetchFreshPersonnelRead).toHaveBeenCalledTimes(1);
    expect(runDueScheduledBroadcastDispatch).not.toHaveBeenCalled();
    expect(runDueCustomWeeklyRuleDispatch).toHaveBeenCalledTimes(1);
  });
});

describe("runScheduledBroadcastWorkerTick -- concurrency/idempotency assumptions remain delegated", () => {
  it("never claims jobs itself -- delegates entirely to runDelivery()'s own claim_due_notification_jobs call, both in the dispatch path and the stranded-job recovery path", async () => {
    setupRuleConfigDefaults();
    peekAnyManagerScheduledBroadcastWorkDue.mockResolvedValue(0);
    peekDueJobsCount.mockResolvedValue(1);
    runDelivery.mockResolvedValue(ZERO_DELIVERY_SUMMARY);

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    await runScheduledBroadcastWorkerTick();

    // This module holds no claim/lock logic of its own -- `runDelivery()` is
    // the ONLY place a due job is ever claimed, exactly as before this fix.
    expect(runDelivery).toHaveBeenCalledWith();
  });
});

describe("runScheduledBroadcastWorkerTick -- PII-safe summary shape", () => {
  it("the returned summary is counts/booleans/duration only -- no name, email, title, or body field", async () => {
    setupRuleConfigDefaults();
    peekAnyManagerScheduledBroadcastWorkDue.mockResolvedValue(1);
    peekDueJobsCount.mockResolvedValue(0);
    fetchFreshPersonnelRead.mockResolvedValue({ people: PEOPLE, fetchedAt: "2026-08-21T17:32:00.000Z" });
    runDueScheduledBroadcastDispatch.mockResolvedValue({ claimed: 1, dispatched: 1, failed: 0 });
    runDelivery.mockResolvedValue(ZERO_DELIVERY_SUMMARY);

    const { runScheduledBroadcastWorkerTick } = await loadModule();
    const summary = await runScheduledBroadcastWorkerTick();

    for (const value of Object.values(summary)) {
      expect(typeof value === "number" || typeof value === "boolean").toBe(true);
    }
  });
});
