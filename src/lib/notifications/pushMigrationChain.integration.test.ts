import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

/**
 * A GENUINE runtime proof of the MIGRATION CHAIN itself, as opposed to
 * what any one function does (that is `pushReliabilityRpc.integration.test.ts`).
 *
 * Why this file exists: `20260921090000_push_reliability_and_device_management.sql`
 * was edited in place AFTER production had already applied it, to change
 * `touch_push_subscription` from one argument to five. Supabase records
 * a migration as applied by its timestamp prefix and never re-runs it,
 * so that edit could never have reached production -- the repository
 * would have expected a five-argument function that production did not
 * have, and no test in the suite would have noticed, because every test
 * built its database from the EDITED file.
 *
 * That is the specific blind spot this file closes. It exercises the two
 * paths that actually exist in the world:
 *
 *   1. A FRESH database built from the complete history in order.
 *   2. A database already at production's current state (everything
 *      through `20260921090000`, and no further), then upgraded with
 *      only the pending migration -- which is exactly what production
 *      will do.
 *
 * Both must converge on the same schema. The second is the one that
 * would have caught the mistake.
 *
 * Intentionally NOT part of the required `npm test` gate: this
 * repository has no CI-provisioned Postgres, so this suite probes for a
 * reachable database at import time and SKIPS ITSELF ENTIRELY when none
 * is found -- same convention as every other integration suite here.
 * Point `TEST_DATABASE_URL` at any reachable Postgres (a role with
 * CREATEDB) to run it.
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
    "[pushMigrationChain.integration.test] No reachable Postgres at " +
      `${BASE_CONNECTION_STRING} -- skipping the real-database migration-chain suite. ` +
      "Set TEST_DATABASE_URL to run it.",
  );
}

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "supabase", "migrations");

/** Every migration, in the exact order Supabase would apply them. */
function orderedMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** The migration production has already applied, up to and including the push-reliability one. */
const LAST_APPLIED = "20260921090000_push_reliability_and_device_management.sql";

function appliedInProduction(): string[] {
  const files = orderedMigrations();
  return files.slice(0, files.indexOf(LAST_APPLIED) + 1);
}

function pendingMigrations(): string[] {
  const files = orderedMigrations();
  return files.slice(files.indexOf(LAST_APPLIED) + 1);
}

describe.skipIf(!databaseAvailable)("push migration chain -- real PostgreSQL execution", () => {
  let admin: Client;
  const createdDatabases: string[] = [];

  /** Heartbeat signatures currently defined, one string per overload. */
  async function heartbeatSignatures(db: Client): Promise<string[]> {
    const result = await db.query(`
      select pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'touch_push_subscription'
       order by p.pronargs
    `);
    return result.rows.map((row) => row.args as string);
  }

  async function newDatabase(label: string): Promise<Client> {
    const name = `test_chain_${label}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await admin.query(`create database ${name}`);
    createdDatabases.push(name);

    const db = new Client({ connectionString: withDatabase(BASE_CONNECTION_STRING, name) });
    await db.connect();

    // Minimal stand-in for Supabase's own `auth` schema and built-in
    // roles -- just enough for the real migration files to run unmodified.
    await db.query(`
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid
        language sql stable
        as $$
          select (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid
        $$;
      do $$
      begin
        if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
        if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
        if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
      end
      $$;
    `);
    return db;
  }

  async function apply(db: Client, files: readonly string[]): Promise<void> {
    for (const file of files) {
      await db.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    }
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: BASE_CONNECTION_STRING });
    await admin.connect();
  }, 30_000);

  afterAll(async () => {
    for (const name of createdDatabases) {
      await admin.query(`drop database if exists ${name} with (force)`).catch(() => {});
    }
    if (admin) await admin.end();
  }, 60_000);

  describe("the history is shaped the way production expects", () => {
    it("has exactly ONE pending migration -- the legacy-metadata backfill", () => {
      expect(pendingMigrations()).toEqual([
        expect.stringMatching(/_legacy_push_device_metadata_backfill\.sql$/),
      ]);
    });

    it("applies the complete history to a FRESH database without error", async () => {
      const db = await newDatabase("fresh");
      try {
        await expect(apply(db, orderedMigrations())).resolves.toBeUndefined();
      } finally {
        await db.end();
      }
    }, 60_000);
  });

  describe("staged: production's current state, then the upgrade", () => {
    let db: Client;

    beforeAll(async () => {
      db = await newDatabase("staged");
      await apply(db, appliedInProduction());
    }, 60_000);

    afterAll(async () => {
      if (db) await db.end();
    });

    it("immediately after 20260921090000, the ONE-argument heartbeat exists -- matching what production actually has", async () => {
      expect(await heartbeatSignatures(db)).toEqual(["p_endpoint text"]);
    });

    it("that deployed heartbeat already carries the SECURITY DEFINER + empty-search_path hardening", async () => {
      const result = await db.query(`
        select p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as config
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'touch_push_subscription'
      `);
      expect(result.rows[0].prosecdef).toBe(true);
      expect(result.rows[0].config).toBe('search_path=""');
    });

    it("applies the pending migration on top of that exact state -- the real production upgrade", async () => {
      await expect(apply(db, pendingMigrations())).resolves.toBeUndefined();
    }, 30_000);

    it("the old one-argument heartbeat is GONE and the five-argument one exists", async () => {
      expect(await heartbeatSignatures(db)).toEqual([
        "p_endpoint text, p_device_type text, p_device_platform text, p_device_browser text, p_device_standalone boolean",
      ]);
    });

    it("leaves NO ambiguous overload -- exactly one touch_push_subscription remains", async () => {
      // Two functions of the same name would make PostgREST's
      // by-argument-name resolution ambiguous, and every heartbeat would
      // start failing with "Could not choose the best candidate function".
      expect(await heartbeatSignatures(db)).toHaveLength(1);
    });

    it("preserves the hardening and the grants through the arity change", async () => {
      const result = await db.query(`
        select p.prosecdef,
               coalesce(array_to_string(p.proconfig, ','), '') as config,
               has_function_privilege('authenticated', p.oid, 'execute') as authenticated_exec,
               has_function_privilege('anon', p.oid, 'execute') as anon_exec
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'touch_push_subscription'
      `);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].prosecdef).toBe(true);
      expect(result.rows[0].config).toBe('search_path=""');
      // The drop took the old grants with it, so these prove the new
      // signature re-established them rather than silently losing them.
      expect(result.rows[0].authenticated_exec).toBe(true);
      expect(result.rows[0].anon_exec).toBe(false);
    });
  });

  describe("both paths converge", () => {
    it("a FRESH database and an UPGRADED one end up with the identical heartbeat definition", async () => {
      const fresh = await newDatabase("converge_fresh");
      const upgraded = await newDatabase("converge_upgraded");
      try {
        await apply(fresh, orderedMigrations());

        await apply(upgraded, appliedInProduction());
        await apply(upgraded, pendingMigrations());

        expect(await heartbeatSignatures(upgraded)).toEqual(await heartbeatSignatures(fresh));

        async function definition(db: Client): Promise<string> {
          const result = await db.query(`
            select pg_get_functiondef(p.oid) as def
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'touch_push_subscription'
          `);
          return result.rows[0].def as string;
        }
        expect(await definition(upgraded)).toBe(await definition(fresh));
      } finally {
        await fresh.end();
        await upgraded.end();
      }
    }, 90_000);
  });

  describe("the upgraded heartbeat behaves correctly against real data", () => {
    const USER_A = "00000000-0000-0000-0000-0000000000a1";
    const USER_B = "00000000-0000-0000-0000-0000000000b2";
    let db: Client;

    async function actingAs<T>(userId: string, fn: () => Promise<T>): Promise<T> {
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId })]);
      try {
        return await fn();
      } finally {
        await db.query("select set_config('request.jwt.claims', '', false)");
      }
    }

    /** Registers a row exactly as production's legacy ones look: active, owned, no descriptor at all. */
    async function legacyRow(endpoint: string, keys = { p256dh: "k", auth: "a" }) {
      const result = await db.query(
        "select * from public.upsert_push_subscription_v2($1,$2,$3,null,true,null,null,null,null)",
        [endpoint, keys.p256dh, keys.auth],
      );
      return result.rows[0];
    }

    async function heartbeat(userId: string, endpoint: string, descriptor: (string | boolean | null)[]) {
      return actingAs(userId, () =>
        db.query("select public.touch_push_subscription($1,$2,$3,$4,$5) as ok", [endpoint, ...descriptor]),
      );
    }

    async function rowFor(endpoint: string) {
      const result = await db.query("select * from public.push_subscriptions where endpoint = $1", [endpoint]);
      return result.rows[0];
    }

    beforeAll(async () => {
      // Built the way production will get there: applied state first,
      // then the pending migration -- NOT the fresh-chain shortcut.
      db = await newDatabase("behaviour");
      await apply(db, appliedInProduction());
      await apply(db, pendingMigrations());
      await db.query("insert into auth.users (id) values ($1), ($2)", [USER_A, USER_B]);
    }, 60_000);

    afterAll(async () => {
      if (db) await db.end();
    });

    it("backfills every missing descriptor field on a legacy row", async () => {
      await actingAs(USER_A, () => legacyRow("https://push.example/legacy"));

      const result = await heartbeat(USER_A, "https://push.example/legacy", ["desktop", "windows", "chrome", false]);
      expect(result.rows[0].ok).toBe(true);

      const row = await rowFor("https://push.example/legacy");
      expect(row.device_type).toBe("desktop");
      expect(row.device_platform).toBe("windows");
      expect(row.device_browser).toBe("chrome");
      expect(row.device_standalone).toBe(false);
    });

    it("leaves ALREADY-RECORDED metadata untouched, filling only what is missing", async () => {
      await actingAs(USER_A, () =>
        db.query("select * from public.upsert_push_subscription_v2($1,$2,$3,null,true,null,$4,null,null)", [
          "https://push.example/partial",
          "k2",
          "a2",
          "windows",
        ]),
      );

      await heartbeat(USER_A, "https://push.example/partial", ["desktop", "macos", "firefox", true]);

      const row = await rowFor("https://push.example/partial");
      expect(row.device_platform).toBe("windows");
      expect(row.device_type).toBe("desktop");
      expect(row.device_browser).toBe("firefox");
    });

    it("does NOT backfill a REVOKED row, and does not clear its revocation", async () => {
      const created = await actingAs(USER_A, () => legacyRow("https://push.example/revoked", { p256dh: "k3", auth: "a3" }));
      await actingAs(USER_A, () =>
        db.query("select public.revoke_push_subscription($1,$2)", [created.device_ref, "user_removed"]),
      );

      const result = await heartbeat(USER_A, "https://push.example/revoked", ["desktop", "windows", "chrome", false]);

      expect(result.rows[0].ok).toBe(false);
      const row = await rowFor("https://push.example/revoked");
      expect(row.device_type).toBeNull();
      expect(row.revoked_at).not.toBeNull();
    });

    it("does NOT backfill ANOTHER user's row", async () => {
      await actingAs(USER_A, () => legacyRow("https://push.example/a-device", { p256dh: "k4", auth: "a4" }));

      const result = await heartbeat(USER_B, "https://push.example/a-device", ["desktop", "windows", "chrome", false]);

      expect(result.rows[0].ok).toBe(false);
      const row = await rowFor("https://push.example/a-device");
      expect(row.device_type).toBeNull();
      expect(row.user_id).toBe(USER_A);
    });
  });
});
