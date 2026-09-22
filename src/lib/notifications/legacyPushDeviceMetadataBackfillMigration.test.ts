import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Text-level regression guard on the legacy-metadata backfill migration
 * -- the file that exists because `20260921090000` was (wrongly) edited
 * in place after production had already applied it.
 *
 * IMPORTANT SCOPE NOTE, same as every other migration test here: nothing
 * in this file executes SQL. The runtime proof -- that a fresh database
 * and a production-shaped database both end up with exactly the
 * five-argument heartbeat, that the backfill fills only missing columns,
 * and that revoked/foreign rows stay untouched -- lives in
 * `pushMigrationChain.integration.test.ts` and
 * `pushReliabilityRpc.integration.test.ts`, which run the ACTUAL
 * migration files against a real local PostgreSQL.
 */
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "supabase", "migrations");

function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

const FILE = migrationFiles().find((name) => name.includes("legacy_push_device_metadata_backfill"));
const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, FILE!), "utf8");
const executableSql = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("legacy metadata backfill -- placement in the migration history", () => {
  it("exists as its own file rather than as an edit to the already-applied migration", () => {
    expect(FILE).toBeDefined();
  });

  it("carries a CLI-generated timestamp, not a hand-invented one", () => {
    // `npx supabase migration new <name>` stamps the current UTC instant
    // to the second. A hand-written file in this repo's older style
    // would end in `0000` like every pre-CLI migration here.
    expect(FILE).toMatch(/^\d{14}_legacy_push_device_metadata_backfill\.sql$/);
    expect(FILE).not.toMatch(/0000_legacy/);
  });

  it("sorts AFTER the migration production has already applied", () => {
    const files = migrationFiles();
    const applied = files.indexOf("20260921090000_push_reliability_and_device_management.sql");
    expect(applied).toBeGreaterThanOrEqual(0);
    expect(files.indexOf(FILE!)).toBeGreaterThan(applied);
  });

  it("is the ONLY migration after the applied one -- nothing else is pending", () => {
    const files = migrationFiles();
    const applied = files.indexOf("20260921090000_push_reliability_and_device_management.sql");
    expect(files.slice(applied + 1)).toEqual([FILE]);
  });
});

describe("legacy metadata backfill -- the arity change is handled safely", () => {
  it("DROPS the deployed one-argument heartbeat explicitly, before creating the new one", () => {
    // `create or replace` with a different argument list creates an
    // OVERLOAD rather than replacing, and two `touch_push_subscription`
    // functions make PostgREST's by-argument-name resolution ambiguous.
    expect(executableSql).toMatch(/drop function if exists public\.touch_push_subscription\(text\);/i);
    expect(executableSql.indexOf("drop function if exists")).toBeLessThan(
      executableSql.indexOf("create or replace function public.touch_push_subscription("),
    );
  });

  it("uses `if exists`, so it is safe on a database that never received the earlier migration", () => {
    expect(executableSql).toMatch(/drop function if exists/i);
  });

  it("creates exactly the five-argument signature", () => {
    expect(sql).toMatch(
      /create or replace function public\.touch_push_subscription\(\s*\n\s*p_endpoint text,\s*\n\s*p_device_type text,\s*\n\s*p_device_platform text,\s*\n\s*p_device_browser text,\s*\n\s*p_device_standalone boolean\s*\n\)/i,
    );
  });

  it("re-establishes the grants the drop took with it -- authenticated only, never anon or public", () => {
    expect(sql).toMatch(
      /revoke all on function public\.touch_push_subscription\(text, text, text, text, boolean\) from public/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.touch_push_subscription\(text, text, text, text, boolean\) to authenticated/i,
    );
    expect(executableSql).not.toMatch(/to anon/i);
  });
});

describe("legacy metadata backfill -- the hardening is preserved", () => {
  const header = sql.slice(
    sql.indexOf("create or replace function public.touch_push_subscription("),
    sql.indexOf("as $$"),
  );

  it("keeps SECURITY DEFINER and the EMPTY pinned search_path", () => {
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path\s+to\s+''/i);
    expect(header).not.toMatch(/set search_path\s*=\s*public/i);
  });

  it("keeps every application object schema-qualified -- the precondition an empty search_path depends on", () => {
    expect(executableSql).toMatch(/public\.push_subscriptions/);
    expect(executableSql).not.toMatch(/(from|into|update|join)\s+push_subscriptions\b/i);
    expect(executableSql).toMatch(/auth\.uid\(\)/);
  });
});

describe("legacy metadata backfill -- what the heartbeat may and may not write", () => {
  const body = sql.slice(sql.indexOf("create or replace function public.touch_push_subscription("));
  const statement = body.slice(0, body.indexOf("get diagnostics"));

  it("fills descriptor columns with coalesce(<column>, <argument>) -- the order that makes an existing value win", () => {
    // Reversed (`coalesce(<argument>, <column>)`) this would silently
    // become an overwrite API for anything a client chose to send.
    for (const column of ["device_type", "device_platform", "device_browser", "device_standalone"]) {
      expect(statement).toMatch(new RegExp(`${column}\\s*=\\s*coalesce\\(${column},`, "i"));
    }
  });

  it("writes NOTHING beyond last_seen_at and the four descriptor columns", () => {
    const setClause = statement.slice(
      statement.indexOf("update public.push_subscriptions"),
      statement.indexOf("where endpoint = p_endpoint"),
    );
    const assignments = (setClause.match(/^\s*(?:set\s+)?(\w+)\s*=/gim) ?? []).map((line) =>
      line.trim().replace(/^set\s+/i, "").replace(/\s*=$/, ""),
    );
    expect(new Set(assignments)).toEqual(
      new Set(["last_seen_at", "device_type", "device_platform", "device_browser", "device_standalone"]),
    );
    // Explicitly NOT touched: receipt history, the subscription itself,
    // and the opaque handle.
    for (const untouched of ["last_received_at", "endpoint", "p256dh", "auth", "user_id", "device_ref"]) {
      expect(setClause).not.toMatch(new RegExp(`\\b${untouched}\\s*=`, "i"));
    }
  });

  it("can only ever touch the caller's OWN, NON-revoked row", () => {
    expect(statement).toMatch(/where endpoint = p_endpoint/i);
    expect(statement).toMatch(/and user_id = auth\.uid\(\)/i);
    expect(statement).toMatch(/and revoked_at is null/i);
  });

  it("can never create a row, reassign ownership, or clear a revocation", () => {
    expect(statement).not.toMatch(/insert into/i);
    expect(statement).not.toMatch(/set user_id/i);
    expect(statement).not.toMatch(/revoked_at\s*=\s*(?!null\b)/i);
    expect(statement).not.toMatch(/revoked_reason\s*=/i);
  });

  it("never takes a user id as a parameter -- identity is derived server-side", () => {
    expect(executableSql).not.toMatch(/p_user_id/i);
  });

  it("normalizes the incoming descriptor against the same closed enums as an explicit enable", () => {
    expect(statement).toMatch(
      /v_type := case when p_device_type in \('phone', 'tablet', 'desktop'\) then p_device_type else null end/i,
    );
    expect(statement).toMatch(
      /v_platform := case[\s\S]{0,200}'ios', 'ipados', 'android', 'windows', 'macos', 'linux', 'other'/i,
    );
    expect(statement).toMatch(/v_browser := case[\s\S]{0,200}'safari', 'chrome', 'edge', 'firefox', 'samsung', 'other'/i);
  });
});

describe("legacy metadata backfill -- scope", () => {
  it("changes ONLY the heartbeat function -- no table, column, index, constraint or policy is touched", () => {
    expect(executableSql).not.toMatch(/alter table/i);
    expect(executableSql).not.toMatch(/create (unique )?index/i);
    expect(executableSql).not.toMatch(/create policy/i);
    expect(executableSql).not.toMatch(/add constraint/i);
    expect(executableSql).not.toMatch(/drop (table|column|policy|constraint)/i);
  });

  it("redefines no other function", () => {
    const created = executableSql.match(/create or replace function public\.(\w+)/gi) ?? [];
    expect(created).toHaveLength(1);
    expect(created[0]).toMatch(/touch_push_subscription/);
  });

  it("introduces no age-based cleanup", () => {
    expect(executableSql).not.toMatch(/interval\s+'/i);
    expect(executableSql).not.toMatch(/last_seen_at\s*<[^=]/i);
    expect(executableSql).not.toMatch(/delete\s+from/i);
  });
});
