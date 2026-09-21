import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Text-level regression guard on the security-critical SHAPE of the push
 * reliability + device management migration -- the same convention
 * `lib/push/migration.test.ts` already established for the PR #29
 * migration, and with the same explicit scope note:
 *
 * IMPORTANT SCOPE NOTE: this file does NOT execute any SQL, so it cannot
 * prove the migration compiles or behaves correctly at runtime. A
 * genuine runtime proof of every scenario -- revocation blocking silent
 * auto-restore, the heartbeat refusing to revive, per-user scoping of
 * device removal, receipt idempotency, a forged token changing nothing --
 * lives in `pushReliabilityRpc.integration.test.ts`, which runs the
 * ACTUAL migration files against a real local PostgreSQL. This file
 * exists to catch a later edit that quietly widens a grant, drops a
 * `search_path` pin, or removes the revocation gate.
 */
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "supabase", "migrations");

function readMigration(fragment: string): string {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.includes(fragment));
  expect(files.length).toBeGreaterThan(0);
  return fs.readFileSync(path.join(MIGRATIONS_DIR, files[0]), "utf8");
}

const sql = readMigration("push_reliability_and_device_management");

/**
 * The migration with every `--` comment line removed. Negative
 * assertions ("this must NOT appear") run against THIS, not the raw
 * text: several of the doc comments deliberately NAME the thing they
 * explain the absence of (why `gen_random_bytes` is avoided, why no IP
 * address is stored), and a guard that failed on its own rationale
 * would just train the next person to delete the explanation.
 */
const executableSql = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("push reliability migration -- additive only", () => {
  it("never drops or renames an existing column or table", () => {
    expect(executableSql).not.toMatch(/drop\s+table/i);
    expect(executableSql).not.toMatch(/drop\s+column/i);
    expect(executableSql).not.toMatch(/rename\s+(column|to)/i);
  });

  it("adds every new column with IF NOT EXISTS, so re-running it is safe", () => {
    const addColumnStatements = sql.match(/add column[^,;]*/gi) ?? [];
    expect(addColumnStatements.length).toBeGreaterThan(0);
    for (const statement of addColumnStatements) {
      expect(statement).toMatch(/add column if not exists/i);
    }
  });

  it("does not edit an already-applied migration -- every other migration file is untouched by this one", () => {
    // A sanity check on the convention rather than the file: this
    // migration must be the newest by filename ordering.
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
    expect(files.at(-1)).toMatch(/push_reliability_and_device_management/);
  });
});

describe("push reliability migration -- revocation is the core guarantee", () => {
  it("adds a revoked_at tombstone rather than relying on deletes", () => {
    expect(sql).toMatch(/add column if not exists revoked_at timestamptz/i);
    expect(sql).toMatch(/add column if not exists revoked_reason text/i);
  });

  it("constrains revoked_reason to a closed set -- it can never become free text", () => {
    expect(sql).toMatch(/revoked_reason in \('user_removed', 'self_disabled', 'permanent_push_failure'\)/i);
  });

  it("the upsert REFUSES a passive (auto-restore) call against a revoked row", () => {
    expect(sql).toMatch(/if existing\.revoked_at is not null and not p_explicit then[\s\S]{0,200}raise exception/i);
  });

  it("only an EXPLICIT enable may clear a revocation", () => {
    expect(sql).toMatch(/revoked_at = case when p_explicit then null else revoked_at end/i);
    expect(sql).toMatch(/revoked_reason = case when p_explicit then null else revoked_reason end/i);
  });

  it("p_explicit has no default -- a caller can never omit its intent and get the permissive branch", () => {
    expect(executableSql).not.toMatch(/p_explicit boolean\s+default/i);
    expect(sql).toMatch(/if p_explicit is null then[\s\S]{0,160}raise exception/i);
  });

  it("the ORIGINAL four-argument RPC still exists (old clients keep working) and is wired to the PASSIVE intent", () => {
    expect(sql).toMatch(/create or replace function public\.upsert_push_subscription\(\s*\n?\s*p_endpoint text/i);
    expect(sql).toMatch(/upsert_push_subscription_v2\([\s\S]{0,200}false,\s*null,\s*null,\s*null,\s*null\s*\)/i);
  });
});

describe("push reliability migration -- the PR #29 guarantees are preserved verbatim", () => {
  it("still derives ownership from auth.uid(), never a client-supplied user id", () => {
    expect(sql).toMatch(/auth\.uid\(\)/);
    expect(executableSql).not.toMatch(/p_user_id/i);
  });

  it("still requires the stored keys to match before reassigning an endpoint owned by a different user", () => {
    expect(sql).toMatch(/existing\.p256dh\s*=\s*p_p256dh\s+and\s+existing\.auth\s*=\s*p_auth/i);
  });

  it("still locks the target row before the ownership decision -- no check-then-write race", () => {
    expect(sql).toMatch(/select \* into existing from public\.push_subscriptions where endpoint = p_endpoint for update/i);
  });

  it("still handles the concurrent first-insert race via unique_violation", () => {
    expect(sql).toMatch(/exception when unique_violation then/i);
  });
});

describe("push reliability migration -- SECURITY DEFINER hardening", () => {
  const definerFunctions = [
    "upsert_push_subscription_v2",
    "touch_push_subscription",
    "revoke_push_subscription",
    "record_notification_delivery_receipt",
  ];

  it.each(definerFunctions)("%s pins its search_path to the EMPTY form", (name) => {
    const body = sql.slice(sql.indexOf(`function public.${name}(`));
    const header = body.slice(0, body.indexOf("as $$"));
    expect(header).toMatch(/security definer/i);
    // `to ''`, not `= public` -- the form
    // `20260913214946_harden_aggregate_notification_rpc_search_path.sql`
    // established for this project. Nothing resolves implicitly, so no
    // schema a caller controls can shadow a referenced object.
    expect(header).toMatch(/set search_path\s+to\s+''/i);
    expect(header).not.toMatch(/set search_path\s*=\s*public/i);
  });

  it("the security-invoker wrapper pins its search_path the same way -- no mixed convention in one file", () => {
    const body = sql.slice(sql.indexOf("function public.upsert_push_subscription(\n"));
    const header = body.slice(0, body.indexOf("as $$"));
    expect(header).toMatch(/set search_path\s+to\s+''/i);
  });

  it("every application object inside a function is schema-qualified -- the precondition an empty search_path depends on", () => {
    // With `search_path to ''` nothing but `pg_catalog` resolves
    // implicitly, so an unqualified application table would fail at RUN
    // time, not at CREATE time. Executed for real in
    // `pushReliabilityRpc.integration.test.ts`; this catches it at the
    // text level too, where the diff is being read.
    for (const table of ["push_subscriptions", "notification_deliveries"]) {
      const unqualified = new RegExp(`(from|into|update|join)\\s+${table}\\b`, "gi");
      expect(executableSql).not.toMatch(unqualified);
    }
  });

  it.each(definerFunctions)("%s revokes EXECUTE from public before granting it", (name) => {
    expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}[\\s\\S]*?from public`, "i"));
  });

  it("grants the authenticated-only functions to `authenticated` and never to `anon`", () => {
    // Matched statement-by-statement rather than across the whole file:
    // a `[\s\S]*?` span would happily reach the unrelated `to anon`
    // grant further down and report a false positive.
    const grantStatements = executableSql.match(/^grant execute on function .*$/gim) ?? [];
    for (const name of ["upsert_push_subscription_v2", "touch_push_subscription", "revoke_push_subscription"]) {
      const forThisFunction = grantStatements.filter((line) => line.includes(`public.${name}(`));
      expect(forThisFunction.length).toBe(1);
      expect(forThisFunction[0]).toMatch(/to authenticated;$/i);
    }
  });

  it("grants no function to `public`, and grants nothing on the tables themselves", () => {
    const grants = executableSql.match(/^grant .*$/gim) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant).toMatch(/grant execute on function/i);
      expect(grant).not.toMatch(/\bto public\b/i);
    }
  });

  it("adds no INSERT/UPDATE/DELETE policy to push_subscriptions -- every write still goes through a narrow function", () => {
    expect(executableSql).not.toMatch(/create policy/i);
  });
});

describe("push reliability migration -- the heartbeat can only ever do one thing", () => {
  it("touches only last_seen_at, only for the caller's own NON-revoked row", () => {
    const body = sql.slice(sql.indexOf("function public.touch_push_subscription("));
    const statement = body.slice(0, body.indexOf("get diagnostics"));
    expect(statement).toMatch(/set last_seen_at = now\(\)/i);
    expect(statement).toMatch(/user_id = auth\.uid\(\)/i);
    expect(statement).toMatch(/revoked_at is null/i);
    // No insert, no ownership change, no un-revoking.
    expect(statement).not.toMatch(/insert into/i);
    expect(statement).not.toMatch(/set user_id/i);
  });
});

describe("push reliability migration -- device removal is per-user and never a delete", () => {
  it("revokes by device_ref, scoped to auth.uid(), and never deletes the row", () => {
    const body = sql.slice(sql.indexOf("function public.revoke_push_subscription("));
    const fn = body.slice(0, body.indexOf("$$;"));
    expect(fn).toMatch(/where device_ref = p_device_ref/i);
    expect(fn).toMatch(/and user_id = auth\.uid\(\)/i);
    expect(fn).not.toMatch(/^\s*delete from/im);
  });

  it("normalizes any unrecognized reason rather than storing what the caller sent", () => {
    expect(sql).toMatch(/v_reason := case[\s\S]{0,200}else 'user_removed'\s*\n?\s*end;/i);
  });
});

describe("push reliability migration -- delivery receipts", () => {
  it("adds received_at and a receipt token VERIFIER column, never a plaintext token column", () => {
    expect(sql).toMatch(/add column if not exists received_at timestamptz/i);
    expect(sql).toMatch(/add column if not exists receipt_token_hash text/i);
    expect(executableSql).not.toMatch(/receipt_token\s+text/i);
  });

  it("indexes the verifier uniquely, so one token can only ever identify one delivery", () => {
    expect(sql).toMatch(/create unique index if not exists notification_deliveries_receipt_token_hash_key/i);
  });

  it("the receipt function takes ONLY a token hash -- no delivery id, no user id, no device id", () => {
    expect(sql).toMatch(/function public\.record_notification_delivery_receipt\(p_token_hash text\)/i);
    const body = sql.slice(sql.indexOf("function public.record_notification_delivery_receipt("));
    const signature = body.slice(0, body.indexOf("as $$"));
    expect(signature).not.toMatch(/p_delivery_id|p_user_id|p_subscription_id/i);
  });

  it("returns void -- a valid, replayed, and bogus receipt are indistinguishable to the caller", () => {
    const body = sql.slice(sql.indexOf("function public.record_notification_delivery_receipt("));
    expect(body.slice(0, body.indexOf("as $$"))).toMatch(/returns void/i);
  });

  it("is idempotent: received_at is pinned to the FIRST acknowledgement", () => {
    expect(sql).toMatch(/received_at = coalesce\(received_at, now\(\)\)/i);
  });

  it("promotes a transiently-failed delivery to 'sent' but never overwrites a permanent failure's status", () => {
    expect(sql).toMatch(/status = case when status = 'failed_permanent' then status else 'sent' end/i);
  });

  it("matches ONLY by the token hash -- it can never be pointed at an arbitrary delivery", () => {
    expect(sql).toMatch(/where receipt_token_hash = p_token_hash/i);
  });

  it("is the only function granted to `anon`, and is granted nothing else", () => {
    const anonGrants = (executableSql.match(/^grant .*to anon;$/gim) ?? []).map((line) => line.trim());
    expect(anonGrants).toEqual([
      "grant execute on function public.record_notification_delivery_receipt(text) to anon;",
    ]);
  });
});

describe("push reliability migration -- device metadata is coarse by construction", () => {
  it.each([
    ["device_type", /device_type in \('phone', 'tablet', 'desktop'\)/i],
    ["device_platform", /device_platform in \('ios', 'ipados', 'android', 'windows', 'macos', 'linux', 'other'\)/i],
    ["device_browser", /device_browser in \('safari', 'chrome', 'edge', 'firefox', 'samsung', 'other'\)/i],
  ])("%s is constrained to a closed enum", (_name, pattern) => {
    expect(sql).toMatch(pattern);
  });

  it("stores no user agent, no IP address, and no fingerprint column", () => {
    expect(executableSql).not.toMatch(/user_agent/i);
    expect(executableSql).not.toMatch(/ip_address|\bip\b|remote_addr/i);
    expect(executableSql).not.toMatch(/fingerprint/i);
  });

  it("normalizes any out-of-enum descriptor value to NULL inside the RPC too, not just via the CHECK", () => {
    expect(sql).toMatch(/v_type := case when p_device_type in \('phone', 'tablet', 'desktop'\) then p_device_type else null end/i);
  });

  it("gives each row an opaque device_ref distinct from its primary key, generated with core Postgres (never pgcrypto, which Supabase installs outside `public`)", () => {
    expect(sql).toMatch(/device_ref/);
    // Schema-qualified: pgcrypto ships its own `gen_random_uuid`, and a
    // column DEFAULT stores the RESOLVED function, so a bare call could
    // bind the default to the extension's copy instead of the core one.
    expect(sql).toMatch(/replace\(pg_catalog\.gen_random_uuid\(\)::text, '-', ''\)/i);
    expect(executableSql).not.toMatch(/gen_random_bytes/i);
  });

  it("does not depend on pgcrypto's digest() -- hashing happens in Node, so no SECURITY DEFINER search_path has to be widened", () => {
    expect(executableSql).not.toMatch(/\bdigest\s*\(/i);
    expect(executableSql).not.toMatch(/search_path[^;\n]*extensions/i);
  });
});
