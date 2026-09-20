import "server-only";
import type { Person } from "@/lib/domain/types";
import { resolveAudienceGroupMembers, type AudienceGroupKey } from "@/lib/domain/audienceGroups";
import { dayOfWeek, parseCalendarDate } from "@/lib/domain/dutyBlocks";
import type { LocalNow } from "@/lib/domain/localNow";
import { fetchAllSubscribedUserIds, fetchAllUserIdsByEmail, resolvePersonIdentity, type AuthAccountLookup } from "./recipients";
import type { CustomWeeklyRuleConfig } from "./ruleConfig";
import {
  claimNotificationRuleOccurrence,
  completeNotificationRuleOccurrence,
  getManagerNotificationBatchById,
  insertManagerNotificationBatchIfAbsent,
  insertNotificationJobIfAbsent,
  listCompletedNotificationRuleOccurrenceKeys,
  listRecoverableNotificationRuleOccurrences,
  setNotificationRuleOccurrenceBatchId,
  type BroadcastAudienceKind,
} from "./store";
import { formatWorkerErrorLog, sanitizeWorkerError } from "./workerErrors";

/**
 * Manager-created weekly recurring notifications ("📌 תזכורת לאילוצים
 * every Saturday 21:00", ...) -- V1 custom rules (`notification_rules.kind
 * = 'custom_weekly'`). Dispatched by the SAME once-a-minute worker that
 * already dispatches one-time scheduled broadcasts (`scheduledWorker.ts`),
 * never a second cron, and through the EXACT SAME manager broadcast/batch/
 * job pipeline `manualBroadcast.ts`/`scheduledBroadcast.ts` already use --
 * this module adds occurrence RESOLUTION/CLAIMING only, never a second
 * Push sender.
 *
 * At-most-once dispatch is owned by `notification_rule_occurrences`/
 * `claim_notification_rule_occurrence` (see the migration's own doc
 * comment) -- deliberately NOT "does a `manager_notification_batches` row
 * for this occurrence already exist", because batch creation and
 * per-recipient `notification_jobs` creation are two separate writes; a
 * crash between them would otherwise leave a half-dispatched occurrence
 * that looks indistinguishable from a genuinely completed one, silently
 * losing the missing recipients' notifications forever. The claim row's
 * own `status = 'completed'` is the ONE terminal-completion signal, set
 * only after every intended recipient's job has been created
 * successfully; a crash before that leaves the claim row `'claimed'`,
 * recoverable by a later tick once its lease goes stale.
 *
 * Editing a rule's time/title/body before its occurrence is CLAIMED
 * simply changes what the next due-check/claim sees (there is no
 * pre-materialized job the way system reminders have) -- nothing to
 * reconcile. Disabling/archiving before claim is honored atomically by
 * the claim RPC itself (it locks the rule row before ever claiming).
 * Once legitimately claimed, an occurrence finishes idempotently using
 * the rule content FROZEN AT CLAIM TIME, regardless of what changes on
 * the rule afterward -- see `claimNotificationRuleOccurrence`'s own
 * return shape.
 */

/** The stable category every recurring-rule occurrence's `notification_jobs` row carries -- reuses the existing worker/inbox/Push pipeline, deliberately DISTINCT from `manager_broadcast` (immediate/scheduled sends) so the two remain independently identifiable, and deliberately excluded from the "נשלחו לאחרונה" recent-broadcasts list (see `store.ts`'s `listRecentManagerNotificationBatches`). */
export const RECURRING_BROADCAST_CATEGORY = "manager_recurring_broadcast";

function recurringOccurrenceIdempotencyKey(ruleId: string, occurrenceDate: string): string {
  return `recurring:${ruleId}:${occurrenceDate}`;
}

export interface DueCustomWeeklyOccurrence {
  ruleId: string;
  /** Asia/Jerusalem local calendar date this occurrence belongs to -- for a freshly-due candidate always `now.date` (an occurrence is only ever freshly considered on its own weekday); for a RECOVERED candidate, whatever date its stale claim was made under. */
  occurrenceDate: string;
}

function occurrenceKey(occurrence: DueCustomWeeklyOccurrence): string {
  return `${occurrence.ruleId}:${occurrence.occurrenceDate}`;
}

/**
 * Which occurrences are worth attempting a claim for on this tick --
 * the union of two independent sources, deliberately merged rather than
 * either one alone:
 *
 *  - FRESH candidates: `rules` whose CURRENT enabled/weekday/local-time
 *    configuration is due as of `now`. Pure in-memory computation over the
 *    already-loaded `rules`/`now`, no I/O.
 *  - RECOVERABLE candidates: any occurrence still sitting `'claimed'`
 *    with a stale lease (`listRecoverableNotificationRuleOccurrences`),
 *    regardless of what its rule's CURRENT weekday/enabled/archived state
 *    is. A worker can crash between claiming an occurrence and completing
 *    it; if that occurrence's rule was disabled, archived, or had its
 *    schedule moved off today's weekday in the meantime, it would never
 *    again appear as a fresh candidate -- the recoverable-claims scan is
 *    what still finds it and lets the claim RPC's own resume path finish
 *    the already-committed dispatch from its frozen snapshot.
 *
 * Both sources are then bulk-filtered by the ONE cheap pre-filter: keys
 * already known `'completed'` are dropped so a quiet rest-of-day doesn't
 * keep forcing a personnel read every tick. This is a PRE-FILTER ONLY,
 * never the actual completion/claim authority -- the real at-most-once
 * guarantee is `claim_notification_rule_occurrence`'s own atomic claim,
 * which every returned candidate still has to win before anything is
 * dispatched (see `runDueCustomWeeklyRuleDispatch`).
 */
export async function findDueCustomWeeklyOccurrences(
  rules: readonly CustomWeeklyRuleConfig[],
  now: LocalNow,
): Promise<DueCustomWeeklyOccurrence[]> {
  const today = parseCalendarDate(now.date);
  const todayWeekday = today ? dayOfWeek(today) : null;

  const freshCandidates: DueCustomWeeklyOccurrence[] = [];
  if (todayWeekday !== null) {
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (rule.weekday !== todayWeekday) continue;
      const dueMinuteOfDay = rule.localHour * 60 + rule.localMinute;
      if (now.minuteOfDay < dueMinuteOfDay) continue;
      freshCandidates.push({ ruleId: rule.id, occurrenceDate: now.date });
    }
  }

  const recoverableCandidates = await listRecoverableNotificationRuleOccurrences();

  const merged = new Map<string, DueCustomWeeklyOccurrence>();
  for (const candidate of freshCandidates) merged.set(occurrenceKey(candidate), candidate);
  for (const candidate of recoverableCandidates) merged.set(occurrenceKey(candidate), candidate);
  const allCandidates = [...merged.values()];
  if (allCandidates.length === 0) return [];

  const completed = await listCompletedNotificationRuleOccurrenceKeys(allCandidates);
  return allCandidates.filter((candidate) => !completed.has(occurrenceKey(candidate)));
}

interface RecurringDispatchResolution {
  pushCapable: { personId: string; userId: string }[];
  inboxOnly: { personId: string; userId: string }[];
  candidateCount: number;
}

/**
 * DISPATCH-time audience resolution -- deliberately NOT `manualBroadcast.ts`'s
 * `resolveAudience` (a fresh manager compose request's fail-closed "any
 * unknown id fails the WHOLE request" rule). A recurring rule is
 * long-lived, so:
 *
 *  - `"everyone"` is resolved against the CURRENT roster on every single
 *    occurrence, never frozen at rule-creation time (unlike a one-time
 *    scheduled broadcast's snapshot -- spec: "do not copy one-time
 *    snapshot semantics blindly").
 *  - `"groups"` is resolved the SAME way -- `groupKeys` is the manager's
 *    own selection, frozen at claim time, but which roster MEMBERS
 *    currently match those keys is resolved fresh via the shared
 *    `resolveAudienceGroupMembers` on every occurrence too (spec: "groups
 *    dynamically reflect roster changes at send time"). Never a frozen
 *    list of person ids.
 *  - `"person"`/`"people"` re-validates the rule's OWN stored
 *    `targetPersonIds` against the current roster + current auth mapping
 *    on every occurrence. A person no longer in the roster, or not
 *    (yet/anymore) auth-mapped, is skipped TRUTHFULLY for that one
 *    occurrence -- never a reason to fail the whole send, and never a
 *    door for a client-supplied id to sneak in (this only ever reads the
 *    rule's own server-validated stored ids, never anything request-
 *    scoped).
 *
 * `excludedPersonIds` ("לא לשלוח ל", also frozen at claim time) is applied
 * on top of whichever branch above selected the base candidates, on every
 * occurrence -- independent of `audienceKind`, and always wins.
 */
function resolveRecurringDispatchTargets(
  audienceKind: BroadcastAudienceKind,
  targetPersonIds: readonly string[],
  groupKeys: readonly AudienceGroupKey[],
  excludedPersonIds: readonly string[],
  people: readonly Person[],
  emailToAccount: ReadonlyMap<string, AuthAccountLookup>,
  subscribed: ReadonlySet<string>,
): RecurringDispatchResolution {
  const excludedSet = new Set(excludedPersonIds);

  let candidatePersons: readonly Person[];
  let candidateCount: number;

  if (audienceKind === "everyone") {
    candidatePersons = people.filter((person) => !excludedSet.has(person.id));
    candidateCount = candidatePersons.length;
  } else if (audienceKind === "groups") {
    candidatePersons = resolveAudienceGroupMembers(people, groupKeys).filter((person) => !excludedSet.has(person.id));
    candidateCount = candidatePersons.length;
  } else {
    // Preserves the ORIGINAL "person"/"people" unresolvedCount semantics:
    // a no-longer-in-roster targeted person still counts toward
    // `candidateCount` (a real, truthful "unresolved" case worth
    // surfacing), while an EXCLUDED id is removed from the count entirely
    // -- exclusion is a deliberate choice, never a resolution failure.
    const nonExcludedTargetIds = targetPersonIds.filter((personId) => !excludedSet.has(personId));
    candidateCount = nonExcludedTargetIds.length;
    const byId = new Map(people.map((person) => [person.id, person]));
    candidatePersons = nonExcludedTargetIds
      .map((personId) => byId.get(personId))
      .filter((person): person is Person => person !== undefined); // no longer in the roster -- skipped truthfully, never fails the occurrence
  }

  const pushCapable: { personId: string; userId: string }[] = [];
  const inboxOnly: { personId: string; userId: string }[] = [];

  for (const person of candidatePersons) {
    const identity = resolvePersonIdentity(person, people, emailToAccount);
    if (identity.status !== "mapped") continue;

    if (subscribed.has(identity.userId)) pushCapable.push({ personId: person.id, userId: identity.userId });
    else inboxOnly.push({ personId: person.id, userId: identity.userId });
  }

  return { pushCapable, inboxOnly, candidateCount };
}

/**
 * Dispatches ONE occurrence, fully claim-guarded:
 *
 * 1. Atomically claim (or safely resume) the occurrence via
 *    `claimNotificationRuleOccurrence`. `null` means another worker owns
 *    it right now, it's already completed, or the rule was disabled/
 *    archived/gone at the claim instant -- nothing further to do.
 * 2. If resuming with an already-checkpointed `batchId`: reuse that
 *    batch's own FROZEN recipient set/copy, never re-resolve (a crash
 *    after the batch existed must never silently change who it's for).
 *    Otherwise resolve the audience fresh (against `people`, the
 *    caller's own current roster) and create/find the batch via the
 *    SAME idempotent `insertManagerNotificationBatchIfAbsent`
 *    `manualBroadcast.ts`/`scheduledBroadcast.ts` already use, then
 *    checkpoint `batch_id` immediately -- a crash from this point on
 *    only ever needs to retry idempotent job creation, never re-decide
 *    whether a batch should exist.
 * 3. Create every recipient's `notification_jobs` row via the SAME
 *    idempotent `insertNotificationJobIfAbsent` every other category
 *    uses -- safe to re-attempt for already-created rows (a resumed
 *    occurrence re-creates the full recipient list; already-existing
 *    dedupe keys are harmless no-ops, only the genuinely missing ones
 *    actually insert).
 * 4. ONLY once every job creation call has resolved without throwing is
 *    the occurrence marked `'completed'` -- the one terminal signal a
 *    later tick's `findDueCustomWeeklyOccurrences` pre-filter and the
 *    claim RPC itself both honor.
 */
async function dispatchOneOccurrence(
  occurrence: DueCustomWeeklyOccurrence,
  people: readonly Person[],
  emailToAccount: ReadonlyMap<string, AuthAccountLookup>,
  subscribed: ReadonlySet<string>,
): Promise<"dispatched" | "skipped"> {
  const claim = await claimNotificationRuleOccurrence(occurrence.ruleId, occurrence.occurrenceDate);
  if (!claim) return "skipped";

  let batchId = claim.batchId;
  let resolvedRecipientUserIds: readonly string[];
  let title: string;
  let body: string;

  if (batchId) {
    const existingBatch = await getManagerNotificationBatchById(batchId);
    if (!existingBatch) {
      throw new Error(`notification_rule_occurrences ${claim.occurrenceId} references missing batch ${batchId}`);
    }
    resolvedRecipientUserIds = existingBatch.resolvedRecipientUserIds;
    title = existingBatch.title;
    body = existingBatch.body;
  } else {
    const resolution = resolveRecurringDispatchTargets(
      claim.ruleAudienceKind,
      claim.ruleTargetPersonIds,
      claim.ruleAudienceGroupKeys,
      claim.ruleExcludedPersonIds,
      people,
      emailToAccount,
      subscribed,
    );
    const freshRecipientUserIds = [
      ...new Set([...resolution.pushCapable, ...resolution.inboxOnly].map((recipient) => recipient.userId)),
    ].sort();

    const { row: batch } = await insertManagerNotificationBatchIfAbsent({
      idempotencyKey: recurringOccurrenceIdempotencyKey(occurrence.ruleId, occurrence.occurrenceDate),
      createdByPersonId: claim.createdByPersonId ?? "system",
      createdByPersonName: claim.createdByPersonName ?? "התראה מחזורית",
      audienceKind: claim.ruleAudienceKind,
      targetPersonIds: claim.ruleTargetPersonIds,
      audienceGroupKeys: claim.ruleAudienceGroupKeys,
      excludedPersonIds: claim.ruleExcludedPersonIds,
      resolvedRecipientUserIds: freshRecipientUserIds,
      title: claim.ruleTitle,
      body: claim.ruleBody,
      resolvedRecipientCount: freshRecipientUserIds.length,
      pushCapableCount: resolution.pushCapable.length,
      inboxOnlyCount: resolution.inboxOnly.length,
      unresolvedCount: Math.max(0, resolution.candidateCount - freshRecipientUserIds.length),
    });
    // Even when the idempotency key already existed (a crash-recovered
    // resume that got this far before, or in principle a race the claim
    // itself already prevents) -- reuse the STORED batch, never this
    // call's own possibly-different resolution.
    resolvedRecipientUserIds = batch.resolvedRecipientUserIds;
    title = batch.title;
    body = batch.body;
    batchId = batch.id;

    await setNotificationRuleOccurrenceBatchId(claim.occurrenceId, batchId);
  }

  const scheduledFor = new Date().toISOString();
  await Promise.all(
    resolvedRecipientUserIds.map((recipientUserId) =>
      insertNotificationJobIfAbsent({
        category: RECURRING_BROADCAST_CATEGORY,
        recipientUserId,
        title,
        body,
        path: "/",
        dedupeKey: `recurring:${batchId}:${recipientUserId}`,
        scheduledFor,
        sourceRef: `recurring:${batchId}`,
      }),
    ),
  );

  await completeNotificationRuleOccurrence(claim.occurrenceId);
  return "dispatched";
}

export interface RecurringRuleDispatchSummary {
  dispatched: number;
  failed: number;
}

/**
 * Dispatches every already-`findDueCustomWeeklyOccurrences`-filtered
 * candidate, with `people` the caller's OWN already-fetched fresh
 * personnel read (never a second Google/workbook read here). Each
 * candidate independently claims (or is safely skipped) and is
 * independently caught -- one failed/skipped occurrence never blocks the
 * rest.
 */
export async function runDueCustomWeeklyRuleDispatch(
  due: readonly DueCustomWeeklyOccurrence[],
  people: readonly Person[],
): Promise<RecurringRuleDispatchSummary> {
  if (due.length === 0) return { dispatched: 0, failed: 0 };

  const [emailToAccount, subscribedUserIds] = await Promise.all([fetchAllUserIdsByEmail(), fetchAllSubscribedUserIds()]);
  const subscribed = new Set(subscribedUserIds);

  let dispatched = 0;
  let failed = 0;
  for (const occurrence of due) {
    try {
      const outcome = await dispatchOneOccurrence(occurrence, people, emailToAccount, subscribed);
      if (outcome === "dispatched") dispatched++;
    } catch (error) {
      failed++;
      // Routed through the SAME PII-safe sanitizer every other worker
      // failure log already uses (`workerErrors.ts`) -- this used to log
      // `error.message` directly, the one remaining spot in the
      // notification engine that bypassed it. `rule=`/`date=` are safe,
      // non-personal context appended after the sanitized representation,
      // never part of what gets redacted.
      console.error(
        `${formatWorkerErrorLog("recurring_rules", sanitizeWorkerError(error))} rule=${occurrence.ruleId} date=${occurrence.occurrenceDate}`,
      );
    }
  }

  return { dispatched, failed };
}
