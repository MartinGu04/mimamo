import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Client } from "pg";

/**
 * A GENUINE runtime proof of the push-reliability RPCs -- the companion
 * to `pushReliabilityMigration.test.ts` (which only pattern-matches SQL
 * text and says so explicitly). Same technique as this repository's
 * existing `lib/push/upsertPushSubscriptionRpc.integration.test.ts`:
 * connect to a real local PostgreSQL, create a throwaway database, load
 * the ACTUAL migration files byte-for-byte, stub just enough of
 * Supabase's `auth` schema (`auth.users`, `auth.uid()` reading
 * `request.jwt.claims` exactly as Supabase's real implementation does),
 * and run the real scenarios against the real PL/pgSQL.
 *
 * Intentionally NOT part of the required `npm test` gate for every
 * contributor: this repository has no CI-provisioned Postgres, and
 * requiring one to run `vitest run` would be a real regression for
 * anyone without it. So this suite probes for a reachable database at
 * import time and SKIPS ITSELF ENTIRELY (not "fails", not "fakes a
 * pass") when none is found. Point `TEST_DATABASE_URL` at any reachable
 * Postgres (a role with CREATEDB) to run it.
 *
 * This does not stand in for a full Supabase/PostgREST integration test
 * (real Supabase also enforces RLS policies and the JWT-issuing layer
 * this file does not reconstruct). What it genuinely proves is the part
 * this feature's correctness actually rests on: the SECURITY DEFINER
 * functions' own branching -- revocation, heartbeat scoping, per-user
 * device removal, and receipt idempotency/authorization.
 */
const BASE_CONNECTION_STRING = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
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
    "[pushReliabilityRpc.integration.test] No reachable Postgres at " +
      `${BASE_CONNECTION_STRING} -- skipping the real-database RPC integration suite. ` +
      "Set TEST_DATABASE_URL to run it.",
  );
}

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "supabase", "migrations");

function migrationSql(fragment: string): string {
  const file = fs.readdirSync(MIGRATIONS_DIR).find((name) => name.includes(fragment));
  if (!file) throw new Error(`No migration matching ${fragment}`);
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
}

describe.skipIf(!databaseAvailable)("push reliability RPCs -- real PostgreSQL execution", () => {
  const dbName = `test_push_reliability_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: Client;
  let db: Client;

  const USER_A = "00000000-0000-0000-0000-0000000000a1";
  const USER_B = "00000000-0000-0000-0000-0000000000b2";

  const KEYS = { p256dh: "p256dh-key", auth: "auth-key" };

  async function actingAs<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId })]);
    try {
      return await fn();
    } finally {
      await db.query("select set_config('request.jwt.claims', '', false)");
    }
  }

  async function actingAsAnonymous<T>(fn: () => Promise<T>): Promise<T> {
    await db.query("select set_config('request.jwt.claims', '', false)");
    return fn();
  }

  /** The EXPLICIT enable -- a user pressing "הפעל התראות" on that device. */
  async function explicitEnable(endpoint: string, keys = KEYS, descriptor = ["phone", "ios", "safari", true]) {
    const result = await db.query(
      "select * from public.upsert_push_subscription_v2($1,$2,$3,$4,true,$5,$6,$7,$8)",
      [endpoint, keys.p256dh, keys.auth, null, ...descriptor],
    );
    return result.rows[0];
  }

  /** The SILENT auto-restore path -- what a device does on load with a remembered "enabled" preference. */
  async function passiveRestore(endpoint: string, keys = KEYS) {
    const result = await db.query(
      "select * from public.upsert_push_subscription_v2($1,$2,$3,$4,false,null,null,null,null)",
      [endpoint, keys.p256dh, keys.auth, null],
    );
    return result.rows[0];
  }

  /** The ORIGINAL four-argument RPC, i.e. what an old still-open client calls mid-rollout. */
  async function legacyUpsert(endpoint: string, keys = KEYS) {
    const result = await db.query("select * from public.upsert_push_subscription($1,$2,$3,$4)", [
      endpoint,
      keys.p256dh,
      keys.auth,
      null,
    ]);
    return result.rows[0];
  }

  async function rowFor(endpoint: string) {
    const result = await db.query("select * from public.push_subscriptions where endpoint = $1", [endpoint]);
    return result.rows[0];
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: BASE_CONNECTION_STRING });
    await admin.connect();
    await admin.query(`create database ${dbName}`);

    db = new Client({ connectionString: withDatabase(BASE_CONNECTION_STRING, dbName) });
    await db.connect();

    // Minimal stand-in for Supabase's own `auth` schema -- just enough
    // for the real migration files to load and run unmodified.
    await db.query(`
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid
        language sql stable
        as $$
          select (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid
        $$;
    `);

    // The migrations' grants target Supabase's built-in roles, which do
    // not exist on a vanilla Postgres. Roles are CLUSTER-wide, so this is
    // idempotent across runs, matching real Supabase where they always
    // exist.
    await db.query(`
      do $$
      begin
        if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
        if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
        if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
      end
      $$;
    `);

    await db.query(migrationSql("create_push_subscriptions"));
    await db.query(migrationSql("create_notification_engine"));
    await db.query(migrationSql("push_reliability_and_device_management"));

    await db.query("insert into auth.users (id) values ($1), ($2)", [USER_A, USER_B]);
  }, 30_000);

  afterAll(async () => {
    if (db) await db.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await db.query("delete from public.notification_deliveries");
    await db.query("delete from public.notification_jobs");
    await db.query("delete from public.push_subscriptions");
  });

  // -------------------------------------------------------------------
  // Registration + device metadata
  // -------------------------------------------------------------------

  describe("registration", () => {
    it("an explicit enable creates an ACTIVE row with an opaque device_ref distinct from the primary key", async () => {
      const row = await actingAs(USER_A, () => explicitEnable("https://push.example/a"));

      expect(row.user_id).toBe(USER_A);
      expect(row.revoked_at).toBeNull();
      expect(row.device_ref).toMatch(/^[0-9a-f]{32}$/);
      expect(row.device_ref).not.toBe(row.id);
    });

    it("records only the coarse descriptor, and refuses anything outside each closed enum", async () => {
      const row = await actingAs(USER_A, () =>
        explicitEnable("https://push.example/a", KEYS, [
          "phone",
          "ios",
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
          true,
        ]),
      );

      expect(row.device_type).toBe("phone");
      expect(row.device_platform).toBe("ios");
      // A raw User-Agent smuggled into a descriptor field is DISCARDED,
      // not stored.
      expect(row.device_browser).toBeNull();
      expect(row.device_standalone).toBe(true);
    });

    it("a passive restore does not overwrite an existing device's recorded descriptor", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/a", KEYS, ["desktop", "windows", "chrome", false]));
      await actingAs(USER_A, () => passiveRestore("https://push.example/a"));

      const row = await rowFor("https://push.example/a");
      expect(row.device_platform).toBe("windows");
      expect(row.device_browser).toBe("chrome");
    });

    it("still refuses to reassign another user's endpoint without matching keys (PR #29's guarantee, unchanged)", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/shared"));

      await expect(
        actingAs(USER_B, () => explicitEnable("https://push.example/shared", { p256dh: "forged", auth: "forged" })),
      ).rejects.toThrow(/could not be registered/);

      expect((await rowFor("https://push.example/shared")).user_id).toBe(USER_A);
    });

    it("still allows a genuine shared-device account switch when the same physical subscription is presented", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/shared"));
      await actingAs(USER_B, () => explicitEnable("https://push.example/shared"));

      const row = await rowFor("https://push.example/shared");
      expect(row.user_id).toBe(USER_B);
      expect(row.revoked_at).toBeNull();
    });

    it("clears the previous owner's receipt history when a device is handed to a different account", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/shared"));
      await db.query("update public.push_subscriptions set last_received_at = now() where endpoint = $1", [
        "https://push.example/shared",
      ]);

      await actingAs(USER_B, () => explicitEnable("https://push.example/shared"));

      expect((await rowFor("https://push.example/shared")).last_received_at).toBeNull();
    });

    it("rejects an unauthenticated caller outright", async () => {
      await expect(actingAsAnonymous(() => explicitEnable("https://push.example/a"))).rejects.toThrow(
        /requires an authenticated user/,
      );
    });
  });

  // -------------------------------------------------------------------
  // Revocation -- the core guarantee
  // -------------------------------------------------------------------

  describe("remote removal (device A removes device B)", () => {
    it("takes the device out of the active set immediately, without deleting the row", async () => {
      const row = await actingAs(USER_A, () => explicitEnable("https://push.example/b"));

      const revoked = await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2) as ok", [row.device_ref, "user_removed"]),
      );
      expect(revoked.rows[0].ok).toBe(true);

      const after = await rowFor("https://push.example/b");
      expect(after).toBeDefined(); // tombstone, not a delete
      expect(after.revoked_at).not.toBeNull();
      expect(after.revoked_reason).toBe("user_removed");
    });

    it("SILENT AUTO-RESTORE CANNOT REVIVE IT -- the whole point of the tombstone", async () => {
      const row = await actingAs(USER_A, () => explicitEnable("https://push.example/b"));
      await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2)", [row.device_ref, "user_removed"]),
      );

      await expect(actingAs(USER_A, () => passiveRestore("https://push.example/b"))).rejects.toThrow(/revoked/);
      expect((await rowFor("https://push.example/b")).revoked_at).not.toBeNull();
    });

    it("a rejected passive restore writes NOTHING -- not even last_seen_at, so a tombstone cannot be kept looking fresh", async () => {
      const row = await actingAs(USER_A, () => explicitEnable("https://push.example/b"));
      await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2)", [row.device_ref, "user_removed"]),
      );
      const before = await rowFor("https://push.example/b");

      await expect(actingAs(USER_A, () => passiveRestore("https://push.example/b"))).rejects.toThrow();

      const after = await rowFor("https://push.example/b");
      expect(after.last_seen_at).toEqual(before.last_seen_at);
      expect(after.updated_at).toEqual(before.updated_at);
    });

    it("an OLD deployed client (the original four-argument RPC) cannot revive it either", async () => {
      const row = await actingAs(USER_A, () => explicitEnable("https://push.example/b"));
      await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2)", [row.device_ref, "user_removed"]),
      );

      await expect(actingAs(USER_A, () => legacyUpsert("https://push.example/b"))).rejects.toThrow(/revoked/);
    });

    it("an old client still works normally against an ACTIVE row -- rollout does not break existing devices", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/b"));
      const refreshed = await actingAs(USER_A, () => legacyUpsert("https://push.example/b"));

      expect(refreshed.user_id).toBe(USER_A);
      expect(refreshed.revoked_at).toBeNull();
    });

    it("an EXPLICIT enable on that device -- and only that -- brings it back", async () => {
      const row = await actingAs(USER_A, () => explicitEnable("https://push.example/b"));
      await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2)", [row.device_ref, "user_removed"]),
      );

      const reactivated = await actingAs(USER_A, () => explicitEnable("https://push.example/b"));

      expect(reactivated.revoked_at).toBeNull();
      expect(reactivated.revoked_reason).toBeNull();
    });

    it("can only ever revoke the CALLER'S OWN device", async () => {
      const row = await actingAs(USER_A, () => explicitEnable("https://push.example/a-device"));

      const result = await actingAs(USER_B, () =>
        db.query("select public.revoke_push_subscription($1,$2) as ok", [row.device_ref, "user_removed"]),
      );

      // Indistinguishable from "no such device" -- never an ownership oracle.
      expect(result.rows[0].ok).toBe(false);
      expect((await rowFor("https://push.example/a-device")).revoked_at).toBeNull();
    });

    it("reports false for an unknown device_ref, and false for an unauthenticated caller", async () => {
      const unknown = await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2) as ok", ["deadbeef".repeat(4), "user_removed"]),
      );
      expect(unknown.rows[0].ok).toBe(false);

      const row = await actingAs(USER_A, () => explicitEnable("https://push.example/a"));
      const anonymous = await actingAsAnonymous(() =>
        db.query("select public.revoke_push_subscription($1,$2) as ok", [row.device_ref, "user_removed"]),
      );
      expect(anonymous.rows[0].ok).toBe(false);
    });

    it("never stores a caller-invented reason string", async () => {
      const row = await actingAs(USER_A, () => explicitEnable("https://push.example/a"));
      await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2)", [row.device_ref, "'; drop table --"]),
      );

      expect((await rowFor("https://push.example/a")).revoked_reason).toBe("user_removed");
    });

    it("re-revoking is a harmless no-op that keeps the ORIGINAL revocation time and reason", async () => {
      const row = await actingAs(USER_A, () => explicitEnable("https://push.example/a"));
      await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2)", [row.device_ref, "self_disabled"]),
      );
      const first = await rowFor("https://push.example/a");

      await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2)", [row.device_ref, "user_removed"]),
      );
      const second = await rowFor("https://push.example/a");

      expect(second.revoked_at).toEqual(first.revoked_at);
      expect(second.revoked_reason).toBe("self_disabled");
    });
  });

  describe("404/410 permanent failure", () => {
    it("a worker-revoked dead endpoint is inactive immediately and cannot be resurrected by auto-restore", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/dead"));
      // What the delivery worker does on a 404/410 (service-role, so no
      // JWT claims -- it bypasses RLS by role, exactly as in production).
      await db.query(
        "update public.push_subscriptions set revoked_at = now(), revoked_reason = 'permanent_push_failure' where endpoint = $1",
        ["https://push.example/dead"],
      );

      await expect(actingAs(USER_A, () => passiveRestore("https://push.example/dead"))).rejects.toThrow(/revoked/);
      // No endless 404 -> delete -> re-register -> 404 loop.
      expect((await rowFor("https://push.example/dead")).revoked_reason).toBe("permanent_push_failure");
    });

    it("explicit recovery works, and the reason is visible beforehand so the client knows to recreate the subscription first", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/dead"));
      await db.query(
        "update public.push_subscriptions set revoked_at = now(), revoked_reason = 'permanent_push_failure' where endpoint = $1",
        ["https://push.example/dead"],
      );

      expect((await rowFor("https://push.example/dead")).revoked_reason).toBe("permanent_push_failure");

      // In the real flow the client unsubscribes and subscribes again,
      // producing a genuinely NEW endpoint -- which registers cleanly.
      const fresh = await actingAs(USER_A, () =>
        explicitEnable("https://push.example/recreated", { p256dh: "new-p256dh", auth: "new-auth" }),
      );
      expect(fresh.revoked_at).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------

  describe("touch_push_subscription (the heartbeat)", () => {
    it("moves last_seen_at forward on the caller's own ACTIVE device", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/a"));
      await db.query("update public.push_subscriptions set last_seen_at = now() - interval '5 days'");
      const before = await rowFor("https://push.example/a");

      const result = await actingAs(USER_A, () =>
        db.query("select public.touch_push_subscription($1) as ok", ["https://push.example/a"]),
      );

      expect(result.rows[0].ok).toBe(true);
      expect((await rowFor("https://push.example/a")).last_seen_at.getTime()).toBeGreaterThan(
        before.last_seen_at.getTime(),
      );
    });

    it("CANNOT revive a revoked device", async () => {
      const row = await actingAs(USER_A, () => explicitEnable("https://push.example/a"));
      await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2)", [row.device_ref, "user_removed"]),
      );

      const result = await actingAs(USER_A, () =>
        db.query("select public.touch_push_subscription($1) as ok", ["https://push.example/a"]),
      );

      expect(result.rows[0].ok).toBe(false);
      expect((await rowFor("https://push.example/a")).revoked_at).not.toBeNull();
    });

    it("CANNOT create a row for an endpoint that does not exist", async () => {
      const result = await actingAs(USER_A, () =>
        db.query("select public.touch_push_subscription($1) as ok", ["https://push.example/never-registered"]),
      );

      expect(result.rows[0].ok).toBe(false);
      const count = await db.query("select count(*)::int as n from public.push_subscriptions");
      expect(count.rows[0].n).toBe(0);
    });

    it("CANNOT touch another user's device, and never reveals that it exists", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/a-device"));
      const before = await rowFor("https://push.example/a-device");

      const foreign = await actingAs(USER_B, () =>
        db.query("select public.touch_push_subscription($1) as ok", ["https://push.example/a-device"]),
      );
      const unknown = await actingAs(USER_B, () =>
        db.query("select public.touch_push_subscription($1) as ok", ["https://push.example/nothing-here"]),
      );

      // Same answer for "someone else's device" and "no such device".
      expect(foreign.rows[0].ok).toBe(false);
      expect(unknown.rows[0].ok).toBe(false);
      expect((await rowFor("https://push.example/a-device")).last_seen_at).toEqual(before.last_seen_at);
    });

    it("reports false for an unauthenticated caller and changes nothing", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/a"));
      const before = await rowFor("https://push.example/a");

      const result = await actingAsAnonymous(() =>
        db.query("select public.touch_push_subscription($1) as ok", ["https://push.example/a"]),
      );

      expect(result.rows[0].ok).toBe(false);
      expect((await rowFor("https://push.example/a")).last_seen_at).toEqual(before.last_seen_at);
    });

    it("never changes ownership", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/a"));
      await actingAs(USER_B, () => db.query("select public.touch_push_subscription($1)", ["https://push.example/a"]));

      expect((await rowFor("https://push.example/a")).user_id).toBe(USER_A);
    });
  });

  // -------------------------------------------------------------------
  // Multi-device independence
  // -------------------------------------------------------------------

  describe("multiple devices", () => {
    it("three devices coexist independently; opening one updates only that one, and none is ever removed for being old", async () => {
      await actingAs(USER_A, () => explicitEnable("https://push.example/iphone", KEYS, ["phone", "ios", "safari", true]));
      await actingAs(USER_A, () =>
        explicitEnable("https://push.example/windows", { p256dh: "k2", auth: "a2" }, ["desktop", "windows", "chrome", false]),
      );
      await actingAs(USER_A, () =>
        explicitEnable("https://push.example/other-pc", { p256dh: "k3", auth: "a3" }, ["desktop", "macos", "firefox", false]),
      );
      await db.query("update public.push_subscriptions set last_seen_at = now() - interval '30 days'");

      await actingAs(USER_A, () => db.query("select public.touch_push_subscription($1)", ["https://push.example/iphone"]));

      const rows = await db.query(
        "select endpoint, last_seen_at from public.push_subscriptions where revoked_at is null order by endpoint",
      );
      expect(rows.rows).toHaveLength(3);
      const byEndpoint = new Map(rows.rows.map((row) => [row.endpoint, row.last_seen_at.getTime()]));
      const staleCutoff = Date.now() - 20 * 24 * 60 * 60 * 1000;
      expect(byEndpoint.get("https://push.example/iphone")!).toBeGreaterThan(staleCutoff);
      expect(byEndpoint.get("https://push.example/windows")!).toBeLessThan(staleCutoff);
      expect(byEndpoint.get("https://push.example/other-pc")!).toBeLessThan(staleCutoff);
    });

    it("removing one device leaves the others active", async () => {
      const iphone = await actingAs(USER_A, () => explicitEnable("https://push.example/iphone"));
      await actingAs(USER_A, () => explicitEnable("https://push.example/windows", { p256dh: "k2", auth: "a2" }));

      await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2)", [iphone.device_ref, "user_removed"]),
      );

      const active = await db.query("select endpoint from public.push_subscriptions where revoked_at is null");
      expect(active.rows.map((row) => row.endpoint)).toEqual(["https://push.example/windows"]);
    });
  });

  // -------------------------------------------------------------------
  // Delivery receipts
  // -------------------------------------------------------------------

  describe("record_notification_delivery_receipt", () => {
    const TOKEN_A = "a".repeat(64);
    const TOKEN_B = "b".repeat(64);
    const hash = (token: string) => createHash("sha256").update(token).digest("hex");

    async function seedDelivery(
      endpoint: string,
      token: string | null,
      status: string,
      dedupeKey: string,
    ): Promise<{ deliveryId: string; subscriptionId: string }> {
      const subscription = await actingAs(USER_A, () =>
        explicitEnable(endpoint, { p256dh: `p-${dedupeKey}`, auth: `a-${dedupeKey}` }),
      );
      const jobResult = await db.query(
        `insert into public.notification_jobs (category, recipient_user_id, title, body, path, dedupe_key, scheduled_for)
         values ('manual_broadcast', $1, 't', 'b', '/', $2, now()) returning id`,
        [USER_A, dedupeKey],
      );
      const deliveryResult = await db.query(
        `insert into public.notification_deliveries (job_id, push_subscription_id, status, receipt_token_hash)
         values ($1, $2, $3, $4) returning id`,
        [jobResult.rows[0].id, subscription.id, status, token === null ? null : hash(token)],
      );
      return { deliveryId: deliveryResult.rows[0].id, subscriptionId: subscription.id };
    }

    async function ack(token: string) {
      await actingAsAnonymous(() =>
        db.query("select public.record_notification_delivery_receipt($1)", [hash(token)]),
      );
    }

    it("a real receipt stamps received_at on the RIGHT delivery and last_received_at on the RIGHT device", async () => {
      const { deliveryId, subscriptionId } = await seedDelivery("https://push.example/d1", TOKEN_A, "sent", "job-1");

      await ack(TOKEN_A);

      const deliveryRow = await db.query("select received_at from public.notification_deliveries where id = $1", [
        deliveryId,
      ]);
      expect(deliveryRow.rows[0].received_at).not.toBeNull();
      const subscriptionRow = await db.query("select last_received_at from public.push_subscriptions where id = $1", [
        subscriptionId,
      ]);
      expect(subscriptionRow.rows[0].last_received_at).not.toBeNull();
    });

    it("a push the provider accepted but which was never acknowledged keeps received_at NULL", async () => {
      const { deliveryId } = await seedDelivery("https://push.example/d1", TOKEN_A, "sent", "job-1");

      const row = await db.query("select received_at from public.notification_deliveries where id = $1", [deliveryId]);
      expect(row.rows[0].received_at).toBeNull();
    });

    it("a SECOND identical ACK is harmless and keeps the FIRST receipt time", async () => {
      const { deliveryId } = await seedDelivery("https://push.example/d1", TOKEN_A, "sent", "job-1");

      await ack(TOKEN_A);
      const first = await db.query("select received_at from public.notification_deliveries where id = $1", [deliveryId]);
      await ack(TOKEN_A);
      const second = await db.query("select received_at from public.notification_deliveries where id = $1", [deliveryId]);

      expect(second.rows[0].received_at).toEqual(first.rows[0].received_at);
    });

    it("an invalid/forged token changes absolutely nothing", async () => {
      const { deliveryId, subscriptionId } = await seedDelivery("https://push.example/d1", TOKEN_A, "sent", "job-1");

      await ack("f".repeat(64));
      await actingAsAnonymous(() =>
        db.query("select public.record_notification_delivery_receipt($1)", ["not-even-a-hash"]),
      );
      await actingAsAnonymous(() => db.query("select public.record_notification_delivery_receipt(null)"));

      const deliveryRow = await db.query("select received_at from public.notification_deliveries where id = $1", [
        deliveryId,
      ]);
      expect(deliveryRow.rows[0].received_at).toBeNull();
      const subscriptionRow = await db.query("select last_received_at from public.push_subscriptions where id = $1", [
        subscriptionId,
      ]);
      expect(subscriptionRow.rows[0].last_received_at).toBeNull();
    });

    it("an ACK for one delivery cannot mutate another", async () => {
      const first = await seedDelivery("https://push.example/d1", TOKEN_A, "sent", "job-1");
      const second = await seedDelivery("https://push.example/d2", TOKEN_B, "sent", "job-2");

      await ack(TOKEN_A);

      const untouched = await db.query("select received_at from public.notification_deliveries where id = $1", [
        second.deliveryId,
      ]);
      expect(untouched.rows[0].received_at).toBeNull();
      const touched = await db.query("select received_at from public.notification_deliveries where id = $1", [
        first.deliveryId,
      ]);
      expect(touched.rows[0].received_at).not.toBeNull();
    });

    it("TRANSIENT-SEND RACE: an ACK promotes a failed_transient delivery to terminal 'sent', so the worker does not duplicate-send it", async () => {
      const { deliveryId } = await seedDelivery("https://push.example/d1", TOKEN_A, "failed_transient", "job-1");

      await ack(TOKEN_A);

      const row = await db.query("select status, received_at from public.notification_deliveries where id = $1", [
        deliveryId,
      ]);
      expect(row.rows[0].status).toBe("sent");
      expect(row.rows[0].received_at).not.toBeNull();
    });

    it("does NOT overwrite a permanent failure's terminal status, but still records that it was received", async () => {
      const { deliveryId } = await seedDelivery("https://push.example/d1", TOKEN_A, "failed_permanent", "job-1");

      await ack(TOKEN_A);

      const row = await db.query("select status, received_at from public.notification_deliveries where id = $1", [
        deliveryId,
      ]);
      expect(row.rows[0].status).toBe("failed_permanent");
      expect(row.rows[0].received_at).not.toBeNull();
    });

    it("a delivery with no stored verifier can never be acknowledged by a null/empty hash", async () => {
      const { deliveryId } = await seedDelivery("https://push.example/d1", null, "sent", "job-1");

      await actingAsAnonymous(() => db.query("select public.record_notification_delivery_receipt(null)"));
      await actingAsAnonymous(() => db.query("select public.record_notification_delivery_receipt('')"));

      const row = await db.query("select received_at from public.notification_deliveries where id = $1", [deliveryId]);
      expect(row.rows[0].received_at).toBeNull();
    });

    it("is reachable with NO session at all -- an ACK must work while the PWA is closed", async () => {
      const { deliveryId } = await seedDelivery("https://push.example/d1", TOKEN_A, "sent", "job-1");

      // No `request.jwt.claims` is set at all here: `auth.uid()` is null,
      // exactly as it is for the Service Worker's credential-less POST.
      await actingAsAnonymous(() =>
        db.query("select public.record_notification_delivery_receipt($1)", [hash(TOKEN_A)]),
      );

      const row = await db.query("select received_at from public.notification_deliveries where id = $1", [deliveryId]);
      expect(row.rows[0].received_at).not.toBeNull();
    });

    it("returns nothing at all -- a valid, replayed, and bogus receipt are indistinguishable to the caller", async () => {
      await seedDelivery("https://push.example/d1", TOKEN_A, "sent", "job-1");

      const valid = await actingAsAnonymous(() =>
        db.query("select public.record_notification_delivery_receipt($1) as result", [hash(TOKEN_A)]),
      );
      const bogus = await actingAsAnonymous(() =>
        db.query("select public.record_notification_delivery_receipt($1) as result", [hash("z".repeat(64))]),
      );

      // `returns void` surfaces as an empty value through `pg`. What
      // matters is that the two answers are byte-identical: nothing in
      // the response tells a caller whether the token matched anything.
      expect(valid.rows[0].result).toEqual(bogus.rows[0].result);
      expect(Object.keys(valid.rows[0])).toEqual(["result"]);
    });
  });

  // -------------------------------------------------------------------
  // Grants
  // -------------------------------------------------------------------

  describe("grants", () => {
    it("`anon` can execute ONLY the receipt function, never the subscription RPCs", async () => {
      const result = await db.query(
        `select p.proname,
                has_function_privilege('anon', p.oid, 'execute') as anon_execute
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('upsert_push_subscription', 'upsert_push_subscription_v2',
                              'touch_push_subscription', 'revoke_push_subscription',
                              'record_notification_delivery_receipt')
          order by p.proname`,
      );

      const byName = new Map(result.rows.map((row) => [row.proname, row.anon_execute]));
      expect(byName.get("record_notification_delivery_receipt")).toBe(true);
      expect(byName.get("upsert_push_subscription")).toBe(false);
      expect(byName.get("upsert_push_subscription_v2")).toBe(false);
      expect(byName.get("touch_push_subscription")).toBe(false);
      expect(byName.get("revoke_push_subscription")).toBe(false);
    });

    it("`anon` has no direct access to the underlying tables -- the receipt function is its entire reachable surface", async () => {
      for (const table of ["push_subscriptions", "notification_deliveries"]) {
        for (const privilege of ["select", "insert", "update", "delete"]) {
          const result = await db.query("select has_table_privilege('anon', $1, $2) as granted", [
            `public.${table}`,
            privilege,
          ]);
          expect(result.rows[0].granted).toBe(false);
        }
      }
    });

    it("`authenticated` still has no direct INSERT/UPDATE on push_subscriptions -- every write goes through a function", async () => {
      for (const privilege of ["insert", "update"]) {
        const result = await db.query("select has_table_privilege('authenticated', $1, $2) as granted", [
          "public.push_subscriptions",
          privilege,
        ]);
        expect(result.rows[0].granted).toBe(false);
      }
    });
  });
});
