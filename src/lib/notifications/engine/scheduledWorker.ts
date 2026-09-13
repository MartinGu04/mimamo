import "server-only";
import { fetchFreshPersonnelRead } from "./freshRead";
import { findDueCustomWeeklyOccurrences, runDueCustomWeeklyRuleDispatch } from "./recurringRuleDispatch";
import { loadNotificationRuleConfig } from "./ruleConfig";
import { runDueScheduledBroadcastDispatch } from "./scheduledBroadcast";
import { runDelivery, type DeliverySummary } from "./delivery";
import { getJerusalemLocalNow } from "@/lib/time/jerusalemClock";
import { getOperationalWeek } from "@/lib/domain/operationalWeek";
import { peekAnyManagerScheduledBroadcastWorkDue, peekBaselineState, peekDueJobsCount } from "./store";
import { requiresNotificationFloodRecovery } from "./notificationFloodRecovery";
import { formatWorkerErrorLog, runStage, sanitizeWorkerError, WorkerStageError } from "./workerErrors";

export interface ScheduledBroadcastWorkerTickSummary {
  /** True when the cheap pre-check found nothing due/recoverable -- no Google read, no dispatch, no delivery happened this tick. */
  skipped: boolean;
  scheduledBroadcastsDue: number;
  scheduledBroadcastsDispatched: number;
  scheduledBroadcastsFailed: number;
  recurringRulesDispatched: number;
  recurringRulesFailed: number;
  /** `runDelivery()`'s own claim count for THIS invocation -- includes any due job, not only ones this tick's dispatch just created (see this module's own docstring). */
  jobsClaimed: number;
  durationMs: number;
}

/**
 * The dedicated once-a-minute worker's orchestrator, driving
 * `POST /internal/notifications/scheduled` (see that route for the
 * secret-gated entry point). This is a SEPARATE, narrower pipeline from
 * `runNotificationWorkerTick` (`pipeline.ts`, the main 5-minute worker) --
 * NOT a copy of it and NOT a "run everything every minute" shortcut. It
 * has THREE jobs: dispatching due one-time scheduled broadcasts,
 * dispatching due CUSTOM WEEKLY RECURRING rules (the Fixed / Recurring
 * Notifications Center's own `kind = 'custom_weekly'` rows -- see
 * `recurringRuleDispatch.ts`; deliberately reuses this SAME minute-level
 * worker rather than a second dedicated cron, per that feature's own
 * spec), AND acting as the <=1-minute fallback for any `notification_jobs`
 * row that's already due but wasn't picked up by a delivery pass yet
 * (e.g. a manual "Send Now" broadcast whose own best-effort immediate
 * `after()` delivery kick -- see `manualBroadcastActions.ts` -- never ran
 * or failed).
 *
 * 1. A cheap, read-only Supabase pre-check considering BOTH kinds of work
 *    in parallel: `peekAnyManagerScheduledBroadcastWorkDue` (mirrors the
 *    claim function's own two-way, lease-only eligibility -- due-
 *    scheduled, or claimed with an expired 90-second lease; `batch_id`'s
 *    presence never bypasses the lease -- see
 *    `20260821100000_speed_up_manager_scheduled_broadcast_claim.sql`'s
 *    own doc comment for why that matters under overlapping invocations)
 *    and `peekDueJobsCount` (already-due `notification_jobs` rows of ANY
 *    category, not only scheduled-broadcast ones). When BOTH are zero,
 *    this returns immediately: no Google/workbook request, no personnel
 *    parsing, no dispatch, no delivery. A minute with nothing to do costs
 *    two small Postgres count queries, never a Sheets API call.
 * 2. When there are no due/recoverable scheduled broadcasts but there ARE
 *    already-due jobs (the stranded-job recovery path): this skips the
 *    personnel read and scheduled-broadcast dispatch entirely -- there is
 *    nothing for them to do -- and calls `runDelivery()` directly.
 * 3. When due/recoverable scheduled broadcasts exist: a PERSONNEL-ONLY
 *    fresh read (`fetchFreshPersonnelRead`, never Schedule/Settings) --
 *    everything `dispatchScheduledBroadcast` needs to re-resolve
 *    recipients fresh -- then the exact same `runDueScheduledBroadcastDispatch`
 *    (audience resolution, idempotency, crash-recovery) PR #79 already
 *    built for the main tick -- reused unmodified, never re-implemented
 *    here -- then the exact same `runDelivery()` PR #29/#30 already
 *    built, invoked in THIS SAME tick so a freshly-dispatched job doesn't
 *    wait for a separate delivery pass.
 *
 * `runDelivery()` is safe to call from every one of these paths, and from
 * the main 5-minute tick, and from a manual broadcast's own `after()`
 * kick, all overlapping: `claim_due_notification_jobs` uses
 * `for update skip locked`, and each device's delivery row has a terminal
 * state (`sent`/`failed_permanent`) that's always skipped on a later call
 * -- see `delivery.ts`. The only externally-visible effect of calling it
 * from more places is that an already-due job may deliver sooner than it
 * otherwise would have, which is a strict improvement, never a
 * correctness risk.
 *
 * This worker is the PRIMARY, minute-precision owner of scheduled-
 * broadcast dispatch, and the PRIMARY <=1-minute fallback for stranded due
 * jobs. `pipeline.ts`'s main 5-minute tick ALSO still calls
 * `runDueScheduledBroadcastDispatch` and `runDelivery()` as a deliberate
 * FINAL FALLBACK -- this worker's own Cron job is configured manually
 * outside the repository, so if it's ever missing/disabled/broken,
 * scheduled broadcasts and due jobs still go out (just on the slower
 * 5-minute cadence) rather than stopping entirely. Two independently-
 * scheduled callers of the same claim functions are safe by construction:
 * `claim_due_manager_scheduled_broadcasts`'s uniform `claimed_at`-vs-
 * 90-second-lease eligibility (see `runDueScheduledBroadcastDispatch`'s
 * own doc comment) means whichever caller claims a row first owns it for
 * the lease; the other can only ever claim a DIFFERENT due row, never the
 * same live one. Same story for `claim_due_notification_jobs`'s
 * `for update skip locked`.
 */
/**
 * Read-only lookup of due custom-weekly-rule occurrences, isolated from
 * the rest of this worker's pre-check: a `notification_rules` load
 * failure (or any error inside `findDueCustomWeeklyOccurrences`) must
 * NEVER take down this worker's PRIMARY job -- one-time scheduled
 * broadcast dispatch and due-job delivery -- so this is caught and
 * logged here rather than propagated. On failure, this tick simply
 * dispatches zero recurring-rule occurrences (fail safe, never a guess),
 * exactly like `pipeline.ts`'s own isolated rule-config phase.
 */
async function findDueCustomWeeklyOccurrencesSafely(now: ReturnType<typeof getJerusalemLocalNow>) {
  try {
    const ruleConfig = await runStage("rule_config", () => loadNotificationRuleConfig());
    return await runStage("recurring_rules_due_lookup", () => findDueCustomWeeklyOccurrences(ruleConfig.customWeeklyRules, now));
  } catch (error) {
    const stage = error instanceof WorkerStageError ? error.stage : "rule_config";
    const cause = error instanceof WorkerStageError ? error.cause : error;
    console.error(formatWorkerErrorLog(stage, sanitizeWorkerError(cause)));
    return [];
  }
}

export async function runScheduledBroadcastWorkerTick(): Promise<ScheduledBroadcastWorkerTickSummary> {
  const startedAt = performance.now();
  const now = getJerusalemLocalNow();

  // The minute worker can deliver ANY due outbox job. Keep it fail-closed
  // until the 5-minute worker has quarantined the incident jobs and completed
  // the fresh baseline reseed; otherwise it could race ahead and deliver the
  // very false-positive jobs the recovery is meant to cancel.
  const baselineState = await runStage("notification_flood_recovery_guard", () => peekBaselineState());
  if (!baselineState.initialized || requiresNotificationFloodRecovery(baselineState, getOperationalWeek(now).weekStart)) {
    return {
      skipped: true,
      scheduledBroadcastsDue: 0,
      scheduledBroadcastsDispatched: 0,
      scheduledBroadcastsFailed: 0,
      recurringRulesDispatched: 0,
      recurringRulesFailed: 0,
      jobsClaimed: 0,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const [scheduledDueCount, dueJobsCount, recurringDue] = await Promise.all([
    runStage("scheduled_broadcasts_work_check", () => peekAnyManagerScheduledBroadcastWorkDue()),
    runStage("jobs_due_lookup", () => peekDueJobsCount()),
    findDueCustomWeeklyOccurrencesSafely(now),
  ]);

  if (scheduledDueCount === 0 && dueJobsCount === 0 && recurringDue.length === 0) {
    return {
      skipped: true,
      scheduledBroadcastsDue: 0,
      scheduledBroadcastsDispatched: 0,
      scheduledBroadcastsFailed: 0,
      recurringRulesDispatched: 0,
      recurringRulesFailed: 0,
      jobsClaimed: 0,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  if (scheduledDueCount === 0 && recurringDue.length === 0) {
    // Stranded-job recovery path: no due/recoverable scheduled broadcast
    // and no due recurring-rule occurrence, so there is nothing for a
    // personnel read or dispatch to do -- go straight to delivery for
    // whatever is already due (e.g. a manual "Send Now" broadcast whose
    // own immediate `after()` kick never ran).
    const deliverySummary: DeliverySummary = await runStage("delivery", () => runDelivery());
    return {
      skipped: false,
      scheduledBroadcastsDue: 0,
      scheduledBroadcastsDispatched: 0,
      scheduledBroadcastsFailed: 0,
      recurringRulesDispatched: 0,
      recurringRulesFailed: 0,
      jobsClaimed: deliverySummary.jobsClaimed,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  // Either a due/recoverable scheduled broadcast or a due recurring-rule
  // occurrence (or both) exists -- both dispatch paths need the SAME
  // personnel-ONLY fresh read, fetched exactly once here.
  const { people } = await runStage("fresh_personnel_read", () => fetchFreshPersonnelRead());

  let scheduledBroadcastsDue = 0;
  let scheduledBroadcastsDispatched = 0;
  let scheduledBroadcastsFailed = 0;
  if (scheduledDueCount > 0) {
    const dispatchResult = await runStage("scheduled_broadcasts", () => runDueScheduledBroadcastDispatch(people));
    scheduledBroadcastsDue = dispatchResult.claimed;
    scheduledBroadcastsDispatched = dispatchResult.dispatched;
    scheduledBroadcastsFailed = dispatchResult.failed;
  }

  let recurringRulesDispatched = 0;
  let recurringRulesFailed = 0;
  if (recurringDue.length > 0) {
    const recurringResult = await runStage("recurring_rules", () => runDueCustomWeeklyRuleDispatch(recurringDue, people));
    recurringRulesDispatched = recurringResult.dispatched;
    recurringRulesFailed = recurringResult.failed;
  }

  const deliverySummary: DeliverySummary = await runStage("delivery", () => runDelivery());

  return {
    skipped: false,
    scheduledBroadcastsDue,
    scheduledBroadcastsDispatched,
    scheduledBroadcastsFailed,
    recurringRulesDispatched,
    recurringRulesFailed,
    jobsClaimed: deliverySummary.jobsClaimed,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
