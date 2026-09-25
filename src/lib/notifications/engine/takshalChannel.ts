import "server-only";
import {
  planDeliveryChannels,
  resolveNotificationDeliveryChannel,
  testRecipientAllowlistPolicy,
  type DeliveryChannelPlan,
} from "@/lib/notifications/deliveryChannel";
import { sendTakshalNotification } from "@/lib/notifications/takshal/client";
import { readTakshalConfig, type TakshalConfig } from "@/lib/notifications/takshal/config";
import { createTakshalDispatcher, type TakshalDispatchResult } from "@/lib/notifications/takshal/dispatcher";
import { buildTakshalNotification, type TakshalNotification } from "@/lib/notifications/takshal/notification";
import { fetchVerifiedEmailsByUserId } from "./recipients";
import type { ClaimedNotificationJob } from "./store";
import { sanitizeWorkerError } from "./workerErrors";

/**
 * The TAKSHAL CTRL channel for ONE `runDelivery()` invocation -- the only
 * place the worker touches it. Everything here is additive and fail-open:
 * it can decide that a job ALSO goes to the hub, but any failure of its
 * own (configuration, identity lookup, network, hub) only ever turns the
 * channel off for that job or run, never the direct delivery.
 *
 * Returns null -- and costs nothing at all, not even an identity lookup --
 * unless the channel is configured AND someone is rolled out to it.
 */

/** The verified-email directory is one bulk Admin API pass per run; this only bounds a hanging one. */
export const TAKSHAL_DIRECTORY_TIMEOUT_MS = 3_000;

export interface TakshalJobRouting {
  readonly plan: DeliveryChannelPlan;
  /** The hub request for this job; null exactly when `plan.takshal` is false. */
  readonly notification: TakshalNotification | null;
}

export interface TakshalChannelRun {
  /** This job's channel plan. Never rejects; any problem resolves to direct-only. */
  planFor(job: ClaimedNotificationJob): Promise<TakshalJobRouting>;
  /** Channel `both`: queued, never awaited by the direct path. */
  sendSecondary(notification: TakshalNotification): void;
  /** Channel `takshal`: the hub is the job's only push channel, so its outcome settles the job. */
  sendPrimary(notification: TakshalNotification): Promise<TakshalDispatchResult>;
  /** Bounded wait for secondary requests still in flight. Never rejects. */
  settle(): Promise<void>;
}

const DIRECT_ONLY: TakshalJobRouting = { plan: planDeliveryChannels("direct"), notification: null };

class TakshalDirectoryTimeoutError extends Error {
  constructor() {
    super("Verified-email directory lookup timed out.");
    this.name = "TakshalDirectoryTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TakshalDirectoryTimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function startTakshalChannelRun(): TakshalChannelRun | null {
  let config: TakshalConfig;
  try {
    const result = readTakshalConfig();
    if (result.status === "misconfigured") console.warn(`[takshal] channel off: ${result.problem}`);
    if (result.status !== "ok") return null;
    config = result.config;
  } catch {
    return null;
  }
  if (config.ignoredTestRecipientEntries > 0) {
    console.warn(`[takshal] test-recipient allowlist: ${config.ignoredTestRecipientEntries} malformed entr${config.ignoredTestRecipientEntries === 1 ? "y" : "ies"} ignored`);
  }
  // The temporary rollout allowlist is the only policy in this phase:
  // nobody on it means nobody's delivery changes, so skip everything.
  if (config.testRecipients.size === 0) return null;

  const policy = testRecipientAllowlistPolicy(config.testRecipients);
  const dispatcher = createTakshalDispatcher((notification) => sendTakshalNotification(config, notification));

  let directory: Promise<ReadonlyMap<string, string> | null> | undefined;
  const loadDirectory = () =>
    (directory ??= withTimeout(fetchVerifiedEmailsByUserId(), TAKSHAL_DIRECTORY_TIMEOUT_MS).catch((error: unknown) => {
      const sanitized = sanitizeWorkerError(error);
      console.warn(
        `[takshal] verified-email directory unavailable; direct delivery only this run error=${sanitized.name} category=${sanitized.category}`,
      );
      return null;
    }));

  return {
    async planFor(job) {
      try {
        const emails = await loadDirectory();
        const verifiedEmail = emails?.get(job.recipientUserId) ?? null;
        const plan = planDeliveryChannels(resolveNotificationDeliveryChannel({ userId: job.recipientUserId, verifiedEmail }, policy));
        if (!plan.takshal || verifiedEmail === null) return DIRECT_ONLY;
        const notification = buildTakshalNotification(job, verifiedEmail);
        // Nothing sendable for the hub: never drop the notification -- direct it is.
        return notification ? { plan, notification } : DIRECT_ONLY;
      } catch {
        return DIRECT_ONLY;
      }
    },

    sendSecondary(notification) {
      dispatcher.send(notification);
    },

    sendPrimary(notification) {
      return dispatcher.sendAndWait(notification);
    },

    async settle() {
      try {
        await dispatcher.settle();
      } catch {
        // `settle` never rejects; belt and braces for the worker's own path.
      }
    },
  };
}
