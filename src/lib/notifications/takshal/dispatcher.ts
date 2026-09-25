import "server-only";
import type { TakshalSendResult } from "./client";
import { eventFingerprint, type TakshalNotification } from "./notification";

/**
 * Per-worker-run scheduling of TAKSHAL CTRL requests, so the channel can
 * never hang or slow the notification worker:
 *
 * - `send` is fire-and-forget: it queues and returns immediately, so the
 *   direct fan-out of the SAME job proceeds in parallel with it.
 * - At most `concurrency` requests are in flight; each one is itself
 *   bounded by the client's own timeout.
 * - After `breakerThreshold` consecutive failures (hub down/slow) the rest
 *   of this run skips the channel instead of queueing more doomed calls.
 * - `settle` waits for what is still in flight for at most
 *   `settleBudgetMs`, then drops whatever never started. No retry chain
 *   lives here: a job the direct pipeline retries is offered to the hub
 *   again under the same event id, which the hub deduplicates.
 *
 * Logs are sanitized by construction: an outcome label, an HTTP status and
 * a 6-character event tail -- never the secret, the recipient, a push
 * endpoint or notification text.
 */

export const TAKSHAL_MAX_CONCURRENT_REQUESTS = 4;
/** Just above the client's request timeout, so a request started before `settle` always gets to finish. */
export const TAKSHAL_SETTLE_BUDGET_MS = 4_000;
export const TAKSHAL_BREAKER_THRESHOLD = 3;

/** The dispatcher never even attempted the request (circuit open, or the run's settle budget ran out). */
export type TakshalDispatchResult = TakshalSendResult | { readonly ok: false; readonly reason: "skipped" };

export interface TakshalRunReport {
  requested: number;
  accepted: number;
  /** Devices reached, summed over accepted requests. */
  devices: number;
  duplicate: number;
  noActiveSubscription: number;
  failed: number;
  skipped: number;
}

export interface TakshalLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface TakshalDispatcherOptions {
  readonly concurrency?: number;
  readonly settleBudgetMs?: number;
  readonly breakerThreshold?: number;
  readonly log?: TakshalLogger;
}

export interface TakshalDispatcher {
  /** Queues a request and returns immediately. Never throws. */
  send(notification: TakshalNotification): void;
  /** Queues a request and resolves with its outcome. Never rejects. */
  sendAndWait(notification: TakshalNotification): Promise<TakshalDispatchResult>;
  /** Waits (bounded) for queued/in-flight requests, logs one summary line, and returns the run's counts. Never rejects. */
  settle(): Promise<TakshalRunReport>;
}

const consoleLogger: TakshalLogger = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
};

function describeFailure(result: Exclude<TakshalSendResult, { ok: true }>): string {
  return result.reason === "http_error" ? `http_${result.status ?? "unknown"}` : result.reason;
}

interface QueuedRequest {
  readonly notification: TakshalNotification;
  readonly resolve: (result: TakshalDispatchResult) => void;
}

export function createTakshalDispatcher(
  send: (notification: TakshalNotification) => Promise<TakshalSendResult>,
  options: TakshalDispatcherOptions = {},
): TakshalDispatcher {
  const concurrency = options.concurrency ?? TAKSHAL_MAX_CONCURRENT_REQUESTS;
  const settleBudgetMs = options.settleBudgetMs ?? TAKSHAL_SETTLE_BUDGET_MS;
  const breakerThreshold = options.breakerThreshold ?? TAKSHAL_BREAKER_THRESHOLD;
  const log = options.log ?? consoleLogger;

  const queue: QueuedRequest[] = [];
  const inFlight = new Set<Promise<void>>();
  const report: TakshalRunReport = { requested: 0, accepted: 0, devices: 0, duplicate: 0, noActiveSubscription: 0, failed: 0, skipped: 0 };
  let consecutiveFailures = 0;
  let closed = false; // circuit open, or the run already settled

  function skip(request: QueuedRequest): void {
    report.skipped++;
    request.resolve({ ok: false, reason: "skipped" });
  }

  function record(notification: TakshalNotification, result: TakshalSendResult): void {
    if (result.ok) {
      consecutiveFailures = 0;
      report.accepted++;
      report.devices += result.delivered;
      if (result.duplicate) report.duplicate++;
      if (result.noActiveSubscription) report.noActiveSubscription++;
      return;
    }
    report.failed++;
    consecutiveFailures++;
    log.warn(`[takshal] delivery failed reason=${describeFailure(result)} event=${eventFingerprint(notification.eventId)}`);
    if (!closed && consecutiveFailures >= breakerThreshold) {
      closed = true;
      log.warn(`[takshal] ${consecutiveFailures} consecutive failures; skipping TAKSHAL CTRL for the rest of this run`);
      while (queue.length > 0) skip(queue.shift()!);
    }
  }

  function pump(): void {
    while (!closed && inFlight.size < concurrency && queue.length > 0) {
      const request = queue.shift()!;
      const task: Promise<void> = send(request.notification)
        .catch((): TakshalSendResult => ({ ok: false, reason: "network" }))
        .then((result) => {
          record(request.notification, result);
          request.resolve(result);
        })
        .finally(() => {
          inFlight.delete(task);
          pump();
        });
      inFlight.add(task);
    }
  }

  function enqueue(notification: TakshalNotification): Promise<TakshalDispatchResult> {
    report.requested++;
    return new Promise((resolve) => {
      const request = { notification, resolve };
      if (closed) return skip(request);
      queue.push(request);
      pump();
    });
  }

  return {
    send(notification) {
      void enqueue(notification);
    },

    sendAndWait(notification) {
      return enqueue(notification);
    },

    async settle() {
      const deadline = Date.now() + settleBudgetMs;
      while (inFlight.size > 0) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, remaining);
        });
        await Promise.race([Promise.race(inFlight), timeout]);
        clearTimeout(timer);
      }
      closed = true;
      while (queue.length > 0) skip(queue.shift()!);

      if (report.requested > 0) {
        log.info(
          `[takshal] run requested=${report.requested} accepted=${report.accepted} devices=${report.devices} ` +
            `duplicate=${report.duplicate} noActiveSubscription=${report.noActiveSubscription} failed=${report.failed} ` +
            `skipped=${report.skipped} stillInFlight=${inFlight.size}`,
        );
      }
      return { ...report };
    },
  };
}
