import "server-only";
import { SEMANTIC_CHANGE_DEBOUNCE_MINUTES } from "@/lib/config/notificationTiming";
import type { AudienceGroupKey } from "@/lib/domain/audienceGroups";
import { getNotificationServiceClient } from "./serviceClient";
import { semanticFactValuesEqual, type FactChange } from "./diffFacts";
import type { SemanticFact, SemanticFactCategory, SemanticFactValue } from "./semanticFacts";

// ---------------------------------------------------------------------------
// JSONB storage helpers -- a fact can legitimately be "absent" (the entity
// didn't exist before/doesn't exist now), which is a real, meaningful value
// distinct from SQL NULL (which the jsonb columns below reject via `not
// null`). Represented as a small sentinel object rather than a JSON `null`
// literal so it round-trips unambiguously through postgrest.
// ---------------------------------------------------------------------------

const ABSENT_MARKER = { absent: true } as const;

function toStoredValue(value: SemanticFactValue | null): Record<string, unknown> {
  return value === null ? ABSENT_MARKER : (value as unknown as Record<string, unknown>);
}

function fromStoredValue(stored: Record<string, unknown>): SemanticFactValue | null {
  if (stored && (stored as { absent?: boolean }).absent === true) return null;
  return stored as unknown as SemanticFactValue;
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

export interface BaselineAdvanceResult {
  action: "initialized" | "rolled_over" | "unchanged";
  previousWeekStart: string | null;
}

/** The ONLY writer of `notification_baseline_state` -- see the migration's own comment for the atomicity guarantee this RPC provides. */
export async function advanceNotificationBaseline(weekStart: string): Promise<BaselineAdvanceResult> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .rpc("advance_notification_baseline", { p_week_start: weekStart })
    .single<{ action: string; previous_week_start: string | null }>();

  if (error || !data) throw error ?? new Error("advance_notification_baseline returned no row");
  return {
    action: data.action as BaselineAdvanceResult["action"],
    previousWeekStart: data.previous_week_start,
  };
}

export interface BaselineStateSnapshot {
  initialized: boolean;
  currentWeekStart: string | null;
  updatedAt: string | null;
}

/** Read-only peek at the baseline row -- used by dry-run mode, which must never call the mutating `advance_notification_baseline` RPC. */
export async function peekBaselineState(): Promise<BaselineStateSnapshot> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_baseline_state")
    .select("initialized, current_week_start, updated_at")
    .eq("id", 1)
    .maybeSingle<{ initialized: boolean; current_week_start: string | null; updated_at: string | null }>();
  if (error) throw error;
  return {
    initialized: data?.initialized ?? false,
    currentWeekStart: data?.current_week_start ?? null,
    updatedAt: data?.updated_at ?? null,
  };
}

/**
 * Compare-and-set claim for a silent baseline reseed. Setting initialized=false
 * BEFORE destructive clear/seed work is the durable in-progress marker: a crash
 * leaves the next worker on another silent recovery path, never ordinary diff.
 */
export async function claimNotificationBaselineReseed(expected: BaselineStateSnapshot): Promise<boolean> {
  const supabase = getNotificationServiceClient();
  let query = supabase
    .from("notification_baseline_state")
    .update({ initialized: false, updated_at: new Date().toISOString() })
    .eq("id", 1)
    .eq("initialized", expected.initialized);

  query = expected.currentWeekStart === null
    ? query.is("current_week_start", null)
    : query.eq("current_week_start", expected.currentWeekStart);
  query = expected.updatedAt === null ? query.is("updated_at", null) : query.eq("updated_at", expected.updatedAt);

  const { data, error } = await query.select("id").maybeSingle<{ id: number }>();
  if (error) throw error;
  return data !== null;
}

/** Cancels only still-deliverable semantic-change jobs created during the bounded 2026-09-13 false-positive incident. */
export async function quarantineNotificationFloodJobs(createdFrom: string, createdThrough: string): Promise<number> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_jobs")
    .update({ status: "cancelled", claimed_at: null, updated_at: new Date().toISOString() })
    .like("dedupe_key", "settle:%")
    .in("status", ["pending", "claimed"])
    .gte("created_at", createdFrom)
    .lte("created_at", createdThrough)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * The last operational GENERATION (`"regular"` or
 * `` `emergency:${periodId}` ``, never the bare word `"emergency"`) a
 * persisted tick observed -- the transition-tracking counterpart to
 * `current_week_start`'s week-rollover tracking (spec section 22). A full
 * generation identity, not merely a regular/emergency KIND, so that two
 * DIFFERENT Emergency Mode activations (period A, then later, unrelated
 * period B) are distinguishable even though both share `kind: "emergency"`
 * -- see `resolveOperationalGeneration` (`operationalGeneration.ts`) for
 * where this string is derived, and the migration's own doc comment for
 * why comparing bare kind alone is unsafe. `null` only when the baseline
 * row itself doesn't exist yet (pre-first-tick) -- treated by the caller
 * exactly like the un-initialized-baseline case, never guessed.
 */
export async function peekLastOperationalGeneration(): Promise<string | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_baseline_state")
    .select("last_operational_generation")
    .eq("id", 1)
    .maybeSingle<{ last_operational_generation: string }>();
  if (error) throw error;
  return data?.last_operational_generation ?? null;
}

/**
 * Records this tick's operational generation as the new "last observed"
 * value. A PLAIN update, deliberately NOT routed through
 * `advance_notification_baseline` -- see the migration's own doc comment
 * for why this column doesn't need that RPC's row-lock/concurrency
 * guarantee. Never called in dry-run mode (mirrors every other WRITE in
 * this file).
 */
export async function setLastOperationalGeneration(generation: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase
    .from("notification_baseline_state")
    .update({ last_operational_generation: generation })
    .eq("id", 1);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Observed facts (last settled truth for the current week)
// ---------------------------------------------------------------------------

export async function getObservedFacts(weekStart: string): Promise<Map<string, SemanticFact>> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("observed_notification_facts")
    .select("fact_key, category, fact_value")
    .eq("week_start_date", weekStart);
  if (error) throw error;

  const facts = new Map<string, SemanticFact>();
  for (const row of (data ?? []) as { fact_key: string; category: SemanticFactCategory; fact_value: Record<string, unknown> }[]) {
    facts.set(row.fact_key, { factKey: row.fact_key, category: row.category, value: row.fact_value as unknown as SemanticFactValue });
  }
  return facts;
}

/** Bulk delete+insert for a week's observed facts -- used only for the silent baseline capture (first run / week rollover), never during an ordinary tick's settle flow (see `setObservedFact`). */
export async function seedObservedFacts(weekStart: string, facts: ReadonlyMap<string, SemanticFact>): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error: deleteError } = await supabase
    .from("observed_notification_facts")
    .delete()
    .eq("week_start_date", weekStart);
  if (deleteError) throw deleteError;

  if (facts.size === 0) return;

  const rows = [...facts.values()].map((fact) => ({
    week_start_date: weekStart,
    fact_key: fact.factKey,
    category: fact.category,
    fact_value: fact.value,
  }));
  const { error: insertError } = await supabase.from("observed_notification_facts").insert(rows);
  if (insertError) throw insertError;
}

/** Updates exactly one fact's settled value -- called once a pending change for it has settled. */
export async function setObservedFact(weekStart: string, factKey: string, category: SemanticFactCategory, value: SemanticFactValue | null): Promise<void> {
  const supabase = getNotificationServiceClient();
  if (value === null) {
    const { error } = await supabase
      .from("observed_notification_facts")
      .delete()
      .eq("week_start_date", weekStart)
      .eq("fact_key", factKey);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("observed_notification_facts")
    .upsert(
      { week_start_date: weekStart, fact_key: factKey, category, fact_value: value },
      { onConflict: "week_start_date,fact_key" },
    );
  if (error) throw error;
}

/** Clears a week's observed facts and pending changes (week rollover). Throws on either delete failing -- a partial/failed cleanup must never be silently treated as success (that would leak the previous week's stale state into the new week's diff base). */
export async function clearWeekState(weekStart: string): Promise<void> {
  const supabase = getNotificationServiceClient();

  const { error: observedError } = await supabase
    .from("observed_notification_facts")
    .delete()
    .eq("week_start_date", weekStart);
  if (observedError) throw observedError;

  const { error: pendingError } = await supabase
    .from("pending_notification_changes")
    .delete()
    .eq("week_start_date", weekStart);
  if (pendingError) throw pendingError;
}

// ---------------------------------------------------------------------------
// Pending (debounced) changes
// ---------------------------------------------------------------------------

/**
 * Applies a fresh tick's fact readings against the pending-changes
 * table. For each candidate key, compares the fresh value against BOTH
 * the pending row's `original_value` and its `latest_value` -- never
 * `original_value` alone, and NEVER treats a worker tick itself as
 * evidence of a new change:
 *
 *  - fresh === original_value -> the value returned to where it started;
 *    delete/cancel the row, send nothing (spec section 11: "evening ->
 *    morning -> evening... then no notification should be sent").
 *  - fresh === latest_value (and !== original_value) -> this is the SAME
 *    value already recorded from a previous tick, merely observed again
 *    -- the row is left COMPLETELY untouched (`last_changed_at`/
 *    `settle_at` never move). This is the fix for the bug where a
 *    5-minute worker cadence re-diffing an unsettled `observed`-vs-fresh
 *    pair every tick would otherwise keep pushing `settle_at` forward
 *    forever and the change would never settle.
 *  - fresh differs from BOTH -> a genuinely NEW value since the row was
 *    last updated; extends the debounce (`last_changed_at = now()`,
 *    `settle_at = now() + debounce`) and updates `latest_value`,
 *    preserving `original_value` from the first observation untouched.
 *  - no existing row and fresh !== the diff's own oldValue -> opens a
 *    brand-new pending row.
 *
 * Takes `changes` (this tick's observed-vs-fresh diff) AND every
 * currently-open pending row for the week -- not `changes` alone -- as
 * its candidate set, so a key that reverted to its original value can
 * still be detected and cancelled even on a tick where it no longer
 * differs from the still-unsettled `observed_notification_facts` value
 * (and therefore wouldn't appear in `changes` at all).
 */
export async function applyPendingChanges(
  weekStart: string,
  changes: readonly FactChange[],
  freshFacts: ReadonlyMap<string, SemanticFact>,
): Promise<void> {
  const supabase = getNotificationServiceClient();

  // Every currently-open pending row for the week -- not just the keys
  // this tick's diff touched -- see this function's own docstring.
  const { data: existingRows, error: fetchError } = await supabase
    .from("pending_notification_changes")
    .select("fact_key, category, original_value, latest_value")
    .eq("week_start_date", weekStart);
  if (fetchError) throw fetchError;

  const existingByKey = new Map(
    (
      (existingRows ?? []) as {
        fact_key: string;
        category: SemanticFactCategory;
        original_value: Record<string, unknown>;
        latest_value: Record<string, unknown>;
      }[]
    ).map((row) => [
      row.fact_key,
      { category: row.category, originalValue: fromStoredValue(row.original_value), latestValue: fromStoredValue(row.latest_value) },
    ]),
  );

  const now = new Date();
  const settleAt = new Date(now.getTime() + SEMANTIC_CHANGE_DEBOUNCE_MINUTES * 60_000).toISOString();

  const toUpsert: Record<string, unknown>[] = [];
  const toCancel: string[] = [];
  const handledKeys = new Set<string>();

  function reconcile(
    key: string,
    category: SemanticFactCategory,
    freshValue: SemanticFactValue | null,
    fallbackOriginal: SemanticFactValue | null,
  ): void {
    if (handledKeys.has(key)) return;
    handledKeys.add(key);

    const existing = existingByKey.get(key);
    const originalValue = existing ? existing.originalValue : fallbackOriginal;

    if (semanticFactValuesEqual(originalValue, freshValue)) {
      if (existing) toCancel.push(key);
      return;
    }

    // The fresh value is identical to what's already recorded as
    // `latest_value` -- this is the SAME still-debouncing change being
    // observed again by another worker tick, not a new change. Leave
    // the row's timestamps completely alone; polling itself is never
    // evidence of a new change.
    if (existing && semanticFactValuesEqual(existing.latestValue, freshValue)) {
      return;
    }

    toUpsert.push({
      week_start_date: weekStart,
      fact_key: key,
      category,
      original_value: toStoredValue(originalValue),
      latest_value: toStoredValue(freshValue),
      last_changed_at: now.toISOString(),
      settle_at: settleAt,
      status: "pending",
    });
  }

  for (const change of changes) {
    reconcile(change.factKey, change.category, change.newValue, change.oldValue);
  }

  // Every open pending row NOT touched by this tick's diff means the
  // fresh reading now matches the still-unsettled observed value again
  // -- re-check it against its own original/latest values, since that's
  // exactly the "reverted to original" case a plain observed-vs-fresh
  // diff cannot see.
  for (const [key, existing] of existingByKey) {
    if (handledKeys.has(key)) continue;
    const freshValue = freshFacts.get(key)?.value ?? null;
    reconcile(key, existing.category, freshValue, existing.originalValue);
  }

  if (toCancel.length > 0) {
    const { error } = await supabase
      .from("pending_notification_changes")
      .delete()
      .eq("week_start_date", weekStart)
      .in("fact_key", toCancel);
    if (error) throw error;
  }

  if (toUpsert.length > 0) {
    const { error } = await supabase
      .from("pending_notification_changes")
      .upsert(toUpsert, { onConflict: "week_start_date,fact_key" });
    if (error) throw error;
  }
}

export interface ClaimedPendingChange {
  id: string;
  weekStartDate: string;
  factKey: string;
  category: SemanticFactCategory;
  originalValue: SemanticFactValue | null;
  latestValue: SemanticFactValue | null;
}

export async function claimDuePendingChanges(limit = 200): Promise<ClaimedPendingChange[]> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase.rpc("claim_due_pending_notification_changes", { p_limit: limit });
  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    weekStartDate: row.week_start_date as string,
    factKey: row.fact_key as string,
    category: row.category as SemanticFactCategory,
    originalValue: fromStoredValue(row.original_value as Record<string, unknown>),
    latestValue: fromStoredValue(row.latest_value as Record<string, unknown>),
  }));
}

export async function deletePendingChange(id: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase.from("pending_notification_changes").delete().eq("id", id);
  if (error) throw error;
}

/** Read-only count of every open (still debouncing) pending change for the week. */
export async function countOpenPendingChanges(weekStart: string): Promise<number> {
  const supabase = getNotificationServiceClient();
  const { count, error } = await supabase
    .from("pending_notification_changes")
    .select("id", { count: "exact", head: true })
    .eq("week_start_date", weekStart);
  if (error) throw error;
  return count ?? 0;
}

/** Read-only count of pending changes already due to settle -- dry-run mode's estimate; never claims/mutates. */
export async function peekDuePendingChangesCount(weekStart: string): Promise<number> {
  const supabase = getNotificationServiceClient();
  const { count, error } = await supabase
    .from("pending_notification_changes")
    .select("id", { count: "exact", head: true })
    .eq("week_start_date", weekStart)
    .eq("status", "pending")
    .lte("settle_at", new Date().toISOString());
  if (error) throw error;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Notification jobs (outbox)
// ---------------------------------------------------------------------------

export interface NewNotificationJob {
  category: string;
  recipientUserId: string;
  title: string;
  body: string;
  path: string;
  tag?: string;
  dedupeKey: string;
  scheduledFor: string;
  sourceRef?: string;
}

/** Idempotent by `dedupe_key` -- a retried/duplicate worker tick never creates two logical jobs for the same event. Returns true when a NEW job was inserted (false when the dedupe_key already existed). */
export async function insertNotificationJobIfAbsent(job: NewNotificationJob): Promise<boolean> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_jobs")
    .insert({
      category: job.category,
      recipient_user_id: job.recipientUserId,
      title: job.title,
      body: job.body,
      path: job.path,
      tag: job.tag ?? null,
      dedupe_key: job.dedupeKey,
      scheduled_for: job.scheduledFor,
      source_ref: job.sourceRef ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // Unique violation on dedupe_key is the expected, harmless outcome of
    // a duplicate/retried job-creation attempt -- never a real failure.
    if ((error as { code?: string }).code === "23505") return false;
    throw error;
  }
  return data !== null;
}

/**
 * The `source_ref` of the most recently CREATED job for `recipientUserId`
 * within `category`, regardless of that job's own delivery outcome/status
 * -- same "delivery status is irrelevant to whether the logical
 * notification happened" convention `getRecentSettledJobsForRecipient`'s
 * own docstring already establishes. `null` when no such job has ever been
 * created for this recipient (a genuinely first-time case, or the row's
 * own `source_ref` was never set) -- callers treat that as "nothing known
 * to compare against yet", never as a fabricated empty state. Used by
 * aggregate/summary notification categories (e.g. `weapon_qualification_summary`
 * in `weaponQualification.ts`) to decide whether the CURRENT aggregate
 * content is genuinely new relative to the last one actually sent, without
 * needing a second/parallel persisted-state table -- this one `text`
 * column on the EXISTING `notification_jobs` row already carries it.
 */
export async function getLatestNotificationSourceRef(recipientUserId: string, category: string): Promise<string | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_jobs")
    .select("source_ref")
    .eq("recipient_user_id", recipientUserId)
    .eq("category", category)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ source_ref: string | null }>();
  if (error) throw error;
  return data?.source_ref ?? null;
}

/**
 * Upsert semantics for time-based reminders (tomorrow shift/duty), whose
 * content can legitimately change before send (the underlying assignment
 * changed) -- see PR #30 spec sections 16-17. Only touches a job still
 * `pending`; a job already claimed/completed/failed/skipped/cancelled is
 * never rewritten out from under an in-flight or already-resolved send.
 *
 * ALWAYS goes through the `upsert_pending_reminder_job` RPC -- never a
 * plain `.upsert(...).eq('status','pending')` client call. That chained
 * `.eq()` looks like a WHERE guard but is NOT one for an upsert: PostgREST
 * request-level filters are not applied to a merge-duplicates upsert's
 * `ON CONFLICT ... DO UPDATE` action, so that call unconditionally
 * revived ANY existing row back to 'pending' regardless of its real
 * status -- confirmed as a real Production incident (see the migration's
 * own comment for the exact tick-by-tick mechanism). The RPC expresses
 * the guard as a genuine `ON CONFLICT ... DO UPDATE ... WHERE` clause in
 * SQL instead, which Postgres actually honors.
 */
export async function upsertPendingReminderJob(job: NewNotificationJob): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase.rpc("upsert_pending_reminder_job", {
    p_category: job.category,
    p_recipient_user_id: job.recipientUserId,
    p_title: job.title,
    p_body: job.body,
    p_path: job.path,
    p_tag: job.tag ?? null,
    p_dedupe_key: job.dedupeKey,
    p_scheduled_for: job.scheduledFor,
    p_source_ref: job.sourceRef ?? null,
  });
  if (error) throw error;
}

/**
 * Upsert semantics for an AGGREGATE/SUMMARY notification category whose
 * `dedupeKey` identifies a whole logical EPISODE of an ongoing problem
 * (e.g. `weapon_qualification_summary:<managerUserId>`), never one tick's
 * content -- see `weaponQualification.ts`'s own docs and this function's
 * migration (`20260902130000_add_aggregate_notification_episode_dedupe.sql`)
 * for the exact "episode" semantics this exists to serve (spec: fix a
 * production notification-spam incident where 38 -> 40 -> 44 mismatches
 * produced three separate Notification Center entries and three pushes
 * instead of one notification that simply updates its own count, with
 * exactly one push for the whole episode).
 *
 * ALWAYS goes through the `upsert_aggregate_notification_job` RPC --
 * never a plain client upsert -- for the same reason
 * `upsertPendingReminderJob` above does: a PostgREST request-level filter
 * is not a real `ON CONFLICT ... DO UPDATE` guard. Here the guard is a
 * genuine branch on the EXISTING row's `resolved_at`, decided under a
 * real row lock, which only SQL can express atomically:
 *
 *  - no row yet for this `dedupeKey`, or the existing row's episode was
 *    already resolved (`resolveAggregateNotificationJob` below) -> a
 *    fresh episode: (re)inserted/reset to `status = 'pending'`, ready for
 *    the worker's next delivery tick to push it. Returns `true`.
 *  - an episode is already open (unresolved) for this key -> only the
 *    displayed content (`title`/`body`/`path`/`tag`/`sourceRef`) is
 *    refreshed in place; delivery state is left completely untouched, so
 *    an already-delivered job is never revived/re-pushed. Returns
 *    `false`.
 *
 * Callers are expected to call this UNCONDITIONALLY on every tick the
 * underlying issue set is non-empty (never only when content changed) --
 * the exact same "recompute and re-upsert every eligible tick, by
 * design" convention `upsertPendingReminderJob`'s own docstring already
 * establishes for reminders; the RPC's own row lock is what keeps that
 * safe under concurrent/repeated worker executions (see the migration's
 * own doc comment for the retry-on-conflict mechanics).
 */
export async function upsertAggregateNotificationJob(job: NewNotificationJob): Promise<boolean> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase.rpc("upsert_aggregate_notification_job", {
    p_category: job.category,
    p_recipient_user_id: job.recipientUserId,
    p_title: job.title,
    p_body: job.body,
    p_path: job.path,
    p_tag: job.tag ?? null,
    p_dedupe_key: job.dedupeKey,
    p_scheduled_for: job.scheduledFor,
    p_source_ref: job.sourceRef ?? null,
  });
  if (error) throw error;
  return data === true;
}

/**
 * Closes an aggregate notification's currently open episode (`resolved_at
 * = now()`) so the NEXT `upsertAggregateNotificationJob` call against the
 * SAME `dedupeKey` is treated as a genuinely NEW episode -- a fresh push,
 * never a silent content update of the old (now-irrelevant) one. Called
 * once the underlying issue set for this recipient/category is fully
 * empty (spec: "44 -> 0" must close the episode; a later "0 -> 3" must
 * read as new). A no-op (never throws) when no open episode exists yet
 * for this key -- resolving something never opened, or already resolved,
 * is exactly as safe as `cancelPendingReminderJob`'s own "cancelling an
 * already-terminal job" no-op.
 */
export async function resolveAggregateNotificationJob(dedupeKey: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase.rpc("resolve_aggregate_notification_job", { p_dedupe_key: dedupeKey });
  if (error) throw error;
}

export interface SystemReminderRuleGuard {
  /** The `notification_rules.id` this job's category is materialized from. */
  ruleId: string;
  /** The `SystemRuleConfig.revision` the caller's `NotificationRuleConfig` was loaded with -- the exact revision this job's content/schedule was computed against. */
  expectedRevision: number;
}

/**
 * The ONLY write path for a SYSTEM reminder category's pending job (never
 * `upsertPendingReminderJob` directly -- see this function's own migration
 * counterpart, `upsert_pending_system_reminder_job`, for why). On top of
 * that function's existing `WHERE status = 'pending'` guard (never revives
 * a claimed/completed/failed/skipped/cancelled job), this ALSO locks
 * `notification_rules` at `guard.ruleId` FIRST and requires, all against
 * the row it just locked:
 *
 *  - it is still `kind = 'system'` with `system_key = job.category`
 *    (defense in depth against a caller ever passing a mismatched
 *    ruleId/category pair)
 *  - it is still `enabled`
 *  - its CURRENT `revision` still equals `guard.expectedRevision`
 *
 * Closes the stale-worker race a hard-delete-on-edit alone cannot: a
 * worker that loaded its `NotificationRuleConfig` BEFORE a manager's
 * concurrent `updateSystemRule` commits (disable, or a time change) but
 * only calls this function AFTER that commit would otherwise
 * re-materialize the job under the OLD configuration -- exactly
 * recreating what `update_system_rule_and_invalidate_pending_jobs` just
 * deleted. `updateSystemRule` increments `revision` in that SAME
 * transaction, so by the time this function's lock is granted, either:
 *
 *  - this call's lock is granted FIRST -- it authorizes/writes normally,
 *    and the manager's update (blocked on the same row lock) commits
 *    afterward, deleting the job this call just created (its own
 *    invalidation sweep is unconditional on category, not revision-aware
 *    -- it doesn't need to be, since it always runs strictly after).
 *  - the manager's update's lock is granted FIRST -- `revision` is
 *    already incremented by the time this call's lock is granted, so the
 *    revision check fails and this call no-ops, returning `false`.
 *
 * Either interleaving lands on the SAME safe outcome: the old
 * configuration can never produce a job that outlives the manager's edit.
 * Returns `false` for the no-op case (never throws) -- this is an
 * EXPECTED, benign outcome of losing a race, not an error; the category's
 * own next reminder-worker tick reloads the current revision and
 * re-materializes correctly.
 */
export async function upsertPendingSystemReminderJob(
  job: NewNotificationJob,
  guard: SystemReminderRuleGuard,
): Promise<boolean> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase.rpc("upsert_pending_system_reminder_job", {
    p_rule_id: guard.ruleId,
    p_category: job.category,
    p_expected_revision: guard.expectedRevision,
    p_recipient_user_id: job.recipientUserId,
    p_title: job.title,
    p_body: job.body,
    p_path: job.path,
    p_tag: job.tag ?? null,
    p_dedupe_key: job.dedupeKey,
    p_scheduled_for: job.scheduledFor,
    p_source_ref: job.sourceRef ?? null,
  });
  if (error) throw error;
  return data === true;
}

/** Cancels a still-pending reminder job (e.g. the underlying shift/duty disappeared before send) -- never touches a claimed/completed job. */
/** Every still-`pending` job's dedupe_key starting with `prefix` -- used to find stale reminder jobs (an assignment that no longer exists) that need cancelling. */
export async function listPendingJobDedupeKeysByPrefix(prefix: string): Promise<string[]> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_jobs")
    .select("dedupe_key")
    .eq("status", "pending")
    .like("dedupe_key", `${prefix}%`);
  if (error) throw error;
  return ((data ?? []) as { dedupe_key: string }[]).map((row) => row.dedupe_key);
}

export async function cancelPendingReminderJob(dedupeKey: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase
    .from("notification_jobs")
    .update({ status: "cancelled" })
    .eq("dedupe_key", dedupeKey)
    .eq("status", "pending");
  if (error) throw error;
}

export interface SystemReminderCancelGuard extends SystemReminderRuleGuard {
  /** The system category this dedupe key belongs to -- `cancel_pending_system_reminder_job` verifies this against the locked rule's own `system_key`, the same defense-in-depth `upsertPendingSystemReminderJob` applies. */
  category: string;
}

/**
 * The ONLY cancellation path for a SYSTEM reminder category's stale
 * pending job (never the generic `cancelPendingReminderJob` directly, for
 * any of the 10 system categories -- see `reminders.ts`'s
 * `applyReminderJobs`, this function's one caller). Closes the MIRROR-
 * IMAGE race to `upsertPendingSystemReminderJob`'s own guard: that
 * function stops a stale worker from re-CREATING a job under an old
 * configuration; this one stops a stale worker from CANCELLING a job a
 * FRESHER worker (or the manager's own reconciliation) has since created
 * under the CURRENT revision -- e.g. a worker that loaded a disabled
 * revision-1 config (computing zero valid jobs) whose own stale-key
 * sweep would otherwise treat a revision-2 re-enable's freshly-created
 * job as "not in my valid set" and cancel it, permanently (a cancelled
 * job can never be revived by a later upsert -- see
 * `upsertPendingSystemReminderJob`'s own docstring).
 *
 * Locks the SAME `notification_rules` row `upsertPendingSystemReminderJob`
 * and `updateSystemRule` both lock, and only proceeds when that row is
 * still `kind = 'system'`, `system_key = guard.category`, and its CURRENT
 * `revision` still equals `guard.expectedRevision`.
 *
 * Deliberately does NOT require `enabled = true` (unlike the upsert
 * guard) -- a worker that genuinely loaded the CURRENT revision of a
 * now-DISABLED rule must still be able to clean up that revision's own
 * still-pending jobs. The authority here is rule IDENTITY + exact
 * REVISION, never enabled state.
 *
 * Only ever cancels a still-`'pending'` job (same terminal-status
 * protection `cancelPendingReminderJob` already has). Returns `true` once
 * authorized/attempted (regardless of whether a `'pending'` row actually
 * existed to cancel -- mirroring `upsertPendingSystemReminderJob`'s own
 * "authorized and attempted" semantics), `false` for the stale-revision/
 * mismatched no-op case.
 */
export async function cancelPendingSystemReminderJob(dedupeKey: string, guard: SystemReminderCancelGuard): Promise<boolean> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase.rpc("cancel_pending_system_reminder_job", {
    p_rule_id: guard.ruleId,
    p_category: guard.category,
    p_expected_revision: guard.expectedRevision,
    p_dedupe_key: dedupeKey,
  });
  if (error) throw error;
  return data === true;
}

export interface ClaimedNotificationJob {
  id: string;
  category: string;
  recipientUserId: string;
  title: string;
  body: string;
  path: string;
  tag: string | null;
  attempts: number;
  maxAttempts: number;
}

export async function claimDueNotificationJobs(limit = 200): Promise<ClaimedNotificationJob[]> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase.rpc("claim_due_notification_jobs", { p_limit: limit });
  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    category: row.category as string,
    recipientUserId: row.recipient_user_id as string,
    title: row.title as string,
    body: row.body as string,
    path: row.path as string,
    tag: row.tag as string | null,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
  }));
}

export type JobFinalStatus = "completed" | "failed" | "pending" | "skipped";

/** Read-only count of pending jobs already due -- dry-run mode's estimate; never claims/mutates. */
export async function peekDueJobsCount(): Promise<number> {
  const supabase = getNotificationServiceClient();
  const { count, error } = await supabase
    .from("notification_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString());
  if (error) throw error;
  return count ?? 0;
}

export async function setJobStatus(id: string, status: JobFinalStatus, lastError?: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase
    .from("notification_jobs")
    .update({ status, last_error: lastError ?? null })
    .eq("id", id);
  if (error) throw error;
}

export interface RecentSettledJobRow {
  id: string;
  category: string;
  title: string;
  body: string;
  path: string;
  sourceRef: string | null;
  createdAt: string;
}

export interface RecentSettledJobsResult {
  /** Newest-first, bounded to `limit` -- a small presentation slice, never the full match set. */
  rows: RecentSettledJobRow[];
  /** The EXACT number of matching rows, independent of `limit` -- lets the caller render a truthful "ועוד N שינויים" without a second query. */
  totalCount: number;
}

/**
 * Read-only lookup of ONE recipient's own recent settled-change jobs --
 * powers the personal Home dashboard's "מה השתנה מאז הפעם הקודמת" recap
 * (originally PR #36, upgraded from a fixed 72h horizon to "since your
 * previous Home visit"), never the worker itself. Deliberately selects
 * ONLY presentation-safe columns -- never `recipient_user_id`,
 * `dedupe_key`, `attempts`, `last_error`, `status`, `scheduled_for`,
 * `claimed_at`, `tag`, or `updated_at`. The caller
 * (`lib/readModels/recentDashboardChanges.ts`) maps this straight into a
 * small typed read model -- never a raw row into React.
 *
 * Deliberately NO `status` filter: whether a job's push delivery
 * completed, was skipped, or failed is irrelevant here -- a settled
 * semantic change is a real event the moment its job row exists,
 * independent of delivery outcome. Coupling this recap's visibility to
 * delivery status would be exactly the "second baseline system" this
 * feature is designed to avoid becoming.
 *
 * `sinceIso` is caller-supplied and generic -- this function has no
 * opinion on WHERE it comes from (a fixed horizon, or, as of the
 * "since your previous visit" upgrade, the user's own previous-visit
 * cutoff from `lib/dashboardVisit/store.ts`).
 *
 * STRICTLY after `sinceIso` (`.gt`, never `.gte`): a job whose
 * `created_at` is exactly equal to the caller's cutoff belongs to the
 * boundary itself, not to the period after it. For the "since your
 * previous visit" recap specifically, that cutoff IS a previously
 * recorded visit instant -- a settled change created at that exact
 * instant was already visible (or eligible to be) on the visit that
 * produced the cutoff, so `.gte` would risk showing it again.
 *
 * Requests an EXACT row count (`{ count: "exact" }`) in the SAME request
 * as the bounded/limited rows -- postgrest computes `count` over the
 * whole filtered match set independent of `limit`, so this is one round
 * trip, never a second "how many total?" query (no N+1).
 */
export async function getRecentSettledJobsForRecipient(
  recipientUserId: string,
  categories: readonly string[],
  sinceIso: string,
  limit: number,
): Promise<RecentSettledJobsResult> {
  const supabase = getNotificationServiceClient();
  const { data, error, count } = await supabase
    .from("notification_jobs")
    .select("id, category, title, body, path, source_ref, created_at", { count: "exact" })
    .eq("recipient_user_id", recipientUserId)
    .in("category", categories)
    .gt("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    category: row.category as string,
    title: row.title as string,
    body: row.body as string,
    path: row.path as string,
    sourceRef: row.source_ref as string | null,
    createdAt: row.created_at as string,
  }));

  return { rows, totalCount: count ?? rows.length };
}

// ---------------------------------------------------------------------------
// Notification center -- inbox read/dismiss state
//
// Read-only projection + minimal per-user state over the SAME
// notification_jobs outbox above -- never a second notification-rule
// engine, never a new column on notification_jobs. Every function here
// requires the caller to already have a SERVER-VERIFIED recipientUserId
// (see `lib/readModels/notificationInbox.ts`, which resolves it via
// `getAuthenticatedIdentity()` exactly like `recentDashboardChanges.ts`
// already does) -- never a client-supplied id, and never called from
// anywhere but a Server Action/Server Component.
// ---------------------------------------------------------------------------

/** A bounded inbox window -- a bell popover, never a full notification archive (same "bounded, not an archive" convention `DASHBOARD_VISIT_RECAP_VISIBLE_LIMIT` already establishes). The unread badge counts only within this window. */
export const NOTIFICATION_INBOX_LIMIT = 50;

export interface InboxJobRow {
  id: string;
  category: string;
  title: string;
  body: string;
  path: string;
  createdAt: string;
  scheduledFor: string;
}

/** The current user's "נקה התראות" cutoff -- `-infinity` (i.e. no cutoff at all) when the user has never cleared their inbox. Never throws on a missing row; that's the ordinary, expected first-visit state. */
export async function getInboxClearedBefore(userId: string): Promise<string> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_inbox_state")
    .select("cleared_before")
    .eq("user_id", userId)
    .maybeSingle<{ cleared_before: string }>();
  if (error) throw error;
  return data?.cleared_before ?? "-infinity";
}

/**
 * One recipient's own inbox jobs -- filtered to `scheduled_for <= now()`
 * (a time-based reminder like `tomorrow_shift` is upserted repeatedly
 * from just after midnight, hours before its real 20:00 `scheduled_for`;
 * gating on `scheduled_for` rather than `created_at` means it appears in
 * the inbox at the moment it was actually meant to notify, never hours
 * early) AND `scheduled_for > clearedBefore` (the user's own "נקה
 * התראות" cutoff, passed in by the caller after `getInboxClearedBefore`
 * -- never re-read here, so both queries always agree on the same
 * instant). No `status` filter beyond excluding `cancelled` (see
 * `INELIGIBLE_INBOX_STATUS` below) -- delivery OUTCOME is otherwise
 * irrelevant to whether the logical notification happened, same
 * reasoning as `getRecentSettledJobsForRecipient`: completed/skipped
 * (no subscription)/failed/still-pending-but-due all represent a real
 * logical notification, so a push-disabled user must see the exact same
 * inbox a push-enabled user would. `cancelled` is different in KIND, not
 * just outcome: a reminder job can be created ahead of its `scheduled_for`
 * and later cancelled (`cancelPendingReminderJob`) because the underlying
 * assignment disappeared/changed before it ever fired -- once
 * `scheduled_for` passes, that row must never resurface as if it still
 * described something real.
 */
const INELIGIBLE_INBOX_STATUS = "cancelled";

export async function getInboxJobsForRecipient(
  recipientUserId: string,
  clearedBefore: string,
  limit: number = NOTIFICATION_INBOX_LIMIT,
): Promise<InboxJobRow[]> {
  const supabase = getNotificationServiceClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("notification_jobs")
    .select("id, category, title, body, path, created_at, scheduled_for")
    .eq("recipient_user_id", recipientUserId)
    .neq("status", INELIGIBLE_INBOX_STATUS)
    .lte("scheduled_for", nowIso)
    .gt("scheduled_for", clearedBefore)
    .order("scheduled_for", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    category: row.category as string,
    title: row.title as string,
    body: row.body as string,
    path: row.path as string,
    createdAt: row.created_at as string,
    scheduledFor: row.scheduled_for as string,
  }));
}

/** Every job id, among `jobIds`, this user has already marked read. A single `.in()` query regardless of how many ids are passed -- never one query per job. */
export async function getReadJobIds(userId: string, jobIds: readonly string[]): Promise<Set<string>> {
  if (jobIds.length === 0) return new Set();
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_reads")
    .select("job_id")
    .eq("user_id", userId)
    .in("job_id", jobIds);
  if (error) throw error;
  return new Set(((data ?? []) as { job_id: string }[]).map((row) => row.job_id));
}

/**
 * Whether `jobId` is a real, inbox-eligible job (not `cancelled`, same
 * eligibility rule `getInboxJobsForRecipient` applies) whose
 * `recipient_user_id` is `userId` -- the ONE ownership check
 * `markNotificationReadAction` must run before ever writing a
 * `notification_reads` row. `jobId` is always client-supplied (the item
 * the user clicked); the service-role client bypasses RLS entirely, so
 * without this explicit check a caller could otherwise write a read-state
 * row for a job that was never addressed to them. `false` covers both
 * "no such job" and "exists but belongs to someone else / is cancelled"
 * identically -- the caller never needs to (and, by design, cannot)
 * distinguish the two.
 */
export async function isEligibleInboxJobForRecipient(userId: string, jobId: string): Promise<boolean> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("recipient_user_id", userId)
    .neq("status", INELIGIBLE_INBOX_STATUS)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** Marks one job read for this user -- idempotent (`ignoreDuplicates`), never errors on an already-read job. Never touches `notification_jobs` itself. Callers MUST verify ownership first (`isEligibleInboxJobForRecipient`) -- this function itself trusts `jobId` as already-proven, so it never re-checks. */
export async function markNotificationJobRead(userId: string, jobId: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase
    .from("notification_reads")
    .upsert({ user_id: userId, job_id: jobId }, { onConflict: "user_id,job_id", ignoreDuplicates: true });
  if (error) throw error;
}

/** Marks every one of `jobIds` read for this user in ONE upsert -- never one query per job (avoids N+1 for "סמן הכל כנקרא"). A job already marked read is left untouched (`ignoreDuplicates`). */
export async function markNotificationJobsRead(userId: string, jobIds: readonly string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const supabase = getNotificationServiceClient();
  const rows = jobIds.map((jobId) => ({ user_id: userId, job_id: jobId }));
  const { error } = await supabase
    .from("notification_reads")
    .upsert(rows, { onConflict: "user_id,job_id", ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * "נקה התראות" -- advances this user's inbox cutoff to now, so every
 * currently-visible job stops appearing. Idempotent by construction
 * (upserting a later `cleared_before` is always safe to repeat) and
 * never deletes/updates a single `notification_jobs` row -- the
 * technical outbox history this cutoff hides is still fully intact for
 * the worker and for any future audit.
 */
export async function clearNotificationInbox(userId: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase
    .from("notification_inbox_state")
    .upsert(
      { user_id: userId, cleared_before: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Deliveries (per push subscription / device)
// ---------------------------------------------------------------------------

export interface ActiveSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Every active push subscription row for an arbitrary recipient -- requires the service-role client, since this is never the calling user's own session. */
export async function getActiveSubscriptionsForUser(userId: string): Promise<ActiveSubscription[]> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []) as ActiveSubscription[];
}

export interface DeliveryRow {
  id: string;
  pushSubscriptionId: string;
  status: "pending" | "sent" | "failed_permanent" | "failed_transient";
  attempts: number;
}

export async function ensureDeliveryRows(jobId: string, subscriptionIds: readonly string[]): Promise<void> {
  if (subscriptionIds.length === 0) return;
  const supabase = getNotificationServiceClient();
  const rows = subscriptionIds.map((subscriptionId) => ({ job_id: jobId, push_subscription_id: subscriptionId }));
  const { error } = await supabase
    .from("notification_deliveries")
    .upsert(rows, { onConflict: "job_id,push_subscription_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function getDeliveriesForJob(jobId: string): Promise<DeliveryRow[]> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_deliveries")
    .select("id, push_subscription_id, status, attempts")
    .eq("job_id", jobId);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    pushSubscriptionId: row.push_subscription_id as string,
    status: row.status as DeliveryRow["status"],
    attempts: row.attempts as number,
  }));
}

/** Records the terminal (or transient-retry) outcome of one send attempt. Attempt counting itself is bumped separately via `incrementDeliveryAttempts` before the send, since postgrest's `update()` has no atomic increment expression. */
export async function updateDeliveryOutcome(
  deliveryId: string,
  status: "sent" | "failed_permanent" | "failed_transient",
  lastError?: string,
): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase
    .from("notification_deliveries")
    .update({
      status,
      last_attempted_at: new Date().toISOString(),
      last_error: lastError ?? null,
    })
    .eq("id", deliveryId);
  if (error) throw error;
}

export async function incrementDeliveryAttempts(deliveryId: string, currentAttempts: number): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase
    .from("notification_deliveries")
    .update({ attempts: currentAttempts + 1 })
    .eq("id", deliveryId);
  if (error) throw error;
}

export async function deletePushSubscriptionById(subscriptionId: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("id", subscriptionId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Manager manual broadcast batches -- audit + idempotency ONLY. Per-recipient
// delivery state stays entirely owned by `notification_jobs`/
// `notification_deliveries` above; this table never duplicates it (see
// `lib/notifications/engine/manualBroadcast.ts`, the one caller).
// ---------------------------------------------------------------------------

/** `"groups"` (dynamic audience groups/exclusions follow-up) resolves `audienceGroupKeys` against the roster at the SAME point every other kind already resolves its own audience -- immediately, for a manual send; at save/edit time, frozen into `targetPersonIds`, for a scheduled broadcast or custom weekly rule (see `manualBroadcast.ts`'s `resolveAudience`). Never re-expanded later, exactly like `"everyone"` already isn't. */
export type BroadcastAudienceKind = "person" | "people" | "everyone" | "groups";

export interface NewManagerNotificationBatch {
  idempotencyKey: string;
  createdByPersonId: string;
  createdByPersonName: string;
  audienceKind: BroadcastAudienceKind;
  targetPersonIds: readonly string[];
  /** The raw group-key selection intent -- meaningful only when `audienceKind === "groups"`. Stored for audit/display only; `targetPersonIds` (the already-resolved snapshot) is what job creation actually uses. */
  audienceGroupKeys?: readonly AudienceGroupKey[];
  /** "לא לשלוח ל" -- the raw excluded-person-id selection, independent of `audienceKind`. Already baked into `targetPersonIds`/`resolvedRecipientUserIds` by the time this batch is created; stored here only so the batch's own audit record reflects what the manager actually configured. */
  excludedPersonIds?: readonly string[];
  /** The EXACT set of resolved Supabase auth user ids this batch's jobs were (or are about to be) created for -- the batch's own immutability anchor. See the migration's own doc comment. */
  resolvedRecipientUserIds: readonly string[];
  title: string;
  body: string;
  resolvedRecipientCount: number;
  pushCapableCount: number;
  inboxOnlyCount: number;
  unresolvedCount: number;
}

export interface ManagerNotificationBatchRow {
  id: string;
  idempotencyKey: string;
  createdByPersonId: string;
  createdByPersonName: string;
  audienceKind: BroadcastAudienceKind;
  targetPersonIds: string[];
  audienceGroupKeys: AudienceGroupKey[];
  excludedPersonIds: string[];
  resolvedRecipientUserIds: string[];
  title: string;
  body: string;
  resolvedRecipientCount: number;
  pushCapableCount: number;
  inboxOnlyCount: number;
  unresolvedCount: number;
  createdAt: string;
}

const MANAGER_NOTIFICATION_BATCH_COLUMNS =
  "id, idempotency_key, created_by_person_id, created_by_person_name, audience_kind, target_person_ids, audience_group_keys, excluded_person_ids, resolved_recipient_user_ids, title, body, resolved_recipient_count, push_capable_count, inbox_only_count, unresolved_count, created_at";

function toBatchRow(row: Record<string, unknown>): ManagerNotificationBatchRow {
  return {
    id: row.id as string,
    idempotencyKey: row.idempotency_key as string,
    createdByPersonId: row.created_by_person_id as string,
    createdByPersonName: row.created_by_person_name as string,
    audienceKind: row.audience_kind as BroadcastAudienceKind,
    targetPersonIds: (row.target_person_ids as string[] | null) ?? [],
    audienceGroupKeys: (row.audience_group_keys as AudienceGroupKey[] | null) ?? [],
    excludedPersonIds: (row.excluded_person_ids as string[] | null) ?? [],
    resolvedRecipientUserIds: (row.resolved_recipient_user_ids as string[] | null) ?? [],
    title: row.title as string,
    body: row.body as string,
    resolvedRecipientCount: row.resolved_recipient_count as number,
    pushCapableCount: row.push_capable_count as number,
    inboxOnlyCount: row.inbox_only_count as number,
    unresolvedCount: row.unresolved_count as number,
    createdAt: row.created_at as string,
  };
}

export async function getManagerNotificationBatchByIdempotencyKey(
  idempotencyKey: string,
): Promise<ManagerNotificationBatchRow | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("manager_notification_batches")
    .select(MANAGER_NOTIFICATION_BATCH_COLUMNS)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data ? toBatchRow(data as Record<string, unknown>) : null;
}

/** Looked up by `id` (rather than `idempotency_key`) for a scheduled broadcast RESUMING dispatch after its own `batch_id` checkpoint was already written -- see `engine/scheduledBroadcast.ts`. */
export async function getManagerNotificationBatchById(id: string): Promise<ManagerNotificationBatchRow | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("manager_notification_batches")
    .select(MANAGER_NOTIFICATION_BATCH_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toBatchRow(data as Record<string, unknown>) : null;
}

export interface ManagerNotificationBatchUpsertResult {
  row: ManagerNotificationBatchRow;
  /** `true` only when THIS call genuinely inserted the row. `false` means `idempotency_key` already existed -- `row` is the ORIGINAL stored batch, never overwritten by this call's (possibly different) payload. The caller MUST compare `row` against its own current request before creating any jobs -- see `manualBroadcast.ts`'s `isSameLogicalBroadcastRequest`; this function itself does not decide whether a reused key represents a legitimate replay or a mutated request. */
  created: boolean;
}

/**
 * Idempotent by `idempotency_key` -- a genuinely new batch inserts and
 * returns its own fresh row with `created: true`. A retried/double-
 * submitted composer click carrying the SAME key hits the unique
 * constraint and this returns the ALREADY-EXISTING batch row instead
 * (`created: false`, the row's ORIGINAL stored values, never silently
 * overwritten by a second, possibly-different payload).
 */
export async function insertManagerNotificationBatchIfAbsent(
  batch: NewManagerNotificationBatch,
): Promise<ManagerNotificationBatchUpsertResult> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("manager_notification_batches")
    .insert({
      idempotency_key: batch.idempotencyKey,
      created_by_person_id: batch.createdByPersonId,
      created_by_person_name: batch.createdByPersonName,
      audience_kind: batch.audienceKind,
      target_person_ids: batch.targetPersonIds,
      audience_group_keys: batch.audienceGroupKeys ?? [],
      excluded_person_ids: batch.excludedPersonIds ?? [],
      resolved_recipient_user_ids: batch.resolvedRecipientUserIds,
      title: batch.title,
      body: batch.body,
      resolved_recipient_count: batch.resolvedRecipientCount,
      push_capable_count: batch.pushCapableCount,
      inbox_only_count: batch.inboxOnlyCount,
      unresolved_count: batch.unresolvedCount,
    })
    .select(MANAGER_NOTIFICATION_BATCH_COLUMNS)
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const existing = await getManagerNotificationBatchByIdempotencyKey(batch.idempotencyKey);
      if (existing) return { row: existing, created: false };
    }
    throw error;
  }
  return { row: toBatchRow(data as Record<string, unknown>), created: true };
}

// ---------------------------------------------------------------------------
// notification_rule_occurrences -- the recurring-rule at-most-once CLAIM
// boundary. See `supabase/migrations/*_create_notification_rules.sql`'s own
// extensive doc comment on this table + `claim_notification_rule_occurrence`
// for exactly why a `manager_notification_batches` row's mere existence is
// never a safe "this occurrence is fully dispatched" signal on its own --
// batch creation and per-recipient `notification_jobs` creation are two
// separate writes, so a crash between them must be recoverable, never
// mistaken for completion.
// ---------------------------------------------------------------------------

export interface NotificationRuleOccurrenceClaim {
  occurrenceId: string;
  batchId: string | null;
  /** `true` when this call resumed an existing (previously claimed, now stale-leased) occurrence rather than creating a fresh one. */
  isResume: boolean;
  /**
   * The occurrence's own FROZEN content -- captured once, at the FRESH
   * claim instant, from `notification_rules`, and never re-read from
   * there again. A resume returns this SAME frozen snapshot, never the
   * rule's current (possibly since-edited) content -- see the RPC's own
   * migration doc comment for exactly why re-reading mutable columns on
   * resume would be a bug (a manager's post-claim edit silently changing
   * an already-in-flight occurrence's meaning).
   */
  ruleTitle: string;
  ruleBody: string;
  ruleAudienceKind: BroadcastAudienceKind;
  ruleTargetPersonIds: string[];
  /** Dynamic audience group keys, frozen at claim time -- meaningful only when `ruleAudienceKind === "groups"`. The KEYS are frozen; MEMBERSHIP is still resolved fresh against the current roster on every occurrence dispatch, exactly like `"everyone"` already is -- see `recurringRuleDispatch.ts`'s own `resolveRecurringDispatchTargets`. */
  ruleAudienceGroupKeys: AudienceGroupKey[];
  /** "לא לשלוח ל", frozen at claim time -- applied fresh against the resolved candidate set on every occurrence dispatch, independent of `ruleAudienceKind`. */
  ruleExcludedPersonIds: string[];
  createdByPersonId: string | null;
  createdByPersonName: string | null;
}

/**
 * Atomically claims (or safely resumes) one custom weekly rule's one
 * local occurrence -- the ONE call site of
 * `claim_notification_rule_occurrence_v2` (the dynamic audience groups/
 * exclusions follow-up migration's replacement for
 * `claim_notification_rule_occurrence`, which remains defined, untouched,
 * in the database for rollout compatibility with an already-deployed old
 * app instance -- same convention as `update_system_rule_configuration_
 * and_invalidate_pending_jobs_v2`). `null` means: already `'completed'`,
 * actively leased by another worker right now, or (FRESH claim only) the
 * rule is disabled/archived/gone, or its CURRENT weekday/local time no
 * longer matches `occurrenceDate`/the caller's assumption of due-ness --
 * in every case, the caller does nothing further for this occurrence this
 * tick. See the RPC's own migration doc comment for the full at-most-once
 * + disable/edit/archive-before-claim + frozen-content race analysis.
 */
export async function claimNotificationRuleOccurrence(
  ruleId: string,
  occurrenceDate: string,
): Promise<NotificationRuleOccurrenceClaim | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase.rpc("claim_notification_rule_occurrence_v2", {
    p_rule_id: ruleId,
    p_occurrence_date: occurrenceDate,
  });
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    occurrenceId: row.occurrence_id as string,
    batchId: (row.batch_id as string | null) ?? null,
    isResume: row.is_resume as boolean,
    ruleTitle: row.rule_title as string,
    ruleBody: row.rule_body as string,
    ruleAudienceKind: row.rule_audience_kind as BroadcastAudienceKind,
    ruleTargetPersonIds: (row.rule_target_person_ids as string[] | null) ?? [],
    ruleAudienceGroupKeys: (row.rule_audience_group_keys as AudienceGroupKey[] | null) ?? [],
    ruleExcludedPersonIds: (row.rule_excluded_person_ids as string[] | null) ?? [],
    createdByPersonId: (row.created_by_person_id as string | null) ?? null,
    createdByPersonName: (row.created_by_person_name as string | null) ?? null,
  };
}

/** The dispatch checkpoint: once this succeeds, this occurrence's eventual batch is fixed -- a crash after this point only ever needs to retry idempotent job creation, never re-decide whether a batch should exist. Guarded to `batch_id is null` (only ever applies once); a second call is a harmless no-op, exactly like `setManagerScheduledBroadcastBatchId`. */
export async function setNotificationRuleOccurrenceBatchId(occurrenceId: string, batchId: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase
    .from("notification_rule_occurrences")
    .update({ batch_id: batchId, updated_at: new Date().toISOString() })
    .eq("id", occurrenceId)
    .is("batch_id", null);
  if (error) throw error;
}

/** The terminal transition -- set ONLY after every intended recipient's `notification_jobs` row has been created successfully. Guarded to `status = 'claimed'`; a second call (a harmless retry) is a no-op. */
export async function completeNotificationRuleOccurrence(occurrenceId: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase
    .from("notification_rule_occurrences")
    .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", occurrenceId)
    .eq("status", "claimed");
  if (error) throw error;
}

/**
 * Bulk-checks which of `candidates` already have a `'completed'`
 * occurrence row -- one query for the whole tick's candidate set, never
 * one per candidate. Used ONLY as a cheap pre-filter (`recurringRuleDispatch.ts`'s
 * `findDueCustomWeeklyOccurrences`) to skip attempting a claim for an
 * occurrence that's obviously already done, saving a personnel read on
 * an otherwise-quiet tick -- never the actual completion authority
 * itself (that's `claim_notification_rule_occurrence`'s own atomic
 * read, which this cannot race unsafely against: at worst this filter
 * is stale by a few seconds and the caller attempts one harmless claim
 * that correctly returns null).
 */
export async function listCompletedNotificationRuleOccurrenceKeys(
  candidates: readonly { ruleId: string; occurrenceDate: string }[],
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const ruleIds = [...new Set(candidates.map((candidate) => candidate.ruleId))];
  const dates = [...new Set(candidates.map((candidate) => candidate.occurrenceDate))];

  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_rule_occurrences")
    .select("rule_id, occurrence_date")
    .in("rule_id", ruleIds)
    .in("occurrence_date", dates)
    .eq("status", "completed");
  if (error) throw error;

  const candidateKeys = new Set(candidates.map((candidate) => `${candidate.ruleId}:${candidate.occurrenceDate}`));
  const completed = new Set<string>();
  for (const row of (data ?? []) as { rule_id: string; occurrence_date: string }[]) {
    const key = `${row.rule_id}:${row.occurrence_date}`;
    if (candidateKeys.has(key)) completed.add(key);
  }
  return completed;
}

/**
 * Every occurrence whose claim lease has gone stale -- `status =
 * 'claimed'` and `claimed_at` older than `leaseSeconds` -- discovered
 * INDEPENDENTLY of any rule's current enabled/schedule/archived state
 * (never joins `notification_rules` at all). This is what makes a
 * claimed-but-crashed occurrence recoverable even after its rule's
 * weekday no longer matches today (e.g. claimed Saturday 23:59, crashed,
 * discovered Sunday), even after the rule was disabled or archived, and
 * even after its schedule was edited -- see `recurringRuleDispatch.ts`'s
 * `findDueCustomWeeklyOccurrences`, the one caller, which merges this
 * with the current-schedule-driven "freshly due" candidate list before
 * every claim attempt. Every returned candidate still has to actually
 * WIN `claim_notification_rule_occurrence` (this is a discovery query
 * only, never a claim itself) -- so a small staleness window here (e.g.
 * two ticks both seeing the same recoverable row) is harmless, exactly
 * like `listCompletedNotificationRuleOccurrenceKeys`'s own docstring.
 */
export async function listRecoverableNotificationRuleOccurrences(
  leaseSeconds = 90,
): Promise<{ ruleId: string; occurrenceDate: string }[]> {
  const supabase = getNotificationServiceClient();
  const staleBefore = new Date(Date.now() - leaseSeconds * 1000).toISOString();
  const { data, error } = await supabase
    .from("notification_rule_occurrences")
    .select("rule_id, occurrence_date")
    .eq("status", "claimed")
    .lt("claimed_at", staleBefore);
  if (error) throw error;
  return ((data ?? []) as { rule_id: string; occurrence_date: string }[]).map((row) => ({
    ruleId: row.rule_id,
    occurrenceDate: row.occurrence_date,
  }));
}

/** A bounded recent-history read for the composer's own small audit list -- never a full archive. */
export const RECENT_MANAGER_BROADCASTS_LIMIT = 10;

/**
 * Excludes recurring-rule occurrence batches (`idempotency_key` prefixed
 * `recurring:`, see `recurringRuleDispatch.ts`) -- this list is the
 * "נשלחו לאחרונה" immediate/scheduled-broadcast history, unchanged by
 * this feature (spec: "recent broadcasts stay functional", meaning
 * behaviorally UNCHANGED, not "also absorbs every weekly recurring
 * send"). A weekly recurring rule's own dispatch history is a Fixed
 * Notifications Center concern (its "next send" summary), never mixed
 * into this unrelated list.
 */
export async function listRecentManagerNotificationBatches(
  limit: number = RECENT_MANAGER_BROADCASTS_LIMIT,
): Promise<ManagerNotificationBatchRow[]> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("manager_notification_batches")
    .select(MANAGER_NOTIFICATION_BATCH_COLUMNS)
    .not("idempotency_key", "like", "recurring:%")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(toBatchRow);
}

// ---------------------------------------------------------------------------
// Manager manual broadcast DELIVERY TIMING -- read-only aggregation for the
// "נשלחו לאחרונה" compact timing row. Deliberately NOT a second delivery/audit
// mechanism: every timestamp below is read straight from
// `manager_scheduled_broadcasts`/`notification_jobs`/`notification_deliveries`,
// the SAME tables the engine's own delivery pipeline already owns (see those
// tables' own migration doc comments). This section only AGGREGATES what
// already exists -- it never writes to any of them, and never adds a
// `sent_at` column or a second history table.
// ---------------------------------------------------------------------------

interface ScheduledBroadcastTimingRow {
  batchId: string;
  createdAt: string;
  scheduledFor: string;
  sentNowAt: string | null;
}

/** One bulk `.in("batch_id", ...)` query -- never one query per batch. Rows with no `batch_id` match (not yet dispatched) are structurally impossible here since every input id came from an already-existing `manager_notification_batches` row. */
async function listManagerScheduledBroadcastTimingByBatchIds(
  batchIds: readonly string[],
): Promise<ScheduledBroadcastTimingRow[]> {
  if (batchIds.length === 0) return [];
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("manager_scheduled_broadcasts")
    .select("batch_id, created_at, scheduled_for, sent_now_at")
    .in("batch_id", batchIds);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .filter((row) => row.batch_id !== null)
    .map((row) => ({
      batchId: row.batch_id as string,
      createdAt: row.created_at as string,
      scheduledFor: row.scheduled_for as string,
      sentNowAt: (row.sent_now_at as string | null) ?? null,
    }));
}

interface ManagerBroadcastJobRow {
  id: string;
  batchId: string;
  status: string;
}

/** One bulk `.in("source_ref", ...)` query against the SAME `manual:<batchId>` convention `manualBroadcast.ts`/`scheduledBroadcast.ts` already write at job-creation time -- never a new column. */
async function listManagerBroadcastJobsBySourceRefs(sourceRefs: readonly string[]): Promise<ManagerBroadcastJobRow[]> {
  if (sourceRefs.length === 0) return [];
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase.from("notification_jobs").select("id, source_ref, status").in("source_ref", sourceRefs);
  if (error) throw error;
  const rows: ManagerBroadcastJobRow[] = [];
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const sourceRef = row.source_ref as string | null;
    if (!sourceRef || !sourceRef.startsWith("manual:")) continue;
    rows.push({ id: row.id as string, batchId: sourceRef.slice("manual:".length), status: row.status as string });
  }
  return rows;
}

interface SuccessfulDeliveryRow {
  jobId: string;
  lastAttemptedAt: string;
}

/** One bulk `.in("job_id", ...)` query, filtered server-side to `status = 'sent'` -- a failed/transient attempt can never reach this list, so it can never be mistaken for a successful send (see `getManagerBroadcastDeliveryTiming`'s own "earliest wins" aggregation below). */
async function listSuccessfulDeliveriesForJobIds(jobIds: readonly string[]): Promise<SuccessfulDeliveryRow[]> {
  if (jobIds.length === 0) return [];
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_deliveries")
    .select("job_id, last_attempted_at")
    .eq("status", "sent")
    .in("job_id", jobIds);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .filter((row) => row.last_attempted_at !== null)
    .map((row) => ({ jobId: row.job_id as string, lastAttemptedAt: row.last_attempted_at as string }));
}

export interface ManagerBroadcastDeliveryTiming {
  /** The matched `manager_scheduled_broadcasts` row's own `created_at` -- when the manager originally created/last edited the SCHEDULE itself. Null for an immediate ("Send Now") broadcast, which has no scheduled row at all. Deliberately never conflated with `ManagerNotificationBatchRow.createdAt` (the batch's own creation/dispatch instant), which stays the list's own sort/clear-cutoff anchor. */
  scheduleCreatedAt: string | null;
  /** The scheduled row's own `scheduled_for` -- null for an immediate broadcast. */
  scheduledFor: string | null;
  /** Non-null only when the scheduled broadcast was triggered early via "שלח עכשיו" (`claim_manager_scheduled_broadcast_now`'s own `sent_now_at`). */
  sentNowAt: string | null;
  /** Earliest `notification_deliveries.last_attempted_at` among `status = 'sent'` rows, across every `notification_jobs` row this batch's `source_ref = manual:<batchId>` matches -- a successful WEB PUSH REQUEST, never proof the operating system displayed anything. Null when nothing has succeeded yet, or ever. */
  firstSuccessfulPushAt: string | null;
  /**
   * A small, truthful fallback classification for when `firstSuccessfulPushAt`
   * is null -- "sent" never appears without `firstSuccessfulPushAt` also being
   * set. "no_push_recipients" is derived from the batch's OWN `pushCapableCount`
   * (zero push-capable recipients at resolution time), independent of
   * job/delivery state. "pending" means at least one of this batch's jobs is
   * still `pending`/`claimed` (still processing/retrying -- including the
   * short window right after a manual send, before its `after()` immediate-
   * delivery kick has run -- see `manualBroadcastActions.ts`). "failed" means
   * every job reached a terminal state (`completed`/`failed`/`skipped`) with
   * no successful delivery -- a genuine, terminal outcome, never a
   * still-in-flight send.
   */
  deliveryState: "sent" | "pending" | "no_push_recipients" | "failed";
}

const NON_TERMINAL_JOB_STATUSES = new Set(["pending", "claimed"]);

/**
 * Bulk-aggregates delivery timing for up to `RECENT_MANAGER_BROADCASTS_LIMIT`
 * batches in exactly THREE queries total, regardless of how many
 * batches/jobs/deliveries exist -- never one query per batch (see the three
 * helpers above, and `manualBroadcastActions.ts`'s `getRecentManagerBroadcastsAction`,
 * the one caller). Read-only: never claims, mutates, or writes to any of
 * the three tables it reads.
 */
export async function getManagerBroadcastDeliveryTiming(
  batches: readonly Pick<ManagerNotificationBatchRow, "id" | "pushCapableCount">[],
): Promise<Map<string, ManagerBroadcastDeliveryTiming>> {
  const result = new Map<string, ManagerBroadcastDeliveryTiming>();
  if (batches.length === 0) return result;

  const batchIds = batches.map((batch) => batch.id);
  const sourceRefs = batchIds.map((id) => `manual:${id}`);

  // Independent reads -- fetched CONCURRENTLY, same reasoning as
  // `computeNotificationReadiness`'s own `Promise.all` (readiness.ts).
  const [scheduledRows, jobRows] = await Promise.all([
    listManagerScheduledBroadcastTimingByBatchIds(batchIds),
    listManagerBroadcastJobsBySourceRefs(sourceRefs),
  ]);

  // Depends on `jobRows` (its own job ids), so this stays sequential.
  const sentDeliveries = await listSuccessfulDeliveriesForJobIds(jobRows.map((job) => job.id));

  const scheduledByBatchId = new Map(scheduledRows.map((row) => [row.batchId, row]));
  const batchIdByJobId = new Map(jobRows.map((job) => [job.id, job.batchId]));
  const statusesByBatchId = new Map<string, string[]>();
  for (const job of jobRows) {
    const statuses = statusesByBatchId.get(job.batchId) ?? [];
    statuses.push(job.status);
    statusesByBatchId.set(job.batchId, statuses);
  }

  // "Earliest successful push wins" -- a later successful device delivery,
  // or ANY failed/transient attempt (never even in `sentDeliveries` to begin
  // with -- see `listSuccessfulDeliveriesForJobIds`'s own server-side
  // `status = 'sent'` filter), can never overwrite an earlier real success.
  const firstSuccessfulPushMsByBatchId = new Map<string, number>();
  for (const delivery of sentDeliveries) {
    const batchId = batchIdByJobId.get(delivery.jobId);
    if (!batchId) continue;
    const ms = Date.parse(delivery.lastAttemptedAt);
    if (Number.isNaN(ms)) continue;
    const existing = firstSuccessfulPushMsByBatchId.get(batchId);
    if (existing === undefined || ms < existing) firstSuccessfulPushMsByBatchId.set(batchId, ms);
  }

  for (const batch of batches) {
    const scheduled = scheduledByBatchId.get(batch.id) ?? null;
    const firstSuccessfulPushMs = firstSuccessfulPushMsByBatchId.get(batch.id);
    const firstSuccessfulPushAt = firstSuccessfulPushMs !== undefined ? new Date(firstSuccessfulPushMs).toISOString() : null;

    let deliveryState: ManagerBroadcastDeliveryTiming["deliveryState"];
    if (firstSuccessfulPushAt !== null) {
      deliveryState = "sent";
    } else if (batch.pushCapableCount === 0) {
      deliveryState = "no_push_recipients";
    } else {
      const statuses = statusesByBatchId.get(batch.id) ?? [];
      // Fails open toward "pending" (never a false "failed" claim) when no
      // job row is found at all -- structurally shouldn't happen (every
      // resolved recipient's job is created synchronously before the send
      // action ever returns `ok: true`), but this is a read-only view, so a
      // transient inconsistency must never assert a terminal outcome that
      // hasn't actually been proven.
      const stillOutstanding = statuses.length === 0 || statuses.some((status) => NON_TERMINAL_JOB_STATUSES.has(status));
      deliveryState = stillOutstanding ? "pending" : "failed";
    }

    result.set(batch.id, {
      scheduleCreatedAt: scheduled?.createdAt ?? null,
      scheduledFor: scheduled?.scheduledFor ?? null,
      sentNowAt: scheduled?.sentNowAt ?? null,
      firstSuccessfulPushAt,
      deliveryState,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Manager scheduled broadcasts -- a manager-scheduled "שליחת התראה" that has
// not yet dispatched. Deliberately separate from `manager_notification_batches`
// (which is immutable once created): this table's whole reason to exist is
// that a scheduled broadcast stays editable/cancellable up until dispatch
// claims it. See the migration's own doc comment for the full lifecycle.
// ---------------------------------------------------------------------------

export type ManagerScheduledBroadcastStatus = "scheduled" | "claimed" | "dispatched" | "cancelled";

export interface NewManagerScheduledBroadcast {
  /** The compose-session key behind exactly-once CREATION -- see the migration's own doc comment. Never reused for dispatch (that's `batch_id`/`scheduled:<id>`). */
  createIdempotencyKey: string;
  audienceKind: BroadcastAudienceKind;
  /** The frozen audience snapshot -- for `"everyone"`/`"groups"` this is already the roster (or matching group members) expanded to ids at save time, minus any exclusion, never re-expanded later. */
  targetPersonIds: readonly string[];
  /** The raw group-key selection intent -- meaningful only when `audienceKind === "groups"`. Stored for display/re-edit only; `targetPersonIds` is the resolved snapshot dispatch actually uses. */
  audienceGroupKeys?: readonly AudienceGroupKey[];
  /** "לא לשלוח ל" intent -- already baked into `targetPersonIds` at save time; stored separately so the editor can show/re-edit it. */
  excludedPersonIds?: readonly string[];
  title: string;
  body: string;
  scheduledFor: string;
  createdByPersonId: string;
  createdByPersonName: string;
}

export interface ManagerScheduledBroadcastRow {
  id: string;
  createIdempotencyKey: string;
  status: ManagerScheduledBroadcastStatus;
  audienceKind: BroadcastAudienceKind;
  targetPersonIds: string[];
  audienceGroupKeys: AudienceGroupKey[];
  excludedPersonIds: string[];
  title: string;
  body: string;
  scheduledFor: string;
  createdByPersonId: string;
  createdByPersonName: string;
  lastChangedByPersonId: string | null;
  lastChangedByPersonName: string | null;
  cancelledByPersonId: string | null;
  cancelledByPersonName: string | null;
  /** The manager who actually pressed "שלח עכשיו" -- distinct from `createdByPersonId`/`lastChangedByPersonId`; null for a normal due-time worker dispatch. See `claim_manager_scheduled_broadcast_now` and `scheduledBroadcast.ts`'s `batchCreatorForRow`. */
  sentNowByPersonId: string | null;
  sentNowByPersonName: string | null;
  sentNowAt: string | null;
  claimedAt: string | null;
  batchId: string | null;
  dispatchedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const MANAGER_SCHEDULED_BROADCAST_COLUMNS =
  "id, create_idempotency_key, status, audience_kind, target_person_ids, audience_group_keys, excluded_person_ids, title, body, scheduled_for, created_by_person_id, created_by_person_name, last_changed_by_person_id, last_changed_by_person_name, cancelled_by_person_id, cancelled_by_person_name, sent_now_by_person_id, sent_now_by_person_name, sent_now_at, claimed_at, batch_id, dispatched_at, cancelled_at, created_at, updated_at";

function toScheduledBroadcastRow(row: Record<string, unknown>): ManagerScheduledBroadcastRow {
  return {
    id: row.id as string,
    createIdempotencyKey: row.create_idempotency_key as string,
    status: row.status as ManagerScheduledBroadcastStatus,
    audienceKind: row.audience_kind as BroadcastAudienceKind,
    targetPersonIds: (row.target_person_ids as string[] | null) ?? [],
    audienceGroupKeys: (row.audience_group_keys as AudienceGroupKey[] | null) ?? [],
    excludedPersonIds: (row.excluded_person_ids as string[] | null) ?? [],
    title: row.title as string,
    body: row.body as string,
    // Canonicalized here, ONCE, at this row's one mapping boundary --
    // Postgres/PostgREST can represent the identical `timestamptz`
    // instant as either `+00:00` or `.000Z`; every downstream consumer
    // of `ManagerScheduledBroadcastRow.scheduledFor` (dispatch,
    // create-idempotency replay comparison, the UI's local-time view)
    // must be able to trust a single canonical string form and never
    // re-normalize it itself. See `scheduledBroadcast.ts`'s
    // `isSameLogicalScheduledCreateRequest` for exactly why this matters.
    scheduledFor: new Date(row.scheduled_for as string).toISOString(),
    createdByPersonId: row.created_by_person_id as string,
    createdByPersonName: row.created_by_person_name as string,
    lastChangedByPersonId: (row.last_changed_by_person_id as string | null) ?? null,
    lastChangedByPersonName: (row.last_changed_by_person_name as string | null) ?? null,
    cancelledByPersonId: (row.cancelled_by_person_id as string | null) ?? null,
    cancelledByPersonName: (row.cancelled_by_person_name as string | null) ?? null,
    sentNowByPersonId: (row.sent_now_by_person_id as string | null) ?? null,
    sentNowByPersonName: (row.sent_now_by_person_name as string | null) ?? null,
    sentNowAt: (row.sent_now_at as string | null) ?? null,
    claimedAt: (row.claimed_at as string | null) ?? null,
    batchId: (row.batch_id as string | null) ?? null,
    dispatchedAt: (row.dispatched_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export interface ManagerScheduledBroadcastUpsertResult {
  row: ManagerScheduledBroadcastRow;
  /** `true` only when THIS call genuinely inserted the row. `false` means `create_idempotency_key` already existed -- `row` is the ORIGINAL stored row, never overwritten by this call's (possibly different) payload. The caller MUST compare `row` against its own current request before treating this as a safe replay -- see `scheduledBroadcast.ts`'s `createScheduledBroadcast`; this function itself does not decide whether a reused key represents a legitimate replay or a mutated request. */
  created: boolean;
}

/**
 * Idempotent by `create_idempotency_key` -- a genuinely new schedule
 * inserts and returns its own fresh row with `created: true`. A retried/
 * double-submitted "שמירת תזמון" click carrying the SAME key hits the
 * unique constraint and this returns the ALREADY-EXISTING row instead
 * (`created: false`, the row's ORIGINAL stored values). Never performs an
 * `update` on conflict -- so this can never overwrite an edit that
 * happened to the row after its original creation, no matter how late a
 * replay of the original create request arrives.
 */
export async function insertManagerScheduledBroadcastIfAbsent(
  input: NewManagerScheduledBroadcast,
): Promise<ManagerScheduledBroadcastUpsertResult> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("manager_scheduled_broadcasts")
    .insert({
      create_idempotency_key: input.createIdempotencyKey,
      audience_kind: input.audienceKind,
      target_person_ids: input.targetPersonIds,
      audience_group_keys: input.audienceGroupKeys ?? [],
      excluded_person_ids: input.excludedPersonIds ?? [],
      title: input.title,
      body: input.body,
      scheduled_for: input.scheduledFor,
      created_by_person_id: input.createdByPersonId,
      created_by_person_name: input.createdByPersonName,
    })
    .select(MANAGER_SCHEDULED_BROADCAST_COLUMNS)
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const existing = await getManagerScheduledBroadcastByCreateIdempotencyKey(input.createIdempotencyKey);
      if (existing) return { row: existing, created: false };
    }
    throw error;
  }
  return { row: toScheduledBroadcastRow(data as Record<string, unknown>), created: true };
}

export async function getManagerScheduledBroadcastByCreateIdempotencyKey(
  createIdempotencyKey: string,
): Promise<ManagerScheduledBroadcastRow | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("manager_scheduled_broadcasts")
    .select(MANAGER_SCHEDULED_BROADCAST_COLUMNS)
    .eq("create_idempotency_key", createIdempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return data ? toScheduledBroadcastRow(data as Record<string, unknown>) : null;
}

export async function getManagerScheduledBroadcastById(id: string): Promise<ManagerScheduledBroadcastRow | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("manager_scheduled_broadcasts")
    .select(MANAGER_SCHEDULED_BROADCAST_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toScheduledBroadcastRow(data as Record<string, unknown>) : null;
}

export interface ManagerScheduledBroadcastEdit {
  audienceKind: BroadcastAudienceKind;
  targetPersonIds: readonly string[];
  audienceGroupKeys?: readonly AudienceGroupKey[];
  excludedPersonIds?: readonly string[];
  title: string;
  body: string;
  scheduledFor: string;
  changedByPersonId: string;
  changedByPersonName: string;
}

/** Guarded by `status = 'scheduled'` at the database level -- returns `null` (never throws) when the row is missing or no longer editable, so the caller can fail truthfully ("השליחה כבר התחילה") instead of silently no-op'ing. */
export async function updateManagerScheduledBroadcastIfEditable(
  id: string,
  edit: ManagerScheduledBroadcastEdit,
): Promise<ManagerScheduledBroadcastRow | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("manager_scheduled_broadcasts")
    .update({
      audience_kind: edit.audienceKind,
      target_person_ids: edit.targetPersonIds,
      audience_group_keys: edit.audienceGroupKeys ?? [],
      excluded_person_ids: edit.excludedPersonIds ?? [],
      title: edit.title,
      body: edit.body,
      scheduled_for: edit.scheduledFor,
      last_changed_by_person_id: edit.changedByPersonId,
      last_changed_by_person_name: edit.changedByPersonName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "scheduled")
    .select(MANAGER_SCHEDULED_BROADCAST_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? toScheduledBroadcastRow(data as Record<string, unknown>) : null;
}

/** Same fail-closed shape as `updateManagerScheduledBroadcastIfEditable` -- `null` means it was no longer `'scheduled'` (already claimed/dispatched/cancelled). */
export async function cancelManagerScheduledBroadcastIfEditable(
  id: string,
  cancelledByPersonId: string,
  cancelledByPersonName: string,
): Promise<ManagerScheduledBroadcastRow | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("manager_scheduled_broadcasts")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by_person_id: cancelledByPersonId,
      cancelled_by_person_name: cancelledByPersonName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "scheduled")
    .select(MANAGER_SCHEDULED_BROADCAST_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? toScheduledBroadcastRow(data as Record<string, unknown>) : null;
}

/** The manager UI's "🕒 התראות מתוזמנות" list -- every not-yet-dispatched, not-cancelled broadcast (including one currently `'claimed'` mid-dispatch, a normally brief transient state), soonest due first. */
export async function listActiveManagerScheduledBroadcasts(): Promise<ManagerScheduledBroadcastRow[]> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("manager_scheduled_broadcasts")
    .select(MANAGER_SCHEDULED_BROADCAST_COLUMNS)
    .in("status", ["scheduled", "claimed"])
    .order("scheduled_for", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(toScheduledBroadcastRow);
}

/** The worker tick's bulk atomic claim -- see `claim_due_manager_scheduled_broadcasts`'s own migration doc comment for the exact `for update skip locked` + crash-recovery semantics. */
export async function claimDueManagerScheduledBroadcasts(limit = 50): Promise<ManagerScheduledBroadcastRow[]> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase.rpc("claim_due_manager_scheduled_broadcasts", { p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(toScheduledBroadcastRow);
}

/**
 * "שלח עכשיו"'s single-row atomic claim. `null` means it was no longer
 * `'scheduled'` (already claimed by a racing worker tick, already
 * dispatched, or cancelled). `sentNowByPersonId`/`sentNowByPersonName` --
 * the AUTHENTICATED caller, never client-supplied -- are recorded by the
 * RPC itself, atomically with the winning claim, so only the manager
 * whose claim actually succeeds is ever attributed.
 */
export async function claimManagerScheduledBroadcastNow(
  id: string,
  sentNowByPersonId: string,
  sentNowByPersonName: string,
): Promise<ManagerScheduledBroadcastRow | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase.rpc("claim_manager_scheduled_broadcast_now", {
    p_id: id,
    p_sent_now_by_person_id: sentNowByPersonId,
    p_sent_now_by_person_name: sentNowByPersonName,
  });
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.length > 0 ? toScheduledBroadcastRow(rows[0]) : null;
}

/**
 * The dispatch checkpoint: once this succeeds, `id`'s eventual batch is
 * fixed forever -- a worker crash after this point only ever needs to
 * retry idempotent job creation for `batchId`, never re-decide whether a
 * batch should exist. Guarded so it only ever applies once (`batch_id is
 * null`) to a still-`'claimed'` row; a second call for the same id is a
 * harmless no-op (0 rows affected), which is exactly what a retried
 * dispatch attempt after a crash right at this step produces.
 */
export async function setManagerScheduledBroadcastBatchId(id: string, batchId: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase
    .from("manager_scheduled_broadcasts")
    .update({ batch_id: batchId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "claimed")
    .is("batch_id", null);
  if (error) throw error;
}

/** The final state transition, once every resolved recipient's `notification_jobs` row exists. Guarded to `status = 'claimed'` so it can never "dispatch" a row that was somehow no longer in flight. */
export async function markManagerScheduledBroadcastDispatched(id: string): Promise<void> {
  const supabase = getNotificationServiceClient();
  const { error } = await supabase
    .from("manager_scheduled_broadcasts")
    .update({ status: "dispatched", dispatched_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "claimed");
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// notification_rules -- the Fixed / Recurring Notifications Center's own
// managed configuration. See `supabase/migrations/*_create_notification_rules.sql`
// for the full schema doc comment and `engine/ruleConfig.ts` for the typed
// loader `reminders.ts`/`pipeline.ts` actually consume -- this section is
// purely the raw row <-> DB mapping, same convention as every other table
// in this file.
// ---------------------------------------------------------------------------

export type NotificationRuleKind = "system" | "custom_weekly";

export interface NotificationRuleRow {
  id: string;
  kind: NotificationRuleKind;
  systemKey: string | null;
  enabled: boolean;
  weekday: number | null;
  localHour: number;
  localMinute: number;
  /** Monotonic, server-incremented on every `updateSystemRule` edit -- see `SystemRuleConfig.revision`'s own docstring (ruleConfig.ts) for the stale-worker race this guards against. Meaningless for a `custom_weekly` row (never read there), always present (table-wide column, default 1). */
  revision: number;
  title: string | null;
  body: string | null;
  audienceKind: BroadcastAudienceKind | null;
  targetPersonIds: string[];
  /** `custom_weekly` only -- the raw group-key selection intent, meaningful only when `audienceKind === "groups"`. `targetPersonIds` (above) is the already-resolved snapshot dispatch actually uses; this is stored purely for display/re-edit. Always empty for a `system` row. */
  audienceGroupKeys: AudienceGroupKey[];
  /** `custom_weekly` only -- "לא לשלוח ל" intent, already baked into `targetPersonIds` at save time. Always empty for a `system` row (system exclusions live in `systemExcludedPersonIds` instead). */
  excludedPersonIds: string[];
  /** System rule only (null override = the built-in title unchanged). Always null for a `custom_weekly` row -- see the migration's own shape check. */
  systemTitleOverride: string | null;
  /** System rule only -- for a static-body category, a full replacement; for a dynamic-body category, a `{details}` template. Always null for a `custom_weekly` row. */
  systemBodyOverride: string | null;
  /** System rule only -- `'all_eligible'`, `'groups'`, or `'selected'`, a FILTER over the rule's own domain-eligible recipients. Always `'all_eligible'` for a `custom_weekly` row. */
  systemAudienceMode: "all_eligible" | "selected" | "groups";
  /** System rule only -- stable roster person ids, meaningful only when `systemAudienceMode === 'selected'`. Always empty for a `custom_weekly` row. */
  systemTargetPersonIds: string[];
  /** System rule only -- dynamic group keys, meaningful only when `systemAudienceMode === 'groups'`. Resolved fresh every reminder tick, never frozen. Always empty for a `custom_weekly` row. */
  systemAudienceGroupKeys: AudienceGroupKey[];
  /** System rule only -- "לא לשלוח ל", ALWAYS applied regardless of `systemAudienceMode`. Always empty for a `custom_weekly` row. */
  systemExcludedPersonIds: string[];
  archivedAt: string | null;
  createdByPersonId: string | null;
  createdByPersonName: string | null;
  updatedByPersonId: string | null;
  updatedByPersonName: string | null;
  createdAt: string;
  updatedAt: string;
}

const NOTIFICATION_RULE_COLUMNS =
  "id, kind, system_key, enabled, weekday, local_hour, local_minute, revision, title, body, audience_kind, target_person_ids, audience_group_keys, excluded_person_ids, system_title_override, system_body_override, system_audience_mode, system_target_person_ids, system_audience_group_keys, system_excluded_person_ids, archived_at, created_by_person_id, created_by_person_name, updated_by_person_id, updated_by_person_name, created_at, updated_at";

function toNotificationRuleRow(row: Record<string, unknown>): NotificationRuleRow {
  return {
    id: row.id as string,
    kind: row.kind as NotificationRuleKind,
    systemKey: (row.system_key as string | null) ?? null,
    enabled: row.enabled as boolean,
    weekday: (row.weekday as number | null) ?? null,
    localHour: row.local_hour as number,
    localMinute: row.local_minute as number,
    // PostgREST serializes `bigint` as a JSON number when it's within the
    // safe integer range (true for any realistic edit count) -- `Number(...)`
    // is still the defensive normalization in case a driver ever hands
    // this back as a numeric string.
    revision: Number(row.revision),
    title: (row.title as string | null) ?? null,
    body: (row.body as string | null) ?? null,
    audienceKind: (row.audience_kind as BroadcastAudienceKind | null) ?? null,
    targetPersonIds: (row.target_person_ids as string[] | null) ?? [],
    audienceGroupKeys: (row.audience_group_keys as AudienceGroupKey[] | null) ?? [],
    excludedPersonIds: (row.excluded_person_ids as string[] | null) ?? [],
    systemTitleOverride: (row.system_title_override as string | null) ?? null,
    systemBodyOverride: (row.system_body_override as string | null) ?? null,
    systemAudienceMode: (row.system_audience_mode as "all_eligible" | "selected" | "groups" | null) ?? "all_eligible",
    systemTargetPersonIds: (row.system_target_person_ids as string[] | null) ?? [],
    systemAudienceGroupKeys: (row.system_audience_group_keys as AudienceGroupKey[] | null) ?? [],
    systemExcludedPersonIds: (row.system_excluded_person_ids as string[] | null) ?? [],
    archivedAt: (row.archived_at as string | null) ?? null,
    createdByPersonId: (row.created_by_person_id as string | null) ?? null,
    createdByPersonName: (row.created_by_person_name as string | null) ?? null,
    updatedByPersonId: (row.updated_by_person_id as string | null) ?? null,
    updatedByPersonName: (row.updated_by_person_name as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Every non-archived rule of either kind -- the worker's own once-per-tick load, and the Manager Fixed Notifications Center's default listing. Archived custom rules are deliberately excluded (see `listArchivedCustomWeeklyRules` for the rare case a caller needs them). */
export async function listActiveNotificationRules(): Promise<NotificationRuleRow[]> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_rules")
    .select(NOTIFICATION_RULE_COLUMNS)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(toNotificationRuleRow);
}

export async function getNotificationRuleById(id: string): Promise<NotificationRuleRow | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_rules")
    .select(NOTIFICATION_RULE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toNotificationRuleRow(data as Record<string, unknown>) : null;
}

export interface SystemRuleEdit {
  enabled: boolean;
  localHour: number;
  localMinute: number;
  /** `null` = clear the override, use the built-in title unchanged. */
  titleOverride: string | null;
  /** `null` = clear the override, use the built-in body unchanged. Server-side callers must already have validated the `{details}` placeholder requirement for a dynamic-body category before reaching here -- this function does not re-derive that classification. */
  bodyOverride: string | null;
  audienceMode: "all_eligible" | "selected" | "groups";
  /** Stable roster person ids -- meaningful only when `audienceMode === 'selected'`; callers must already have revalidated these against a fresh roster (`ruleActions.ts`) before reaching here. */
  targetPersonIds: readonly string[];
  /** Dynamic audience group keys -- meaningful only when `audienceMode === 'groups'`; callers must already have validated these against the canonical `AudienceGroupKey` enum (`ruleActions.ts`). */
  audienceGroupKeys?: readonly AudienceGroupKey[];
  /** "לא לשלוח ל" -- ALWAYS applied, independent of `audienceMode`; callers must already have revalidated these against a fresh roster, same as `targetPersonIds`. */
  excludedPersonIds?: readonly string[];
  /**
   * The `revision` this edit's caller loaded the rule at (`SystemRuleView.revision`)
   * -- the OPTIMISTIC CONCURRENCY TOKEN for the Manager's OWN write path
   * (a separate concern from the worker-side `SystemRuleConfig.revision`
   * guard `upsertPendingSystemReminderJob`/`cancelPendingSystemReminderJob`
   * already enforce). The RPC only applies this edit when the row's
   * CURRENT revision still equals this value -- otherwise a stale Manager
   * page (or a quick enable/disable toggle firing after someone else's
   * concurrent edit) could silently overwrite a newer edit with its own
   * stale copy/audience/time, a classic lost-update race. See the RPC's
   * own migration doc comment for the full race and lock ordering.
   */
  expectedRevision: number;
  updatedByPersonId: string;
  updatedByPersonName: string;
}

export type UpdateSystemRuleOutcome =
  | { status: "ok"; rule: NotificationRuleRow }
  | { status: "conflict" }
  | { status: "not_found" };

/**
 * The ONLY write path for a system rule -- via the enhanced
 * `update_system_rule_configuration_and_invalidate_pending_jobs` RPC
 * (added by the editable-copy/audience-filtering follow-up migration),
 * guarded to `kind = 'system'` at the SQL level (defense in depth on top
 * of the migration's own identity-protection trigger, which additionally
 * forbids `kind`/`system_key` from ever appearing in the SET list here
 * in the first place).
 *
 * Deliberately an RPC, not a plain `.update()`: the rule update and
 * invalidating that category's still-`pending` (never-claimed)
 * `notification_jobs` rows must happen in ONE atomic transaction --
 * otherwise a disable/time/copy/audience edit could commit while an
 * already-materialized pending job (system reminders are upserted ahead
 * of their own send time) is still deliverable, under the OLD
 * configuration, for up to the next reminder-worker tick. See the RPC's
 * own migration doc comment for why this is a hard delete rather than a
 * soft cancel, and for the documented (bounded, safe) rematerialization
 * delay this leaves for `reminders.ts`'s next tick.
 *
 * ALSO increments `revision` in this SAME transaction, for EVERY field
 * this function can change (not just enabled/time) -- the second half of
 * the guard `upsertPendingSystemReminderJob`/`cancelPendingSystemReminderJob`
 * check. Hard-deleting this rule's pending jobs closes the window for an
 * ALREADY-materialized job; incrementing `revision` closes the SEPARATE
 * window for a worker that loaded this rule's config before this edit,
 * but only attempts to (re)materialize/cancel a job for it AFTER this
 * edit commits -- see those functions' own docstrings for the full race
 * and the migration for the SQL-level lock ordering.
 *
 * The RPC returns ZERO rows both when the id doesn't exist/isn't a
 * system row AND when `edit.expectedRevision` is stale (the row moved on
 * under a concurrent edit) -- at the SQL level these are indistinguishable
 * from a single atomic statement on purpose (see the RPC's own doc
 * comment). This function distinguishes them for the caller with a
 * best-effort follow-up plain read: if the row still exists as a system
 * rule, the zero-rows result must have been the revision check failing,
 * so `"conflict"`; otherwise `"not_found"`. This follow-up read is NOT
 * part of the same transaction (a purely informational lookup for a
 * user-facing error message), but that's fine -- the RPC's own atomic
 * revision check already fully protects the actual write; this can only
 * ever affect which error STRING a caller sees, never whether a lost
 * update can occur.
 *
 * The PR #93 predecessor RPC (`update_system_rule_and_invalidate_pending_jobs`,
 * enabled/time only, no revision check on the Manager's own write path)
 * remains defined in the database, untouched, for rollout compatibility
 * with an already-deployed old app instance -- this function never calls it.
 *
 * Calls `update_system_rule_configuration_and_invalidate_pending_jobs_v2`
 * (the dynamic audience groups/exclusions follow-up migration) rather than
 * its `_v2`-less predecessor -- same rollout-safety reasoning: the
 * predecessor remains defined, untouched, in the database for an
 * already-deployed old app instance mid-rollout; this function never calls
 * it once the new columns exist.
 */
export async function updateSystemRule(id: string, edit: SystemRuleEdit): Promise<UpdateSystemRuleOutcome> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase.rpc("update_system_rule_configuration_and_invalidate_pending_jobs_v2", {
    p_rule_id: id,
    p_expected_revision: edit.expectedRevision,
    p_enabled: edit.enabled,
    p_local_hour: edit.localHour,
    p_local_minute: edit.localMinute,
    p_title_override: edit.titleOverride,
    p_body_override: edit.bodyOverride,
    p_audience_mode: edit.audienceMode,
    p_target_person_ids: edit.targetPersonIds,
    p_audience_group_keys: edit.audienceGroupKeys ?? [],
    p_excluded_person_ids: edit.excludedPersonIds ?? [],
    p_updated_by_person_id: edit.updatedByPersonId,
    p_updated_by_person_name: edit.updatedByPersonName,
  });
  if (error) throw error;
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length > 0) return { status: "ok", rule: toNotificationRuleRow(rows[0]) };

  const existing = await getNotificationRuleById(id);
  if (existing && existing.kind === "system") return { status: "conflict" };
  return { status: "not_found" };
}

export interface NewCustomWeeklyRule {
  weekday: number;
  localHour: number;
  localMinute: number;
  title: string;
  body: string;
  audienceKind: BroadcastAudienceKind;
  targetPersonIds: readonly string[];
  audienceGroupKeys?: readonly AudienceGroupKey[];
  excludedPersonIds?: readonly string[];
  createdByPersonId: string;
  createdByPersonName: string;
}

export async function insertCustomWeeklyRule(rule: NewCustomWeeklyRule): Promise<NotificationRuleRow> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_rules")
    .insert({
      kind: "custom_weekly",
      enabled: true,
      weekday: rule.weekday,
      local_hour: rule.localHour,
      local_minute: rule.localMinute,
      title: rule.title,
      body: rule.body,
      audience_kind: rule.audienceKind,
      target_person_ids: rule.targetPersonIds,
      audience_group_keys: rule.audienceGroupKeys ?? [],
      excluded_person_ids: rule.excludedPersonIds ?? [],
      created_by_person_id: rule.createdByPersonId,
      created_by_person_name: rule.createdByPersonName,
    })
    .select(NOTIFICATION_RULE_COLUMNS)
    .single();
  if (error) throw error;
  return toNotificationRuleRow(data as Record<string, unknown>);
}

export interface CustomWeeklyRuleEdit {
  weekday: number;
  localHour: number;
  localMinute: number;
  title: string;
  body: string;
  audienceKind: BroadcastAudienceKind;
  targetPersonIds: readonly string[];
  audienceGroupKeys?: readonly AudienceGroupKey[];
  excludedPersonIds?: readonly string[];
  updatedByPersonId: string;
  updatedByPersonName: string;
}

/** Guarded to `kind = 'custom_weekly'` and not archived -- an archived rule must be un-archived (there is none in V1; archive is terminal) rather than silently edited back to life. `null` means not found / not a still-active custom rule. */
export async function updateCustomWeeklyRule(id: string, edit: CustomWeeklyRuleEdit): Promise<NotificationRuleRow | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_rules")
    .update({
      weekday: edit.weekday,
      local_hour: edit.localHour,
      local_minute: edit.localMinute,
      title: edit.title,
      body: edit.body,
      audience_kind: edit.audienceKind,
      target_person_ids: edit.targetPersonIds,
      audience_group_keys: edit.audienceGroupKeys ?? [],
      excluded_person_ids: edit.excludedPersonIds ?? [],
      updated_by_person_id: edit.updatedByPersonId,
      updated_by_person_name: edit.updatedByPersonName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("kind", "custom_weekly")
    .is("archived_at", null)
    .select(NOTIFICATION_RULE_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? toNotificationRuleRow(data as Record<string, unknown>) : null;
}

/** Toggles a still-active custom rule's `enabled` flag -- same guard shape as `updateCustomWeeklyRule`. */
export async function setCustomWeeklyRuleEnabled(
  id: string,
  enabled: boolean,
  updatedByPersonId: string,
  updatedByPersonName: string,
): Promise<NotificationRuleRow | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_rules")
    .update({
      enabled,
      updated_by_person_id: updatedByPersonId,
      updated_by_person_name: updatedByPersonName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("kind", "custom_weekly")
    .is("archived_at", null)
    .select(NOTIFICATION_RULE_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? toNotificationRuleRow(data as Record<string, unknown>) : null;
}

/** Terminal -- an archived custom rule never appears in `listActiveNotificationRules` / worker dispatch again, but its row (and every `notification_jobs`/`manager_notification_batches` row it ever produced) is never deleted. There is no un-archive path in V1 (matches the spec's "archive/delete safely" scope -- a genuine hard-delete-and-recreate is always available to a manager who wants a fresh rule). */
export async function archiveCustomWeeklyRule(
  id: string,
  updatedByPersonId: string,
  updatedByPersonName: string,
): Promise<NotificationRuleRow | null> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase
    .from("notification_rules")
    .update({
      archived_at: new Date().toISOString(),
      updated_by_person_id: updatedByPersonId,
      updated_by_person_name: updatedByPersonName,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("kind", "custom_weekly")
    .is("archived_at", null)
    .select(NOTIFICATION_RULE_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? toNotificationRuleRow(data as Record<string, unknown>) : null;
}

/** Read-only count of scheduled broadcasts already due -- dry-run mode's estimate; never claims/mutates, mirroring `peekDueJobsCount`. */
export async function peekDueManagerScheduledBroadcastsCount(): Promise<number> {
  const supabase = getNotificationServiceClient();
  const { count, error } = await supabase
    .from("manager_scheduled_broadcasts")
    .select("id", { count: "exact", head: true })
    .eq("status", "scheduled")
    .lte("scheduled_for", new Date().toISOString());
  if (error) throw error;
  return count ?? 0;
}

/**
 * The dedicated once-a-minute scheduled worker's cheap "is there any work
 * at all" pre-check -- unlike `peekDueManagerScheduledBroadcastsCount`
 * above (a `'scheduled'`-only display estimate), this calls
 * `peek_due_manager_scheduled_broadcasts`, the SQL function that mirrors
 * `claim_due_manager_scheduled_broadcasts`'s exact two-way, lease-only
 * eligibility (due-scheduled, or claimed with an expired 90-second lease
 * -- `batch_id`'s presence never bypasses the lease, see
 * `20260821100000_speed_up_manager_scheduled_broadcast_claim.sql`).
 * Missing a recoverable claimed row here would mean a crashed dispatch is
 * never resumed until some later, unrelated broadcast happens to come due.
 * Read-only -- never claims/mutates.
 */
export async function peekAnyManagerScheduledBroadcastWorkDue(): Promise<number> {
  const supabase = getNotificationServiceClient();
  const { data, error } = await supabase.rpc("peek_due_manager_scheduled_broadcasts");
  if (error) throw error;
  return (data as number | null) ?? 0;
}
