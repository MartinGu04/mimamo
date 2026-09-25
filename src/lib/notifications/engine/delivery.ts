import "server-only";
import { buildNotificationPayload } from "@/lib/push/payload";
import { sendPush } from "@/lib/push/sendPush";
import { deriveDeliveryReceiptToken, hashReceiptToken } from "@/lib/notifications/receiptToken";
import {
  beginDeliveryAttempt,
  claimDueNotificationJobs,
  ensureDeliveryRows,
  getActiveSubscriptionsForUser,
  getDeliveriesForJob,
  revokePushSubscriptionById,
  setJobStatus,
  updateDeliveryOutcome,
  type ClaimedNotificationJob,
} from "./store";
import { startTakshalChannelRun, type TakshalChannelRun } from "./takshalChannel";

export interface DeliverySummary {
  jobsClaimed: number;
  jobsCompleted: number;
  jobsFailed: number;
  jobsPending: number;
  jobsSkipped: number;
  deliveriesSucceeded: number;
  deliveriesFailedPermanent: number;
  deliveriesFailedTransient: number;
  /** Devices taken out of the active delivery set this run by a permanent (404/410) push failure. Historical field name -- the row is now REVOKED rather than deleted (see `revokePushSubscriptionById`); the count, and the worker's PII-safe response shape, are unchanged. */
  subscriptionsRemoved: number;
}

interface JobOutcome {
  succeeded: number;
  failedPermanent: number;
  failedTransient: number;
  subscriptionsRemoved: number;
  finalStatus: "completed" | "failed" | "pending" | "skipped";
}

/**
 * Phases 11-16 of the worker pipeline (PR #30 spec section 23): claims
 * due outbox jobs (atomically, via `claim_due_notification_jobs` --
 * concurrency-safe, see the migration comment), resolves each
 * recipient's currently active devices, sends through PR #29's real
 * `sendPush`/`buildNotificationPayload` pipeline (never a hand-built
 * payload), and reconciles per-device delivery state so a device that
 * already succeeded is never re-sent and a permanently-dead subscription
 * is cleaned up without affecting any other device's outcome.
 */
export async function runDelivery(limit = 200): Promise<DeliverySummary> {
  const jobs = await claimDueNotificationJobs(limit);

  const summary: DeliverySummary = {
    jobsClaimed: jobs.length,
    jobsCompleted: 0,
    jobsFailed: 0,
    jobsPending: 0,
    jobsSkipped: 0,
    deliveriesSucceeded: 0,
    deliveriesFailedPermanent: 0,
    deliveriesFailedTransient: 0,
    subscriptionsRemoved: 0,
  };

  // The optional TAKSHAL CTRL channel (see `takshalChannel.ts`) -- null,
  // at zero cost, unless it is configured AND someone is rolled out to it,
  // in which case every job below is exactly the pre-existing direct path.
  const takshal = jobs.length > 0 ? startTakshalChannelRun() : null;

  for (const job of jobs) {
    const outcome = takshal ? await routeJob(job, takshal) : await processJob(job);
    summary.deliveriesSucceeded += outcome.succeeded;
    summary.deliveriesFailedPermanent += outcome.failedPermanent;
    summary.deliveriesFailedTransient += outcome.failedTransient;
    summary.subscriptionsRemoved += outcome.subscriptionsRemoved;

    if (outcome.finalStatus === "completed") summary.jobsCompleted++;
    else if (outcome.finalStatus === "failed") summary.jobsFailed++;
    else if (outcome.finalStatus === "skipped") summary.jobsSkipped++;
    else summary.jobsPending++;
  }

  // Bounded (a few seconds at most, see `takshal/dispatcher.ts`): lets
  // secondary TAKSHAL CTRL requests still in flight finish inside this
  // invocation. Every direct delivery above has already completed.
  await takshal?.settle();

  return summary;
}

/**
 * Follows the job's channel plan (`lib/notifications/deliveryChannel.ts`):
 *
 * - `direct` -- `processJob`, unchanged.
 * - `both`   -- the hub request is QUEUED first (it runs alongside the
 *   direct fan-out, never before or instead of it), then `processJob`,
 *   unchanged. The direct pipeline stays authoritative for the job's
 *   status, retries and receipts; the hub's outcome never touches them.
 *   A job the direct pipeline retries is offered to the hub again under
 *   the same event id, which the hub deduplicates -- a free retry for a
 *   hub request that failed the first time.
 * - `takshal` -- see `processTakshalOnlyJob`. No policy produces this in
 *   the current rollout phase (allowlisted -> `both`, everyone else ->
 *   `direct`); it is wired so a persisted per-user preference can switch
 *   it on later without touching this pipeline.
 */
async function routeJob(job: ClaimedNotificationJob, takshal: TakshalChannelRun): Promise<JobOutcome> {
  const { plan, notification } = await takshal.planFor(job);
  if (!notification) return processJob(job);
  if (plan.direct) {
    takshal.sendSecondary(notification);
    return processJob(job);
  }
  return processTakshalOnlyJob(job, notification, takshal);
}

/**
 * Channel `takshal`: the hub is this job's ONLY push channel, so -- unlike
 * `both` -- its outcome settles the job, through the SAME bounded
 * job-level retry every direct job already uses (`attempts` vs.
 * `max_attempts`, re-claimed by the next tick, same event id so the hub
 * never pushes twice):
 *
 * - accepted -> `completed` (`skipped` when the recipient has no active
 *   TAKSHAL CTRL device -- the exact meaning `skipped` already has for a
 *   recipient with no direct device)
 * - not accepted -> left `pending` for a later tick, or `failed` once the
 *   attempt budget is spent.
 *
 * The inbox shows the job either way (it never depends on delivery
 * status). No direct device is attempted, so every per-device counter
 * stays zero.
 */
async function processTakshalOnlyJob(
  job: ClaimedNotificationJob,
  notification: Parameters<TakshalChannelRun["sendPrimary"]>[0],
  takshal: TakshalChannelRun,
): Promise<JobOutcome> {
  const none = { succeeded: 0, failedPermanent: 0, failedTransient: 0, subscriptionsRemoved: 0 };
  const result = await takshal.sendPrimary(notification);

  if (result.ok) {
    const finalStatus = result.noActiveSubscription ? "skipped" : "completed";
    await setJobStatus(job.id, finalStatus);
    return { ...none, finalStatus };
  }
  if (job.attempts >= job.maxAttempts) {
    await setJobStatus(job.id, "failed", "TAKSHAL CTRL delivery failed.");
    return { ...none, finalStatus: "failed" };
  }
  await setJobStatus(job.id, "pending");
  return { ...none, finalStatus: "pending" };
}

async function processJob(job: ClaimedNotificationJob): Promise<JobOutcome> {
  const subscriptions = await getActiveSubscriptionsForUser(job.recipientUserId);

  if (subscriptions.length === 0) {
    await setJobStatus(job.id, "skipped");
    return { succeeded: 0, failedPermanent: 0, failedTransient: 0, subscriptionsRemoved: 0, finalStatus: "skipped" };
  }

  await ensureDeliveryRows(
    job.id,
    subscriptions.map((subscription) => subscription.id),
  );
  const deliveries = await getDeliveriesForJob(job.id);
  const subscriptionById = new Map(subscriptions.map((subscription) => [subscription.id, subscription]));

  const payload = buildNotificationPayload({
    title: job.title,
    body: job.body,
    path: job.path,
    tag: job.tag ?? undefined,
  });

  let succeeded = 0;
  let failedPermanent = 0;
  let failedTransient = 0;
  let subscriptionsRemoved = 0;

  for (const delivery of deliveries) {
    // Terminal states are never retried: a device that already got the
    // notification must never receive it twice just because another
    // device on the same job is still failing transiently.
    if (delivery.status === "sent" || delivery.status === "failed_permanent") continue;
    // A genuine Service Worker receipt is stronger evidence than the
    // HTTP outcome of the send that produced it. A delivery the device
    // ACTUALLY acknowledged is never re-sent, even if this server only
    // ever recorded a transient failure for it -- that is the whole
    // point of receipts, and the one case `status` alone gets wrong.
    // `updateDeliveryOutcome` normally promotes such a row to 'sent'
    // already; this check is what covers the window where the ACK landed
    // after that write, within the same job.
    if (delivery.receivedAt) continue;

    const subscription = subscriptionById.get(delivery.pushSubscriptionId);
    if (!subscription) continue;

    // Derived per delivery and STABLE across retries (see
    // `receiptToken.ts`), so a late ACK for an earlier attempt still
    // matches. `null` = no worker secret configured, in which case the
    // push simply carries no receipt token and nothing downstream
    // changes.
    const receiptToken = deriveDeliveryReceiptToken(delivery.id);
    await beginDeliveryAttempt(
      delivery.id,
      delivery.attempts,
      receiptToken === null ? null : hashReceiptToken(receiptToken),
    );
    const result = await sendPush(
      { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
      // The ONLY per-device variation in an otherwise shared payload.
      // Each device receives a token that can acknowledge exactly its
      // own delivery row and nothing else, so one device's payload can
      // never be replayed to mutate another device's delivery.
      receiptToken === null ? payload : { ...payload, receiptToken },
    );

    if (result.ok) {
      await updateDeliveryOutcome(delivery.id, "sent");
      succeeded++;
    } else if (result.permanent) {
      // Reuses PR #29's exact permanent-failure classification (404/410),
      // but the cleanup is now a REVOCATION rather than a delete -- see
      // `revokePushSubscriptionById` for the resurrection loop that
      // deleting caused. The semantic guarantee is unchanged: this
      // endpoint is out of the active delivery set immediately.
      await updateDeliveryOutcome(delivery.id, "failed_permanent", result.message);
      await revokePushSubscriptionById(subscription.id);
      failedPermanent++;
      subscriptionsRemoved++;
    } else {
      // Never deletes the subscription for a transient/network/429/5xx
      // failure -- it may succeed on a later tick.
      await updateDeliveryOutcome(delivery.id, "failed_transient", result.message);
      failedTransient++;
    }
  }

  const finalDeliveries = await getDeliveriesForJob(job.id);
  // A device that acknowledged receipt counts as succeeded, and is never
  // outstanding, regardless of what HTTP status this server recorded for
  // the send -- the receipt is the stronger fact (see the skip above).
  const anySucceeded = finalDeliveries.some((delivery) => delivery.status === "sent" || Boolean(delivery.receivedAt));
  const anyOutstanding = finalDeliveries.some(
    (delivery) =>
      !delivery.receivedAt && (delivery.status === "pending" || delivery.status === "failed_transient"),
  );

  // Retries are bounded at the JOB level (attempts vs. max_attempts,
  // claimed atomically by `claim_due_notification_jobs`) rather than
  // retrying forever -- spec section 21: "bound retries... do not retry
  // forever". A job is only left `pending` (for the next tick to retry
  // its still-outstanding devices) while outstanding work remains AND
  // the job hasn't exhausted its own attempt budget.
  if (!anyOutstanding || job.attempts >= job.maxAttempts) {
    const finalStatus = anySucceeded ? "completed" : "failed";
    await setJobStatus(job.id, finalStatus, anyOutstanding ? "Exceeded max retry attempts." : undefined);
    return { succeeded, failedPermanent, failedTransient, subscriptionsRemoved, finalStatus };
  }

  await setJobStatus(job.id, "pending");
  return { succeeded, failedPermanent, failedTransient, subscriptionsRemoved, finalStatus: "pending" };
}
