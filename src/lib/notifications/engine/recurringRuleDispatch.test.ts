import { afterEach, describe, expect, it, vi } from "vitest";
import type { Person } from "@/lib/domain/types";
import type { LocalNow } from "@/lib/domain/localNow";
import type { CustomWeeklyRuleConfig } from "./ruleConfig";

/**
 * A stateful, in-memory fake that faithfully mirrors
 * `claim_notification_rule_occurrence`'s own real semantics (see the
 * migration's doc comment):
 *
 *  - Fresh claim: requires the LOCKED rule row to currently be
 *    enabled/not-archived, AND revalidates the rule's CURRENT weekday and
 *    CURRENT local due-time against an injectable "wall clock" (never the
 *    possibly-stale in-memory candidate that triggered this claim
 *    attempt) -- closing the schedule-edit-before-claim race. On success,
 *    the rule's content is copied into the occurrence's own FROZEN
 *    snapshot ONCE, at this instant.
 *  - Resume (existing row, lease stale): returns ONLY the occurrence's
 *    own already-frozen snapshot -- this branch never reads `rules` again,
 *    so a rule mutated (or even deleted from this fake's `rules` map)
 *    between claim and resume cannot leak into the resumed dispatch.
 *  - Refuse while actively leased; refuse forever once completed.
 *
 * This lets these tests exercise genuine multi-tick crash-recovery
 * scenarios against the SAME state machine the real SQL implements --
 * what it CANNOT prove is Postgres-level transactional atomicity itself
 * (row locking, `for update`, concurrent commit ordering), which has no
 * live Postgres available in this environment; see
 * `notificationRulesMigration.test.ts` for the SQL's own text-level shape
 * checks instead.
 */
function createFakeClaimStore() {
  interface RuleState {
    enabled: boolean;
    archived: boolean;
    weekday: number;
    localHour: number;
    localMinute: number;
    title: string;
    body: string;
    audienceKind: "everyone" | "person" | "people" | "groups";
    targetPersonIds: string[];
    audienceGroupKeys: string[];
    excludedPersonIds: string[];
    createdByPersonId: string | null;
    createdByPersonName: string | null;
  }
  interface FrozenSnapshot {
    title: string;
    body: string;
    audienceKind: "everyone" | "person" | "people" | "groups";
    targetPersonIds: string[];
    audienceGroupKeys: string[];
    excludedPersonIds: string[];
    createdByPersonId: string | null;
    createdByPersonName: string | null;
  }
  interface OccurrenceState {
    id: string;
    status: "claimed" | "completed";
    batchId: string | null;
    claimedAtMs: number;
    frozen: FrozenSnapshot;
  }

  const rules = new Map<string, RuleState>();
  const occurrences = new Map<string, OccurrenceState>();
  let occurrenceCounter = 0;
  const LEASE_MS = 90_000;
  /** The "current wall-clock local time" the fresh-claim path revalidates against -- null means "always due" (skip the check) so tests that don't care about this race don't need to set it. */
  let wallClock: { occurrenceDate: string; minuteOfDay: number } | null = null;

  function setRule(ruleId: string, state: RuleState) {
    rules.set(ruleId, state);
  }

  function setWallClock(occurrenceDate: string, minuteOfDay: number) {
    wallClock = { occurrenceDate, minuteOfDay };
  }

  /** Sunday=0..Saturday=6, matching `dayOfWeek()`'s own convention. */
  function weekdayOfDate(dateStr: string): number {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  }

  async function claim(ruleId: string, occurrenceDate: string, nowMs = Date.now()) {
    const key = `${ruleId}:${occurrenceDate}`;
    const existing = occurrences.get(key);

    if (existing) {
      if (existing.status === "completed") return null;
      if (nowMs - existing.claimedAtMs < LEASE_MS) return null; // actively leased by "someone else"
      // Stale -- resume UNCONDITIONALLY, independent of the rule's
      // current state, and NEVER re-reads `rules`.
      existing.claimedAtMs = nowMs;
      return {
        occurrenceId: existing.id,
        batchId: existing.batchId,
        isResume: true,
        ruleTitle: existing.frozen.title,
        ruleBody: existing.frozen.body,
        ruleAudienceKind: existing.frozen.audienceKind,
        ruleTargetPersonIds: existing.frozen.targetPersonIds,
        ruleAudienceGroupKeys: existing.frozen.audienceGroupKeys,
        ruleExcludedPersonIds: existing.frozen.excludedPersonIds,
        createdByPersonId: existing.frozen.createdByPersonId,
        createdByPersonName: existing.frozen.createdByPersonName,
      };
    }

    const rule = rules.get(ruleId);
    if (!rule || !rule.enabled || rule.archived) return null; // fresh claim requires currently-enabled, un-archived
    if (rule.weekday !== weekdayOfDate(occurrenceDate)) return null; // CURRENT weekday revalidation
    if (wallClock && wallClock.occurrenceDate === occurrenceDate) {
      const dueMinuteOfDay = rule.localHour * 60 + rule.localMinute;
      if (wallClock.minuteOfDay < dueMinuteOfDay) return null; // CURRENT local-time revalidation
    }

    occurrenceCounter += 1;
    const frozen: FrozenSnapshot = {
      title: rule.title,
      body: rule.body,
      audienceKind: rule.audienceKind,
      targetPersonIds: [...rule.targetPersonIds],
      audienceGroupKeys: [...rule.audienceGroupKeys],
      excludedPersonIds: [...rule.excludedPersonIds],
      createdByPersonId: rule.createdByPersonId,
      createdByPersonName: rule.createdByPersonName,
    };
    const created: OccurrenceState = { id: `occ-${occurrenceCounter}`, status: "claimed", batchId: null, claimedAtMs: nowMs, frozen };
    occurrences.set(key, created);
    return {
      occurrenceId: created.id,
      batchId: null,
      isResume: false,
      ruleTitle: frozen.title,
      ruleBody: frozen.body,
      ruleAudienceKind: frozen.audienceKind,
      ruleTargetPersonIds: frozen.targetPersonIds,
      ruleAudienceGroupKeys: frozen.audienceGroupKeys,
      ruleExcludedPersonIds: frozen.excludedPersonIds,
      createdByPersonId: frozen.createdByPersonId,
      createdByPersonName: frozen.createdByPersonName,
    };
  }

  async function setBatchId(occurrenceId: string, batchId: string) {
    for (const occurrence of occurrences.values()) {
      if (occurrence.id === occurrenceId && occurrence.batchId === null) occurrence.batchId = batchId;
    }
  }

  async function complete(occurrenceId: string) {
    for (const occurrence of occurrences.values()) {
      if (occurrence.id === occurrenceId && occurrence.status === "claimed") occurrence.status = "completed";
    }
  }

  function statusOf(ruleId: string, occurrenceDate: string) {
    return occurrences.get(`${ruleId}:${occurrenceDate}`)?.status ?? null;
  }

  function expireLease(ruleId: string, occurrenceDate: string) {
    const occurrence = occurrences.get(`${ruleId}:${occurrenceDate}`);
    if (occurrence) occurrence.claimedAtMs -= LEASE_MS + 1000;
  }

  function listRecoverable(leaseSeconds = 90, nowMs = Date.now()) {
    const staleBeforeMs = nowMs - leaseSeconds * 1000;
    const result: { ruleId: string; occurrenceDate: string }[] = [];
    for (const [key, occurrence] of occurrences) {
      if (occurrence.status !== "claimed") continue;
      if (occurrence.claimedAtMs >= staleBeforeMs) continue;
      const separatorIndex = key.lastIndexOf(":");
      result.push({ ruleId: key.slice(0, separatorIndex), occurrenceDate: key.slice(separatorIndex + 1) });
    }
    return result;
  }

  return { setRule, setWallClock, claim, setBatchId, complete, statusOf, expireLease, listRecoverable, rules };
}

/** Converts a `CustomWeeklyRuleConfig` (the shape `findDueCustomWeeklyOccurrences` due-checks against) into the claim store's own rule-state shape, so tests don't have to hand-duplicate every field twice. */
function registerRule(claimStore: ReturnType<typeof createFakeClaimStore>, config: CustomWeeklyRuleConfig, archived = false) {
  claimStore.setRule(config.id, {
    enabled: config.enabled,
    archived,
    weekday: config.weekday,
    localHour: config.localHour,
    localMinute: config.localMinute,
    title: config.title,
    body: config.body,
    audienceKind: config.audienceKind,
    targetPersonIds: [...config.targetPersonIds],
    audienceGroupKeys: [],
    excludedPersonIds: [],
    createdByPersonId: config.createdByPersonId,
    createdByPersonName: config.createdByPersonName,
  });
}

/** A stateful fake for `manager_notification_batches`, keyed by idempotency_key (matching the real table's unique constraint) -- lets a resumed dispatch genuinely find its own earlier-created batch. */
function createFakeBatchStore() {
  const byIdempotencyKey = new Map<string, Record<string, unknown>>();
  const byId = new Map<string, Record<string, unknown>>();
  let counter = 0;

  async function insertIfAbsent(batch: Record<string, unknown>) {
    const key = batch.idempotencyKey as string;
    const existing = byIdempotencyKey.get(key);
    if (existing) return { row: existing, created: false };

    counter += 1;
    const row = { id: `batch-${counter}`, ...batch };
    byIdempotencyKey.set(key, row);
    byId.set(row.id, row);
    return { row, created: true };
  }

  async function getById(id: string) {
    return byId.get(id) ?? null;
  }

  return { insertIfAbsent, getById, byIdempotencyKey };
}

/** A stateful fake for `notification_jobs`, keyed by dedupe_key -- can be configured to throw for specific keys to simulate a crash mid-job-creation (recovery scenario B). */
function createFakeJobStore() {
  const created = new Set<string>();
  const failingKeys = new Set<string>();

  async function insertIfAbsent(job: { dedupeKey: string }) {
    if (failingKeys.has(job.dedupeKey)) throw new Error(`fake: simulated crash creating job ${job.dedupeKey}`);
    if (created.has(job.dedupeKey)) return false;
    created.add(job.dedupeKey);
    return true;
  }

  return { insertIfAbsent, created, failingKeys };
}

const fetchAllUserIdsByEmail = vi.fn<() => Promise<Map<string, { userId: string; avatarUrl: string | null }>>>(
  async () => new Map(),
);
const fetchAllSubscribedUserIds = vi.fn<() => Promise<string[]>>(async () => []);

let claimStore = createFakeClaimStore();
let batchStore = createFakeBatchStore();
let jobStore = createFakeJobStore();

async function loadModule() {
  vi.doMock("./store", () => ({
    claimNotificationRuleOccurrence: (ruleId: string, occurrenceDate: string) => claimStore.claim(ruleId, occurrenceDate),
    setNotificationRuleOccurrenceBatchId: (occurrenceId: string, batchId: string) => claimStore.setBatchId(occurrenceId, batchId),
    completeNotificationRuleOccurrence: (occurrenceId: string) => claimStore.complete(occurrenceId),
    listCompletedNotificationRuleOccurrenceKeys: async (candidates: { ruleId: string; occurrenceDate: string }[]) => {
      const result = new Set<string>();
      for (const candidate of candidates) {
        if (claimStore.statusOf(candidate.ruleId, candidate.occurrenceDate) === "completed") {
          result.add(`${candidate.ruleId}:${candidate.occurrenceDate}`);
        }
      }
      return result;
    },
    listRecoverableNotificationRuleOccurrences: async (leaseSeconds?: number) => claimStore.listRecoverable(leaseSeconds),
    insertManagerNotificationBatchIfAbsent: (batch: Record<string, unknown>) => batchStore.insertIfAbsent(batch),
    getManagerNotificationBatchById: (id: string) => batchStore.getById(id),
    insertNotificationJobIfAbsent: (job: { dedupeKey: string }) => jobStore.insertIfAbsent(job),
  }));
  vi.doMock("./recipients", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./recipients")>();
    return { ...actual, fetchAllUserIdsByEmail, fetchAllSubscribedUserIds };
  });
  return import("./recurringRuleDispatch");
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  claimStore = createFakeClaimStore();
  batchStore = createFakeBatchStore();
  jobStore = createFakeJobStore();
});

function rule(overrides: Partial<CustomWeeklyRuleConfig> = {}): CustomWeeklyRuleConfig {
  return {
    id: "rule-1",
    enabled: true,
    weekday: 6, // Saturday
    localHour: 21,
    localMinute: 0,
    title: "📌 תזכורת לאילוצים",
    body: "body",
    audienceKind: "everyone",
    targetPersonIds: [],
    createdByPersonId: "mgr-1",
    createdByPersonName: "מנהל",
    ...overrides,
  };
}

function person(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    isManager: false,
    isTechnician: false,
    isSupervisor: false,
    personnelType: null,
    dischargeDate: null,
    enlistmentDate: null,
    ...overrides,
  };
}

describe("findDueCustomWeeklyOccurrences -- weekday/time due check", () => {
  it("is due once the configured weekday's configured time has passed", async () => {
    const { findDueCustomWeeklyOccurrences } = await loadModule();
    const saturday2100 = rule({ weekday: 6, localHour: 21, localMinute: 0 });
    const now: LocalNow = { date: "2026-08-22", minuteOfDay: 21 * 60 };

    const due = await findDueCustomWeeklyOccurrences([saturday2100], now);

    expect(due).toEqual([{ ruleId: "rule-1", occurrenceDate: "2026-08-22" }]);
  });

  it("is NOT due before the configured time on the correct weekday", async () => {
    const { findDueCustomWeeklyOccurrences } = await loadModule();
    const saturday2100 = rule({ weekday: 6, localHour: 21, localMinute: 0 });
    const now: LocalNow = { date: "2026-08-22", minuteOfDay: 20 * 60 + 59 };

    expect(await findDueCustomWeeklyOccurrences([saturday2100], now)).toEqual([]);
  });

  it("is NOT due on a different weekday, even at/after the configured time", async () => {
    const { findDueCustomWeeklyOccurrences } = await loadModule();
    const saturday2100 = rule({ weekday: 6, localHour: 21, localMinute: 0 });
    const now: LocalNow = { date: "2026-08-23", minuteOfDay: 22 * 60 }; // Sunday

    expect(await findDueCustomWeeklyOccurrences([saturday2100], now)).toEqual([]);
  });

  it("a disabled rule is never due, even on its configured weekday/time", async () => {
    const { findDueCustomWeeklyOccurrences } = await loadModule();
    const now: LocalNow = { date: "2026-08-22", minuteOfDay: 21 * 60 };

    expect(await findDueCustomWeeklyOccurrences([rule({ enabled: false })], now)).toEqual([]);
  });

  it("merges in RECOVERABLE (stale-leased) occurrences even when no rule is freshly due -- Blocker 1: recovery must not depend on current rule due-matching", async () => {
    registerRule(claimStore, rule({ id: "rule-1" }));
    // Claim it fresh (simulating an earlier tick), then let its lease go stale.
    await claimStore.claim("rule-1", "2026-08-22");
    claimStore.expireLease("rule-1", "2026-08-22");

    const { findDueCustomWeeklyOccurrences } = await loadModule();
    // No rule is freshly due right now (wrong weekday for "today").
    const now: LocalNow = { date: "2026-08-23", minuteOfDay: 12 * 60 }; // Sunday -- rule-1 is Saturday-only
    const due = await findDueCustomWeeklyOccurrences([rule({ id: "rule-1" })], now);

    expect(due).toEqual([{ ruleId: "rule-1", occurrenceDate: "2026-08-22" }]);
  });

  it("a recoverable occurrence already 'completed' by the time it's re-checked is filtered out, never re-attempted", async () => {
    registerRule(claimStore, rule({ id: "rule-1" }));
    const claimed = await claimStore.claim("rule-1", "2026-08-22");
    if (claimed) await claimStore.complete(claimed.occurrenceId);
    claimStore.expireLease("rule-1", "2026-08-22"); // stale-looking claimed_at, but status is already 'completed'

    const { findDueCustomWeeklyOccurrences } = await loadModule();
    const now: LocalNow = { date: "2026-08-23", minuteOfDay: 12 * 60 };
    const due = await findDueCustomWeeklyOccurrences([rule({ id: "rule-1" })], now);

    expect(due).toEqual([]);
  });
});

describe("runDueCustomWeeklyRuleDispatch -- fresh dispatch + audience resolution", () => {
  it("'everyone' resolves against the CURRENT roster passed in, never a frozen snapshot on the rule itself", async () => {
    registerRule(claimStore, rule({ audienceKind: "everyone", targetPersonIds: [] }));
    fetchAllUserIdsByEmail.mockResolvedValue(
      new Map([
        ["a@example.com", { userId: "user-a", avatarUrl: null }],
        ["b@example.com", { userId: "user-b", avatarUrl: null }],
      ]),
    );
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();

    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const people = [person("p_a", { email: "a@example.com" }), person("p_b", { email: "b@example.com" })];
    const summary = await runDueCustomWeeklyRuleDispatch([occurrence], people);

    expect(summary).toEqual({ dispatched: 1, failed: 0 });
    expect(jobStore.created).toEqual(new Set(["recurring:batch-1:user-a", "recurring:batch-1:user-b"]));
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBe("completed");
  });

  it("selected 'people' audience is revalidated against the current roster -- a stale id is skipped truthfully, never fails the whole occurrence", async () => {
    registerRule(claimStore, rule({ audienceKind: "people", targetPersonIds: ["p_a", "p_removed"] }));
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();

    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const summary = await runDueCustomWeeklyRuleDispatch([occurrence], [person("p_a", { email: "a@example.com" })]);

    expect(summary).toEqual({ dispatched: 1, failed: 0 });
    expect(jobStore.created).toEqual(new Set(["recurring:batch-1:user-a"]));
  });

  it("'groups' audience resolves membership fresh against the CURRENT roster passed to dispatch, never a frozen id list -- the frozen keys are just the manager's own selection", async () => {
    claimStore.setRule("rule-1", {
      enabled: true,
      archived: false,
      weekday: 6,
      localHour: 21,
      localMinute: 0,
      title: "כותרת",
      body: "גוף",
      audienceKind: "groups",
      targetPersonIds: [],
      audienceGroupKeys: ["permanent"],
      excludedPersonIds: [],
      createdByPersonId: "mgr-1",
      createdByPersonName: "מנהל",
    });
    fetchAllUserIdsByEmail.mockResolvedValue(
      new Map([
        ["a@example.com", { userId: "user-a", avatarUrl: null }],
        ["b@example.com", { userId: "user-b", avatarUrl: null }],
      ]),
    );
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();

    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const people = [
      person("p_a", { email: "a@example.com", personnelType: "קבע" }),
      person("p_b", { email: "b@example.com", personnelType: "חובה" }),
    ];
    const summary = await runDueCustomWeeklyRuleDispatch([occurrence], people);

    expect(summary).toEqual({ dispatched: 1, failed: 0 });
    // Only the permanent (קבע) person -- p_b (חובה) never matches the group.
    expect(jobStore.created).toEqual(new Set(["recurring:batch-1:user-a"]));
  });

  it("excludedPersonIds (frozen at claim time) always wins over the resolved audience on every occurrence dispatch", async () => {
    claimStore.setRule("rule-1", {
      enabled: true,
      archived: false,
      weekday: 6,
      localHour: 21,
      localMinute: 0,
      title: "כותרת",
      body: "גוף",
      audienceKind: "everyone",
      targetPersonIds: [],
      audienceGroupKeys: [],
      excludedPersonIds: ["p_a"],
      createdByPersonId: "mgr-1",
      createdByPersonName: "מנהל",
    });
    fetchAllUserIdsByEmail.mockResolvedValue(
      new Map([
        ["a@example.com", { userId: "user-a", avatarUrl: null }],
        ["b@example.com", { userId: "user-b", avatarUrl: null }],
      ]),
    );
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();

    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const people = [person("p_a", { email: "a@example.com" }), person("p_b", { email: "b@example.com" })];
    const summary = await runDueCustomWeeklyRuleDispatch([occurrence], people);

    expect(summary).toEqual({ dispatched: 1, failed: 0 });
    expect(jobStore.created).toEqual(new Set(["recurring:batch-1:user-b"]));
  });

  it("zero due occurrences performs zero I/O", async () => {
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    expect(await runDueCustomWeeklyRuleDispatch([], [])).toEqual({ dispatched: 0, failed: 0 });
    expect(fetchAllUserIdsByEmail).not.toHaveBeenCalled();
  });
});

describe("crash-recovery scenarios (the reviewed hole this design fixes)", () => {
  it("A. crash after occurrence/batch creation, before ANY jobs: a later tick recovers and creates every intended job exactly once", async () => {
    registerRule(claimStore, rule());
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    // Simulate "crash before any jobs": make every job insert fail on this first attempt.
    jobStore.failingKeys.add("recurring:batch-1:user-a");
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const people = [person("p_a", { email: "a@example.com" })];

    const first = await runDueCustomWeeklyRuleDispatch([occurrence], people);
    expect(first).toEqual({ dispatched: 0, failed: 1 });
    // The batch WAS created and checkpointed even though the job insert crashed.
    expect(batchStore.byIdempotencyKey.get("recurring:rule-1:2026-08-22")).toBeTruthy();
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBe("claimed"); // not yet completed

    // Next tick: lease has NOT expired yet, so an immediate retry (same
    // worker's own retry loop, or a wholly different tick within the
    // 90s lease) correctly still finds it actively claimed and skips --
    // proving this is NOT a busy-retry loop that could double-send.
    const immediateRetry = await runDueCustomWeeklyRuleDispatch([occurrence], people);
    expect(immediateRetry).toEqual({ dispatched: 0, failed: 0 });

    // Now let the lease go stale (simulating enough real time passing)
    // and stop simulating the crash -- the SAME occurrence resumes and
    // completes.
    claimStore.expireLease("rule-1", "2026-08-22");
    jobStore.failingKeys.delete("recurring:batch-1:user-a");
    const resumed = await runDueCustomWeeklyRuleDispatch([occurrence], people);

    expect(resumed).toEqual({ dispatched: 1, failed: 0 });
    expect(jobStore.created).toEqual(new Set(["recurring:batch-1:user-a"]));
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBe("completed");
    // Exactly ONE batch was ever created for this occurrence, never a second one.
    expect(batchStore.byIdempotencyKey.size).toBe(1);
  });

  it("B. partial job creation: recipient A's job exists, recipient B's insertion crashes -- a retry creates B without duplicating A", async () => {
    registerRule(claimStore, rule());
    fetchAllUserIdsByEmail.mockResolvedValue(
      new Map([
        ["a@example.com", { userId: "user-a", avatarUrl: null }],
        ["b@example.com", { userId: "user-b", avatarUrl: null }],
      ]),
    );
    jobStore.failingKeys.add("recurring:batch-1:user-b");
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const people = [person("p_a", { email: "a@example.com" }), person("p_b", { email: "b@example.com" })];

    const first = await runDueCustomWeeklyRuleDispatch([occurrence], people);
    expect(first).toEqual({ dispatched: 0, failed: 1 });
    expect(jobStore.created).toEqual(new Set(["recurring:batch-1:user-a"])); // A succeeded, B did not
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBe("claimed");

    claimStore.expireLease("rule-1", "2026-08-22");
    jobStore.failingKeys.delete("recurring:batch-1:user-b");
    const resumed = await runDueCustomWeeklyRuleDispatch([occurrence], people);

    expect(resumed).toEqual({ dispatched: 1, failed: 0 });
    // A is not duplicated (the set has exactly one entry for A), B now exists too.
    expect(jobStore.created).toEqual(new Set(["recurring:batch-1:user-a", "recurring:batch-1:user-b"]));
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBe("completed");
  });

  it("C. a completed occurrence: later ticks create nothing", async () => {
    registerRule(claimStore, rule());
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const people = [person("p_a", { email: "a@example.com" })];

    await runDueCustomWeeklyRuleDispatch([occurrence], people);
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBe("completed");

    // Even after the lease would have expired, a completed occurrence never resumes.
    claimStore.expireLease("rule-1", "2026-08-22");
    const again = await runDueCustomWeeklyRuleDispatch([occurrence], people);

    expect(again).toEqual({ dispatched: 0, failed: 0 });
    expect(jobStore.created).toEqual(new Set(["recurring:batch-1:user-a"])); // unchanged
  });

  it("D. two concurrent workers racing the SAME occurrence: only one claims it, one batch, one job per recipient", async () => {
    registerRule(claimStore, rule());
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const people = [person("p_a", { email: "a@example.com" })];

    // Two "concurrent" worker invocations dispatching the exact same
    // candidate in the same tick -- the fake claim store's lease check
    // means the second sees the first's fresh claim as active and skips.
    const [first, second] = await Promise.all([
      runDueCustomWeeklyRuleDispatch([occurrence], people),
      runDueCustomWeeklyRuleDispatch([occurrence], people),
    ]);

    const totals = { dispatched: first.dispatched + second.dispatched, failed: first.failed + second.failed };
    expect(totals.dispatched).toBe(1);
    expect(jobStore.created).toEqual(new Set(["recurring:batch-1:user-a"]));
    expect(batchStore.byIdempotencyKey.size).toBe(1);
  });

  it("E. disable before claim: no occurrence dispatch", async () => {
    registerRule(claimStore, rule({ enabled: false }));
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };

    const summary = await runDueCustomWeeklyRuleDispatch([occurrence], [person("p_a")]);

    expect(summary).toEqual({ dispatched: 0, failed: 0 });
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBeNull(); // never even claimed
  });

  it("F. edit before FRESH claim: dispatch uses the rule content read at claim time, never a stale earlier in-memory candidate", async () => {
    registerRule(claimStore, rule({ title: "כותרת חדשה אחרי עריכה", body: "גוף חדש" }));
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();

    // The candidate itself only ever carries ruleId+occurrenceDate now
    // (never a copy of rule content) -- so there is no stale in-memory
    // copy to shadow the claim's own fresh read at all.
    const staleCandidate = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    await runDueCustomWeeklyRuleDispatch([staleCandidate], [person("p_a", { email: "a@example.com" })]);

    const storedBatch = batchStore.byIdempotencyKey.get("recurring:rule-1:2026-08-22");
    expect(storedBatch?.title).toBe("כותרת חדשה אחרי עריכה");
  });

  it("G. disable/archive after a due lookup but before claim: the persisted state wins over the stale in-memory candidate", async () => {
    // The candidate was computed while the rule LOOKED enabled/due --
    // but by claim time it has since been archived.
    registerRule(claimStore, rule({ enabled: true }), /* archived */ true);
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const staleCandidate = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };

    const summary = await runDueCustomWeeklyRuleDispatch([staleCandidate], [person("p_a")]);

    expect(summary).toEqual({ dispatched: 0, failed: 0 });
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBeNull();
  });

  it("H. retry after claim lease expiry resumes safely -- no duplicate send even though the FIRST attempt actually finished normally between the two calls", async () => {
    registerRule(claimStore, rule());
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const people = [person("p_a", { email: "a@example.com" })];

    await runDueCustomWeeklyRuleDispatch([occurrence], people);
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBe("completed");

    // A very late duplicate tick (e.g. a stray retry) arrives well after
    // the lease window -- since the occurrence is already 'completed',
    // it must never resend regardless of lease timing.
    claimStore.expireLease("rule-1", "2026-08-22");
    const late = await runDueCustomWeeklyRuleDispatch([occurrence], people);

    expect(late).toEqual({ dispatched: 0, failed: 0 });
    expect(jobStore.created.size).toBe(1);
  });
});

describe("runDueCustomWeeklyRuleDispatch -- PII-safe error logging (Phase 9B)", () => {
  it("never logs the raw error message -- routes through the same sanitizeWorkerError/formatWorkerErrorLog the rest of the worker uses, while keeping ruleId/occurrenceDate as safe context", async () => {
    const email = "person@example.com";
    const url = "https://internal.example.com/secret?token=abc";
    const longToken = "aVeryLongOpaqueBearerTokenThatShouldNeverBeLogged1234567890";
    const sensitiveMessage = `failed for ${email} at ${url} token=${longToken}`;

    vi.resetModules();
    vi.doMock("./store", () => ({
      claimNotificationRuleOccurrence: () => {
        throw new Error(sensitiveMessage);
      },
      setNotificationRuleOccurrenceBatchId: vi.fn(),
      completeNotificationRuleOccurrence: vi.fn(),
      listCompletedNotificationRuleOccurrenceKeys: async () => new Set<string>(),
      listRecoverableNotificationRuleOccurrences: async () => [],
      insertManagerNotificationBatchIfAbsent: vi.fn(),
      getManagerNotificationBatchById: vi.fn(),
      insertNotificationJobIfAbsent: vi.fn(),
    }));
    vi.doMock("./recipients", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./recipients")>();
      return {
        ...actual,
        fetchAllUserIdsByEmail: async () => new Map(),
        fetchAllSubscribedUserIds: async () => [],
      };
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { runDueCustomWeeklyRuleDispatch } = await import("./recurringRuleDispatch");

    const summary = await runDueCustomWeeklyRuleDispatch([{ ruleId: "rule-1", occurrenceDate: "2026-08-22" }], []);

    expect(summary).toEqual({ dispatched: 0, failed: 1 });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedLine = consoleErrorSpy.mock.calls[0]?.join(" ") ?? "";

    expect(loggedLine).not.toContain(email);
    expect(loggedLine).not.toContain(url);
    expect(loggedLine).not.toContain(longToken);
    expect(loggedLine).not.toContain(sensitiveMessage);
    // Safe, non-personal context is still present.
    expect(loggedLine).toContain("rule=rule-1");
    expect(loggedLine).toContain("date=2026-08-22");
    expect(loggedLine).toContain("stage=recurring_rules");
  });
});

describe("Recovery Test Matrix -- Blocker 1 (recovery-discoverability independent of current rule state)", () => {
  it("1. a stale claim whose rule was DISABLED while claimed still resumes and completes from its frozen snapshot", async () => {
    registerRule(claimStore, rule());
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    const claimed = await claimStore.claim("rule-1", "2026-08-22");
    expect(claimed?.isResume).toBe(false);
    claimStore.setRule("rule-1", { ...claimStore.rules.get("rule-1")!, enabled: false }); // disabled mid-flight
    claimStore.expireLease("rule-1", "2026-08-22");

    const { runDueCustomWeeklyRuleDispatch, findDueCustomWeeklyOccurrences } = await loadModule();
    const now: LocalNow = { date: "2026-08-23", minuteOfDay: 0 }; // rule is disabled AND wrong weekday for "today"
    const due = await findDueCustomWeeklyOccurrences([rule({ enabled: false })], now);
    expect(due).toEqual([{ ruleId: "rule-1", occurrenceDate: "2026-08-22" }]);

    const summary = await runDueCustomWeeklyRuleDispatch(due, [person("p_a", { email: "a@example.com" })]);
    expect(summary).toEqual({ dispatched: 1, failed: 0 });
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBe("completed");
  });

  it("2. a stale claim whose rule was ARCHIVED while claimed still resumes and completes", async () => {
    registerRule(claimStore, rule());
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    await claimStore.claim("rule-1", "2026-08-22");
    registerRule(claimStore, rule(), /* archived */ true);
    claimStore.expireLease("rule-1", "2026-08-22");

    const { runDueCustomWeeklyRuleDispatch, findDueCustomWeeklyOccurrences } = await loadModule();
    const now: LocalNow = { date: "2026-08-23", minuteOfDay: 0 };
    const due = await findDueCustomWeeklyOccurrences([], now); // rule not even passed in this tick's config anymore
    expect(due).toEqual([{ ruleId: "rule-1", occurrenceDate: "2026-08-22" }]);

    const summary = await runDueCustomWeeklyRuleDispatch(due, [person("p_a", { email: "a@example.com" })]);
    expect(summary).toEqual({ dispatched: 1, failed: 0 });
  });

  it("3. a stale claim whose rule's WEEKDAY was moved off the claimed occurrence's weekday still resumes and completes", async () => {
    registerRule(claimStore, rule({ weekday: 6 })); // Saturday
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    await claimStore.claim("rule-1", "2026-08-22"); // Saturday occurrence
    registerRule(claimStore, rule({ weekday: 2 })); // moved to Tuesday
    claimStore.expireLease("rule-1", "2026-08-22");

    const { runDueCustomWeeklyRuleDispatch, findDueCustomWeeklyOccurrences } = await loadModule();
    const now: LocalNow = { date: "2026-08-25", minuteOfDay: 0 }; // Tuesday, no fresh Saturday occurrence today
    const due = await findDueCustomWeeklyOccurrences([rule({ weekday: 2 })], now);
    expect(due).toContainEqual({ ruleId: "rule-1", occurrenceDate: "2026-08-22" });

    const summary = await runDueCustomWeeklyRuleDispatch(due, [person("p_a", { email: "a@example.com" })]);
    expect(summary.dispatched).toBeGreaterThanOrEqual(1);
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBe("completed");
  });

  it("4. a lease that expires only AFTER local midnight is still discovered and resumed the next day -- recovery is calendar-date-independent", async () => {
    registerRule(claimStore, rule());
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    await claimStore.claim("rule-1", "2026-08-22");
    claimStore.expireLease("rule-1", "2026-08-22");

    const { runDueCustomWeeklyRuleDispatch, findDueCustomWeeklyOccurrences } = await loadModule();
    // "Now" is the FOLLOWING Sunday -- a full calendar day after the
    // claimed occurrence's own date, and structurally never due again
    // (wrong weekday) -- recovery must still find it purely via the
    // lease-staleness scan.
    const now: LocalNow = { date: "2026-08-23", minuteOfDay: 5 * 60 };
    const due = await findDueCustomWeeklyOccurrences([rule()], now);
    expect(due).toEqual([{ ruleId: "rule-1", occurrenceDate: "2026-08-22" }]);

    const summary = await runDueCustomWeeklyRuleDispatch(due, [person("p_a", { email: "a@example.com" })]);
    expect(summary).toEqual({ dispatched: 1, failed: 0 });
  });
});

describe("Recovery Test Matrix -- Blocker 2 (fresh-claim revalidates CURRENT weekday/local-time; resume never re-checks schedule)", () => {
  it("5. fresh claim REFUSED when the current wall-clock local time is still before the rule's (possibly just-moved-later) due time", async () => {
    registerRule(claimStore, rule({ localHour: 21, localMinute: 0 }));
    claimStore.setWallClock("2026-08-22", 20 * 60); // 20:00 -- before 21:00

    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const summary = await runDueCustomWeeklyRuleDispatch([occurrence], [person("p_a")]);

    expect(summary).toEqual({ dispatched: 0, failed: 0 });
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBeNull(); // never claimed at all
  });

  it("6. fresh claim SUCCEEDS once the current wall-clock local time reaches the (possibly just-moved-earlier) due time", async () => {
    registerRule(claimStore, rule({ localHour: 21, localMinute: 0 }));
    claimStore.setWallClock("2026-08-22", 21 * 60);
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));

    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const summary = await runDueCustomWeeklyRuleDispatch([occurrence], [person("p_a", { email: "a@example.com" })]);

    expect(summary).toEqual({ dispatched: 1, failed: 0 });
  });

  it("7. fresh claim REFUSED when the rule's CURRENT weekday no longer matches the candidate occurrence's own weekday (edited between due-check and claim)", async () => {
    registerRule(claimStore, rule({ weekday: 2 })); // rule now Tuesday-only
    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    // The candidate is for a Saturday date, as if computed before the edit landed.
    const staleCandidate = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };

    const summary = await runDueCustomWeeklyRuleDispatch([staleCandidate], [person("p_a")]);

    expect(summary).toEqual({ dispatched: 0, failed: 0 });
    expect(claimStore.statusOf("rule-1", "2026-08-22")).toBeNull();
  });

  it("8. RESUME never re-checks weekday/time -- a schedule edit made after a fresh claim does not retroactively block the already-committed resume", async () => {
    registerRule(claimStore, rule({ weekday: 6, localHour: 21, localMinute: 0 }));
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    await claimStore.claim("rule-1", "2026-08-22");
    // Move the schedule to a weekday/time that would refuse a FRESH claim outright.
    registerRule(claimStore, rule({ weekday: 2, localHour: 8, localMinute: 0 }));
    claimStore.setWallClock("2026-08-22", 0); // and "now" is even before the OLD due time
    claimStore.expireLease("rule-1", "2026-08-22");

    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const summary = await runDueCustomWeeklyRuleDispatch([occurrence], [person("p_a", { email: "a@example.com" })]);

    expect(summary).toEqual({ dispatched: 1, failed: 0 }); // resumed and completed regardless
  });
});

describe("Recovery Test Matrix -- Blocker 3 (frozen-at-claim is real: resume returns the occurrence's OWN stored snapshot, never a live rule re-read)", () => {
  it("9. a content edit made AFTER fresh claim but BEFORE resume does not leak into the resumed dispatch -- the frozen snapshot wins", async () => {
    registerRule(claimStore, rule({ title: "כותרת מקורית", body: "גוף מקורי" }));
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    await claimStore.claim("rule-1", "2026-08-22");
    // Edited post-claim, pre-resume -- the fake's `rules` map now holds
    // ONLY the new content; if resume ever re-read it, this would leak.
    registerRule(claimStore, rule({ title: "כותרת אחרי עריכה שלא אמורה לדלוף", body: "גוף אחרי עריכה" }));
    claimStore.expireLease("rule-1", "2026-08-22");

    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    await runDueCustomWeeklyRuleDispatch([occurrence], [person("p_a", { email: "a@example.com" })]);

    const storedBatch = batchStore.byIdempotencyKey.get("recurring:rule-1:2026-08-22");
    expect(storedBatch?.title).toBe("כותרת מקורית");
    expect(storedBatch?.body).toBe("גוף מקורי");
  });

  it("10. resume succeeds even if the rule has been fully DELETED from the rules table between claim and resume -- proves resume never re-reads notification_rules at all", async () => {
    registerRule(claimStore, rule());
    fetchAllUserIdsByEmail.mockResolvedValue(new Map([["a@example.com", { userId: "user-a", avatarUrl: null }]]));
    await claimStore.claim("rule-1", "2026-08-22");
    claimStore.rules.delete("rule-1"); // gone entirely
    claimStore.expireLease("rule-1", "2026-08-22");

    const { runDueCustomWeeklyRuleDispatch } = await loadModule();
    const occurrence = { ruleId: "rule-1", occurrenceDate: "2026-08-22" };
    const summary = await runDueCustomWeeklyRuleDispatch([occurrence], [person("p_a", { email: "a@example.com" })]);

    expect(summary).toEqual({ dispatched: 1, failed: 0 });
  });
});
