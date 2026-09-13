/**
 * Stage-aware, PII-safe error diagnostics for the notification worker.
 *
 * The worker route's catch block used to discard the real error
 * entirely (`console.error("[notifications] worker tick failed")`),
 * which made a real integration failure (missing env var, migration not
 * applied, a stale RPC signature, a Google Sheets auth failure, ...)
 * completely undiagnosable from Vercel logs. This module lets each
 * pipeline phase be wrapped with `runStage(stage, fn)` so a thrown error
 * is tagged with WHICH phase failed, and provides `sanitizeWorkerError`
 * to turn an arbitrary thrown value into a small, safe-to-log summary --
 * never the full error object, never a stack trace, never anything that
 * could carry a secret, a push endpoint/key, a raw Sheet row, a name, an
 * email, or a notification body.
 *
 * The HTTP response returned to the caller NEVER includes any of this --
 * see `src/app/internal/notifications/tick/route.ts`, which still
 * returns a flat `{ error: "internal_error" }` regardless of what
 * happened. This module only controls what reaches the SERVER-SIDE log
 * line, which an operator (never the Cron caller) reads.
 */

export type WorkerStage =
  | "fresh_workbook_read"
  | "recipient_resolution"
  | "operational_mode"
  | "operational_roster"
  | "notification_flood_recovery_guard"
  | "last_operational_generation"
  | "last_operational_generation_write"
  | "change_detection"
  | "rule_config"
  | "reminders"
  | "scheduled_broadcasts"
  | "scheduled_broadcasts_due_lookup"
  | "jobs_due_lookup"
  | "delivery"
  | "scheduled_broadcasts_work_check"
  | "recurring_rules_due_lookup"
  | "recurring_rules"
  | "fresh_personnel_read"
  | "manual_broadcast_immediate_delivery"
  | "weapon_qualification";

export class WorkerStageError extends Error {
  readonly stage: WorkerStage;
  readonly cause: unknown;

  constructor(stage: WorkerStage, cause: unknown) {
    super(`Notification worker failed at stage "${stage}"`);
    this.name = "WorkerStageError";
    this.stage = stage;
    this.cause = cause;
  }
}

/** Runs `fn`, tagging any thrown error with `stage` (never double-wraps an already-tagged error). */
export async function runStage<T>(stage: WorkerStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof WorkerStageError) throw error;
    throw new WorkerStageError(stage, error);
  }
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

export interface SanitizedWorkerError {
  /** The error's constructor/class name -- e.g. "GoogleConfigError", "TypeError". Always safe: a class name never carries data. */
  name: string;
  /** A Postgres/PostgREST error code (e.g. "42P01"), when present -- these are fixed, generic, standardized codes, never data-bearing. */
  code?: string;
  /** A Postgres HINT string, when present and string-typed -- Postgres hints are static schema/query advice, never interpolated user data. */
  hint?: string;
  /** A short, best-effort classification to speed up triage -- see `classifyCategory`. */
  category: string;
  /** A REDACTED, length-capped fragment of the error's own message/details -- never the raw value. */
  detail?: string;
}

/**
 * Error classes in this codebase whose `.message` is KNOWN, by
 * construction, to only ever name a missing environment variable (never
 * its value) -- see each class's own definition
 * (`lib/supabase/serviceRoleClient.ts`, `lib/supabase/config.ts`,
 * `lib/google/errors.ts` / `lib/google/config.ts`, `lib/push/config.ts`,
 * `lib/notifications/workerAuth.ts`, `lib/domain/shiftSchedule.ts`).
 * Safe to log verbatim (still capped defensively).
 */
const CONFIG_ERROR_CATEGORY: Record<string, string> = {
  SupabaseServiceRoleConfigError: "missing_service_role_key",
  SupabaseConfigError: "missing_supabase_public_config",
  GoogleConfigError: "google_sheet_config_error",
  VapidConfigError: "missing_vapid_config",
  NotificationWorkerConfigError: "missing_worker_secret",
  ShiftConfigurationError: "shift_configuration_error",
};

/** Postgres error codes worth calling out by name -- see https://www.postgresql.org/docs/current/errcodes-appendix.html. */
const POSTGRES_CODE_CATEGORY: Record<string, string> = {
  "42P01": "migration_table_missing",
  "42883": "migration_function_missing",
  "42501": "permission_denied",
  "28000": "database_auth_failure",
  "3D000": "database_missing",
};

const MAX_DETAIL_LENGTH = 200;

// Matches an email address, an http(s) URL, or any long (24+ char)
// opaque token/id/key-shaped run of base64url-ish characters -- catches
// bearer tokens, JWTs, push endpoints/keys, UUIDs, and similar
// identifiers that have no business appearing in a log line, even
// inside an otherwise-safe-looking error message.
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const URL_RE = /https?:\/\/\S+/g;
const OPAQUE_TOKEN_RE = /\b[A-Za-z0-9_-]{24,}\b/g;

function redact(text: string): string {
  return text.replace(URL_RE, "[url]").replace(EMAIL_RE, "[email]").replace(OPAQUE_TOKEN_RE, "[redacted]");
}

function cap(value: string): string {
  return value.length > MAX_DETAIL_LENGTH ? `${value.slice(0, MAX_DETAIL_LENGTH)}…` : value;
}

function safeDetail(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return cap(redact(value));
}

/**
 * Like `safeDetail`, but skips the opaque-token redaction pass --
 * used ONLY for the known-safe config-error messages below, whose
 * entire point is naming a missing environment variable (e.g.
 * "SUPABASE_SERVICE_ROLE_KEY"), which is itself a long
 * underscore-separated identifier that the generic opaque-token
 * pattern would otherwise strip out along with genuine secrets. Still
 * redacts email/URL patterns defensively even though these specific
 * error classes never produce them.
 */
function safeDetailPreservingIdentifiers(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return cap(value.replace(URL_RE, "[url]").replace(EMAIL_RE, "[email]"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** True for the shape supabase-js's Auth Admin API throws (`AuthError`/`AuthApiError`-ish: a `name` containing "Auth" plus a numeric `status`). */
function looksLikeSupabaseAuthError(error: Record<string, unknown>): boolean {
  const name = typeof error.name === "string" ? error.name : "";
  return name.includes("Auth") && typeof error.status === "number";
}

function classifyCategory(error: unknown, name: string, code: string | undefined): string {
  if (CONFIG_ERROR_CATEGORY[name]) return CONFIG_ERROR_CATEGORY[name];
  if (code && POSTGRES_CODE_CATEGORY[code]) return POSTGRES_CODE_CATEGORY[code];
  if (code?.startsWith("PGRST")) return "postgrest_error";
  if (isRecord(error) && looksLikeSupabaseAuthError(error)) return "supabase_admin_api_error";
  return "unknown";
}

/**
 * Turns an arbitrary thrown value into a small, log-safe summary.
 * Deliberately never returns the original error object, a stack trace,
 * or an unredacted message -- see this module's own top docstring for
 * the full list of what must never appear in a log line.
 */
export function sanitizeWorkerError(error: unknown): SanitizedWorkerError {
  const name = error instanceof Error ? error.name : isRecord(error) && typeof error.name === "string" ? error.name : "UnknownError";
  const code = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
  const hint = isRecord(error) && typeof error.hint === "string" ? safeDetail(error.hint) : undefined;
  const message = error instanceof Error ? error.message : isRecord(error) && typeof error.message === "string" ? error.message : undefined;

  const isKnownSafeConfigError = Object.prototype.hasOwnProperty.call(CONFIG_ERROR_CATEGORY, name);

  return {
    name,
    code,
    hint,
    category: classifyCategory(error, name, code),
    detail: isKnownSafeConfigError ? safeDetailPreservingIdentifiers(message) : safeDetail(message),
  };
}

/** The exact log line the worker route writes on a tick failure -- one line, PII-safe, stage-tagged. */
export function formatWorkerErrorLog(stage: WorkerStage | "unknown", sanitized: SanitizedWorkerError): string {
  const parts = [`[notifications] worker tick failed stage=${stage}`, `error=${sanitized.name}`, `category=${sanitized.category}`];
  if (sanitized.code) parts.push(`code=${sanitized.code}`);
  if (sanitized.hint) parts.push(`hint=${sanitized.hint}`);
  if (sanitized.detail) parts.push(`detail=${sanitized.detail}`);
  return parts.join(" ");
}
