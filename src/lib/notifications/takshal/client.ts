import "server-only";
import type { TakshalConfig } from "./config";
import { TAKSHAL_REQUEST_VERSION, type TakshalNotification } from "./notification";

/**
 * One bounded server-to-server call to TAKSHAL CTRL's המחלבה source
 * endpoint. Never throws: every outcome -- including a timeout, a network
 * error, an HTTP error or a response it cannot understand -- comes back as
 * a value, so a caller can never be broken by this channel.
 */

/** A healthy hub answers in well under a second; this only bounds a slow/hanging one. */
export const TAKSHAL_REQUEST_TIMEOUT_MS = 3_500;

export type TakshalFailureReason = "timeout" | "network" | "http_error" | "invalid_response";

export type TakshalSendResult =
  | {
      readonly ok: true;
      /** Devices the hub delivered to by THIS request (0 for a duplicate or an unenrolled recipient). */
      readonly delivered: number;
      /** The hub had already processed this event id (a retry) -- not re-pushed. */
      readonly duplicate: boolean;
      /** The recipient has no active TAKSHAL CTRL device (or is not enrolled -- the hub does not say which). */
      readonly noActiveSubscription: boolean;
    }
  | { readonly ok: false; readonly reason: TakshalFailureReason; readonly status?: number };

export interface TakshalClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function sendTakshalNotification(
  config: Pick<TakshalConfig, "endpoint" | "sourceSecret">,
  notification: TakshalNotification,
  options: TakshalClientOptions = {},
): Promise<TakshalSendResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TAKSHAL_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.sourceSecret}` },
      body: JSON.stringify({ version: TAKSHAL_REQUEST_VERSION, ...notification }),
      // Never follow a redirect: the credential must only ever reach the configured hub.
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return { ok: false, reason: "http_error", status: response.status };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return controller.signal.aborted ? { ok: false, reason: "timeout" } : { ok: false, reason: "invalid_response", status: response.status };
    }
    if (!isRecord(data) || data.accepted !== true || typeof data.delivered !== "number" || !Number.isFinite(data.delivered)) {
      return { ok: false, reason: "invalid_response", status: response.status };
    }
    return {
      ok: true,
      delivered: data.delivered,
      duplicate: data.duplicate === true,
      noActiveSubscription: data.reason === "no_active_subscription",
    };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
