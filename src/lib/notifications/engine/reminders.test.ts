import { afterEach, describe, expect, it, vi } from "vitest";
import type { DutyFamily, Event } from "@/lib/domain/event";
import { buildShiftSchedule } from "@/lib/domain/shiftSchedule";
import { getOperationalWeek } from "@/lib/domain/operationalWeek";
import type { LocalNow } from "@/lib/domain/localNow";
import { jerusalemLocalTimeToInstant } from "@/lib/time/jerusalemClock";
import { resolveMotzashShabbatInstant } from "@/lib/time/motzashShabbat";
import type { RecipientResolution } from "./recipients";
import type { NotificationRuleConfig, SystemRuleConfig, SystemRuleKey } from "./ruleConfig";

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

const store = {
  upsertPendingSystemReminderJob: vi.fn<
    (job: import("./store").NewNotificationJob, guard: { ruleId: string; expectedRevision: number }) => Promise<boolean>
  >(async () => true),
  cancelPendingSystemReminderJob: vi.fn<
    (dedupeKey: string, guard: { ruleId: string; category: string; expectedRevision: number }) => Promise<boolean>
  >(async () => true),
  listPendingJobDedupeKeysByPrefix: vi.fn<(prefix: string) => Promise<string[]>>(async () => []),
  insertNotificationJobIfAbsent: vi.fn(async () => true),
};

const fetchAllSubscribedUserIds = vi.fn(async () => [] as string[]);
// `resolveNonPermanentConstraintsRecipients` is the mock boundary here
// (not its own internal `fetchAllUserIdsByEmail` dependency) -- both are
// defined in the SAME `./recipients` module, and a same-module internal
// call is bound to the real function at module-evaluation time
// regardless of any `vi.doMock` override of the exported reference (a
// plain JS/ESM closure fact, not a mocking bug). See `recipients.test.ts`
// for `resolveNonPermanentConstraintsRecipients`'s own real-classification
// tests (mocked at the `./serviceClient` I/O boundary instead, where
// interception genuinely works).
const resolveNonPermanentConstraintsRecipients = vi.fn(async () => [] as { personId: string; userId: string }[]);

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

/**
 * Every system rule enabled, at its CURRENT production seed time
 * (`notificationTiming.ts`'s former constants, now this table's own
 * migration seed values) -- the default a test gets unless it explicitly
 * overrides a specific rule. `overrides` merges shallowly per system key
 * (e.g. `{ tomorrow_shift: { enabled: false } }`).
 */
function defaultRuleConfig(
  overrides: Partial<Record<SystemRuleKey, Partial<SystemRuleConfig>>> = {},
  customWeeklyRules: NotificationRuleConfig["customWeeklyRules"] = [],
): NotificationRuleConfig {
  const base: Record<SystemRuleKey, SystemRuleConfig> = {
    tomorrow_shift: {
      id: "rule-tomorrow_shift",
      systemKey: "tomorrow_shift",
      enabled: true,
      localHour: 20,
      localMinute: 0,
      revision: 1,
      titleOverride: null,
      bodyOverride: null,
      audienceMode: "all_eligible" as const,
      targetPersonIds: [],
      audienceGroupKeys: [],
      excludedPersonIds: [],
    },
    tomorrow_duty: {
      id: "rule-tomorrow_duty",
      systemKey: "tomorrow_duty",
      enabled: true,
      localHour: 20,
      localMinute: 0,
      revision: 1,
      titleOverride: null,
      bodyOverride: null,
      audienceMode: "all_eligible" as const,
      targetPersonIds: [],
      audienceGroupKeys: [],
      excludedPersonIds: [],
    },
    tomorrow_logistics_withdrawal: {
      id: "rule-tomorrow_logistics_withdrawal",
      systemKey: "tomorrow_logistics_withdrawal",
      enabled: true,
      localHour: 20,
      localMinute: 0,
      revision: 1,
      titleOverride: null,
      bodyOverride: null,
      audienceMode: "all_eligible" as const,
      targetPersonIds: [],
      audienceGroupKeys: [],
      excludedPersonIds: [],
    },
    tomorrow_logistics_withdrawal_supervisor: {
      id: "rule-tomorrow_logistics_withdrawal_supervisor",
      systemKey: "tomorrow_logistics_withdrawal_supervisor",
      enabled: true,
      localHour: 20,
      localMinute: 0,
      revision: 1,
      titleOverride: null,
      bodyOverride: null,
      audienceMode: "all_eligible" as const,
      targetPersonIds: [],
      audienceGroupKeys: [],
      excludedPersonIds: [],
    },
    logistics_withdrawal_noon_assigned: {
      id: "rule-logistics_withdrawal_noon_assigned",
      systemKey: "logistics_withdrawal_noon_assigned",
      enabled: true,
      localHour: 12,
      localMinute: 0,
      revision: 1,
      titleOverride: null,
      bodyOverride: null,
      audienceMode: "all_eligible" as const,
      targetPersonIds: [],
      audienceGroupKeys: [],
      excludedPersonIds: [],
    },
    logistics_withdrawal_noon_supervisor: {
      id: "rule-logistics_withdrawal_noon_supervisor",
      systemKey: "logistics_withdrawal_noon_supervisor",
      enabled: true,
      localHour: 12,
      localMinute: 0,
      revision: 1,
      titleOverride: null,
      bodyOverride: null,
      audienceMode: "all_eligible" as const,
      targetPersonIds: [],
      audienceGroupKeys: [],
      excludedPersonIds: [],
    },
    logistics_withdrawal_noon_team: {
      id: "rule-logistics_withdrawal_noon_team",
      systemKey: "logistics_withdrawal_noon_team",
      enabled: true,
      localHour: 12,
      localMinute: 0,
      revision: 1,
      titleOverride: null,
      bodyOverride: null,
      audienceMode: "all_eligible" as const,
      targetPersonIds: [],
      audienceGroupKeys: [],
      excludedPersonIds: [],
    },
    almash_check_in: {
      id: "rule-almash_check_in",
      systemKey: "almash_check_in",
      enabled: true,
      localHour: 12,
      localMinute: 45,
      revision: 1,
      titleOverride: null,
      bodyOverride: null,
      audienceMode: "all_eligible" as const,
      targetPersonIds: [],
      audienceGroupKeys: [],
      excludedPersonIds: [],
    },
    constraints_sunday: {
      id: "rule-constraints_sunday",
      systemKey: "constraints_sunday",
      enabled: true,
      localHour: 18,
      localMinute: 0,
      revision: 1,
      titleOverride: null,
      bodyOverride: null,
      audienceMode: "all_eligible" as const,
      targetPersonIds: [],
      audienceGroupKeys: [],
      excludedPersonIds: [],
    },
    constraints_monday: {
      id: "rule-constraints_monday",
      systemKey: "constraints_monday",
      enabled: true,
      localHour: 9,
      localMinute: 0,
      revision: 1,
      titleOverride: null,
      bodyOverride: null,
      audienceMode: "all_eligible" as const,
      targetPersonIds: [],
      audienceGroupKeys: [],
      excludedPersonIds: [],
    },
  };

  for (const [key, patch] of Object.entries(overrides)) {
    base[key as SystemRuleKey] = { ...base[key as SystemRuleKey], ...patch };
  }

  return { systemRules: new Map(Object.entries(base)) as Map<SystemRuleKey, SystemRuleConfig>, customWeeklyRules };
}

async function loadModule() {
  vi.doMock("./store", () => store);
  vi.doMock("./recipients", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./recipients")>();
    return { ...actual, fetchAllSubscribedUserIds, resolveNonPermanentConstraintsRecipients };
  });
  const mod = await import("./reminders");

  // Every pre-existing call site in this file omits `ruleConfig` -- this
  // wrapper injects the default (all system rules enabled, seed times)
  // unless the test explicitly passes its own `ruleConfig`, so the huge
  // majority of tests below (unrelated to the Fixed Notifications Center
  // itself) never had to be touched by that feature's addition.
  return {
    ...mod,
    runReminders: (input: Omit<Parameters<typeof mod.runReminders>[0], "ruleConfig"> & { ruleConfig?: NotificationRuleConfig }) =>
      mod.runReminders({ ruleConfig: defaultRuleConfig(), ...input }),
  };
}

function resolutionWith(personId: string, userId: string): RecipientResolution {
  return {
    resolved: new Map([[personId, { personId, email: `${personId}@example.com`, userId }]]),
    unmappedCount: 0,
    ambiguousEmailCount: 0,
    noEmailCount: 0,
  };
}

describe("runReminders -- tomorrow shift reminder", () => {
  it("creates a reminder job crossing a Saturday -> Sunday week boundary", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-22", minuteOfDay: 1200 }; // Saturday evening
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-23", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "tomorrow_shift",
        recipientUserId: "user-p1",
        dedupeKey: "tomorrow_shift:2026-08-23:user-p1:day",
      }), expect.anything()
    );
  });

  it("includes the real shift start time when the domain can resolve it", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("07:00") }), expect.anything()
    );
  });

  it("never invents a time for an unresolvable (morning/unspecified) period", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "morning" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    const call = store.upsertPendingSystemReminderJob.mock.calls[0][0];
    expect(call.body).not.toMatch(/\d{2}:\d{2}/);
  });

  it("cancels a previously-created reminder whose assignment disappeared before send", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue(["tomorrow_shift:2026-08-19:user-p1:day"]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [], // the shift no longer exists
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith("tomorrow_shift:2026-08-19:user-p1:day", expect.anything());
  });

  it("two same-day shifts for one person (different periods) get distinct dedupe keys AND distinct Push tags", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [
        event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" }),
        event({ personId: "p1", date: "2026-08-19", category: "shift", period: "night" }),
      ],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    const jobs = store.upsertPendingSystemReminderJob.mock.calls.map((call) => call[0]);
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((job) => job.dedupeKey)).size).toBe(2);
    expect(new Set(jobs.map((job) => job.tag)).size).toBe(2);
  });
});

describe("runReminders -- tomorrow duty reminder", () => {
  it("fires normally for evacuation_on_call (the exclusion only applies to the removed check-in reminder, not the duty existence reminder)", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "duty", dutyFamily: "evacuation_on_call" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({ category: "tomorrow_duty", body: expect.stringContaining("כונן פינויים") }), expect.anything()
    );
  });

  it("two concurrent tomorrow-duty families for one person get distinct dedupe keys AND distinct Push tags", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [
        event({ personId: "p1", date: "2026-08-19", category: "duty", dutyFamily: "guard" }),
        event({ personId: "p1", date: "2026-08-19", category: "duty", dutyFamily: "oxid" }),
      ],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    const jobs = store.upsertPendingSystemReminderJob.mock.calls
      .map((call) => call[0])
      .filter((job) => job.category === "tomorrow_duty");
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((job) => job.dedupeKey)).size).toBe(2);
    expect(new Set(jobs.map((job) => job.tag)).size).toBe(2);
  });
});

describe("runReminders -- tomorrow logistics-withdrawal reminder (משיכות מהלוגיסטיקה)", () => {
  it("the assigned person gets exactly one reminder, with the exact spec copy and path", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "other", title: "משיכות מהלוגיסטיקה" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledTimes(1);
    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith({
      category: "tomorrow_logistics_withdrawal",
      recipientUserId: "user-p1",
      title: "📦 משיכות מהלוגיסטיקה מחר",
      body: "מחר אתה עושה משיכות בין 13:00–14:00.",
      path: "/",
      tag: "tomorrow-logistics-withdrawal-2026-08-19-user-p1",
      dedupeKey: "tomorrow_logistics_withdrawal:2026-08-19:user-p1",
      scheduledFor: expect.any(String),
      sourceRef: "logistics_withdrawal:p1:2026-08-19",
    }, expect.anything());
  });

  it("other users (not assigned) never get a reminder", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    const resolution: RecipientResolution = {
      resolved: new Map([
        ["p1", { personId: "p1", email: "p1@example.com", userId: "user-p1" }],
        ["p2", { personId: "p2", email: "p2@example.com", userId: "user-p2" }],
      ]),
      unmappedCount: 0,
      ambiguousEmailCount: 0,
      noEmailCount: 0,
    };

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "other", title: "משיכות" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolution,
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledTimes(1);
    expect(store.upsertPendingSystemReminderJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "user-p2" }), expect.anything()
    );
  });

  it("is scheduled for exactly 20:00 Asia/Jerusalem the previous day", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 }; // 2026-08-18, winter/summer irrelevant here (August = UTC+3)
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "other", title: "משיכות" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    const call = store.upsertPendingSystemReminderJob.mock.calls[0][0];
    expect(call.scheduledFor).toBe("2026-08-18T17:00:00.000Z"); // 20:00 Asia/Jerusalem (UTC+3 in August) on 2026-08-18
  });

  it("cancels the pending reminder when the assignment disappears before send", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue(["tomorrow_logistics_withdrawal:2026-08-19:user-p1"]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [], // the assignment no longer exists
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith("tomorrow_logistics_withdrawal:2026-08-19:user-p1", expect.anything());
    expect(store.upsertPendingSystemReminderJob).not.toHaveBeenCalled();
  });

  it("moving the assignment from person A to person B cancels A's pending reminder and creates B's", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue(["tomorrow_logistics_withdrawal:2026-08-19:user-a"]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    const resolution: RecipientResolution = {
      resolved: new Map([
        ["p-a", { personId: "p-a", email: "a@example.com", userId: "user-a" }],
        ["p-b", { personId: "p-b", email: "b@example.com", userId: "user-b" }],
      ]),
      unmappedCount: 0,
      ambiguousEmailCount: 0,
      noEmailCount: 0,
    };

    // The Sheet now assigns "p-b", not "p-a" -- the assignment moved.
    await runReminders({
      events: [event({ personId: "p-b", date: "2026-08-19", category: "other", title: "משיכות מהלוגיסטיקה" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolution,
    });

    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith("tomorrow_logistics_withdrawal:2026-08-19:user-a", expect.anything());
    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: "user-b", dedupeKey: "tomorrow_logistics_withdrawal:2026-08-19:user-b" }), expect.anything()
    );
  });

  it("repeated worker ticks (same assignment observed again) use the identical deterministic dedupe key -- never a duplicate", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);
    const input = {
      events: [event({ personId: "p1", date: "2026-08-19", category: "other", title: "משיכות מהלוגיסטיקה" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    };

    await runReminders(input); // tick 1
    await runReminders(input); // tick 2, 5 minutes later in reality -- same assignment, same tomorrow date

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledTimes(2);
    const firstDedupeKey = store.upsertPendingSystemReminderJob.mock.calls[0][0].dedupeKey;
    const secondDedupeKey = store.upsertPendingSystemReminderJob.mock.calls[1][0].dedupeKey;
    expect(firstDedupeKey).toBe(secondDedupeKey); // identical key both times -- the real store's ON CONFLICT (dedupe_key) upsert (see store.ts) collapses these into one row, never two
  });

  it("crosses a Saturday -> Sunday operational-week boundary", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-22", minuteOfDay: 1200 }; // Saturday evening
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-23", category: "other", title: "משיכות מהלוגיסטיקה" })], // tomorrow = Sunday, next week
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "tomorrow_logistics_withdrawal",
        recipientUserId: "user-p1",
        dedupeKey: "tomorrow_logistics_withdrawal:2026-08-23:user-p1",
      }), expect.anything()
    );
  });
});

const emptyRecipientResolution: RecipientResolution = {
  resolved: new Map(),
  unmappedCount: 0,
  ambiguousEmailCount: 0,
  noEmailCount: 0,
};

describe("runReminders -- weekly constraints reminders", () => {
  it("creates a Sunday reminder for every id resolveNonPermanentConstraintsRecipients returns, only on Sunday", async () => {
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([
      { personId: "p_a", userId: "user-a" },
      { personId: "p_b", userId: "user-b" },
    ]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-16", minuteOfDay: 1080 }; // Sunday
    const week = getOperationalWeek(now);

    const summary = await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
    });

    expect(summary.constraintsJobs).toBe(2);
    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({ category: "constraints_sunday", dedupeKey: `constraints_sunday:${week.weekStart}:user-a` }), expect.anything()
    );
  });

  it("creates a Monday reminder, and never on any other weekday", async () => {
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-17", minuteOfDay: 600 }; // Monday
    const week = getOperationalWeek(now);

    const summary = await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
    });

    expect(summary.constraintsJobs).toBe(1);
  });

  it("creates no constraints jobs on a Tuesday", async () => {
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 600 }; // Tuesday
    const week = getOperationalWeek(now);

    const summary = await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
    });

    expect(summary.constraintsJobs).toBe(0);
    expect(resolveNonPermanentConstraintsRecipients).not.toHaveBeenCalled();
  });

  it("Sunday/Monday titles, bodies, timing, and path are unchanged by the audience-source fix", async () => {
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    let { runReminders } = await loadModule();
    let now: LocalNow = { date: "2026-08-16", minuteOfDay: 1080 }; // Sunday
    let week = getOperationalWeek(now);

    await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "📌 תזכורת לאילוצים",
        body: "יש אילוץ לשבוע הבא? אפשר לשלוח עד מחר.",
        path: "/",
        scheduledFor: jerusalemLocalTimeToInstant("2026-08-16", 18, 0).toISOString(),
      }), expect.anything()
    );

    store.upsertPendingSystemReminderJob.mockClear();
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    ({ runReminders } = await loadModule());
    now = { date: "2026-08-17", minuteOfDay: 600 }; // Monday
    week = getOperationalWeek(now);

    await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "⏳ היום האחרון לאילוצים",
        body: "אפשר לשלוח אילוצים לשבוע הבא עד סוף היום.",
        path: "/",
        scheduledFor: jerusalemLocalTimeToInstant("2026-08-17", 9, 0).toISOString(),
      }), expect.anything()
    );
  });

  it("never queries push-subscription state for recipient targeting -- fetchAllSubscribedUserIds is untouched by this category", async () => {
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-16", minuteOfDay: 1080 }; // Sunday
    const week = getOperationalWeek(now);

    await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
    });

    expect(fetchAllSubscribedUserIds).not.toHaveBeenCalled();
  });

  it("passes the reminder's OWN `people` roster through to resolveNonPermanentConstraintsRecipients -- the recipient source the mandatory permanent-exclusion fix depends on (see recipients.test.ts for the real classification behavior)", async () => {
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-16", minuteOfDay: 1080 }; // Sunday
    const week = getOperationalWeek(now);
    const people = [person("p_a", { personnelType: "חובה" })];

    await runReminders({
      events: [],
      people,
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
    });

    expect(resolveNonPermanentConstraintsRecipients).toHaveBeenCalledWith(people);
  });
});

describe("runReminders -- system rule config (Fixed Notifications Center)", () => {
  it("a disabled system rule creates no new jobs and cancels its pending unsent job", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue(["tomorrow_shift:2026-08-19:user-p1:day"]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    const summary = await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      ruleConfig: defaultRuleConfig({ tomorrow_shift: { enabled: false } }),
    });

    expect(summary.tomorrowShiftJobs).toBe(0);
    expect(store.upsertPendingSystemReminderJob).not.toHaveBeenCalled();
    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith("tomorrow_shift:2026-08-19:user-p1:day", expect.anything());
  });

  it("re-enabling a system rule resumes normal dispatch", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    const summary = await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      ruleConfig: defaultRuleConfig({ tomorrow_shift: { enabled: true } }),
    });

    expect(summary.tomorrowShiftJobs).toBe(1);
    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({ category: "tomorrow_shift", dedupeKey: "tomorrow_shift:2026-08-19:user-p1:day" }), expect.anything()
    );
  });

  it("a changed send time re-upserts the SAME pending job at the new time -- never a duplicate", async () => {
    // Only tomorrow_shift's own prefix has a stale key -- every OTHER
    // category's own `listPendingJobDedupeKeysByPrefix` call (this single
    // `runReminders` invocation runs every category) must see none of
    // its own, or this test's `.not.toHaveBeenCalledWith` assertion below
    // would trip on an unrelated category's cancellation instead.
    store.listPendingJobDedupeKeysByPrefix.mockImplementation(async (prefix: string) =>
      prefix === "tomorrow_shift:2026-08-19:" ? ["tomorrow_shift:2026-08-19:user-p1:day"] : [],
    );
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      ruleConfig: defaultRuleConfig({ tomorrow_shift: { localHour: 19, localMinute: 30 } }),
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: "tomorrow_shift:2026-08-19:user-p1:day",
        scheduledFor: jerusalemLocalTimeToInstant("2026-08-18", 19, 30).toISOString(),
      }), expect.anything()
    );
    // The SAME dedupe key, not a second job -- `cancelPendingSystemReminderJob`
    // is never called for it (the still-pending row was upserted in
    // place, not cancelled-and-recreated).
    expect(store.cancelPendingSystemReminderJob).not.toHaveBeenCalledWith("tomorrow_shift:2026-08-19:user-p1:day", expect.anything());
  });

  it("a system rule missing from the loaded config is treated as disabled -- fail safe, never a hardcoded fallback time, and NEVER an unguarded cancellation (no rule identity/revision to authorize one with)", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    const emptyConfig: NotificationRuleConfig = { systemRules: new Map(), customWeeklyRules: [] };
    const summary = await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      ruleConfig: emptyConfig,
    });

    expect(summary.tomorrowShiftJobs).toBe(0);
    expect(summary.tomorrowShiftCancelled).toBe(0);
    expect(store.upsertPendingSystemReminderJob).not.toHaveBeenCalled();
    // No rule identity/revision exists to authorize a cancellation with --
    // this category's existing pending jobs (if any) are left completely
    // untouched this tick, never mutated via an unguarded fallback path.
    expect(store.cancelPendingSystemReminderJob).not.toHaveBeenCalled();
    expect(store.listPendingJobDedupeKeysByPrefix).not.toHaveBeenCalled();
  });

  it("disabling constraints_sunday cancels its own pending unsent job", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    const now: LocalNow = { date: "2026-08-16", minuteOfDay: 1080 }; // Sunday
    const week = getOperationalWeek(now);

    // First tick: rule enabled, job upserted (pending).
    let { runReminders } = await loadModule();
    await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
    });
    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: `constraints_sunday:${week.weekStart}:user-a` }), expect.anything()
    );

    // Second tick (same Sunday), manager disables the rule -- the
    // still-pending job for this week must now be cancelled.
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([`constraints_sunday:${week.weekStart}:user-a`]);
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    ({ runReminders } = await loadModule());
    const summary = await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
      ruleConfig: defaultRuleConfig({ constraints_sunday: { enabled: false } }),
    });

    expect(summary.constraintsJobs).toBe(0);
    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith(`constraints_sunday:${week.weekStart}:user-a`, expect.anything());
  });

  it("passes the exact ruleId/category/expectedRevision guard to BOTH the upsert and the cancellation call for the same category", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue(["tomorrow_shift:2026-08-19:user-stale:day"]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      ruleConfig: defaultRuleConfig({ tomorrow_shift: { id: "rule-tomorrow_shift", revision: 7 } }),
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({ category: "tomorrow_shift" }),
      { ruleId: "rule-tomorrow_shift", expectedRevision: 7 },
    );
    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith("tomorrow_shift:2026-08-19:user-stale:day", {
      ruleId: "rule-tomorrow_shift",
      category: "tomorrow_shift",
      expectedRevision: 7,
    });
  });

  it("truthfully reports created/cancelled counts as GUARDED WRITES the RPCs actually authorized -- never a raw candidate/stale-key count", async () => {
    // Only tomorrow_shift's own prefix has a stale key -- every OTHER
    // category's own `listPendingJobDedupeKeysByPrefix` call must see
    // none of its own, or this test's exact call-count assertions below
    // would trip on an unrelated category's cancellation sweep instead.
    store.listPendingJobDedupeKeysByPrefix.mockImplementation(async (prefix: string) =>
      prefix === "tomorrow_shift:2026-08-19:" ? ["tomorrow_shift:2026-08-19:user-stale:day"] : [],
    );
    store.upsertPendingSystemReminderJob.mockResolvedValue(false); // a concurrent manager edit is now authoritative
    store.cancelPendingSystemReminderJob.mockResolvedValue(false); // ditto for the cancellation sweep
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    const summary = await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    // The upsert/cancel calls were still ATTEMPTED (one candidate, one
    // stale key) -- but since the guarded RPC rejected both as stale, the
    // summary must report zero, never the raw candidate/stale-key count.
    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledTimes(1);
    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledTimes(1);
    expect(summary.tomorrowShiftJobs).toBe(0);
    expect(summary.tomorrowShiftCancelled).toBe(0);
    expect(consoleWarnSpy).toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
    // `vi.clearAllMocks()` (this file's own `afterEach`) clears call
    // history but never undoes a persistent `mockResolvedValue` override
    // -- restore the default true-returning behavior explicitly so later
    // tests never inherit this test's stale-revision simulation.
    store.upsertPendingSystemReminderJob.mockResolvedValue(true);
    store.cancelPendingSystemReminderJob.mockResolvedValue(true);
  });
});

// ---------------------------------------------------------------------------
// Logistics-withdrawal team coordination (tomorrow-supervisor + same-day noon)
// ---------------------------------------------------------------------------

function daySupervisorShift(personId: string, overrides: Partial<Event> & Pick<Event, "date">): Event {
  return event({ personId, category: "shift", role: "supervisor", period: "day", ...overrides });
}

function dayTechnicianShift(personId: string, overrides: Partial<Event> & Pick<Event, "date">): Event {
  return event({ personId, category: "shift", role: "technician", period: "day", ...overrides });
}

function withdrawalAssignment(personId: string, date: string, overrides: Partial<Event> = {}): Event {
  return event({ personId, date, category: "other", title: "משיכות", ...overrides });
}

function resolutionFor(pairs: readonly [string, string][]): RecipientResolution {
  return {
    resolved: new Map(pairs.map(([personId, userId]) => [personId, { personId, email: `${personId}@example.com`, userId }])),
    unmappedCount: 0,
    ambiguousEmailCount: 0,
    noEmailCount: 0,
  };
}

function upsertedFor(category: string) {
  return store.upsertPendingSystemReminderJob.mock.calls.map((call) => call[0]).filter((job) => job.category === category);
}

function person(id: string, overrides: Partial<import("@/lib/domain/types").Person> = {}) {
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

describe("runReminders -- tomorrow logistics-withdrawal SUPERVISOR reminder (20:00, day before)", () => {
  it("supervisor gets the assigned-person-informed message when someone is assigned", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [withdrawalAssignment("p_ethan", "2026-08-19"), daySupervisorShift("p_sup", { date: "2026-08-19" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([
        ["p_ethan", "user-ethan"],
        ["p_sup", "user-sup"],
      ]),
    });

    const jobs = upsertedFor("tomorrow_logistics_withdrawal_supervisor");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      recipientUserId: "user-sup",
      title: "📦 משיכות מחר",
      body: "מחר p_ethan עושה משיכות בין 13:00–14:00. נדרש לוודא שהוא מכיר את המשימה.",
      dedupeKey: "tomorrow_logistics_withdrawal_supervisor:2026-08-19:user-sup",
    });
  });

  it("no assignee: supervisor gets the anti-spam warning, and NO technician-wide push exists at 20:00 at all (Sunday evening -> Monday, a genuine logistics-withdrawal date)", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-16", minuteOfDay: 1200 }; // Sunday
    const week = getOperationalWeek(now);

    await runReminders({
      events: [daySupervisorShift("p_sup", { date: "2026-08-17" }), dayTechnicianShift("p_tech", { date: "2026-08-17" })],
      people: [person("p_tech", { isTechnician: true })],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([
        ["p_sup", "user-sup"],
        ["p_tech", "user-tech"],
      ]),
    });

    const supervisorJobs = upsertedFor("tomorrow_logistics_withdrawal_supervisor");
    expect(supervisorJobs).toHaveLength(1);
    expect(supervisorJobs[0]).toMatchObject({
      recipientUserId: "user-sup",
      title: "⚠️ לא הוגדר טכנאי למשיכות",
      body: "לא הוגדר טכנאי למשיכות מחר בין 13:00–14:00. נדרש לוודא שכל הטכנאים הזמינים יוצאים למשיכות.",
    });
    // No LOGISTICS category ever targets the technician the evening before
    // (p_tech legitimately still gets the unrelated, pre-existing
    // tomorrow_shift reminder for their own ordinary shift -- untouched by
    // this feature).
    for (const category of [
      "tomorrow_logistics_withdrawal",
      "tomorrow_logistics_withdrawal_supervisor",
      "logistics_withdrawal_noon_assigned",
      "logistics_withdrawal_noon_supervisor",
      "logistics_withdrawal_noon_team",
    ]) {
      expect(upsertedFor(category).some((job) => job.recipientUserId === "user-tech")).toBe(false);
    }
  });

  it("no supervisor can be proven: zero supervisor jobs, even with an assignee", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [withdrawalAssignment("p_ethan", "2026-08-19")], // no shift Events at all
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([["p_ethan", "user-ethan"]]),
    });

    expect(upsertedFor("tomorrow_logistics_withdrawal_supervisor")).toHaveLength(0);
  });

  it("multiple assignees consolidate into ONE supervisor job (not one per assignee), with plural copy", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [
        withdrawalAssignment("p_a", "2026-08-19"),
        withdrawalAssignment("p_b", "2026-08-19"),
        daySupervisorShift("p_sup", { date: "2026-08-19" }),
      ],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([
        ["p_a", "user-a"],
        ["p_b", "user-b"],
        ["p_sup", "user-sup"],
      ]),
    });

    const jobs = upsertedFor("tomorrow_logistics_withdrawal_supervisor");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].body).toContain("עושים");
  });

  it("an assignee who is ALSO the relevant supervisor never gets the supervisor message about themselves", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [withdrawalAssignment("p_ethan", "2026-08-19"), daySupervisorShift("p_ethan", { date: "2026-08-19" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([["p_ethan", "user-ethan"]]),
    });

    expect(upsertedFor("tomorrow_logistics_withdrawal_supervisor")).toHaveLength(0);
    expect(upsertedFor("tomorrow_logistics_withdrawal")).toHaveLength(1);
  });
});

describe("runReminders -- same-day noon (12:00) logistics-withdrawal team coordination", () => {
  it("the assigned technician gets the personal noon reminder", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [withdrawalAssignment("p_ethan", "2026-08-19")],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([["p_ethan", "user-ethan"]]),
    });

    const jobs = upsertedFor("logistics_withdrawal_noon_assigned");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      recipientUserId: "user-ethan",
      title: "📦 משיכות בעוד שעה",
      body: "היום אתה עושה משיכות בין 13:00–14:00.",
      dedupeKey: "logistics_withdrawal_noon_assigned:2026-08-19:user-ethan",
    });
  });

  it("other eligible technicians get the noon help message naming the assignee, and the assignee does NOT also get it", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [
        withdrawalAssignment("p_ethan", "2026-08-19"),
        dayTechnicianShift("p_ethan", { date: "2026-08-19" }),
        dayTechnicianShift("p_helper", { date: "2026-08-19" }),
      ],
      people: [person("p_ethan", { isTechnician: true }), person("p_helper", { isTechnician: true })],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([
        ["p_ethan", "user-ethan"],
        ["p_helper", "user-helper"],
      ]),
    });

    const teamJobs = upsertedFor("logistics_withdrawal_noon_team");
    expect(teamJobs).toHaveLength(1);
    expect(teamJobs[0]).toMatchObject({
      recipientUserId: "user-helper",
      title: "🤝 משיכות היום",
      body: "p_ethan עושה משיכות היום בין 13:00–14:00. נדרש לעזור לו.",
    });
    // Ethan himself never receives the generic help message about his own assignment.
    expect(store.upsertPendingSystemReminderJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ category: "logistics_withdrawal_noon_team", recipientUserId: "user-ethan" }), expect.anything()
    );
  });

  it("assigned Monday at noon: assigned technician, relevant supervisor, AND another eligible technician ALL receive their own distinct notification (the main bug -- the supervisor is no longer notified only when unassigned)", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-17", minuteOfDay: 600 }; // Monday
    const week = getOperationalWeek(now);

    await runReminders({
      events: [
        withdrawalAssignment("p_ethan", "2026-08-17"),
        dayTechnicianShift("p_ethan", { date: "2026-08-17" }),
        dayTechnicianShift("p_helper", { date: "2026-08-17" }),
        daySupervisorShift("p_sup", { date: "2026-08-17" }),
      ],
      people: [person("p_ethan", { isTechnician: true }), person("p_helper", { isTechnician: true })],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([
        ["p_ethan", "user-ethan"],
        ["p_helper", "user-helper"],
        ["p_sup", "user-sup"],
      ]),
    });

    const assignedJobs = upsertedFor("logistics_withdrawal_noon_assigned");
    expect(assignedJobs).toHaveLength(1);
    expect(assignedJobs[0]).toMatchObject({ recipientUserId: "user-ethan", title: "📦 משיכות בעוד שעה" });

    const supervisorJobs = upsertedFor("logistics_withdrawal_noon_supervisor");
    expect(supervisorJobs).toHaveLength(1);
    expect(supervisorJobs[0]).toMatchObject({ recipientUserId: "user-sup", title: "📦 משיכות היום" });
    expect(supervisorJobs[0].body).toBe("p_ethan עושה משיכות היום בין 13:00–14:00. נדרש לוודא שהוא מכיר את המשימה.");

    const teamJobs = upsertedFor("logistics_withdrawal_noon_team");
    expect(teamJobs).toHaveLength(1);
    expect(teamJobs[0]).toMatchObject({ recipientUserId: "user-helper", title: "🤝 משיכות היום" });

    // No cross-category duplication: the assignee and the supervisor never
    // receive the generic team job, and the supervisor is not double-booked.
    expect(store.upsertPendingSystemReminderJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ category: "logistics_withdrawal_noon_team", recipientUserId: "user-ethan" }), expect.anything(),
    );
    expect(store.upsertPendingSystemReminderJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ category: "logistics_withdrawal_noon_team", recipientUserId: "user-sup" }), expect.anything(),
    );
  });

  it("no assignee at noon: supervisor gets the warning AND eligible technicians get the all-hands fallback", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-17", minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [daySupervisorShift("p_sup", { date: "2026-08-17" }), dayTechnicianShift("p_tech", { date: "2026-08-17" })],
      people: [person("p_tech", { isTechnician: true })],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([
        ["p_sup", "user-sup"],
        ["p_tech", "user-tech"],
      ]),
    });

    const supervisorJobs = upsertedFor("logistics_withdrawal_noon_supervisor");
    expect(supervisorJobs).toHaveLength(1);
    expect(supervisorJobs[0]).toMatchObject({
      recipientUserId: "user-sup",
      title: "⚠️ לא הוגדר טכנאי למשיכות",
      body: "לא הוגדר טכנאי למשיכות היום בין 13:00–14:00. נדרש לוודא שכל הטכנאים הזמינים יוצאים למשיכות.",
    });

    const teamJobs = upsertedFor("logistics_withdrawal_noon_team");
    expect(teamJobs).toHaveLength(1);
    expect(teamJobs[0]).toMatchObject({
      recipientUserId: "user-tech",
      title: "📦 משיכות היום",
      body: "לא הוגדר טכנאי למשיכות היום. כל הטכנאים הזמינים נדרשים לצאת למשיכות בין 13:00–14:00.",
    });
  });

  it("an assignment appearing before noon reconciles the pending supervisor and team jobs on the next tick (supervisor is NOT cancelled)", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-17", minuteOfDay: 480 }; // 08:00 -- still unassigned
    const week = getOperationalWeek(now);
    const events = [daySupervisorShift("p_sup", { date: "2026-08-17" }), dayTechnicianShift("p_tech", { date: "2026-08-17" })];
    const people = [person("p_tech", { isTechnician: true })];
    const recipientResolution = resolutionFor([
      ["p_sup", "user-sup"],
      ["p_tech", "user-tech"],
      ["p_ethan", "user-ethan"],
    ]);

    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    await runReminders({ events, people, shiftSchedule: schedule, week, now, persist: true, recipientResolution });
    expect(upsertedFor("logistics_withdrawal_noon_supervisor")).toHaveLength(1);
    expect(upsertedFor("logistics_withdrawal_noon_team")).toHaveLength(1);

    // 09:00 -- Ethan gets assigned. Next tick's stale-key sweep reports the
    // previously-upserted fallback jobs as still pending.
    store.upsertPendingSystemReminderJob.mockClear();
    store.listPendingJobDedupeKeysByPrefix.mockImplementation(async (prefix: string) => {
      if (prefix === "logistics_withdrawal_noon_supervisor:2026-08-17:") return ["logistics_withdrawal_noon_supervisor:2026-08-17:user-sup"];
      if (prefix === "logistics_withdrawal_noon_team:2026-08-17:") return ["logistics_withdrawal_noon_team:2026-08-17:user-tech"];
      return [];
    });

    await runReminders({
      events: [...events, withdrawalAssignment("p_ethan", "2026-08-17")],
      people,
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
    });

    // The supervisor job REMAINS valid -- it is re-upserted using the SAME
    // dedupe identity, with its copy switched from the unassigned warning to
    // the assigned-informed copy naming Ethan. It must NOT be cancelled
    // merely because an assignee appeared.
    expect(store.cancelPendingSystemReminderJob).not.toHaveBeenCalledWith("logistics_withdrawal_noon_supervisor:2026-08-17:user-sup", expect.anything());
    const supervisorJobs = upsertedFor("logistics_withdrawal_noon_supervisor");
    expect(supervisorJobs).toHaveLength(1);
    expect(supervisorJobs[0]).toMatchObject({
      recipientUserId: "user-sup",
      dedupeKey: "logistics_withdrawal_noon_supervisor:2026-08-17:user-sup",
      title: "📦 משיכות היום",
    });
    expect(supervisorJobs[0].body).toContain("p_ethan");
    // p_tech is STILL a valid team recipient (still eligible) -- their job
    // is re-upserted with fresh "help Ethan" content, never cancelled.
    expect(store.cancelPendingSystemReminderJob).not.toHaveBeenCalledWith("logistics_withdrawal_noon_team:2026-08-17:user-tech", expect.anything());
    expect(upsertedFor("logistics_withdrawal_noon_assigned")).toHaveLength(1);
    const teamJobs = upsertedFor("logistics_withdrawal_noon_team");
    expect(teamJobs).toHaveLength(1);
    expect(teamJobs[0].body).toContain("p_ethan");
  });

  it("an assignment removed before noon switches back to the fallback on the next tick", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 480 };
    const week = getOperationalWeek(now);
    const recipientResolution = resolutionFor([["p_ethan", "user-ethan"]]);

    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    await runReminders({
      events: [withdrawalAssignment("p_ethan", "2026-08-19")],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
    });
    expect(upsertedFor("logistics_withdrawal_noon_assigned")).toHaveLength(1);

    store.upsertPendingSystemReminderJob.mockClear();
    store.listPendingJobDedupeKeysByPrefix.mockImplementation(async (prefix: string) => {
      if (prefix === "logistics_withdrawal_noon_assigned:2026-08-19:") return ["logistics_withdrawal_noon_assigned:2026-08-19:user-ethan"];
      return [];
    });

    await runReminders({
      events: [], // the assignment was removed
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
    });

    expect(upsertedFor("logistics_withdrawal_noon_assigned")).toHaveLength(0);
    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith("logistics_withdrawal_noon_assigned:2026-08-19:user-ethan", expect.anything());
  });

  it("reassignment from A to B cancels A's stale noon-assigned job and creates B's", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 480 };
    const week = getOperationalWeek(now);
    const recipientResolution = resolutionFor([
      ["p_a", "user-a"],
      ["p_b", "user-b"],
    ]);

    store.listPendingJobDedupeKeysByPrefix.mockImplementation(async (prefix: string) => {
      if (prefix === "logistics_withdrawal_noon_assigned:2026-08-19:") return ["logistics_withdrawal_noon_assigned:2026-08-19:user-a"];
      return [];
    });

    await runReminders({
      events: [withdrawalAssignment("p_b", "2026-08-19")], // now assigns B, not A
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
    });

    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith("logistics_withdrawal_noon_assigned:2026-08-19:user-a", expect.anything());
    expect(upsertedFor("logistics_withdrawal_noon_assigned")).toEqual([
      expect.objectContaining({ recipientUserId: "user-b", dedupeKey: "logistics_withdrawal_noon_assigned:2026-08-19:user-b" }),
    ]);
  });

  it("a technician who becomes absent before noon disappears from the team recipient set on the next tick", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 480 };
    const week = getOperationalWeek(now);
    const events = [dayTechnicianShift("p_helper", { date: "2026-08-19" })];
    const people = [person("p_helper", { isTechnician: true })];
    const recipientResolution = resolutionFor([
      ["p_ethan", "user-ethan"],
      ["p_helper", "user-helper"],
    ]);

    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    await runReminders({
      events: [...events, withdrawalAssignment("p_ethan", "2026-08-19")],
      people,
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
    });
    expect(upsertedFor("logistics_withdrawal_noon_team")).toHaveLength(1);

    store.upsertPendingSystemReminderJob.mockClear();
    store.listPendingJobDedupeKeysByPrefix.mockImplementation(async (prefix: string) => {
      if (prefix === "logistics_withdrawal_noon_team:2026-08-19:") return ["logistics_withdrawal_noon_team:2026-08-19:user-helper"];
      return [];
    });

    await runReminders({
      events: [
        ...events,
        withdrawalAssignment("p_ethan", "2026-08-19"),
        event({ personId: "p_helper", date: "2026-08-19", category: "absence", absenceKind: "referral" }),
      ],
      people,
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
    });

    expect(upsertedFor("logistics_withdrawal_noon_team")).toHaveLength(0);
    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith("logistics_withdrawal_noon_team:2026-08-19:user-helper", expect.anything());
  });

  it("multiple assignees consolidate into ONE team job per eligible technician AND ONE supervisor job, not one per assignee", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [
        withdrawalAssignment("p_a", "2026-08-19"),
        withdrawalAssignment("p_b", "2026-08-19"),
        dayTechnicianShift("p_helper", { date: "2026-08-19" }),
        daySupervisorShift("p_sup", { date: "2026-08-19" }),
      ],
      people: [person("p_helper", { isTechnician: true })],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([
        ["p_a", "user-a"],
        ["p_b", "user-b"],
        ["p_helper", "user-helper"],
        ["p_sup", "user-sup"],
      ]),
    });

    const teamJobs = upsertedFor("logistics_withdrawal_noon_team");
    expect(teamJobs).toHaveLength(1);
    expect(teamJobs[0].body).toContain("עושים");

    const supervisorJobs = upsertedFor("logistics_withdrawal_noon_supervisor");
    expect(supervisorJobs).toHaveLength(1);
    expect(supervisorJobs[0].recipientUserId).toBe("user-sup");
    expect(supervisorJobs[0].body).toBe("p_a וp_b עושים משיכות היום בין 13:00–14:00. נדרש לוודא שהם מכירים את המשימה.");
  });

  it("repeated worker ticks are idempotent -- identical dedupe keys both times", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 600 };
    const week = getOperationalWeek(now);
    const input = {
      events: [withdrawalAssignment("p_ethan", "2026-08-19")],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([["p_ethan", "user-ethan"]]),
    };

    await runReminders(input);
    await runReminders(input);

    const jobs = upsertedFor("logistics_withdrawal_noon_assigned");
    expect(jobs).toHaveLength(2);
    expect(jobs[0].dedupeKey).toBe(jobs[1].dedupeKey);
  });

  it("dry_run computes counts but performs no store mutations", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    const summary = await runReminders({
      events: [withdrawalAssignment("p_ethan", "2026-08-19"), daySupervisorShift("p_sup", { date: "2026-08-19" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: false,
      recipientResolution: resolutionFor([
        ["p_ethan", "user-ethan"],
        ["p_sup", "user-sup"],
      ]),
    });

    expect(summary.logisticsWithdrawalNoonAssignedJobs).toBe(1);
    expect(store.upsertPendingSystemReminderJob).not.toHaveBeenCalled();
    expect(store.cancelPendingSystemReminderJob).not.toHaveBeenCalled();
  });

  it("a person not resolvable to a Supabase account is skipped, never guessed (fails closed)", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [withdrawalAssignment("p_ethan", "2026-08-19")],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: { resolved: new Map(), unmappedCount: 1, ambiguousEmailCount: 0, noEmailCount: 0 },
    });

    expect(upsertedFor("logistics_withdrawal_noon_assigned")).toHaveLength(0);
  });

  it("works correctly across a Saturday -> Sunday operational-week boundary (noon reminders are calendar-date driven, not week-driven)", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-23", minuteOfDay: 600 }; // Sunday, new operational week
    const week = getOperationalWeek(now);

    await runReminders({
      events: [withdrawalAssignment("p_ethan", "2026-08-23")],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([["p_ethan", "user-ethan"]]),
    });

    expect(upsertedFor("logistics_withdrawal_noon_assigned")).toEqual([
      expect.objectContaining({ dedupeKey: "logistics_withdrawal_noon_assigned:2026-08-23:user-ethan" }),
    ]);
  });
});

describe("runReminders -- logistics-withdrawal fallback only ever exists for Monday", () => {
  // 2026-08-16=Sun, 17=Mon, 18=Tue, 19=Wed, 20=Thu, 21=Fri, 22=Sat.
  const NON_MONDAY_DATES = ["2026-08-16", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22"];

  it("no fallback job of any kind is created for an unassigned NON-Monday date, noon", async () => {
    for (const date of NON_MONDAY_DATES) {
      store.upsertPendingSystemReminderJob.mockClear();
      store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
      const { runReminders } = await loadModule();
      const now: LocalNow = { date, minuteOfDay: 600 };
      const week = getOperationalWeek(now);

      await runReminders({
        events: [daySupervisorShift("p_sup", { date }), dayTechnicianShift("p_tech", { date })],
        people: [person("p_tech", { isTechnician: true })],
        shiftSchedule: schedule,
        week,
        now,
        persist: true,
        recipientResolution: resolutionFor([
          ["p_sup", "user-sup"],
          ["p_tech", "user-tech"],
        ]),
      });

      expect(upsertedFor("logistics_withdrawal_noon_supervisor")).toEqual([]);
      expect(upsertedFor("logistics_withdrawal_noon_team")).toEqual([]);
    }
  });

  it("no fallback job of any kind is created when TOMORROW (the target date) is not a Monday, 20:00", async () => {
    // now=Monday (17th) -> tomorrow=Tuesday (18th, non-Monday) is the one
    // case worth singling out: the EVENING of a genuine withdrawal Monday
    // itself must not produce a fallback for the day AFTER it.
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-17", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [daySupervisorShift("p_sup", { date: "2026-08-18" }), dayTechnicianShift("p_tech", { date: "2026-08-18" })],
      people: [person("p_tech", { isTechnician: true })],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([
        ["p_sup", "user-sup"],
        ["p_tech", "user-tech"],
      ]),
    });

    expect(upsertedFor("tomorrow_logistics_withdrawal_supervisor")).toEqual([]);
  });

  it("an explicit 'משיכות' Event on a non-Monday still gets the FULL normal coordination treatment (an intentional exceptional withdrawal)", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const wednesday = "2026-08-19";
    const now: LocalNow = { date: wednesday, minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [
        withdrawalAssignment("p_ethan", wednesday),
        daySupervisorShift("p_sup", { date: wednesday }),
        dayTechnicianShift("p_helper", { date: wednesday }),
      ],
      people: [person("p_helper", { isTechnician: true })],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionFor([
        ["p_ethan", "user-ethan"],
        ["p_sup", "user-sup"],
        ["p_helper", "user-helper"],
      ]),
    });

    expect(upsertedFor("logistics_withdrawal_noon_assigned")).toHaveLength(1);
    // The relevant supervisor also gets notified -- an explicit assignment
    // is a real exceptional withdrawal regardless of weekday, so the
    // Monday-only restriction (which only governs the NO-ASSIGNEE fallback)
    // must never suppress it.
    expect(upsertedFor("logistics_withdrawal_noon_supervisor")).toEqual([
      expect.objectContaining({ recipientUserId: "user-sup", title: "📦 משיכות היום" }),
    ]);
    expect(upsertedFor("logistics_withdrawal_noon_team")).toEqual([
      expect.objectContaining({ recipientUserId: "user-helper", title: "🤝 משיכות היום" }),
    ]);
  });
});

// Known week used throughout this suite (also used above):
// Sun 2026-08-16, Mon 08-17, Tue 08-18, Wed 08-19, Thu 08-20, Fri 08-21, Sat 08-22.

function dutyEvent(personId: string, date: string, dutyFamily: DutyFamily, overrides: Partial<Event> = {}): Event {
  return event({ personId, date, category: "duty", dutyFamily, ...overrides });
}

describe("runReminders -- עלמ״ש check-in reminder (שמירה / עתודה / אוקסיד only)", () => {
  it.each<[DutyFamily, string]>([
    ["guard", "שמירה"],
    ["reserve", "עתודה"],
    ["oxid", "אוקסיד"],
  ])("creates the correct עלמ״ש reminder for %s (%s)", async (dutyFamily, label) => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const wednesday = "2026-08-19";
    const now: LocalNow = { date: wednesday, minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [dutyEvent("p1", wednesday, dutyFamily)],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(upsertedFor("almash_check_in")).toEqual([
      expect.objectContaining({
        category: "almash_check_in",
        recipientUserId: "user-p1",
        title: "🫡 עלמ״ש בעוד רבע שעה",
        body: `יש לך היום עלמ״ש ל${label} — מתחילים ב־13:00`,
        path: "/duties",
        dedupeKey: `almash_check_in:${wednesday}:user-p1:${dutyFamily}:`,
        scheduledFor: jerusalemLocalTimeToInstant(wednesday, 12, 45).toISOString(),
      }),
    ]);
  });

  it.each<DutyFamily>(["rasar", "callup", "full_kitchen", "daily_kitchen", "weekend_kitchen", "evacuation_on_call"])(
    "never fires for %s -- only שמירה/עתודה/אוקסיד qualify, even though deriveDutyActions() itself has a check-in for this family too",
    async (dutyFamily) => {
      store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
      const { runReminders } = await loadModule();
      const wednesday = "2026-08-19";
      const now: LocalNow = { date: wednesday, minuteOfDay: 600 };
      const week = getOperationalWeek(now);

      await runReminders({
        events: [dutyEvent("p1", wednesday, dutyFamily)],
        people: [],
        shiftSchedule: schedule,
        week,
        now,
        persist: true,
        recipientResolution: resolutionWith("p1", "user-p1"),
      });

      expect(upsertedFor("almash_check_in")).toEqual([]);
    },
  );

  it("a 3-day guard duty gets a check-in on day 1 and day 2, never on the final day", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const threeDayEvents = [
      dutyEvent("p1", "2026-08-19", "guard"),
      dutyEvent("p1", "2026-08-20", "guard"),
      dutyEvent("p1", "2026-08-21", "guard"),
    ];

    for (const [today, expectFires] of [
      ["2026-08-19", true],
      ["2026-08-20", true],
      ["2026-08-21", false],
    ] as const) {
      store.upsertPendingSystemReminderJob.mockClear();
      const { runReminders } = await loadModule();
      const now: LocalNow = { date: today, minuteOfDay: 600 };
      const week = getOperationalWeek(now);

      await runReminders({
        events: threeDayEvents,
        people: [],
        shiftSchedule: schedule,
        week,
        now,
        persist: true,
        recipientResolution: resolutionWith("p1", "user-p1"),
      });

      expect(upsertedFor("almash_check_in")).toHaveLength(expectFires ? 1 : 0);
    }
  });

  it("a single-day duty behaves like day 1 of a multi-day block -- it still gets its one check-in", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const wednesday = "2026-08-19";
    const now: LocalNow = { date: wednesday, minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [dutyEvent("p1", wednesday, "oxid")],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(upsertedFor("almash_check_in")).toHaveLength(1);
  });

  it("Friday is scheduled at 12:45 Jerusalem, same as any other weekday -- only Saturday is special", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const friday = "2026-08-21";
    const now: LocalNow = { date: friday, minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [dutyEvent("p1", friday, "guard")],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(upsertedFor("almash_check_in")).toEqual([
      expect.objectContaining({ scheduledFor: jerusalemLocalTimeToInstant(friday, 12, 45).toISOString() }),
    ]);
  });

  it("Saturday uses the real resolved מוצ״ש instant and the Saturday-specific copy, never 12:45/13:00", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const saturday = "2026-08-22";
    const now: LocalNow = { date: saturday, minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [dutyEvent("p1", saturday, "guard")],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    const expectedMotzash = resolveMotzashShabbatInstant(saturday)!.toISOString();
    // Sanity: genuinely different from what 12:45 that day would have been.
    expect(expectedMotzash).not.toBe(jerusalemLocalTimeToInstant(saturday, 12, 45).toISOString());

    expect(upsertedFor("almash_check_in")).toEqual([
      expect.objectContaining({
        title: "🫡 הגיע הזמן לעלמ״ש",
        body: "יש לך הערב עלמ״ש לשמירה",
        scheduledFor: expectedMotzash,
      }),
    ]);
  });

  it("repeated ticks with the same input use the identical dedupe key -- no duplicates, upsert-idempotent", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const wednesday = "2026-08-19";
    const now: LocalNow = { date: wednesday, minuteOfDay: 600 };
    const week = getOperationalWeek(now);
    const input = {
      events: [dutyEvent("p1", wednesday, "reserve")],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    };

    const { runReminders: tick1 } = await loadModule();
    await tick1(input);
    const firstKey = upsertedFor("almash_check_in")[0]?.dedupeKey;

    const { runReminders: tick2 } = await loadModule();
    await tick2(input);
    const secondKey = upsertedFor("almash_check_in")[0]?.dedupeKey;

    expect(firstKey).toBeDefined();
    expect(secondKey).toBe(firstKey);
  });

  it("cancels a still-pending עלמ״ש job whose qualifying duty disappeared before send", async () => {
    const staleKey = "almash_check_in:2026-08-19:user-p1:guard:";
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([staleKey]);
    const { runReminders } = await loadModule();
    const wednesday = "2026-08-19";
    const now: LocalNow = { date: wednesday, minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [], // the duty no longer exists
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith(staleKey, expect.anything());
  });

  it("never creates a job for a person who cannot be resolved to an auth user -- same recipient-resolution rule as every other reminder", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const wednesday = "2026-08-19";
    const now: LocalNow = { date: wednesday, minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [dutyEvent("p_unmapped", wednesday, "guard")],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"), // p_unmapped is NOT in the resolution
    });

    expect(upsertedFor("almash_check_in")).toEqual([]);
  });

  it("two qualifying same-day duty families for one person produce two distinct jobs AND two distinct Push tags -- the service worker collapses same-tag pushes at the OS level (public/sw.js), so a coarser tag would silently drop one", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const { runReminders } = await loadModule();
    const wednesday = "2026-08-19";
    const now: LocalNow = { date: wednesday, minuteOfDay: 600 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [dutyEvent("p1", wednesday, "guard"), dutyEvent("p1", wednesday, "oxid")],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    const jobs = upsertedFor("almash_check_in");
    expect(jobs).toHaveLength(2);

    const dedupeKeys = jobs.map((job) => job.dedupeKey);
    const tags = jobs.map((job) => job.tag);
    expect(new Set(dedupeKeys).size).toBe(2);
    expect(new Set(tags).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Editable SYSTEM notification copy + audience filtering (follow-up to the
// Fixed / Recurring Notifications Center). Two invariants, proven per
// category below: (1) a "selected" audience is a FILTER that still
// delivers to a person who IS in `targetPersonIds` AND domain-eligible --
// proving each category passes the correct STABLE ROSTER PERSON ID (never
// an auth user id) into `isSystemRulePersonAllowed`; (2) selecting a
// person who is NOT domain-eligible delivers NOTHING for that category,
// even though someone else genuinely is eligible -- proving the filter can
// only narrow, never expand, a category's own protected domain-eligibility
// logic (spec: "can never expand eligibility").
// ---------------------------------------------------------------------------
describe("audience filtering -- system_target_person_ids FILTERS domain eligibility, never expands it (all 10 categories)", () => {
  it("tomorrow_shift: selecting the actually-scheduled person still delivers; selecting someone without a shift tomorrow delivers nothing", async () => {
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);
    const events = [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })];
    const recipientResolution = resolutionWith("p1", "user-p1");

    let { runReminders } = await loadModule();
    await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ tomorrow_shift: { audienceMode: "selected", targetPersonIds: ["p1"] } }),
    });
    expect(upsertedFor("tomorrow_shift")).toHaveLength(1);

    store.upsertPendingSystemReminderJob.mockClear();
    ({ runReminders } = await loadModule());
    const summary = await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ tomorrow_shift: { audienceMode: "selected", targetPersonIds: ["p_not_scheduled"] } }),
    });
    expect(summary.tomorrowShiftJobs).toBe(0);
    expect(upsertedFor("tomorrow_shift")).toHaveLength(0);
  });

  it("tomorrow_duty: selecting the actually-scheduled person still delivers; selecting someone without a duty tomorrow delivers nothing", async () => {
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);
    const events = [event({ personId: "p1", date: "2026-08-19", category: "duty", dutyFamily: "guard" })];
    const recipientResolution = resolutionWith("p1", "user-p1");

    let { runReminders } = await loadModule();
    await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ tomorrow_duty: { audienceMode: "selected", targetPersonIds: ["p1"] } }),
    });
    expect(upsertedFor("tomorrow_duty")).toHaveLength(1);

    store.upsertPendingSystemReminderJob.mockClear();
    ({ runReminders } = await loadModule());
    const summary = await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ tomorrow_duty: { audienceMode: "selected", targetPersonIds: ["p_not_scheduled"] } }),
    });
    expect(summary.tomorrowDutyJobs).toBe(0);
    expect(upsertedFor("tomorrow_duty")).toHaveLength(0);
  });

  it("tomorrow_logistics_withdrawal: selecting the actually-assigned person still delivers; selecting someone else delivers nothing", async () => {
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);
    const events = [event({ personId: "p1", date: "2026-08-19", category: "other", title: "משיכות מהלוגיסטיקה" })];
    const recipientResolution = resolutionWith("p1", "user-p1");

    let { runReminders } = await loadModule();
    await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ tomorrow_logistics_withdrawal: { audienceMode: "selected", targetPersonIds: ["p1"] } }),
    });
    expect(upsertedFor("tomorrow_logistics_withdrawal")).toHaveLength(1);

    store.upsertPendingSystemReminderJob.mockClear();
    ({ runReminders } = await loadModule());
    const summary = await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ tomorrow_logistics_withdrawal: { audienceMode: "selected", targetPersonIds: ["p_not_assigned"] } }),
    });
    expect(summary.tomorrowLogisticsWithdrawalJobs).toBe(0);
    expect(upsertedFor("tomorrow_logistics_withdrawal")).toHaveLength(0);
  });

  it("tomorrow_logistics_withdrawal_supervisor: selecting the actually-relevant supervisor still delivers; selecting someone else delivers nothing", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);
    const events = [withdrawalAssignment("p_ethan", "2026-08-19"), daySupervisorShift("p_sup", { date: "2026-08-19" })];
    const recipientResolution = resolutionFor([
      ["p_ethan", "user-ethan"],
      ["p_sup", "user-sup"],
    ]);

    let { runReminders } = await loadModule();
    await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ tomorrow_logistics_withdrawal_supervisor: { audienceMode: "selected", targetPersonIds: ["p_sup"] } }),
    });
    expect(upsertedFor("tomorrow_logistics_withdrawal_supervisor")).toHaveLength(1);

    store.upsertPendingSystemReminderJob.mockClear();
    ({ runReminders } = await loadModule());
    const summary = await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ tomorrow_logistics_withdrawal_supervisor: { audienceMode: "selected", targetPersonIds: ["p_not_a_supervisor"] } }),
    });
    expect(summary.tomorrowLogisticsWithdrawalSupervisorJobs).toBe(0);
    expect(upsertedFor("tomorrow_logistics_withdrawal_supervisor")).toHaveLength(0);
  });

  it("logistics_withdrawal_noon_assigned: selecting the actually-assigned person still delivers; selecting someone else delivers nothing", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 600 };
    const week = getOperationalWeek(now);
    const events = [withdrawalAssignment("p_ethan", "2026-08-19")];
    const recipientResolution = resolutionFor([["p_ethan", "user-ethan"]]);

    let { runReminders } = await loadModule();
    await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ logistics_withdrawal_noon_assigned: { audienceMode: "selected", targetPersonIds: ["p_ethan"] } }),
    });
    expect(upsertedFor("logistics_withdrawal_noon_assigned")).toHaveLength(1);

    store.upsertPendingSystemReminderJob.mockClear();
    ({ runReminders } = await loadModule());
    const summary = await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ logistics_withdrawal_noon_assigned: { audienceMode: "selected", targetPersonIds: ["p_not_assigned"] } }),
    });
    expect(summary.logisticsWithdrawalNoonAssignedJobs).toBe(0);
    expect(upsertedFor("logistics_withdrawal_noon_assigned")).toHaveLength(0);
  });

  it("logistics_withdrawal_noon_supervisor: selecting the actually-relevant supervisor still delivers; selecting someone else delivers nothing", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const now: LocalNow = { date: "2026-08-17", minuteOfDay: 600 }; // Monday, unassigned
    const week = getOperationalWeek(now);
    const events = [daySupervisorShift("p_sup", { date: "2026-08-17" }), dayTechnicianShift("p_tech", { date: "2026-08-17" })];
    const people = [person("p_tech", { isTechnician: true })];
    const recipientResolution = resolutionFor([
      ["p_sup", "user-sup"],
      ["p_tech", "user-tech"],
    ]);

    let { runReminders } = await loadModule();
    await runReminders({
      events,
      people,
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ logistics_withdrawal_noon_supervisor: { audienceMode: "selected", targetPersonIds: ["p_sup"] } }),
    });
    expect(upsertedFor("logistics_withdrawal_noon_supervisor")).toHaveLength(1);

    store.upsertPendingSystemReminderJob.mockClear();
    ({ runReminders } = await loadModule());
    const summary = await runReminders({
      events,
      people,
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ logistics_withdrawal_noon_supervisor: { audienceMode: "selected", targetPersonIds: ["p_not_a_supervisor"] } }),
    });
    expect(summary.logisticsWithdrawalNoonSupervisorJobs).toBe(0);
    expect(upsertedFor("logistics_withdrawal_noon_supervisor")).toHaveLength(0);
  });

  it("logistics_withdrawal_noon_team: selecting an actually-eligible teammate still delivers; selecting someone else delivers nothing", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 600 };
    const week = getOperationalWeek(now);
    const events = [
      withdrawalAssignment("p_ethan", "2026-08-19"),
      dayTechnicianShift("p_ethan", { date: "2026-08-19" }),
      dayTechnicianShift("p_helper", { date: "2026-08-19" }),
    ];
    const people = [person("p_ethan", { isTechnician: true }), person("p_helper", { isTechnician: true })];
    const recipientResolution = resolutionFor([
      ["p_ethan", "user-ethan"],
      ["p_helper", "user-helper"],
    ]);

    let { runReminders } = await loadModule();
    await runReminders({
      events,
      people,
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ logistics_withdrawal_noon_team: { audienceMode: "selected", targetPersonIds: ["p_helper"] } }),
    });
    expect(upsertedFor("logistics_withdrawal_noon_team")).toHaveLength(1);

    store.upsertPendingSystemReminderJob.mockClear();
    ({ runReminders } = await loadModule());
    const summary = await runReminders({
      events,
      people,
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ logistics_withdrawal_noon_team: { audienceMode: "selected", targetPersonIds: ["p_not_eligible"] } }),
    });
    expect(summary.logisticsWithdrawalNoonTeamJobs).toBe(0);
    expect(upsertedFor("logistics_withdrawal_noon_team")).toHaveLength(0);
  });

  it("almash_check_in: selecting the person with today's עלמ״ש still delivers; selecting someone else delivers nothing", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockResolvedValue([]);
    const wednesday = "2026-08-19";
    const now: LocalNow = { date: wednesday, minuteOfDay: 600 };
    const week = getOperationalWeek(now);
    const events = [dutyEvent("p1", wednesday, "guard")];
    const recipientResolution = resolutionWith("p1", "user-p1");

    let { runReminders } = await loadModule();
    await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ almash_check_in: { audienceMode: "selected", targetPersonIds: ["p1"] } }),
    });
    expect(upsertedFor("almash_check_in")).toHaveLength(1);

    store.upsertPendingSystemReminderJob.mockClear();
    ({ runReminders } = await loadModule());
    const summary = await runReminders({
      events,
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution,
      ruleConfig: defaultRuleConfig({ almash_check_in: { audienceMode: "selected", targetPersonIds: ["p_not_on_duty"] } }),
    });
    expect(summary.almashCheckInJobs).toBe(0);
    expect(upsertedFor("almash_check_in")).toHaveLength(0);
  });

  it("constraints_sunday: selecting an actually-eligible non-permanent person still delivers; selecting someone else delivers nothing", async () => {
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    const now: LocalNow = { date: "2026-08-16", minuteOfDay: 1080 }; // Sunday
    const week = getOperationalWeek(now);

    let { runReminders } = await loadModule();
    await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
      ruleConfig: defaultRuleConfig({ constraints_sunday: { audienceMode: "selected", targetPersonIds: ["p_a"] } }),
    });
    expect(upsertedFor("constraints_sunday")).toHaveLength(1);

    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    store.upsertPendingSystemReminderJob.mockClear();
    ({ runReminders } = await loadModule());
    const summary = await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
      ruleConfig: defaultRuleConfig({ constraints_sunday: { audienceMode: "selected", targetPersonIds: ["p_permanent_or_unrelated"] } }),
    });
    expect(summary.constraintsJobs).toBe(0);
    expect(upsertedFor("constraints_sunday")).toHaveLength(0);
  });

  it("constraints_monday: selecting an actually-eligible non-permanent person still delivers; selecting someone else delivers nothing", async () => {
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    const now: LocalNow = { date: "2026-08-17", minuteOfDay: 600 }; // Monday
    const week = getOperationalWeek(now);

    let { runReminders } = await loadModule();
    await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
      ruleConfig: defaultRuleConfig({ constraints_monday: { audienceMode: "selected", targetPersonIds: ["p_a"] } }),
    });
    expect(upsertedFor("constraints_monday")).toHaveLength(1);

    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    store.upsertPendingSystemReminderJob.mockClear();
    ({ runReminders } = await loadModule());
    const summary = await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
      ruleConfig: defaultRuleConfig({ constraints_monday: { audienceMode: "selected", targetPersonIds: ["p_permanent_or_unrelated"] } }),
    });
    expect(summary.constraintsJobs).toBe(0);
    expect(upsertedFor("constraints_monday")).toHaveLength(0);
  });

  it("constraints: a selected PERMANENT person is never a candidate at all -- resolveNonPermanentConstraintsRecipients already excludes them, so the audience filter can never reach/include them regardless of what's stored", async () => {
    // The permanent person is never even returned as a candidate -- this is
    // the actual safety mechanism (see recipients.ts's own docstring); the
    // audience filter downstream never gets a chance to include them.
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    const now: LocalNow = { date: "2026-08-16", minuteOfDay: 1080 }; // Sunday
    const week = getOperationalWeek(now);

    const { runReminders } = await loadModule();
    const summary = await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
      // Even selecting the id of a hypothetical permanent person "p_permanent" can never matter --
      // resolveNonPermanentConstraintsRecipients (mocked here as it would behave in reality) never returns them.
      ruleConfig: defaultRuleConfig({ constraints_sunday: { audienceMode: "selected", targetPersonIds: ["p_permanent"] } }),
    });

    expect(summary.constraintsJobs).toBe(0);
    expect(upsertedFor("constraints_sunday")).toHaveLength(0);
  });

  it("constraints: selecting the 'groups' audience mode with the permanent group can never deliver to permanent staff -- same structural safety as 'selected'", async () => {
    // Even if a manager configures the constraints reminder to target the
    // dynamic "permanent" (קבע) group, `resolveNonPermanentConstraintsRecipients`
    // (mocked here exactly as it behaves in reality -- see that function's
    // own docstring) never returns a permanent person as a candidate in
    // the first place, so `isSystemRulePersonAllowed`'s own group-matching
    // logic never even gets a chance to evaluate them. This is the "system
    // audience filters cannot broaden domain eligibility" guarantee,
    // proven specifically for the hard-rule case: קבע must never receive
    // constraint reminders, no matter what audience configuration is saved.
    resolveNonPermanentConstraintsRecipients.mockResolvedValue([{ personId: "p_a", userId: "user-a" }]);
    const now: LocalNow = { date: "2026-08-16", minuteOfDay: 1080 }; // Sunday
    const week = getOperationalWeek(now);

    const { runReminders } = await loadModule();
    const summary = await runReminders({
      events: [],
      people: [
        {
          id: "p_a",
          name: "a",
          email: "a@x.com",
          isManager: false,
          isTechnician: false,
          isSupervisor: false,
          personnelType: "חובה",
          dischargeDate: null,
          enlistmentDate: null,
        },
      ],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: emptyRecipientResolution,
      ruleConfig: defaultRuleConfig({ constraints_sunday: { audienceMode: "groups", audienceGroupKeys: ["permanent"] } }),
    });

    // The candidate (p_a) is non-permanent (חובה), so selecting the
    // "permanent" group correctly excludes them too -- zero jobs, never a
    // permanent person slipping through, and never an accidental match on
    // an unrelated non-permanent candidate either.
    expect(summary.constraintsJobs).toBe(0);
    expect(upsertedFor("constraints_sunday")).toHaveLength(0);
  });
});

describe("editable system-rule copy -- title/body overrides applied at send time (per bodyKind)", () => {
  it("static-body category (tomorrow_logistics_withdrawal): a saved title+body override fully replaces the built-in copy", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "other", title: "משיכות מהלוגיסטיקה" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      ruleConfig: defaultRuleConfig({
        tomorrow_logistics_withdrawal: { titleOverride: "כותרת מותאמת", bodyOverride: "תוכן מותאם לגמרי" },
      }),
    });

    expect(upsertedFor("tomorrow_logistics_withdrawal")).toEqual([
      expect.objectContaining({ title: "כותרת מותאמת", body: "תוכן מותאם לגמרי" }),
    ]);
  });

  it("dynamic-body category (tomorrow_shift): a saved title override replaces the title; a null body override leaves the real dynamic details untouched", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      ruleConfig: defaultRuleConfig({ tomorrow_shift: { titleOverride: "כותרת מותאמת" } }),
    });

    expect(upsertedFor("tomorrow_shift")).toEqual([
      expect.objectContaining({ title: "כותרת מותאמת", body: expect.stringContaining("מחר") }),
    ]);
  });

  it("dynamic-body category (tomorrow_shift): a {details} body template is substituted with the real, per-occurrence dynamic details -- never lost", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "unspecified" })], // unresolvable period, no label -> the real, truthful fallback sentence
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      ruleConfig: defaultRuleConfig({ tomorrow_shift: { bodyOverride: "⚠️ תזכורת חשובה: {details}" } }),
    });

    expect(upsertedFor("tomorrow_shift")).toEqual([
      expect.objectContaining({ title: "⏰ המשמרת שלך מחר", body: "⚠️ תזכורת חשובה: מחר יש לך משמרת" }),
    ]);
  });

  it("null title/body overrides reproduce the exact SAME built-in copy as before this feature existed -- default compatibility", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      // defaultRuleConfig() with no overrides -- titleOverride/bodyOverride null, audienceMode all_eligible.
    });

    expect(upsertedFor("tomorrow_shift")).toEqual([
      expect.objectContaining({ title: "⏰ המשמרת שלך מחר", body: expect.stringContaining("מחר ב־07:00 מתחילה משמרת יום שלך") }),
    ]);
  });
});

describe("runReminders -- Emergency Mode (spec section 24/25)", () => {
  it("tomorrow_shift builds desk-based content from emergencyAssignments when operationalMode is 'emergency', never from events", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      operationalMode: "emergency",
      emergencyAssignments: [
        { date: "2026-08-19", period: "day", desk: "הוגוורט", personId: "p1", personName: "אחד", sourceCell: "C2" },
      ],
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "tomorrow_shift",
        recipientUserId: "user-p1",
        dedupeKey: "tomorrow_shift:2026-08-19:user-p1:day",
        body: expect.stringContaining("הוגוורט"),
        path: "/schedule",
      }),
      expect.anything(),
    );
  });

  it("combines multiple desks for the same person+date+period into ONE job, never one per desk cell", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      operationalMode: "emergency",
      emergencyAssignments: [
        { date: "2026-08-19", period: "day", desk: "הוגוורט", personId: "p1", personName: "אחד", sourceCell: "C2" },
        { date: "2026-08-19", period: "day", desk: "תיעוד", personId: "p1", personName: "אחד", sourceCell: "J2" },
      ],
    });

    const jobs = store.upsertPendingSystemReminderJob.mock.calls
      .map((call) => call[0])
      .filter((job) => job.category === "tomorrow_shift");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].body).toContain("הוגוורט");
    expect(jobs[0].body).toContain("תיעוד");
  });

  it("an unresolved desk assignment (personId null) never becomes a reminder job", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      operationalMode: "emergency",
      emergencyAssignments: [
        { date: "2026-08-19", period: "day", desk: "הוגוורט", personId: null, personName: "לא ידוע", sourceCell: "C2" },
      ],
    });

    expect(store.upsertPendingSystemReminderJob).not.toHaveBeenCalled();
  });

  it("entering Emergency Mode cancels a stale regular tomorrow_shift job for someone no longer on any desk -- same category/dedupe-key prefix, no special transition handling needed", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockImplementation(async (prefix: string) =>
      prefix === "tomorrow_shift:2026-08-19:" ? ["tomorrow_shift:2026-08-19:user-p1:day"] : [],
    );
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })], // stale regular data, must not be consulted
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      operationalMode: "emergency",
      emergencyAssignments: [], // p1 has no desk assignment tomorrow
    });

    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith("tomorrow_shift:2026-08-19:user-p1:day", expect.anything());
  });

  it("tomorrow_duty is suspended entirely during Emergency Mode -- no job created, and any already-pending job is cancelled", async () => {
    store.listPendingJobDedupeKeysByPrefix.mockImplementation(async (prefix: string) =>
      prefix === "tomorrow_duty:2026-08-19:" ? ["tomorrow_duty:2026-08-19:user-p1:guard:"] : [],
    );
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "duty", dutyFamily: "guard" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      operationalMode: "emergency",
      emergencyAssignments: [],
    });

    const dutyJobs = store.upsertPendingSystemReminderJob.mock.calls.map((call) => call[0]).filter((job) => job.category === "tomorrow_duty");
    expect(dutyJobs).toHaveLength(0);
    expect(store.cancelPendingSystemReminderJob).toHaveBeenCalledWith("tomorrow_duty:2026-08-19:user-p1:guard:", expect.anything());
  });

  it("almash_check_in is suspended entirely during Emergency Mode", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-19", minuteOfDay: 700 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "duty", dutyFamily: "guard" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
      operationalMode: "emergency",
      emergencyAssignments: [],
    });

    const almashJobs = store.upsertPendingSystemReminderJob.mock.calls
      .map((call) => call[0])
      .filter((job) => job.category === "almash_check_in");
    expect(almashJobs).toHaveLength(0);
  });

  it("every tomorrow/noon logistics-withdrawal reminder is suspended entirely during Emergency Mode (fail closed -- never reads regular 'who's on shift' data)", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-17", minuteOfDay: 1200 }; // Monday -- would normally be a fallback logistics-withdrawal date
    const week = getOperationalWeek(now);

    await runReminders({
      events: [
        event({ personId: "sup1", date: "2026-08-18", category: "shift", period: "day", role: "supervisor" }),
        event({ personId: "tech1", date: "2026-08-18", category: "shift", period: "day", role: "technician" }),
      ],
      people: [
        { id: "sup1", name: "מפקד", email: null, isManager: false, isTechnician: false, isSupervisor: true, personnelType: null, dischargeDate: null, enlistmentDate: null },
        { id: "tech1", name: "טכנאי", email: null, isManager: false, isTechnician: true, isSupervisor: false, personnelType: null, dischargeDate: null, enlistmentDate: null },
      ],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: {
        resolved: new Map([
          ["sup1", { personId: "sup1", email: "sup1@example.com", userId: "user-sup1" }],
          ["tech1", { personId: "tech1", email: "tech1@example.com", userId: "user-tech1" }],
        ]),
        unmappedCount: 0,
        ambiguousEmailCount: 0,
        noEmailCount: 0,
      },
      operationalMode: "emergency",
      emergencyAssignments: [],
    });

    const logisticsJobs = store.upsertPendingSystemReminderJob.mock.calls
      .map((call) => call[0])
      .filter((job) => job.category.includes("logistics_withdrawal"));
    expect(logisticsJobs).toHaveLength(0);
  });

  it("regular mode (the default) is completely unaffected -- omitting operationalMode/emergencyAssignments still builds tomorrow_shift from events", async () => {
    const { runReminders } = await loadModule();
    const now: LocalNow = { date: "2026-08-18", minuteOfDay: 1200 };
    const week = getOperationalWeek(now);

    await runReminders({
      events: [event({ personId: "p1", date: "2026-08-19", category: "shift", period: "day" })],
      people: [],
      shiftSchedule: schedule,
      week,
      now,
      persist: true,
      recipientResolution: resolutionWith("p1", "user-p1"),
    });

    expect(store.upsertPendingSystemReminderJob).toHaveBeenCalledWith(
      expect.objectContaining({ category: "tomorrow_shift", recipientUserId: "user-p1" }),
      expect.anything(),
    );
  });
});
