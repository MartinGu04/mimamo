import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the migration-history reconciliation against production, plus
 * the search_path hardening it restored.
 *
 * BACKGROUND -- why these exact filenames matter. The repository had
 * drifted from the production migration history: production had already
 * applied `20260913214805_add_aggregate_notification_episode_dedupe`
 * followed by `20260913214946_harden_aggregate_notification_rpc_search_path`,
 * while the repository carried the first one under a DIFFERENT timestamp
 * (`20260902130000_…`) and was missing the hardening entirely. Supabase
 * tracks applied migrations by that timestamp prefix, so the mismatch
 * meant a `db push` would have tried to re-apply the dedupe migration
 * under a name production had never seen, and would never have applied
 * the hardening at all. The filenames below are therefore a real
 * production fact, not a naming preference -- renaming either one
 * re-introduces the drift.
 *
 * SCOPE NOTE, same as this directory's other migration tests: nothing
 * here executes SQL. The runtime proof that both functions still work
 * with an EMPTY search_path -- including under a session search_path
 * that points at a decoy schema -- lives in
 * `notificationEngineFunctions.integration.test.ts`, which applies every
 * migration in this directory in order and then exercises the functions
 * for real.
 */
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "..", "..", "supabase", "migrations");

const DEDUPE_MIGRATION = "20260913214805_add_aggregate_notification_episode_dedupe.sql";
const HARDENING_MIGRATION = "20260913214946_harden_aggregate_notification_rpc_search_path.sql";

function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

describe("migration history matches production", () => {
  it("carries the aggregate-dedupe migration under the timestamp production actually applied", () => {
    expect(migrationFiles()).toContain(DEDUPE_MIGRATION);
  });

  it("carries the search_path hardening migration production applied right after it", () => {
    expect(migrationFiles()).toContain(HARDENING_MIGRATION);
  });

  it("no longer carries the old, never-applied-in-production timestamp for the dedupe migration", () => {
    expect(migrationFiles()).not.toContain("20260902130000_add_aggregate_notification_episode_dedupe.sql");
  });

  it("orders the hardening immediately after the migration it hardens", () => {
    const files = migrationFiles();
    const dedupeIndex = files.indexOf(DEDUPE_MIGRATION);
    const hardeningIndex = files.indexOf(HARDENING_MIGRATION);
    expect(dedupeIndex).toBeGreaterThanOrEqual(0);
    expect(hardeningIndex).toBe(dedupeIndex + 1);
  });

  it("places both BEFORE the push-reliability migration -- new work must never sort ahead of already-applied history", () => {
    const files = migrationFiles();
    const pushReliabilityIndex = files.findIndex((name) => name.includes("push_reliability_and_device_management"));
    expect(pushReliabilityIndex).toBeGreaterThan(files.indexOf(HARDENING_MIGRATION));
  });

  it("has exactly one file per timestamp prefix -- a duplicate prefix is an applied-history collision", () => {
    const prefixes = migrationFiles().map((name) => name.slice(0, 14));
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe("aggregate notification RPC search_path hardening -- shape (text-level only, see docstring)", () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, HARDENING_MIGRATION), "utf8");

  it("pins BOTH aggregate RPCs, by their full argument signature", () => {
    expect(sql).toMatch(
      /alter function public\.upsert_aggregate_notification_job\(\s*text, uuid, text, text, text, text, text, timestamptz, text\s*\)\s*set search_path to ''/i,
    );
    expect(sql).toMatch(/alter function public\.resolve_aggregate_notification_job\(text\) set search_path to ''/i);
  });

  it("pins to the EMPTY search_path, never to `public`", () => {
    const statements = sql.match(/^alter function[\s\S]*?;$/gim) ?? [];
    expect(statements.length).toBe(2);
    for (const statement of statements) {
      expect(statement).toMatch(/set search_path to ''/i);
      expect(statement).not.toMatch(/search_path\s*=\s*public/i);
    }
  });

  it("uses ALTER FUNCTION only -- it must never restate the function bodies, which live in the migration it hardens", () => {
    const executable = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/create\s+(or replace\s+)?function/i);
    expect(executable).not.toMatch(/\$\$/);
  });

  it("does not disturb the grants the previous migration established", () => {
    const executable = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/^\s*(grant|revoke)\b/im);
  });

  it("changes nothing else -- no DDL beyond the two ALTER FUNCTION statements", () => {
    const statements = (sql.replace(/^\s*--.*$/gm, "").match(/[^;]+;/g) ?? []).map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(2);
    for (const statement of statements) expect(statement).toMatch(/^alter function/i);
  });
});

describe("the hardened functions' bodies can actually run with an empty search_path", () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, DEDUPE_MIGRATION), "utf8");
  const executable = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  it("qualifies every reference to notification_jobs inside the function bodies", () => {
    // With `search_path to ''` an unqualified application table fails at
    // RUN time, not at CREATE time -- so this is the one precondition the
    // hardening silently depends on. The `alter table notification_jobs`
    // at the top of the file is deliberately excluded: that is plain DDL
    // run under the migration's own session search_path, not inside a
    // function body.
    const bodies = executable.match(/create or replace function[\s\S]*?\$\$;/gi) ?? [];
    expect(bodies.length).toBe(2);
    for (const body of bodies) {
      expect(body).toMatch(/public\.notification_jobs/);
      expect(body).not.toMatch(/(from|into|update)\s+notification_jobs\b/i);
    }
  });
});
