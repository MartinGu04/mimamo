import { afterEach, describe, expect, it, vi } from "vitest";
import type { Person } from "@/lib/domain/types";

function person(overrides: Partial<Person> & Pick<Person, "id" | "name">): Person {
  return { email: null, isManager: false, isTechnician: false, isSupervisor: false, personnelType: null, dischargeDate: null, enlistmentDate: null, ...overrides };
}

interface FakeUser {
  id: string;
  email: string;
}

/**
 * A single fake Supabase client covering every table
 * `sendManagerBroadcastNotification` touches: the Admin API user listing +
 * `push_subscriptions` (via `recipients.ts`), and `manager_notification_batches`
 * + `notification_jobs` (via `store.ts`). Unique-constraint conflicts are
 * modeled exactly like real Postgres: a repeated `idempotency_key`/
 * `dedupe_key` insert returns a `23505` error, mirroring
 * `insertManagerNotificationBatchIfAbsent`/`insertNotificationJobIfAbsent`'s
 * own real conflict-handling contract.
 */
function makeFakeSupabase(users: FakeUser[], subscribedUserIds: string[] = []) {
  const batchesByIdempotencyKey = new Map<string, Record<string, unknown>>();
  const jobsByDedupeKey = new Map<string, Record<string, unknown>>();
  let batchCounter = 0;
  let jobCounter = 0;

  const client = {
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users }, error: null })),
      },
    },
    from: (table: string) => {
      if (table === "push_subscriptions") {
        return {
          // `.select(...).is("revoked_at", null)` -- only ACTIVE devices
          // count towards `pushCapableCount`; a removed or permanently-
          // failed device must never inflate it.
          select: () => ({
            is: () => Promise.resolve({ data: subscribedUserIds.map((user_id) => ({ user_id })), error: null }),
          }),
        };
      }

      if (table === "manager_notification_batches") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const key = row.idempotency_key as string;
                if (batchesByIdempotencyKey.has(key)) return { data: null, error: { code: "23505" } };
                batchCounter += 1;
                const stored = { id: `batch_${batchCounter}`, created_at: "2026-08-21T08:00:00.000Z", ...row };
                batchesByIdempotencyKey.set(key, stored);
                return { data: stored, error: null };
              },
            }),
          }),
          select: () => ({
            eq: (_column: string, value: string) => ({
              maybeSingle: async () => ({ data: batchesByIdempotencyKey.get(value) ?? null, error: null }),
            }),
          }),
        };
      }

      if (table === "notification_jobs") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              maybeSingle: async () => {
                const key = row.dedupe_key as string;
                if (jobsByDedupeKey.has(key)) return { data: null, error: { code: "23505" } };
                jobCounter += 1;
                const stored = { id: `job_${jobCounter}`, ...row };
                jobsByDedupeKey.set(key, stored);
                return { data: stored, error: null };
              },
            }),
          }),
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
  };

  return { client, batchesByIdempotencyKey, jobsByDedupeKey };
}

async function loadModule(fakeClient: unknown) {
  vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeClient }));
  return import("./manualBroadcast");
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

const MANAGER = person({ id: "p_manager", name: "דני מנהל", isManager: true });

describe("sendManagerBroadcastNotification -- title/body validation", () => {
  it("rejects a blank title", async () => {
    const { sendManagerBroadcastNotification } = await loadModule(makeFakeSupabase([]));
    const result = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER],
      audienceKind: "everyone",
      targetPersonIds: [],
      title: "   ",
      body: "תוכן",
      idempotencyKey: "idem-1",
    });
    expect(result).toEqual({ ok: false, error: "invalid_title" });
  });

  it("rejects a whitespace-only body", async () => {
    const { sendManagerBroadcastNotification } = await loadModule(makeFakeSupabase([]));
    const result = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER],
      audienceKind: "everyone",
      targetPersonIds: [],
      title: "כותרת",
      body: "\n\t ",
      idempotencyKey: "idem-1",
    });
    expect(result).toEqual({ ok: false, error: "invalid_body" });
  });

  it("rejects a title over the max length", async () => {
    const { sendManagerBroadcastNotification, BROADCAST_TITLE_MAX_LENGTH } = await loadModule(makeFakeSupabase([]));
    const result = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER],
      audienceKind: "everyone",
      targetPersonIds: [],
      title: "א".repeat(BROADCAST_TITLE_MAX_LENGTH + 1),
      body: "תוכן",
      idempotencyKey: "idem-1",
    });
    expect(result).toEqual({ ok: false, error: "invalid_title" });
  });

  it("rejects an empty 'people' selection as an audience-cardinality violation ('people' requires at least one id)", async () => {
    const { sendManagerBroadcastNotification } = await loadModule(makeFakeSupabase([]));
    const result = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, person({ id: "p_1", name: "אחד" })],
      audienceKind: "people",
      targetPersonIds: [],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-1",
    });
    expect(result).toEqual({ ok: false, error: "invalid_audience" });
  });

  it("rejects an 'everyone' send against an empty roster as no_targets -- 'everyone' has no id-based cardinality rule, but an empty roster is still nothing to send to", async () => {
    const { sendManagerBroadcastNotification } = await loadModule(makeFakeSupabase([]));
    const result = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [],
      audienceKind: "everyone",
      targetPersonIds: [],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-1",
    });
    expect(result).toEqual({ ok: false, error: "no_targets" });
  });
});

describe("sendManagerBroadcastNotification -- server-side audience cardinality (independent of the UI)", () => {
  it("'person' with zero ids is rejected", async () => {
    const { sendManagerBroadcastNotification } = await loadModule(makeFakeSupabase([]));
    const result = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, person({ id: "p_1", name: "אחד" })],
      audienceKind: "person",
      targetPersonIds: [],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-1",
    });
    expect(result).toEqual({ ok: false, error: "invalid_audience" });
  });

  it("'person' with MORE THAN ONE id is rejected -- a tampered client can never submit a single-person audienceKind with a multi-person payload", async () => {
    const { sendManagerBroadcastNotification } = await loadModule(makeFakeSupabase([]));
    const result = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, person({ id: "p_1", name: "אחד" }), person({ id: "p_2", name: "שתיים" })],
      audienceKind: "person",
      targetPersonIds: ["p_1", "p_2"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-1",
    });
    expect(result).toEqual({ ok: false, error: "invalid_audience" });
  });

  it("'person' with the SAME id repeated twice is still exactly one target -- deduped before the cardinality check, never a false rejection", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase([{ id: "user-dana", email: "dana@example.invalid" }], ["user-dana"]);
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana],
      audienceKind: "person",
      targetPersonIds: ["p_dana", "p_dana"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-dupe-id",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.resolvedRecipientCount).toBe(1);
    expect(jobsByDedupeKey.size).toBe(1);
  });

  it("'people' with exactly one id is a valid audience -- only 'person' is capped at exactly one", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const { client } = makeFakeSupabase([{ id: "user-dana", email: "dana@example.invalid" }], ["user-dana"]);
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana],
      audienceKind: "people",
      targetPersonIds: ["p_dana"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-1",
    });
    expect(outcome.ok).toBe(true);
  });

  it("'everyone' ignores targetPersonIds entirely for cardinality purposes -- a client can never shrink 'everyone' to a subset by tampering with ids", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase([{ id: "user-dana", email: "dana@example.invalid" }], []);
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [dana],
      audienceKind: "everyone",
      targetPersonIds: [], // "everyone" with a deliberately empty id list is still valid -- the roster decides, not the client.
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-1",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.resolvedRecipientCount).toBe(1);
    expect(jobsByDedupeKey.size).toBe(1);
  });
});

describe("sendManagerBroadcastNotification -- recipient resolution", () => {
  it("one selected mapped recipient creates exactly one job, resolved and push-capable", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase([{ id: "user-dana", email: "dana@example.invalid" }], ["user-dana"]);
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana],
      audienceKind: "person",
      targetPersonIds: ["p_dana"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-single",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.resolvedRecipientCount).toBe(1);
    expect(outcome.result.pushCapableCount).toBe(1);
    expect(outcome.result.inboxOnlyCount).toBe(0);
    expect(outcome.result.unresolved).toEqual([]);
    expect(jobsByDedupeKey.size).toBe(1);
    const [job] = [...jobsByDedupeKey.values()];
    expect(job.recipient_user_id).toBe("user-dana");
    expect(job.category).toBe("manager_broadcast");
  });

  it("multiple selected people create one job per resolved auth user", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
      ],
      ["user-dana"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "people",
      targetPersonIds: ["p_dana", "p_noa"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-multi",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.resolvedRecipientCount).toBe(2);
    expect(outcome.result.pushCapableCount).toBe(1);
    expect(outcome.result.inboxOnlyCount).toBe(1);
    expect(jobsByDedupeKey.size).toBe(2);
  });

  it("'everyone' scopes to the full personnel roster passed in, never a client-selected subset", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
      ],
      [],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "everyone",
      targetPersonIds: ["p_dana"], // deliberately ignored for "everyone"
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-everyone",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // MANAGER has no email -> unresolved; dana/noa both mapped, no push subscriptions -> inbox-only.
    expect(outcome.result.resolvedRecipientCount).toBe(2);
    expect(outcome.result.inboxOnlyCount).toBe(2);
    expect(outcome.result.unresolved).toHaveLength(1);
    expect(outcome.result.unresolved[0]).toEqual({ personId: "p_manager", personName: "דני מנהל", reason: "missing_email" });
    expect(jobsByDedupeKey.size).toBe(2);
  });

  it("a mapped user with no Push subscription still gets a job -- inbox-only, never silently skipped", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase([{ id: "user-dana", email: "dana@example.invalid" }], []);
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana],
      audienceKind: "person",
      targetPersonIds: ["p_dana"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-no-push",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.pushCapableCount).toBe(0);
    expect(outcome.result.inboxOnlyCount).toBe(1);
    expect(jobsByDedupeKey.size).toBe(1);
  });

  it("no-email / ambiguous / unmapped people are reported but NEVER guessed into a job", async () => {
    const noEmail = person({ id: "p_no_email", name: "בלי מייל" });
    const dupeA = person({ id: "p_dupe_a", name: "כפול א", email: "dupe@example.invalid" });
    const dupeB = person({ id: "p_dupe_b", name: "כפול ב", email: "dupe@example.invalid" });
    const ghost = person({ id: "p_ghost", name: "רוח רפאים", email: "ghost@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase([], []);
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, noEmail, dupeA, dupeB, ghost],
      audienceKind: "everyone",
      targetPersonIds: [],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-unresolved",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.resolvedRecipientCount).toBe(0);
    expect(jobsByDedupeKey.size).toBe(0);
    const reasons = outcome.result.unresolved.map((entry) => [entry.personId, entry.reason]).sort();
    expect(reasons).toEqual(
      [
        ["p_manager", "missing_email"],
        ["p_no_email", "missing_email"],
        ["p_dupe_a", "ambiguous_email"],
        ["p_dupe_b", "ambiguous_email"],
        ["p_ghost", "unmapped_account"],
      ].sort(),
    );
  });

  it("a candidate id outside the roster fails the WHOLE request closed -- never silently shrinks to whichever ids did resolve, and creates zero jobs", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const { client, jobsByDedupeKey, batchesByIdempotencyKey } = makeFakeSupabase(
      [{ id: "user-dana", email: "dana@example.invalid" }],
      ["user-dana"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana],
      audienceKind: "people",
      targetPersonIds: ["p_dana", "p_does_not_exist", "p_manager_impersonation"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-tampered",
    });

    expect(outcome).toEqual({ ok: false, error: "invalid_targets" });
    expect(jobsByDedupeKey.size).toBe(0);
    expect(batchesByIdempotencyKey.size).toBe(0);
  });

  it("a real, valid roster id is never itself the problem -- only the presence of an invalid one fails the request", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
      ],
      ["user-dana", "user-noa"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "people",
      targetPersonIds: ["p_dana", "p_noa"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-valid",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.resolvedRecipientCount).toBe(2);
    expect(jobsByDedupeKey.size).toBe(2);
  });
});

describe("sendManagerBroadcastNotification -- dynamic audience groups + exclusions", () => {
  it("'groups' resolves a service-type group against the current roster", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid", personnelType: "קבע" });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid", personnelType: "חובה" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
      ],
      ["user-dana", "user-noa"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "groups",
      targetPersonIds: [],
      groupKeys: ["permanent"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-groups-service-type",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.resolvedRecipientCount).toBe(1);
    expect(jobsByDedupeKey.size).toBe(1);
    expect([...jobsByDedupeKey.values()][0].recipient_user_id).toBe("user-dana");
  });

  it("'groups' resolves a role group against the current roster", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid", isSupervisor: true });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
      ],
      ["user-dana", "user-noa"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "groups",
      targetPersonIds: [],
      groupKeys: ["supervisor"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-groups-role",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(jobsByDedupeKey.size).toBe(1);
    expect([...jobsByDedupeKey.values()][0].recipient_user_id).toBe("user-dana");
  });

  it("'groups' unions multiple selected groups correctly", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid", personnelType: "קבע" });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid", isTechnician: true });
    const gil = person({ id: "p_gil", name: "גיל", email: "gil@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
        { id: "user-gil", email: "gil@example.invalid" },
      ],
      ["user-dana", "user-noa", "user-gil"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa, gil],
      audienceKind: "groups",
      targetPersonIds: [],
      groupKeys: ["permanent", "technician"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-groups-union",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.resolvedRecipientCount).toBe(2);
    expect(new Set([...jobsByDedupeKey.values()].map((job) => job.recipient_user_id))).toEqual(new Set(["user-dana", "user-noa"]));
  });

  it("excludedPersonIds always wins -- removes a person even under 'everyone'", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
      ],
      ["user-dana", "user-noa"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "everyone",
      targetPersonIds: [],
      excludedPersonIds: ["p_dana"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-exclude-everyone",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.resolvedRecipientCount).toBe(1);
    expect([...jobsByDedupeKey.values()][0].recipient_user_id).toBe("user-noa");
  });

  it("excludedPersonIds wins even for a person who belongs to multiple selected groups", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid", personnelType: "מילואים", isSupervisor: true, isTechnician: true });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid", personnelType: "מילואים" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
      ],
      ["user-dana", "user-noa"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "groups",
      targetPersonIds: [],
      groupKeys: ["reserve", "supervisor", "technician"],
      excludedPersonIds: ["p_dana"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-exclude-multi-group",
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.resolvedRecipientCount).toBe(1);
    expect([...jobsByDedupeKey.values()][0].recipient_user_id).toBe("user-noa");
  });

  it("an excluded id that isn't a genuine roster member fails the whole request closed, exactly like an invalid targetPersonId", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const { client } = makeFakeSupabase([{ id: "user-dana", email: "dana@example.invalid" }], ["user-dana"]);
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const outcome = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana],
      audienceKind: "everyone",
      targetPersonIds: [],
      excludedPersonIds: ["p_not_in_roster"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-exclude-invalid",
    });

    expect(outcome).toEqual({ ok: false, error: "invalid_targets" });
  });
});

describe("sendManagerBroadcastNotification -- idempotency", () => {
  it("a duplicate submission with the SAME idempotency key never creates a second batch or a second job per recipient", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const { client, batchesByIdempotencyKey, jobsByDedupeKey } = makeFakeSupabase(
      [{ id: "user-dana", email: "dana@example.invalid" }],
      ["user-dana"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const input = {
      manager: MANAGER,
      people: [MANAGER, dana],
      audienceKind: "person" as const,
      targetPersonIds: ["p_dana"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-retry",
    };

    const first = await sendManagerBroadcastNotification(input);
    const second = await sendManagerBroadcastNotification(input);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.batchId).toBe(first.result.batchId);
    expect(batchesByIdempotencyKey.size).toBe(1);
    expect(jobsByDedupeKey.size).toBe(1);
  });

  it("two DIFFERENT idempotency keys for the same content/target are treated as two genuine sends", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const { client, batchesByIdempotencyKey, jobsByDedupeKey } = makeFakeSupabase(
      [{ id: "user-dana", email: "dana@example.invalid" }],
      ["user-dana"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const base = {
      manager: MANAGER,
      people: [MANAGER, dana],
      audienceKind: "person" as const,
      targetPersonIds: ["p_dana"],
      title: "כותרת",
      body: "תוכן",
    };

    await sendManagerBroadcastNotification({ ...base, idempotencyKey: "idem-a" });
    await sendManagerBroadcastNotification({ ...base, idempotencyKey: "idem-b" });

    expect(batchesByIdempotencyKey.size).toBe(2);
    expect(jobsByDedupeKey.size).toBe(2);
  });

  it("reusing the SAME idempotency key with a DIFFERENT recipient fails closed as idempotency_conflict and creates NO additional job -- the exact bug this pass fixes", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
      ],
      ["user-dana", "user-noa"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const first = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "person",
      targetPersonIds: ["p_dana"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-shared",
    });
    expect(first.ok).toBe(true);
    expect(jobsByDedupeKey.size).toBe(1);

    const second = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "person",
      targetPersonIds: ["p_noa"], // a DIFFERENT recipient, same key
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-shared",
    });

    expect(second).toEqual({ ok: false, error: "idempotency_conflict" });
    // Still exactly the ORIGINAL job -- noa never got one.
    expect(jobsByDedupeKey.size).toBe(1);
    expect([...jobsByDedupeKey.values()][0].recipient_user_id).toBe("user-dana");
  });

  it("reusing the SAME idempotency key with DIFFERENT title/body fails closed and never mutates or extends the original batch", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const { client, jobsByDedupeKey, batchesByIdempotencyKey } = makeFakeSupabase(
      [{ id: "user-dana", email: "dana@example.invalid" }],
      ["user-dana"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana],
      audienceKind: "person",
      targetPersonIds: ["p_dana"],
      title: "כותרת מקורית",
      body: "תוכן מקורי",
      idempotencyKey: "idem-content",
    });

    const second = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana],
      audienceKind: "person",
      targetPersonIds: ["p_dana"],
      title: "כותרת שונה לגמרי",
      body: "תוכן מקורי",
      idempotencyKey: "idem-content",
    });

    expect(second).toEqual({ ok: false, error: "idempotency_conflict" });
    expect(batchesByIdempotencyKey.get("idem-content")?.title).toBe("כותרת מקורית");
    expect(jobsByDedupeKey.size).toBe(1);
  });

  it("a genuine replay of the identical request (same manager/audience/targets/title/body) safely retries missing job creation, never a conflict", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
      ],
      ["user-dana", "user-noa"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const input = {
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "people" as const,
      targetPersonIds: ["p_dana", "p_noa"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-replay",
    };

    const first = await sendManagerBroadcastNotification(input);
    // A different array ORDER for the same two ids -- canonical set comparison must still treat this as the same request.
    const second = await sendManagerBroadcastNotification({ ...input, targetPersonIds: ["p_noa", "p_dana"] });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.batchId).toBe(first.result.batchId);
    expect(jobsByDedupeKey.size).toBe(2);
  });

  it("an 'everyone' replay after the roster grows does NOT add a job for the new person -- the batch's resolved recipient set is frozen at creation", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid" });
    const itay = person({ id: "p_itay", name: "איתי", email: "itay@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
        { id: "user-itay", email: "itay@example.invalid" },
      ],
      ["user-dana", "user-noa", "user-itay"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const first = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "everyone",
      targetPersonIds: [],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-roster-growth",
    });
    expect(first.ok).toBe(true);
    expect(jobsByDedupeKey.size).toBe(2);

    const second = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa, itay], // the roster grew between the original send and this replay.
      audienceKind: "everyone",
      targetPersonIds: [],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-roster-growth", // SAME key -- a replay, not a new send.
    });

    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.batchId).toBe(first.result.batchId);
    // itay must NEVER get a job under this old batch -- the resolved recipient set is frozen.
    expect(jobsByDedupeKey.size).toBe(2);
    const recipientIds = [...jobsByDedupeKey.values()].map((job) => job.recipient_user_id).sort();
    expect(recipientIds).toEqual(["user-dana", "user-noa"]);
  });

  it("a selected person unresolved at first send who later becomes mapped does NOT get a job on replay -- becoming resolvable never expands a frozen batch", async () => {
    const quinn = person({ id: "p_quinn", name: "קווין" }); // no email at first send.
    const users: FakeUser[] = [];
    const { client, jobsByDedupeKey } = makeFakeSupabase(users, []);
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const first = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, quinn],
      audienceKind: "person",
      targetPersonIds: ["p_quinn"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-becomes-mapped",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result.resolvedRecipientCount).toBe(0);
    expect(jobsByDedupeKey.size).toBe(0);

    // quinn now has an email AND a mapped auth account -- simulating them becoming resolvable later.
    const quinnMapped = person({ id: "p_quinn", name: "קווין", email: "quinn@example.invalid" });
    users.push({ id: "user-quinn", email: "quinn@example.invalid" });

    const second = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, quinnMapped],
      audienceKind: "person",
      targetPersonIds: ["p_quinn"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-becomes-mapped", // SAME key -- a replay.
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.result.batchId).toBe(first.result.batchId);
    // quinn must never get a job under the old batch, even though they're now resolvable.
    expect(jobsByDedupeKey.size).toBe(0);
  });

  it("a mapped recipient whose auth mapping changes before replay is never redirected -- the OLD batch stays pointed at the ORIGINAL resolved user id", async () => {
    const sam = person({ id: "p_sam", name: "סם", email: "sam@example.invalid" });
    const users: FakeUser[] = [{ id: "user-sam-old", email: "sam@example.invalid" }];
    const { client, jobsByDedupeKey } = makeFakeSupabase(users, ["user-sam-old"]);
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const first = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, sam],
      audienceKind: "person",
      targetPersonIds: ["p_sam"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-remapped",
    });
    expect(first.ok).toBe(true);
    expect(jobsByDedupeKey.size).toBe(1);
    expect([...jobsByDedupeKey.values()][0].recipient_user_id).toBe("user-sam-old");

    // sam's email now resolves to a DIFFERENT auth account (e.g. the account was recreated).
    users[0] = { id: "user-sam-new", email: "sam@example.invalid" };

    const second = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, sam],
      audienceKind: "person",
      targetPersonIds: ["p_sam"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-remapped", // SAME key -- a replay.
    });

    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.batchId).toBe(first.result.batchId);
    // Still exactly the ORIGINAL job -- never redirected to the newly-mapped auth user.
    expect(jobsByDedupeKey.size).toBe(1);
    expect([...jobsByDedupeKey.values()][0].recipient_user_id).toBe("user-sam-old");
  });

  it("a genuine replay after PARTIAL job creation still creates the missing ORIGINAL recipient's job, without duplicating the one that already succeeded", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid" });
    const { client, jobsByDedupeKey } = makeFakeSupabase(
      [
        { id: "user-dana", email: "dana@example.invalid" },
        { id: "user-noa", email: "noa@example.invalid" },
      ],
      ["user-dana", "user-noa"],
    );
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const input = {
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "people" as const,
      targetPersonIds: ["p_dana", "p_noa"],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-partial",
    };

    const first = await sendManagerBroadcastNotification(input);
    expect(first.ok).toBe(true);
    expect(jobsByDedupeKey.size).toBe(2);

    // Simulate the original attempt only PARTIALLY succeeding -- e.g. it crashed
    // after dana's job was created but before noa's was.
    const noaJobKey = [...jobsByDedupeKey.entries()].find(([, job]) => job.recipient_user_id === "user-noa")?.[0];
    expect(noaJobKey).toBeTruthy();
    jobsByDedupeKey.delete(noaJobKey!);
    expect(jobsByDedupeKey.size).toBe(1);

    const second = await sendManagerBroadcastNotification(input); // genuine replay, same key.

    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.batchId).toBe(first.result.batchId);
    expect(jobsByDedupeKey.size).toBe(2);
    const recipientIds = [...jobsByDedupeKey.values()].map((job) => job.recipient_user_id).sort();
    expect(recipientIds).toEqual(["user-dana", "user-noa"]);
  });

  it("a DIFFERENT idempotency key is a genuinely new send and MAY reflect the current/new roster state", async () => {
    const dana = person({ id: "p_dana", name: "דנה", email: "dana@example.invalid" });
    const noa = person({ id: "p_noa", name: "נועה", email: "noa@example.invalid" });
    const users: FakeUser[] = [{ id: "user-dana", email: "dana@example.invalid" }];
    const { client, jobsByDedupeKey } = makeFakeSupabase(users, ["user-dana"]);
    const { sendManagerBroadcastNotification } = await loadModule(client);

    const first = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana],
      audienceKind: "everyone",
      targetPersonIds: [],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-key-a",
    });
    expect(first.ok).toBe(true);
    expect(jobsByDedupeKey.size).toBe(1);

    // The roster grows AND a new auth mapping appears -- but this is a genuinely new send (a different key).
    users.push({ id: "user-noa", email: "noa@example.invalid" });

    const second = await sendManagerBroadcastNotification({
      manager: MANAGER,
      people: [MANAGER, dana, noa],
      audienceKind: "everyone",
      targetPersonIds: [],
      title: "כותרת",
      body: "תוכן",
      idempotencyKey: "idem-key-b", // DIFFERENT key -- a new logical batch, free to use current state.
    });

    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.result.batchId).not.toBe(first.result.batchId);
    expect(second.result.resolvedRecipientCount).toBe(2);
    // dana's original job under batch A, plus a fresh dana+noa pair under the new batch B.
    expect(jobsByDedupeKey.size).toBe(3);
  });
});
