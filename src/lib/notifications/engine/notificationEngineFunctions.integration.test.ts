import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * A GENUINE runtime proof of the three PL/pgSQL functions PR #30's
 * notification engine relies on for concurrency safety
 * (`advance_notification_baseline`, `claim_due_pending_notification_changes`,
 * `claim_due_notification_jobs`) -- mirrors
 * `src/lib/push/upsertPushSubscriptionRpc.integration.test.ts`'s exact
 * approach (real throwaway Postgres database, real migration files
 * loaded byte-for-byte, a minimal stand-in `auth` schema) rather than
 * mocking the database, because the property under test IS the
 * database's own row-locking behavior (`for update`, `for update skip
 * locked`) -- something a mock cannot honestly prove.
 *
 * Self-skips when no Postgres is reachable, exactly like the sibling
 * suite -- see its own docstring for why this is intentionally NOT part
 * of every contributor's required `npm test` gate.
 */
const BASE_CONNECTION_STRING =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const CONNECTION_TIMEOUT_MS = 1500;

function withDatabase(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function probeDatabaseAvailable(): Promise<boolean> {
  const probe = new Client({ connectionString: BASE_CONNECTION_STRING, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
  try {
    await probe.connect();
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const databaseAvailable = await probeDatabaseAvailable();

if (!databaseAvailable) {
  console.warn(
    "[notificationEngineFunctions.integration.test] No reachable Postgres at " +
      `${BASE_CONNECTION_STRING} -- skipping. Set TEST_DATABASE_URL to run it.`,
  );
}

describe.skipIf(!databaseAvailable)("notification engine SQL functions -- real PostgreSQL execution", () => {
  const dbName = `test_notif_engine_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: Client;
  let db: Client;

  const USER_A = "00000000-0000-0000-0000-0000000000a1";

  beforeAll(async () => {
    admin = new Client({ connectionString: BASE_CONNECTION_STRING });
    await admin.connect();
    await admin.query(`create database ${dbName}`);

    db = new Client({ connectionString: withDatabase(BASE_CONNECTION_STRING, dbName) });
    await db.connect();

    await db.query(`
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid
        language sql stable
        as $$
          select (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid
        $$;
    `);

    await db.query(`
      do $$
      begin
        if not exists (select from pg_roles where rolname = 'authenticated') then
          create role authenticated;
        end if;
        if not exists (select from pg_roles where rolname = 'anon') then
          create role anon;
        end if;
        if not exists (select from pg_roles where rolname = 'service_role') then
          create role service_role;
        end if;
      end
      $$;
    `);

    const migrationsDir = path.join(__dirname, "..", "..", "..", "..", "supabase", "migrations");
    const migrationFiles = fs.readdirSync(migrationsDir).sort();
    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      await db.query(sql);
    }

    await db.query("insert into auth.users (id) values ($1)", [USER_A]);
  }, 30_000);

  afterAll(async () => {
    if (db) await db.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName}`).catch(() => {});
      await admin.end();
    }
  }, 30_000);

  // -------------------------------------------------------------------
  // advance_notification_baseline
  // -------------------------------------------------------------------

  describe("advance_notification_baseline", () => {
    it("1. first call ever initializes silently", async () => {
      const result = await db.query("select * from public.advance_notification_baseline($1)", ["2026-08-16"]);
      expect(result.rows[0].action).toBe("initialized");
      expect(result.rows[0].previous_week_start).toBeNull();
    });

    it("2. a second call with the SAME week is unchanged", async () => {
      const result = await db.query("select * from public.advance_notification_baseline($1)", ["2026-08-16"]);
      expect(result.rows[0].action).toBe("unchanged");
    });

    it("3. a call with a DIFFERENT week rolls over and reports the previous week", async () => {
      const result = await db.query("select * from public.advance_notification_baseline($1)", ["2026-08-23"]);
      expect(result.rows[0].action).toBe("rolled_over");
      const previousWeekStart = result.rows[0].previous_week_start as Date;
      expect(previousWeekStart.toISOString()).toMatch(/2026-08-16/);
    });

    it("4. two concurrent callers for the same new week: only one observes the transition, the other sees 'unchanged'", async () => {
      const connA = new Client({ connectionString: withDatabase(BASE_CONNECTION_STRING, dbName) });
      const connB = new Client({ connectionString: withDatabase(BASE_CONNECTION_STRING, dbName) });
      await connA.connect();
      await connB.connect();

      try {
        await connA.query("begin");
        const lockedResult = connA.query("select * from public.advance_notification_baseline($1)", ["2026-08-30"]);

        // Give A a moment to acquire the row lock before B races in.
        await new Promise((resolve) => setTimeout(resolve, 150));

        const bPromise = connB.query("select * from public.advance_notification_baseline($1)", ["2026-08-30"]);

        // B must still be blocked on A's row lock -- prove it hasn't
        // resolved yet before A commits.
        let bResolved = false;
        bPromise.then(() => {
          bResolved = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(bResolved).toBe(false);

        await connA.query("commit");
        const aResult = await lockedResult;
        const bResult = await bPromise;

        const actions = [aResult.rows[0].action, bResult.rows[0].action].sort();
        // Exactly one of the two concurrent callers observes the real
        // transition; the other, unblocked only after A committed, sees
        // the already-updated row and reports 'unchanged'.
        expect(actions).toEqual(["rolled_over", "unchanged"]);
      } finally {
        await connA.end();
        await connB.end();
      }
    });

    it("5. anon/authenticated cannot execute the function at all", async () => {
      await db.query("set role authenticated");
      try {
        await expect(
          db.query("select * from public.advance_notification_baseline($1)", ["2026-09-06"]),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await db.query("reset role");
      }
    });
  });

  // -------------------------------------------------------------------
  // claim_due_pending_notification_changes
  // -------------------------------------------------------------------

  describe("claim_due_pending_notification_changes", () => {
    async function insertPendingChange(factKey: string, settleAtOffsetMs: number, status = "pending") {
      await db.query(
        `insert into public.pending_notification_changes
           (week_start_date, fact_key, category, original_value, latest_value, settle_at, status, claimed_at)
         values ($1, $2, 'shift', '{"a":1}'::jsonb, '{"a":2}'::jsonb, now() + ($3 || ' milliseconds')::interval, $4,
           case when $4 = 'claimed' then now() - interval '20 minutes' else null end)`,
        ["2026-08-16", factKey, settleAtOffsetMs, status],
      );
    }

    it("6. only changes whose settle_at has passed are claimed, and their status flips to claimed", async () => {
      await insertPendingChange("shift:p_due:2026-08-18", -1000);
      await insertPendingChange("shift:p_not_due:2026-08-18", 60_000);

      const result = await db.query("select * from public.claim_due_pending_notification_changes(100)");
      const claimedKeys = result.rows.map((row) => row.fact_key);

      expect(claimedKeys).toContain("shift:p_due:2026-08-18");
      expect(claimedKeys).not.toContain("shift:p_not_due:2026-08-18");

      const statusCheck = await db.query(
        "select status from public.pending_notification_changes where fact_key = $1",
        ["shift:p_due:2026-08-18"],
      );
      expect(statusCheck.rows[0].status).toBe("claimed");
    });

    it("7. a row stuck in 'claimed' past the reclaim window is returned to pending and re-claimed", async () => {
      await insertPendingChange("shift:p_stuck:2026-08-18", -5000, "claimed");

      const result = await db.query("select * from public.claim_due_pending_notification_changes(100)");
      const claimedKeys = result.rows.map((row) => row.fact_key);
      expect(claimedKeys).toContain("shift:p_stuck:2026-08-18");
    });

    it("8. two concurrent claimers never both claim the same due row (SKIP LOCKED)", async () => {
      await insertPendingChange("shift:p_race:2026-08-18", -1000);

      const connA = new Client({ connectionString: withDatabase(BASE_CONNECTION_STRING, dbName) });
      const connB = new Client({ connectionString: withDatabase(BASE_CONNECTION_STRING, dbName) });
      await connA.connect();
      await connB.connect();

      try {
        const [resultA, resultB] = await Promise.all([
          connA.query("select * from public.claim_due_pending_notification_changes(100)"),
          connB.query("select * from public.claim_due_pending_notification_changes(100)"),
        ]);

        const allClaimedKeys = [...resultA.rows, ...resultB.rows].map((row) => row.fact_key);
        const raceKeyOccurrences = allClaimedKeys.filter((key) => key === "shift:p_race:2026-08-18").length;
        expect(raceKeyOccurrences).toBe(1);
      } finally {
        await connA.end();
        await connB.end();
      }
    });
  });

  // -------------------------------------------------------------------
  // claim_due_notification_jobs
  // -------------------------------------------------------------------

  describe("claim_due_notification_jobs", () => {
    async function insertJob(dedupeKey: string, scheduledForOffsetMs: number, status = "pending", attempts = 0) {
      await db.query(
        `insert into public.notification_jobs
           (category, recipient_user_id, title, body, path, dedupe_key, scheduled_for, status, attempts, claimed_at)
         values ('shift_change', $1, 't', 'b', '/schedule', $2, now() + ($3 || ' milliseconds')::interval, $4, $5,
           case when $4 = 'claimed' then now() - interval '10 minutes' else null end)`,
        [USER_A, dedupeKey, scheduledForOffsetMs, status, attempts],
      );
    }

    it("9. only due, non-exhausted jobs are claimed, and attempts increments on claim", async () => {
      await insertJob("job-due", -1000);
      await insertJob("job-future", 60_000);
      await insertJob("job-exhausted", -1000);
      await db.query("update public.notification_jobs set attempts = max_attempts where dedupe_key = $1", [
        "job-exhausted",
      ]);

      const result = await db.query("select * from public.claim_due_notification_jobs(100)");
      const claimedKeys = result.rows.map((row) => row.dedupe_key);

      expect(claimedKeys).toContain("job-due");
      expect(claimedKeys).not.toContain("job-future");
      expect(claimedKeys).not.toContain("job-exhausted");

      const claimedRow = result.rows.find((row) => row.dedupe_key === "job-due");
      expect(claimedRow.attempts).toBe(1);
      expect(claimedRow.status).toBe("claimed");
    });

    it("10. a job stuck in 'claimed' past the reclaim window is retried", async () => {
      await insertJob("job-stuck", -1000, "claimed", 1);

      const result = await db.query("select * from public.claim_due_notification_jobs(100)");
      const claimedKeys = result.rows.map((row) => row.dedupe_key);
      expect(claimedKeys).toContain("job-stuck");
    });

    it("11. the dedupe_key unique constraint rejects a duplicate insert -- idempotent job creation", async () => {
      await insertJob("job-unique", 60_000);
      await expect(insertJob("job-unique", 60_000)).rejects.toThrow(/duplicate key/i);
    });
  });

  // -------------------------------------------------------------------
  // upsert_pending_reminder_job -- hotfix regression coverage. A GENUINE
  // proof that Postgres's own `ON CONFLICT ... DO UPDATE ... WHERE` guard
  // (not a PostgREST client-side filter, which does NOT apply to an
  // upsert's conflict action) is what actually protects a terminal job
  // from revival -- exactly the property a mock cannot honestly prove,
  // and exactly the assumption the pre-fix code got wrong in Production.
  // -------------------------------------------------------------------

  describe("upsert_pending_reminder_job", () => {
    async function callUpsert(dedupeKey: string, overrides: Partial<{ title: string; scheduledForOffsetMs: number }> = {}) {
      return db.query(
        `select public.upsert_pending_reminder_job($1, $2, $3, 'b', '/', null, $4, now() + ($5 || ' milliseconds')::interval, null)`,
        ["tomorrow_shift", USER_A, overrides.title ?? "t", dedupeKey, overrides.scheduledForOffsetMs ?? 3_600_000],
      );
    }

    async function jobRow(dedupeKey: string) {
      const result = await db.query("select * from public.notification_jobs where dedupe_key = $1", [dedupeKey]);
      return result.rows[0];
    }

    it("12. first call creates a new pending job", async () => {
      await callUpsert("reminder-fresh");
      const row = await jobRow("reminder-fresh");
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(0);
    });

    it("13. a SECOND call while still pending legitimately refreshes content (e.g. the underlying assignment changed)", async () => {
      await callUpsert("reminder-refresh", { title: "original" });
      await callUpsert("reminder-refresh", { title: "updated" });

      const row = await jobRow("reminder-refresh");
      expect(row.status).toBe("pending");
      expect(row.title).toBe("updated");
    });

    it("14. reproduces the real Production incident: once a job reaches 'completed', a LATER reminder tick's upsert must NOT revive it", async () => {
      await callUpsert("reminder-completed", { scheduledForOffsetMs: -1000 });

      // Simulate delivery reaching a genuine terminal state, exactly like
      // delivery.ts's processJob does after every device succeeds.
      await db.query("update public.notification_jobs set status = 'completed', attempts = 1 where dedupe_key = $1", [
        "reminder-completed",
      ]);

      // A later tick recomputes the SAME still-in-range reminder and
      // upserts it again, exactly as runTomorrowShiftReminders does on
      // every tick regardless of the job's current delivery state.
      await callUpsert("reminder-completed", { title: "revived?" });

      const row = await jobRow("reminder-completed");
      expect(row.status).toBe("completed");
      expect(row.attempts).toBe(1);
      // Content is untouched too -- a no-op WHERE-guard miss must not
      // partially apply the update.
      expect(row.title).not.toBe("revived?");
    });

    it("15. 'failed' is not revived either", async () => {
      await callUpsert("reminder-failed");
      await db.query("update public.notification_jobs set status = 'failed', attempts = 5 where dedupe_key = $1", [
        "reminder-failed",
      ]);
      await callUpsert("reminder-failed");

      const row = await jobRow("reminder-failed");
      expect(row.status).toBe("failed");
    });

    it("16. 'skipped' (recipient had zero active push subscriptions) is not revived either", async () => {
      await callUpsert("reminder-skipped");
      await db.query("update public.notification_jobs set status = 'skipped', attempts = 1 where dedupe_key = $1", [
        "reminder-skipped",
      ]);
      await callUpsert("reminder-skipped");

      const row = await jobRow("reminder-skipped");
      expect(row.status).toBe("skipped");
    });

    it("17. 'cancelled' is not revived either", async () => {
      await callUpsert("reminder-cancelled");
      await db.query("update public.notification_jobs set status = 'cancelled' where dedupe_key = $1", [
        "reminder-cancelled",
      ]);
      await callUpsert("reminder-cancelled");

      const row = await jobRow("reminder-cancelled");
      expect(row.status).toBe("cancelled");
    });

    it("18. end-to-end: a completed job stays permanently unclaimable by claim_due_notification_jobs even after a later upsert", async () => {
      await callUpsert("reminder-e2e", { scheduledForOffsetMs: -1000 });
      const claimed = await db.query("select * from public.claim_due_notification_jobs(100)");
      expect(claimed.rows.map((r) => r.dedupe_key)).toContain("reminder-e2e");

      await db.query("update public.notification_jobs set status = 'completed' where dedupe_key = $1", ["reminder-e2e"]);
      await callUpsert("reminder-e2e"); // the next tick's reminder recomputation

      const row = await jobRow("reminder-e2e");
      expect(row.status).toBe("completed");

      const reclaimed = await db.query("select * from public.claim_due_notification_jobs(100)");
      expect(reclaimed.rows.map((r) => r.dedupe_key)).not.toContain("reminder-e2e");
    });

    it("19. anon/authenticated cannot execute the function at all", async () => {
      await db.query("set role authenticated");
      try {
        await expect(callUpsert("reminder-forbidden")).rejects.toThrow(/permission denied/i);
      } finally {
        await db.query("reset role");
      }
    });
  });

  // -------------------------------------------------------------------
  // claim_due_manager_scheduled_broadcasts / claim_manager_scheduled_broadcast_now
  // -- a GENUINE proof of the scheduled-broadcast feature's own
  // concurrency-safety functions (worker-tick bulk claim + "שלח עכשיו"'s
  // single-row claim), same rationale as `claim_due_notification_jobs`
  // above: the property under test IS Postgres's own row-locking/guarded-
  // update behavior, which a mock cannot honestly prove.
  // -------------------------------------------------------------------

  describe("claim_due_manager_scheduled_broadcasts", () => {
    async function insertScheduled(
      id: string,
      overrides: Partial<{
        status: string;
        scheduledForOffsetMs: number;
        claimedAtOffsetMs: number | null;
        batchId: string | null;
        sentNowByPersonId: string | null;
        sentNowByPersonName: string | null;
      }> = {},
    ) {
      const status = overrides.status ?? "scheduled";
      const scheduledForOffsetMs = overrides.scheduledForOffsetMs ?? -1000;
      const claimedAtOffsetMs = overrides.claimedAtOffsetMs ?? null;
      const batchId = overrides.batchId ?? null;
      const sentNowByPersonId = overrides.sentNowByPersonId ?? null;
      const sentNowByPersonName = overrides.sentNowByPersonName ?? null;
      // A direct test insert never goes through the manager's own compose
      // session, so it has no real client-generated creation key -- the
      // row's own (already-unique) `id` is a convenient stand-in here.
      await db.query(
        `insert into public.manager_scheduled_broadcasts
           (id, create_idempotency_key, status, audience_kind, target_person_ids, title, body, scheduled_for,
            created_by_person_id, created_by_person_name, claimed_at, batch_id,
            sent_now_by_person_id, sent_now_by_person_name, sent_now_at)
         values ($1, $8, $2, 'person', '{p_1}', 't', 'b', now() + ($3 || ' milliseconds')::interval,
           'p_manager', 'מנהל',
           case when $4::bigint is null then null else now() + ($4 || ' milliseconds')::interval end,
           $5, $6, $7,
           case when $6::text is null then null else now() end)`,
        [id, status, scheduledForOffsetMs, claimedAtOffsetMs, batchId, sentNowByPersonId, sentNowByPersonName, `create:${id}`],
      );
    }

    async function insertBatch(id: string, idempotencyKey: string = `scheduled:${id}`) {
      await db.query(
        `insert into public.manager_notification_batches
           (id, idempotency_key, created_by_person_id, created_by_person_name, audience_kind, title, body)
         values ($1, $2, 'p_manager', 'מנהל', 'person', 't', 'b')`,
        [id, idempotencyKey],
      );
    }

    it("35. create_idempotency_key's unique constraint rejects a duplicate insert -- a GENUINE proof that create-exactly-once is DB-enforced, not merely a client-side convention", async () => {
      await db.query(
        `insert into public.manager_scheduled_broadcasts
           (id, create_idempotency_key, status, audience_kind, target_person_ids, title, body, scheduled_for, created_by_person_id, created_by_person_name)
         values (gen_random_uuid(), 'idem-create-dup', 'scheduled', 'person', '{p_1}', 't', 'b', now() + interval '1 hour', 'p_manager', 'מנהל')`,
      );

      await expect(
        db.query(
          `insert into public.manager_scheduled_broadcasts
             (id, create_idempotency_key, status, audience_kind, target_person_ids, title, body, scheduled_for, created_by_person_id, created_by_person_name)
           values (gen_random_uuid(), 'idem-create-dup', 'scheduled', 'person', '{p_1}', 't', 'b', now() + interval '1 hour', 'p_manager', 'מנהל')`,
        ),
      ).rejects.toThrow(/duplicate key/i);
    });

    it("36. two DIFFERENT create_idempotency_keys genuinely insert two independent rows", async () => {
      await db.query(
        `insert into public.manager_scheduled_broadcasts
           (id, create_idempotency_key, status, audience_kind, target_person_ids, title, body, scheduled_for, created_by_person_id, created_by_person_name)
         values (gen_random_uuid(), 'idem-create-a', 'scheduled', 'person', '{p_1}', 't', 'b', now() + interval '1 hour', 'p_manager', 'מנהל')`,
      );
      await db.query(
        `insert into public.manager_scheduled_broadcasts
           (id, create_idempotency_key, status, audience_kind, target_person_ids, title, body, scheduled_for, created_by_person_id, created_by_person_name)
         values (gen_random_uuid(), 'idem-create-b', 'scheduled', 'person', '{p_1}', 't', 'b', now() + interval '1 hour', 'p_manager', 'מנהל')`,
      );

      const rows = await db.query(
        "select id from public.manager_scheduled_broadcasts where create_idempotency_key in ('idem-create-a', 'idem-create-b')",
      );
      expect(rows.rows).toHaveLength(2);
    });

    it("20. only a due, still-'scheduled' broadcast is claimed -- a future one is left alone", async () => {
      await insertScheduled("aaaaaaaa-0000-0000-0000-000000000001", { scheduledForOffsetMs: -1000 });
      await insertScheduled("aaaaaaaa-0000-0000-0000-000000000002", { scheduledForOffsetMs: 60_000 });

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      const claimedIds = result.rows.map((row) => row.id);

      expect(claimedIds).toContain("aaaaaaaa-0000-0000-0000-000000000001");
      expect(claimedIds).not.toContain("aaaaaaaa-0000-0000-0000-000000000002");
      expect(result.rows.find((row) => row.id === "aaaaaaaa-0000-0000-0000-000000000001").status).toBe("claimed");
    });

    it("21. a second claim call never re-claims an already-'claimed' row -- the exclusivity a worker tick relies on", async () => {
      await insertScheduled("aaaaaaaa-0000-0000-0000-000000000003", { scheduledForOffsetMs: -1000 });

      const first = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      expect(first.rows.map((r) => r.id)).toContain("aaaaaaaa-0000-0000-0000-000000000003");

      const second = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      expect(second.rows.map((r) => r.id)).not.toContain("aaaaaaaa-0000-0000-0000-000000000003");
    });

    it("22. a 'claimed' row with NO batch_id, stuck past the crash-recovery window, is RE-CLAIMED while REMAINING 'claimed' -- never reset to 'scheduled' (a batch may already exist externally, see the table's own doc comment)", async () => {
      await insertScheduled("aaaaaaaa-0000-0000-0000-000000000004", {
        status: "claimed",
        scheduledForOffsetMs: -1000,
        claimedAtOffsetMs: -10 * 60_000,
        batchId: null,
      });

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      const row = result.rows.find((r) => r.id === "aaaaaaaa-0000-0000-0000-000000000004");
      expect(row).toBeDefined();
      expect(row.status).toBe("claimed");
      // claimed_at was refreshed by the reclaim, not nulled out.
      expect(new Date(row.claimed_at).getTime()).toBeGreaterThan(Date.now() - 5000);

      // Confirms it was genuinely RE-claimed (not left over from the old
      // status='scheduled' reset+reclaim two-step): the row was never
      // 'scheduled' at any point an edit/cancel guard could have observed.
      const stillGuarded = await db.query(
        "update public.manager_scheduled_broadcasts set title = 'hacked' where id = $1 and status = 'scheduled' returning *",
        ["aaaaaaaa-0000-0000-0000-000000000004"],
      );
      expect(stillGuarded.rows).toHaveLength(0);
    });

    it("23. CRITICAL: a 'claimed' row that already HAS a batch_id but whose claim is FRESH (within the lease) is NOT reclaimable -- batch_id must never bypass the lease (this was the concurrency bug: two overlapping minute-worker invocations could otherwise both actively process the same still-live claim)", async () => {
      await insertBatch("bbbbbbbb-0000-0000-0000-000000000001");
      await insertScheduled("aaaaaaaa-0000-0000-0000-000000000005", {
        status: "claimed",
        scheduledForOffsetMs: -1000,
        claimedAtOffsetMs: 0, // just claimed -- worker A is still actively dispatching
        batchId: "bbbbbbbb-0000-0000-0000-000000000001",
      });

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      expect(result.rows.map((r) => r.id)).not.toContain("aaaaaaaa-0000-0000-0000-000000000005");
    });

    it("45. once the lease expires, the SAME 'claimed' + batch_id row IS reclaimable, and batch_id survives the reclaim unchanged -- resumption uses the existing immutable batch, never a second one", async () => {
      await insertBatch("bbbbbbbb-0000-0000-0000-000000000003");
      await insertScheduled("aaaaaaaa-0000-0000-0000-00000000000e", {
        status: "claimed",
        scheduledForOffsetMs: -1000,
        claimedAtOffsetMs: -100_000, // past the 90-second lease
        batchId: "bbbbbbbb-0000-0000-0000-000000000003",
      });

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      const row = result.rows.find((r) => r.id === "aaaaaaaa-0000-0000-0000-00000000000e");

      expect(row).toBeDefined();
      expect(row.status).toBe("claimed");
      expect(row.batch_id).toBe("bbbbbbbb-0000-0000-0000-000000000003");
      // claimed_at was refreshed by the reclaim (a fresh lease for whichever worker resumes it).
      expect(new Date(row.claimed_at).getTime()).toBeGreaterThan(Date.now() - 5000);
    });

    it("46. simulates overlapping minute-worker ticks: worker A's fresh claim (batch already checkpointed) is invisible to worker B's claim call -- zero rows for that schedule, no second active processing begins", async () => {
      await insertBatch("bbbbbbbb-0000-0000-0000-000000000004");
      const scheduledId = "aaaaaaaa-0000-0000-0000-00000000000f";
      // Worker A: claimed this schedule and already checkpointed its batch, moments ago -- still actively creating notification_jobs rows in application code.
      await insertScheduled(scheduledId, {
        status: "claimed",
        scheduledForOffsetMs: -1000,
        claimedAtOffsetMs: -2000, // 2s ago -- worker A is still well within its own dispatch
        batchId: "bbbbbbbb-0000-0000-0000-000000000004",
      });

      // Worker B's tick, a minute later, must not pick up the same schedule while A's lease is still live.
      const workerB = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      expect(workerB.rows.map((r) => r.id)).not.toContain(scheduledId);

      // The row is exactly as worker A left it -- untouched by B's claim attempt.
      const stillOwnedByA = await db.query("select status, batch_id, claimed_at from public.manager_scheduled_broadcasts where id = $1", [
        scheduledId,
      ]);
      expect(stillOwnedByA.rows[0].status).toBe("claimed");
      expect(stillOwnedByA.rows[0].batch_id).toBe("bbbbbbbb-0000-0000-0000-000000000004");
    });

    it("47. 'שלח עכשיו' followed by a minute-worker tick within the lease cannot re-claim the row while send-now is still active", async () => {
      await insertScheduled("aaaaaaaa-0000-0000-0000-000000000010", { scheduledForOffsetMs: 3_600_000 });

      const sendNow = await db.query("select * from public.claim_manager_scheduled_broadcast_now($1, $2, $3)", [
        "aaaaaaaa-0000-0000-0000-000000000010",
        "p_manager_b",
        "רותם מנהלת",
      ]);
      expect(sendNow.rows).toHaveLength(1);
      expect(sendNow.rows[0].status).toBe("claimed");

      // A minute-worker tick firing right after must not treat this as a fresh due-and-unclaimed schedule.
      const minuteWorkerTick = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      expect(minuteWorkerTick.rows.map((r) => r.id)).not.toContain("aaaaaaaa-0000-0000-0000-000000000010");
    });

    it("24. a 'claimed' row with NO batch_id that is still within the crash-recovery window is NOT reclaimed -- a normal in-flight dispatch is left alone", async () => {
      await insertScheduled("aaaaaaaa-0000-0000-0000-000000000006", {
        status: "claimed",
        scheduledForOffsetMs: -1000,
        claimedAtOffsetMs: -30_000, // 30s ago -- well within the 90-second window (20260821100000 shrunk it from 4 minutes)
        batchId: null,
      });

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      expect(result.rows.map((r) => r.id)).not.toContain("aaaaaaaa-0000-0000-0000-000000000006");
    });

    it("37. a 'claimed' row with NO batch_id past the NEW 90-second window (but well within the OLD 4-minute one) IS reclaimed -- proves the follow-up migration's shrunk window is actually in effect, not just present in the SQL text", async () => {
      await insertScheduled("aaaaaaaa-0000-0000-0000-00000000000d", {
        status: "claimed",
        scheduledForOffsetMs: -1000,
        claimedAtOffsetMs: -100_000, // 100s ago -- past 90s, still well under the old 4-minute window
        batchId: null,
      });

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      const row = result.rows.find((r) => r.id === "aaaaaaaa-0000-0000-0000-00000000000d");
      expect(row).toBeDefined();
      expect(row.status).toBe("claimed");
    });

    it("32. a stale 'שלח עכשיו' claim (no batch_id yet) for a broadcast whose scheduled_for is still far in the future is reclaimed immediately once stale -- it never waits for scheduled_for", async () => {
      await insertScheduled("aaaaaaaa-0000-0000-0000-00000000000a", {
        status: "claimed",
        scheduledForOffsetMs: 24 * 60 * 60_000, // due only tomorrow
        claimedAtOffsetMs: -10 * 60_000, // stale send-now claim
        batchId: null,
        sentNowByPersonId: "p_manager_b",
        sentNowByPersonName: "רותם מנהלת",
      });

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      const row = result.rows.find((r) => r.id === "aaaaaaaa-0000-0000-0000-00000000000a");

      expect(row).toBeDefined();
      expect(row.status).toBe("claimed");
    });

    it("33. sent_now_by_person_id/name/at survive stale-claim recovery completely unchanged", async () => {
      await insertScheduled("aaaaaaaa-0000-0000-0000-00000000000b", {
        status: "claimed",
        scheduledForOffsetMs: 24 * 60 * 60_000,
        claimedAtOffsetMs: -10 * 60_000,
        batchId: null,
        sentNowByPersonId: "p_manager_b",
        sentNowByPersonName: "רותם מנהלת",
      });
      const before = await db.query("select sent_now_at from public.manager_scheduled_broadcasts where id = $1", [
        "aaaaaaaa-0000-0000-0000-00000000000b",
      ]);

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      const row = result.rows.find((r) => r.id === "aaaaaaaa-0000-0000-0000-00000000000b");

      expect(row.sent_now_by_person_id).toBe("p_manager_b");
      expect(row.sent_now_by_person_name).toBe("רותם מנהלת");
      expect(row.sent_now_at.toISOString()).toBe(before.rows[0].sent_now_at.toISOString());
    });

    it("34. simulates the crash window itself: the immutable batch already exists (deterministic scheduled:<id> key) while the row is still 'claimed' with batch_id null -- recovery re-claims it, setting up the application-level dispatch retry to find that exact batch (never a second one; see the engine-level dispatch test for the rest of that flow)", async () => {
      const scheduledId = "aaaaaaaa-0000-0000-0000-00000000000c";
      await insertScheduled(scheduledId, {
        status: "claimed",
        scheduledForOffsetMs: -1000,
        claimedAtOffsetMs: -10 * 60_000,
        batchId: null,
      });
      await insertBatch("bbbbbbbb-0000-0000-0000-000000000002", `scheduled:${scheduledId}`);

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      const row = result.rows.find((r) => r.id === scheduledId);

      expect(row).toBeDefined();
      expect(row.status).toBe("claimed");
      expect(row.batch_id).toBeNull(); // the checkpoint itself is still the application layer's job, not this SQL claim's

      const existingBatch = await db.query("select * from public.manager_notification_batches where idempotency_key = $1", [
        `scheduled:${scheduledId}`,
      ]);
      expect(existingBatch.rows).toHaveLength(1); // exactly one -- proving the precondition for "never a second batch" on the retry
    });

    // ---------------------------------------------------------------------
    // `runDueScheduledBroadcastDispatch` now claims exactly ONE row per
    // call (never a bulk `claim_due_manager_scheduled_broadcasts(limit)`)
    // so a large backlog never gets a single shared `claimed_at` stamped
    // across many rows before their own dispatch has even begun (see that
    // function's own doc comment). These tests prove the SQL side of that
    // design at `p_limit = 1` explicitly, since that is the exact call the
    // application now always makes.
    // ---------------------------------------------------------------------

    it("48. a backlog of several due rows is correctly distributed between two overlapping workers, each claiming one row at a time -- neither ever reclaims a row the other already holds", async () => {
      const ids = [
        "aaaaaaaa-0000-0000-0000-000000000011",
        "aaaaaaaa-0000-0000-0000-000000000012",
        "aaaaaaaa-0000-0000-0000-000000000013",
        "aaaaaaaa-0000-0000-0000-000000000014",
      ];
      for (const id of ids) {
        await insertScheduled(id, { scheduledForOffsetMs: -1000 });
      }

      const claimedByWorkerA: string[] = [];
      const claimedByWorkerB: string[] = [];

      // Simulates two minute-workers interleaving one-row claims over the same backlog.
      for (let i = 0; i < ids.length; i++) {
        const worker = i % 2 === 0 ? "A" : "B";
        const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(1)");
        expect(result.rows).toHaveLength(1);
        (worker === "A" ? claimedByWorkerA : claimedByWorkerB).push(result.rows[0].id);
      }

      const allClaimed = [...claimedByWorkerA, ...claimedByWorkerB];
      // Every row claimed exactly once, across both workers, no duplicates and nothing missed.
      expect(new Set(allClaimed).size).toBe(ids.length);
      for (const id of ids) expect(allClaimed).toContain(id);
      // No overlap between what each worker holds.
      expect(claimedByWorkerA.some((id) => claimedByWorkerB.includes(id))).toBe(false);
    });

    it("49. a row later in a backlog is not assigned a lease until a one-row claim actually reaches it -- unclaimed rows keep status='scheduled' with no claimed_at while earlier rows are still being processed", async () => {
      const first = "aaaaaaaa-0000-0000-0000-000000000015";
      const second = "aaaaaaaa-0000-0000-0000-000000000016";
      await insertScheduled(first, { scheduledForOffsetMs: -2000 });
      await insertScheduled(second, { scheduledForOffsetMs: -1000 });

      const firstClaim = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(1)");
      expect(firstClaim.rows.map((r) => r.id)).toEqual([first]);

      // While "processing" the first row, the second must still be untouched -- scheduled, no lease.
      const stillUnclaimed = await db.query(
        "select status, claimed_at from public.manager_scheduled_broadcasts where id = $1",
        [second],
      );
      expect(stillUnclaimed.rows[0].status).toBe("scheduled");
      expect(stillUnclaimed.rows[0].claimed_at).toBeNull();

      const secondClaim = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(1)");
      expect(secondClaim.rows.map((r) => r.id)).toEqual([second]);
    });

    it("50. a genuinely crashed single-row claim (p_limit=1) is still recoverable after the 90-second lease expires", async () => {
      await insertScheduled("aaaaaaaa-0000-0000-0000-000000000017", {
        status: "claimed",
        scheduledForOffsetMs: -1000,
        claimedAtOffsetMs: -100_000, // past the lease
        batchId: null,
      });

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(1)");
      expect(result.rows.map((r) => r.id)).toContain("aaaaaaaa-0000-0000-0000-000000000017");
    });

    it("51. a single dispatch still under the 90-second lease (p_limit=1) cannot be reclaimed by another one-row claim", async () => {
      await insertScheduled("aaaaaaaa-0000-0000-0000-000000000018", {
        status: "claimed",
        scheduledForOffsetMs: -1000,
        claimedAtOffsetMs: -2000, // fresh -- actively being processed
        batchId: null,
      });

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(1)");
      expect(result.rows.map((r) => r.id)).not.toContain("aaaaaaaa-0000-0000-0000-000000000018");
    });

    it("52. the dedicated once-a-minute worker and the main 5-minute fallback tick share the SAME claim function -- a fresh claim by one is invisible to the other, and each can independently pick up a DIFFERENT due row", async () => {
      const ownedByDedicatedWorker = "aaaaaaaa-0000-0000-0000-000000000019";
      const dueForMainTickFallback = "aaaaaaaa-0000-0000-0000-00000000001a";
      await insertBatch("bbbbbbbb-0000-0000-0000-000000000005");
      // Simulates the dedicated worker having just claimed+checkpointed one schedule, still actively dispatching it.
      await insertScheduled(ownedByDedicatedWorker, {
        status: "claimed",
        scheduledForOffsetMs: -1000,
        claimedAtOffsetMs: -2000,
        batchId: "bbbbbbbb-0000-0000-0000-000000000005",
      });
      // A second, independent schedule the dedicated worker hasn't reached yet.
      await insertScheduled(dueForMainTickFallback, { scheduledForOffsetMs: -1000 });

      // The main tick's own fallback dispatch (a separate call site, same RPC) claims one row.
      const mainTickClaim = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(1)");

      // It must never pick up the dedicated worker's still-live claim...
      expect(mainTickClaim.rows.map((r) => r.id)).not.toContain(ownedByDedicatedWorker);
      // ...it independently claims the OTHER due row instead.
      expect(mainTickClaim.rows.map((r) => r.id)).toEqual([dueForMainTickFallback]);

      // The dedicated worker's row remains exactly as it left it -- untouched by the main tick's claim attempt.
      const stillOwned = await db.query("select status, batch_id from public.manager_scheduled_broadcasts where id = $1", [
        ownedByDedicatedWorker,
      ]);
      expect(stillOwned.rows[0].status).toBe("claimed");
      expect(stillOwned.rows[0].batch_id).toBe("bbbbbbbb-0000-0000-0000-000000000005");
    });

    it("25. anon/authenticated cannot execute the function at all", async () => {
      await db.query("set role authenticated");
      try {
        await expect(db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)")).rejects.toThrow(
          /permission denied/i,
        );
      } finally {
        await db.query("reset role");
      }
    });
  });

  describe("claim_manager_scheduled_broadcast_now", () => {
    async function insertScheduled(id: string, status: string, scheduledForOffsetMs: number) {
      await db.query(
        `insert into public.manager_scheduled_broadcasts
           (id, create_idempotency_key, status, audience_kind, target_person_ids, title, body, scheduled_for, created_by_person_id, created_by_person_name)
         values ($1, $4, $2, 'person', '{p_1}', 't', 'b', now() + ($3 || ' milliseconds')::interval, 'p_manager', 'מנהל')`,
        [id, status, scheduledForOffsetMs, `create:${id}`],
      );
    }

    async function claimNow(id: string, personId = "p_manager_b", personName = "רותם מנהלת") {
      return db.query("select * from public.claim_manager_scheduled_broadcast_now($1, $2, $3)", [id, personId, personName]);
    }

    it("26. claims a still-'scheduled' broadcast regardless of how far in the future scheduled_for is", async () => {
      await insertScheduled("cccccccc-0000-0000-0000-000000000001", "scheduled", 3_600_000);

      const result = await claimNow("cccccccc-0000-0000-0000-000000000001");

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].status).toBe("claimed");
    });

    it("27. returns nothing for a broadcast that is already claimed, dispatched, or cancelled -- the truthful 'already started' signal", async () => {
      await insertScheduled("cccccccc-0000-0000-0000-000000000002", "claimed", -1000);
      await insertScheduled("cccccccc-0000-0000-0000-000000000003", "dispatched", -1000);
      await insertScheduled("cccccccc-0000-0000-0000-000000000004", "cancelled", -1000);

      for (const id of [
        "cccccccc-0000-0000-0000-000000000002",
        "cccccccc-0000-0000-0000-000000000003",
        "cccccccc-0000-0000-0000-000000000004",
      ]) {
        const result = await claimNow(id);
        expect(result.rows).toHaveLength(0);
      }
    });

    it("28. a second 'שלח עכשיו' claim on the same broadcast never succeeds twice -- exactly one logical dispatch", async () => {
      await insertScheduled("cccccccc-0000-0000-0000-000000000005", "scheduled", -1000);

      const first = await claimNow("cccccccc-0000-0000-0000-000000000005");
      const second = await claimNow("cccccccc-0000-0000-0000-000000000005");

      expect(first.rows).toHaveLength(1);
      expect(second.rows).toHaveLength(0);
    });

    it("29. anon/authenticated cannot execute the function at all", async () => {
      await insertScheduled("cccccccc-0000-0000-0000-000000000006", "scheduled", -1000);
      await db.query("set role authenticated");
      try {
        await expect(claimNow("cccccccc-0000-0000-0000-000000000006")).rejects.toThrow(/permission denied/i);
      } finally {
        await db.query("reset role");
      }
    });

    it("30. records the ACTING manager's identity atomically with the winning claim -- never the original scheduler, never a losing racer", async () => {
      await insertScheduled("cccccccc-0000-0000-0000-000000000007", "scheduled", -1000);

      const winner = await claimNow("cccccccc-0000-0000-0000-000000000007", "p_manager_b", "רותם מנהלת");
      expect(winner.rows).toHaveLength(1);
      expect(winner.rows[0].created_by_person_id).toBe("p_manager"); // original scheduler, untouched
      expect(winner.rows[0].sent_now_by_person_id).toBe("p_manager_b");
      expect(winner.rows[0].sent_now_by_person_name).toBe("רותם מנהלת");
      expect(winner.rows[0].sent_now_at).not.toBeNull();

      // A second (losing) claim attempt by a DIFFERENT manager must never overwrite the winner's identity.
      const loser = await claimNow("cccccccc-0000-0000-0000-000000000007", "p_manager_c", "מנהל אחר");
      expect(loser.rows).toHaveLength(0);
      const row = await db.query("select * from public.manager_scheduled_broadcasts where id = $1", [
        "cccccccc-0000-0000-0000-000000000007",
      ]);
      expect(row.rows[0].sent_now_by_person_id).toBe("p_manager_b");
    });

    it("31. a normal due-time worker claim (claim_due_manager_scheduled_broadcasts) never sets sent_now_by_* -- only an explicit 'שלח עכשיו' claim does", async () => {
      await insertScheduled("cccccccc-0000-0000-0000-000000000008", "scheduled", -1000);

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      const row = result.rows.find((r) => r.id === "cccccccc-0000-0000-0000-000000000008");
      expect(row).toBeDefined();
      expect(row.sent_now_by_person_id).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // peek_due_manager_scheduled_broadcasts -- the minute-level-precision
  // follow-up's dedicated worker relies on this read-only function
  // mirroring claim_due_manager_scheduled_broadcasts' eligibility EXACTLY
  // (see 20260821100000_speed_up_manager_scheduled_broadcast_claim.sql's
  // own doc comment). A real-Postgres proof that the two functions
  // genuinely agree, not just that their SQL text looks similar.
  // -------------------------------------------------------------------
  describe("peek_due_manager_scheduled_broadcasts", () => {
    async function insertScheduled(
      id: string,
      overrides: Partial<{
        status: string;
        scheduledForOffsetMs: number;
        claimedAtOffsetMs: number | null;
        batchId: string | null;
      }> = {},
    ) {
      const status = overrides.status ?? "scheduled";
      const scheduledForOffsetMs = overrides.scheduledForOffsetMs ?? -1000;
      const claimedAtOffsetMs = overrides.claimedAtOffsetMs ?? null;
      const batchId = overrides.batchId ?? null;
      await db.query(
        `insert into public.manager_scheduled_broadcasts
           (id, create_idempotency_key, status, audience_kind, target_person_ids, title, body, scheduled_for,
            created_by_person_id, created_by_person_name, claimed_at, batch_id)
         values ($1, $6, $2, 'person', '{p_1}', 't', 'b', now() + ($3 || ' milliseconds')::interval,
           'p_manager', 'מנהל',
           case when $4::bigint is null then null else now() + ($4 || ' milliseconds')::interval end,
           $5)`,
        [id, status, scheduledForOffsetMs, claimedAtOffsetMs, batchId, `create:${id}`],
      );
    }

    async function insertBatch(id: string, idempotencyKey: string) {
      await db.query(
        `insert into public.manager_notification_batches
           (id, idempotency_key, created_by_person_id, created_by_person_name, audience_kind, title, body)
         values ($1, $2, 'p_manager', 'מנהל', 'person', 't', 'b')`,
        [id, idempotencyKey],
      );
    }

    async function peek(): Promise<number> {
      const result = await db.query("select public.peek_due_manager_scheduled_broadcasts() as count");
      return Number(result.rows[0].count);
    }

    // This suite shares one database/table across every `it` in the file
    // with no per-test cleanup (see the file's own top docstring/`beforeAll`)
    // -- earlier describe blocks' rows (and, in principle, a stale 'claimed'
    // row from THIS suite's own earlier claim tests aging past the 90-second
    // window as later tests run) remain in the table. So every assertion
    // here is a BEFORE/AFTER delta around the row(s) it inserts, never an
    // absolute count.

    it("38. inserting a due, still-'scheduled' broadcast increases the count by exactly one -- exactly what claim_due_manager_scheduled_broadcasts would pick up", async () => {
      const before = await peek();
      await insertScheduled("dddddddd-0000-0000-0000-000000000002", { scheduledForOffsetMs: -1000 });
      expect(await peek()).toBe(before + 1);
    });

    it("39. inserting a future, still-'scheduled' broadcast does NOT change the count", async () => {
      const before = await peek();
      await insertScheduled("dddddddd-0000-0000-0000-000000000001", { scheduledForOffsetMs: 60_000 });
      expect(await peek()).toBe(before);
    });

    it("40. CRITICAL: a fresh 'claimed' row with a batch_id does NOT increase the count -- batch_id must never bypass the lease, mirroring the claim function's own fix for the same bug", async () => {
      await insertBatch("eeeeeeee-0000-0000-0000-000000000001", "scheduled:peek-checkpointed");
      const before = await peek();
      await insertScheduled("dddddddd-0000-0000-0000-000000000003", {
        status: "claimed",
        claimedAtOffsetMs: 0, // just claimed -- lease still live
        batchId: "eeeeeeee-0000-0000-0000-000000000001",
      });
      expect(await peek()).toBe(before);
    });

    it("40b. once that same claimed+batch_id row's lease expires, it DOES increase the count -- peek and claim agree on the lease boundary in both directions", async () => {
      await insertBatch("eeeeeeee-0000-0000-0000-000000000002", "scheduled:peek-checkpointed-stale");
      const before = await peek();
      await insertScheduled("dddddddd-0000-0000-0000-000000000009", {
        status: "claimed",
        claimedAtOffsetMs: -100_000, // past the 90-second lease
        batchId: "eeeeeeee-0000-0000-0000-000000000002",
      });
      expect(await peek()).toBe(before + 1);
    });

    it("41. a stale 'claimed' row with no batch_id (past 90s) increases the count; a fresh one still within the window does not -- exactly the claim function's own boundary", async () => {
      const before = await peek();
      await insertScheduled("dddddddd-0000-0000-0000-000000000004", {
        status: "claimed",
        claimedAtOffsetMs: -100_000, // stale
        batchId: null,
      });
      expect(await peek()).toBe(before + 1);

      const beforeFresh = await peek();
      await insertScheduled("dddddddd-0000-0000-0000-000000000005", {
        status: "claimed",
        claimedAtOffsetMs: -30_000, // fresh, still in-flight
        batchId: null,
      });
      expect(await peek()).toBe(beforeFresh);
    });

    it("42. never claims/mutates anything -- a peek immediately followed by a real claim still finds the same row claimable", async () => {
      await insertScheduled("dddddddd-0000-0000-0000-000000000006", { scheduledForOffsetMs: -1000 });

      const before = await peek();
      expect(before).toBeGreaterThanOrEqual(1);

      const result = await db.query("select * from public.claim_due_manager_scheduled_broadcasts(100)");
      expect(result.rows.map((r) => r.id)).toContain("dddddddd-0000-0000-0000-000000000006");

      // This test only proves peek() itself performed no write, by
      // re-querying the exact row it reported and confirming the claim
      // independently succeeded (a freshly-claimed row now has a live
      // lease, so it correctly stops counting as "due" from peek's point
      // of view immediately afterward -- see test 40 above).
    });

    it("43. dispatched/cancelled rows are never counted", async () => {
      const before = await peek();
      await insertScheduled("dddddddd-0000-0000-0000-000000000007", { status: "dispatched", scheduledForOffsetMs: -1000 });
      await insertScheduled("dddddddd-0000-0000-0000-000000000008", { status: "cancelled", scheduledForOffsetMs: -1000 });
      expect(await peek()).toBe(before);
    });

    it("44. anon/authenticated cannot execute the function at all", async () => {
      await db.query("set role authenticated");
      try {
        await expect(db.query("select public.peek_due_manager_scheduled_broadcasts()")).rejects.toThrow(
          /permission denied/i,
        );
      } finally {
        await db.query("reset role");
      }
    });
  });

  // -------------------------------------------------------------------
  // upsert_aggregate_notification_job / resolve_aggregate_notification_job
  // -- spec: fix a real production notification-spam incident (the weapon/
  // shooting-range-qualification manager alert: 38 -> 40 -> 44 mismatches
  // produced THREE separate Notification Center entries and THREE pushes
  // instead of one notification updating its own count with exactly one
  // push). A GENUINE proof that the row-locking/retry-on-conflict episode
  // model actually holds under real concurrent connections -- the property
  // under test IS Postgres's own locking behavior, which a mock cannot
  // honestly prove (same rationale as `claim_due_notification_jobs`/
  // `upsert_pending_reminder_job` above).
  // -------------------------------------------------------------------

  describe("upsert_aggregate_notification_job / resolve_aggregate_notification_job", () => {
    async function callUpsert(dedupeKey: string, overrides: Partial<{ title: string; sourceRef: string | null }> = {}) {
      return db.query(
        `select public.upsert_aggregate_notification_job($1, $2, $3, 'b', '/manager', null, $4, now(), $5) as reopened`,
        ["weapon_qualification_summary", USER_A, overrides.title ?? "t", dedupeKey, overrides.sourceRef ?? null],
      );
    }

    async function callResolve(dedupeKey: string) {
      return db.query("select public.resolve_aggregate_notification_job($1)", [dedupeKey]);
    }

    async function jobRow(dedupeKey: string) {
      const result = await db.query("select * from public.notification_jobs where dedupe_key = $1", [dedupeKey]);
      return result.rows[0];
    }

    it("45. first call opens a fresh episode -- a new pending row, reopened=true", async () => {
      const result = await callUpsert("episode-fresh", { sourceRef: '["a"]' });
      expect(result.rows[0].reopened).toBe(true);

      const row = await jobRow("episode-fresh");
      expect(row.status).toBe("pending");
      expect(row.resolved_at).toBeNull();
      expect(row.source_ref).toBe('["a"]');
    });

    it("46. the exact production incident: 38 -> 40 -> 44 refreshes the SAME row in place, reopened=false after the first call, never a second row", async () => {
      const first = await callUpsert("episode-3840", { title: "38 mismatches", sourceRef: '["k1","...38"]' });
      expect(first.rows[0].reopened).toBe(true);

      const second = await callUpsert("episode-3840", { title: "40 mismatches", sourceRef: '["k1","...40"]' });
      expect(second.rows[0].reopened).toBe(false);

      const third = await callUpsert("episode-3840", { title: "44 mismatches", sourceRef: '["k1","...44"]' });
      expect(third.rows[0].reopened).toBe(false);

      const countResult = await db.query(
        "select count(*)::int as n from public.notification_jobs where dedupe_key = $1",
        ["episode-3840"],
      );
      expect(countResult.rows[0].n).toBe(1); // exactly one row for the whole episode

      const row = await jobRow("episode-3840");
      expect(row.title).toBe("44 mismatches"); // content reflects the latest count
    });

    it("47. 44 -> 44 (identical content re-upserted) is idempotent -- still reopened=false, still one row", async () => {
      await callUpsert("episode-idempotent", { title: "44 mismatches" });
      const repeat = await callUpsert("episode-idempotent", { title: "44 mismatches" });
      expect(repeat.rows[0].reopened).toBe(false);

      const countResult = await db.query(
        "select count(*)::int as n from public.notification_jobs where dedupe_key = $1",
        ["episode-idempotent"],
      );
      expect(countResult.rows[0].n).toBe(1);
    });

    it("48. an already-delivered ('completed') open episode is content-refreshed but never revived to pending -- no re-push", async () => {
      await callUpsert("episode-completed", { title: "before delivery" });
      await db.query("update public.notification_jobs set status = 'completed', attempts = 1 where dedupe_key = $1", [
        "episode-completed",
      ]);

      const result = await callUpsert("episode-completed", { title: "after another tick" });
      expect(result.rows[0].reopened).toBe(false);

      const row = await jobRow("episode-completed");
      expect(row.status).toBe("completed"); // never revived
      expect(row.attempts).toBe(1); // retry bookkeeping untouched
      expect(row.title).toBe("after another tick"); // content still refreshes
    });

    it("49. resolving an open episode (44 -> 0) sets resolved_at, and a LATER call reopens it fresh (0 -> 3) -- reopened=true, same row, resolved_at cleared", async () => {
      await callUpsert("episode-resolve-reopen", { title: "44 mismatches" });

      await callResolve("episode-resolve-reopen");
      const resolvedRow = await jobRow("episode-resolve-reopen");
      expect(resolvedRow.resolved_at).not.toBeNull();

      const reopened = await callUpsert("episode-resolve-reopen", { title: "3 mismatches" });
      expect(reopened.rows[0].reopened).toBe(true);

      const finalRow = await jobRow("episode-resolve-reopen");
      expect(finalRow.resolved_at).toBeNull();
      expect(finalRow.status).toBe("pending"); // a fresh push is due
      expect(finalRow.title).toBe("3 mismatches");

      const countResult = await db.query(
        "select count(*)::int as n from public.notification_jobs where dedupe_key = $1",
        ["episode-resolve-reopen"],
      );
      expect(countResult.rows[0].n).toBe(1); // the SAME row is reused, never a second one
    });

    it("50. resolve is idempotent -- resolving twice, or resolving a key with no row at all, never throws", async () => {
      await callUpsert("episode-double-resolve", {});
      await callResolve("episode-double-resolve");
      await callResolve("episode-double-resolve"); // already resolved -- must not throw
      await expect(callResolve("episode-never-opened")).resolves.toBeDefined(); // no row at all -- must not throw
    });

    it("51. a completed episode's attempts/claimed_at/last_error reset to a clean slate on reopen, so the worker's retry budget starts fresh for the new episode", async () => {
      await callUpsert("episode-clean-reopen", {});
      await db.query(
        "update public.notification_jobs set status = 'failed', attempts = 5, last_error = 'boom' where dedupe_key = $1",
        ["episode-clean-reopen"],
      );
      await callResolve("episode-clean-reopen");

      await callUpsert("episode-clean-reopen", { title: "new episode" });

      const row = await jobRow("episode-clean-reopen");
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(0);
      expect(row.claimed_at).toBeNull();
      expect(row.last_error).toBeNull();
    });

    it("52. two concurrent callers opening the SAME brand-new episode: exactly one observes reopened=true, the other observes reopened=false, and only one row is ever created", async () => {
      const connA = new Client({ connectionString: withDatabase(BASE_CONNECTION_STRING, dbName) });
      const connB = new Client({ connectionString: withDatabase(BASE_CONNECTION_STRING, dbName) });
      await connA.connect();
      await connB.connect();

      try {
        await connA.query("begin");
        const lockedResult = connA.query(
          `select public.upsert_aggregate_notification_job($1, $2, 't', 'b', '/manager', null, $3, now(), null) as reopened`,
          ["weapon_qualification_summary", USER_A, "episode-race"],
        );

        // Give A a moment to acquire its insert before B races in. A's own
        // row-level lock is only taken AFTER the insert commits (or B would
        // simply block forever inside an uncommitted transaction) -- so
        // this test proves the RETRY path specifically: B must attempt its
        // own insert, lose to A's already-committed row, and correctly
        // fall back to locking + updating it instead.
        await new Promise((resolve) => setTimeout(resolve, 150));
        await connA.query("commit");

        const [aResult, bResult] = await Promise.all([
          lockedResult,
          connB.query(
            `select public.upsert_aggregate_notification_job($1, $2, 't', 'b', '/manager', null, $3, now(), null) as reopened`,
            ["weapon_qualification_summary", USER_A, "episode-race"],
          ),
        ]);

        const reopenedFlags = [aResult.rows[0].reopened, bResult.rows[0].reopened].sort();
        // Exactly one caller opened the fresh episode; the other found it
        // already open and merely refreshed it -- never both "true"
        // (which would mean a duplicate initial PUSH job).
        expect(reopenedFlags).toEqual([false, true]);

        const countResult = await db.query(
          "select count(*)::int as n from public.notification_jobs where dedupe_key = $1",
          ["episode-race"],
        );
        expect(countResult.rows[0].n).toBe(1);
      } finally {
        await connA.end();
        await connB.end();
      }
    });

    it("53. anon/authenticated cannot execute either function", async () => {
      await db.query("set role authenticated");
      try {
        await expect(callUpsert("episode-forbidden", {})).rejects.toThrow(/permission denied/i);
        await expect(callResolve("episode-forbidden")).rejects.toThrow(/permission denied/i);
      } finally {
        await db.query("reset role");
      }
    });
  });
  // -------------------------------------------------------------------
  // search_path hardening (20260913214946_harden_aggregate_notification_rpc_search_path)
  // -------------------------------------------------------------------

  describe("aggregate notification RPCs -- search_path hardening", () => {
    it("both functions carry an EMPTY pinned search_path after the migrations are applied in order", async () => {
      const result = await db.query(`
        select p.proname, coalesce(array_to_string(p.proconfig, ','), '') as config
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('upsert_aggregate_notification_job', 'resolve_aggregate_notification_job')
         order by p.proname
      `);

      expect(result.rows).toHaveLength(2);
      for (const row of result.rows) {
        // Postgres stores `set search_path to ''` as the literal
        // `search_path=""`; `= public` would read `search_path=public`.
        expect(row.config).toBe('search_path=""');
      }
    });

    it("still resolve public.notification_jobs when a DECOY schema of the same shape sits first in the caller's search_path", async () => {
      // This is the failure mode an empty search_path exists to prevent,
      // and simultaneously the risk it introduces: if any reference
      // inside those function bodies were unqualified, it would resolve
      // to the decoy here (or fail outright), not to the real table.
      // Nothing about that is visible at CREATE time -- only at RUN time.
      await db.query("drop schema if exists search_path_decoy cascade");
      await db.query("create schema search_path_decoy");
      await db.query(
        "create table search_path_decoy.notification_jobs (like public.notification_jobs including all)",
      );

      const dedupeKey = `harden_check:${Date.now()}`;
      try {
        await db.query("set search_path to search_path_decoy, public");

        const opened = await db.query(
          "select public.upsert_aggregate_notification_job($1,$2,$3,$4,$5,$6,$7,now(),$8) as ok",
          ["weapon_qualification_summary", USER_A, "t1", "b1", "/", "tag", dedupeKey, "src"],
        );
        expect(opened.rows[0].ok).toBe(true);

        const refreshed = await db.query(
          "select public.upsert_aggregate_notification_job($1,$2,$3,$4,$5,$6,$7,now(),$8) as ok",
          ["weapon_qualification_summary", USER_A, "t2", "b2", "/", "tag", dedupeKey, "src"],
        );
        expect(refreshed.rows[0].ok).toBe(false);

        await db.query("select public.resolve_aggregate_notification_job($1)", [dedupeKey]);

        const reopened = await db.query(
          "select public.upsert_aggregate_notification_job($1,$2,$3,$4,$5,$6,$7,now(),$8) as ok",
          ["weapon_qualification_summary", USER_A, "t3", "b3", "/", "tag", dedupeKey, "src"],
        );
        expect(reopened.rows[0].ok).toBe(true);
      } finally {
        await db.query("reset search_path");
      }

      const real = await db.query("select title, status from public.notification_jobs where dedupe_key = $1", [
        dedupeKey,
      ]);
      expect(real.rows).toHaveLength(1);
      expect(real.rows[0].title).toBe("t3");
      expect(real.rows[0].status).toBe("pending");

      const decoy = await db.query("select count(*)::int as n from search_path_decoy.notification_jobs");
      expect(decoy.rows[0].n).toBe(0);

      await db.query("drop schema search_path_decoy cascade");
    });
  });
});
