import "server-only";
import { createHash } from "node:crypto";
import { resolveSafeNotificationPath } from "@/lib/push/notificationPath";

/**
 * Maps one already-built notification job onto TAKSHAL CTRL's source
 * request (v1). Pure: no I/O, no business rules -- title/body/path/tag
 * are taken from the job exactly as the direct channel sends them, and
 * only adapted to the hub's own validation limits.
 */

export const TAKSHAL_REQUEST_VERSION = 1;

/** TAKSHAL CTRL's limits (its `LIMITS` / target / tag rules). A request outside them is rejected by the hub. */
export const TAKSHAL_LIMITS = { title: 120, body: 500, target: 512 } as const;

export interface TakshalNotification {
  readonly eventId: string;
  readonly recipientEmail: string;
  readonly title: string;
  readonly body: string;
  readonly target: string;
  readonly tag?: string;
}

/** The subset of a claimed `notification_jobs` row this mapping reads. */
export interface TakshalJobInput {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly path: string;
  readonly tag: string | null;
}

/**
 * The hub's idempotency key for a job: `job:<notification_jobs.id>`.
 *
 * A job row is ONE logical notification for ONE recipient, created
 * idempotently by `dedupe_key` and re-claimed with the same id on every
 * retry (`claim_due_notification_jobs`) -- so this is stable across
 * worker retries, stuck-claim recovery and overlapping workers, which is
 * exactly what makes TAKSHAL CTRL push it at most once. A per-device
 * `notification_deliveries.id` would be wrong here: those exist once per
 * DIRECT device (none at all for a user without one), not once per
 * recipient. Never random: a fresh id per attempt would defeat the hub's
 * deduplication.
 */
export function takshalEventIdForJob(jobId: string): string {
  return `job:${jobId}`;
}

/**
 * The job's own in-app path, through the SAME `resolveSafeNotificationPath`
 * the direct channel's payload uses -- only ever a relative same-app path
 * (TAKSHAL CTRL owns the המחלבה base URL and builds the final link).
 * Anything unsafe, or too long for the hub, becomes `/`.
 */
export function toTakshalTarget(path: string | null | undefined): string {
  const safe = resolveSafeNotificationPath(path);
  return safe.length <= TAKSHAL_LIMITS.target ? safe : "/";
}

/**
 * The job's grouping tag, translated to one the hub accepts
 * (`[A-Za-z0-9._:-]{1,64}`): a short hash, so the SAME job tag always
 * maps to the SAME hub tag (a later update still replaces the earlier
 * notification on the device) while no user/person id embedded in the
 * original tag ever leaves this app.
 */
export function toTakshalTag(tag: string | null | undefined): string | undefined {
  if (!tag) return undefined;
  return `machlava-${createHash("sha256").update(tag, "utf8").digest("hex").slice(0, 23)}`;
}

/** Trims and, only if longer than the hub allows, shortens with an ellipsis -- never splitting a surrogate pair (emoji). */
export function clampText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  let cut = trimmed.slice(0, max - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/** Null when the job has no usable text to send (the hub requires both). */
export function buildTakshalNotification(job: TakshalJobInput, recipientEmail: string): TakshalNotification | null {
  const title = clampText(job.title, TAKSHAL_LIMITS.title);
  const body = clampText(job.body, TAKSHAL_LIMITS.body);
  if (!title || !body) return null;
  const tag = toTakshalTag(job.tag);
  return {
    eventId: takshalEventIdForJob(job.id),
    recipientEmail,
    title,
    body,
    target: toTakshalTarget(job.path),
    ...(tag ? { tag } : {}),
  };
}

/** Log-safe reference to an event: its last 6 characters only (matches the hub's own log format). */
export function eventFingerprint(eventId: string): string {
  return `…${eventId.slice(-6)}`;
}
