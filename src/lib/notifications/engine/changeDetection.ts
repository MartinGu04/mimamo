import "server-only";
import type { Event } from "@/lib/domain/event";
import type { EmergencyAssignment } from "@/lib/domain/emergencyShift";
import type { Person } from "@/lib/domain/types";
import type { ShiftSchedule } from "@/lib/domain/shiftSchedule";
import type { OperationalWeek } from "@/lib/domain/operationalWeek";
import { computeEmergencySemanticFacts, computeSemanticFacts } from "./semanticFacts";
import { diffSemanticFacts, type FactChange } from "./diffFacts";
import { buildSettledChangeCopy } from "./copy";
import { filterManagerRecipients, type RecipientResolution, type ResolvedRecipient } from "./recipients";
import type { CoverageFactValue } from "./semanticFacts";
import {
  advanceNotificationBaseline,
  applyPendingChanges,
  claimDuePendingChanges,
  claimNotificationBaselineReseed,
  clearWeekState,
  countOpenPendingChanges,
  deletePendingChange,
  getObservedFacts,
  insertNotificationJobIfAbsent,
  peekBaselineState,
  peekDuePendingChangesCount,
  quarantineNotificationFloodJobs,
  seedObservedFacts,
  setObservedFact,
} from "./store";
import { NOTIFICATION_FLOOD_INCIDENT, requiresNotificationFloodRecovery } from "./notificationFloodRecovery";

export interface ChangeDetectionSummary {
  currentWeek: string;
  baselineAction: "initialized" | "rolled_over" | "unchanged";
  semanticChangesDetected: number;
  pendingChangesOpen: number;
  settledChanges: number;
  jobsCreated: number;
}

export interface ChangeDetectionInput {
  events: readonly Event[];
  people: readonly Person[];
  shiftSchedule: ShiftSchedule;
  week: OperationalWeek;
  persist: boolean;
  recipientResolution: RecipientResolution;
  personNameById: ReadonlyMap<string, string>;
  /**
   * Emergency Mode's own desk assignments (spec section 23) -- consulted
   * ONLY when `operationalMode.kind === "emergency"`, in place of
   * `events`, to compute "emergency_shift"/"emergency_team" facts
   * instead of the regular "shift"/"team"/"duty"/"coverage" ones. Empty/
   * ignored in regular mode. Defaults to `[]` -- a safe no-op for any
   * existing caller/test that predates this field.
   */
  emergencyAssignments?: readonly EmergencyAssignment[];
  /** Defaults to `"regular"` -- byte-for-byte unchanged behavior for any existing caller/test that predates this field. Used ONLY to pick which facts to compute below (regular vs. emergency source) -- never the transition safety check, which needs the finer-grained generation identity below. */
  operationalMode?: "regular" | "emergency";
  /**
   * `true` exactly on the tick where the operational GENERATION just
   * changed (spec section 22) -- Emergency Mode was entered, was exited,
   * OR one Emergency Mode session was swapped for a different one
   * (period A deactivated, a later unrelated period B activated, with no
   * intervening regular-mode tick observed in between). Forces the SAME
   * silent "clear + reseed, no diff, no notify" treatment week-rollover
   * already gets, so no generation transition ever floods change
   * notifications for facts that were never meant to be diffed against
   * each other (every regular fact "vanishing" on entry, "reappearing" on
   * exit, or one emergency session's desk assignments diffed against a
   * DIFFERENT session's stale observed facts, would otherwise look like a
   * mass settled change). Computed by `pipeline.ts` from
   * `resolveOperationalGeneration` (`operationalGeneration.ts`), never
   * from bare `operationalMode`/`kind` comparison alone -- see that
   * module's own docs for why kind alone is unsafe. Defaults to `false`.
   */
  operationalGenerationTransitioned?: boolean;
}

const CATEGORY_TO_JOB_CATEGORY: Record<string, string> = {
  shift: "shift_change",
  team: "team_change",
  duty: "duty_change",
  coverage: "coverage_gap",
  emergency_shift: "emergency_shift_change",
  emergency_team: "emergency_team_change",
};

const SILENT_SUMMARY_BASE = {
  semanticChangesDetected: 0,
  pendingChangesOpen: 0,
  settledChanges: 0,
  jobsCreated: 0,
} as const;

/**
 * Phases 3-8 of the worker pipeline (PR #30 spec section 23): resolve the
 * current operational week, silently initialize/roll the baseline (spec
 * section 9), normalize current-week state into semantic facts (section
 * 10), diff against the last settled truth, and apply/settle the
 * 10-minute quiet-period debounce (section 11). In `persist: false`
 * (dry-run) mode, every WRITE is skipped -- this function only ever reads
 * existing state and computes what a real tick would do, never mutating
 * baseline/observed/pending state and never creating a job.
 */
export async function runChangeDetection(input: ChangeDetectionInput): Promise<ChangeDetectionSummary> {
  const {
    week,
    persist,
    operationalMode = "regular",
    operationalGenerationTransitioned = false,
    emergencyAssignments = [],
  } = input;

  // Spec section 23 -- while Emergency Mode is active, regular shift/
  // team/duty/coverage facts are never computed at all (regular
  // operations are suspended); "emergency_shift"/"emergency_team" facts
  // are computed from desk assignments instead. Both share the exact
  // SAME diff/debounce/settle machinery below, which operates on the
  // generic `Map<string, SemanticFact>` shape regardless of source.
  const freshFacts =
    operationalMode === "emergency"
      ? computeEmergencySemanticFacts(emergencyAssignments.filter((assignment) => week.dates.includes(assignment.date)))
      : computeSemanticFacts(
          input.events.filter((event) => week.dates.includes(event.date)),
          input.shiftSchedule,
          week,
        );

  const transition = await resolveBaselineTransition(week.weekStart);
  const {
    action: rawBaselineAction,
    previousWeekStart: rawPreviousWeekStart,
    incidentRecovery,
    baselineState,
  } = transition;

  // A generation transition forces the SAME silent treatment as a week
  // rollover (see `ChangeDetectionInput.operationalGenerationTransitioned`'s
  // own docs) -- but the state to clear is THIS week's own (still
  // current) observed/pending rows, never a different week's.
  const baselineAction =
    operationalGenerationTransitioned && rawBaselineAction === "unchanged" ? "rolled_over" : rawBaselineAction;
  const previousWeekStart = rawBaselineAction === "rolled_over" ? rawPreviousWeekStart : week.weekStart;

  if (baselineAction === "initialized") {
    if (persist) {
      const claimed = await claimNotificationBaselineReseed(baselineState);
      if (!claimed) return { currentWeek: week.weekStart, baselineAction, ...SILENT_SUMMARY_BASE };
      // Commit the marker LAST. If seeding times out or throws, the next
      // invocation still sees an uninitialized baseline and retries this
      // silent path instead of diffing an empty/partial seed as real changes.
      await seedObservedFacts(week.weekStart, freshFacts);
      await advanceNotificationBaseline(week.weekStart);
    }
    return { currentWeek: week.weekStart, baselineAction, ...SILENT_SUMMARY_BASE };
  }

  if (baselineAction === "rolled_over") {
    if (persist) {
      const claimed = await claimNotificationBaselineReseed(baselineState);
      if (!claimed) return { currentWeek: week.weekStart, baselineAction, ...SILENT_SUMMARY_BASE };
      // The previous week's (or, on a mode transition, THIS week's own
      // pre-transition) stale state must never leak into the new diff
      // base, and must never itself generate change notifications just
      // because the week rolled over or the operational generation changed
      // (spec section 9/22).
      if (incidentRecovery) {
        await quarantineNotificationFloodJobs(
          NOTIFICATION_FLOOD_INCIDENT.jobsCreatedFrom,
          NOTIFICATION_FLOOD_INCIDENT.jobsCreatedThrough,
        );
      }
      if (previousWeekStart) await clearWeekState(previousWeekStart);
      await seedObservedFacts(week.weekStart, freshFacts);
      // As above, advance the week marker only after the new seed is
      // complete. A crash before this call leaves initialized=false, so the
      // next worker retries silently rather than emitting a flood.
      await advanceNotificationBaseline(week.weekStart);
    }
    return { currentWeek: week.weekStart, baselineAction, ...SILENT_SUMMARY_BASE };
  }

  // "unchanged" -- the ordinary diff/debounce/settle flow.
  const observedFacts = await getObservedFacts(week.weekStart);
  const changes = diffSemanticFacts(observedFacts, freshFacts);

  if (persist) {
    await applyPendingChanges(week.weekStart, changes, freshFacts);
  }

  let settledChanges = 0;
  let jobsCreated = 0;

  if (persist) {
    const claimed = await claimDuePendingChanges();
    for (const pending of claimed) {
      settledChanges++;
      const change: FactChange = {
        factKey: pending.factKey,
        category: pending.category,
        oldValue: pending.originalValue,
        newValue: pending.latestValue,
      };
      jobsCreated += await settleOneChange(week.weekStart, pending.id, change, input);
    }
  } else {
    settledChanges = await peekDuePendingChangesCount(week.weekStart);
  }

  const pendingChangesOpen = await countOpenPendingChanges(week.weekStart);

  return {
    currentWeek: week.weekStart,
    baselineAction,
    semanticChangesDetected: changes.length,
    pendingChangesOpen,
    settledChanges,
    jobsCreated,
  };
}

/**
 * The single read-only decision point for first-run/rollover/unchanged.
 * The durable marker is intentionally advanced only AFTER clear+seed has
 * completed. This ordering is the crash-safety boundary: a timeout while
 * reseeding leaves the previous marker intact and the next invocation retries
 * the silent transition instead of diffing against empty/partial state.
 */
async function resolveBaselineTransition(
  weekStart: string,
): Promise<{
  action: "initialized" | "rolled_over" | "unchanged";
  previousWeekStart: string | null;
  incidentRecovery: boolean;
  baselineState: Awaited<ReturnType<typeof peekBaselineState>>;
}> {
  const state = await peekBaselineState();
  if (state.currentWeekStart !== weekStart) {
    const firstRun = !state.initialized && state.currentWeekStart === null;
    return {
      action: firstRun ? "initialized" : "rolled_over",
      previousWeekStart: state.currentWeekStart,
      incidentRecovery: false,
      baselineState: state,
    };
  }
  // initialized=false with the SAME week means a previous clear/reseed owner
  // crashed after claiming. Clear the current week's partial state and retry
  // the whole silent transition.
  const interruptedReseed = !state.initialized;
  const incidentRecovery = requiresNotificationFloodRecovery(state, weekStart);
  return {
    action: incidentRecovery || interruptedReseed ? "rolled_over" : "unchanged",
    previousWeekStart: state.currentWeekStart,
    incidentRecovery,
    baselineState: state,
  };
}

async function settleOneChange(
  weekStart: string,
  pendingId: string,
  change: FactChange,
  input: ChangeDetectionInput,
): Promise<number> {
  await setObservedFact(weekStart, change.factKey, change.category, change.newValue);
  await deletePendingChange(pendingId);

  if (change.category === "coverage") {
    const oldStatus = (change.oldValue as CoverageFactValue | null)?.status;
    const newStatus = (change.newValue as CoverageFactValue | null)?.status;
    // Only a genuine "valid coverage -> gap" transition is meaningful
    // (spec section 15) -- an unchanged gap, a resolution, or a drift
    // into "not_evaluable" never creates a job.
    if (newStatus !== "missing" || oldStatus === "missing") return 0;
  }

  const copy = buildSettledChangeCopy(change, input.personNameById);
  if (!copy) return 0;

  const recipients: ResolvedRecipient[] =
    change.category === "coverage"
      ? filterManagerRecipients(input.people, input.recipientResolution)
      : resolvePersonRecipient(change.factKey, input.recipientResolution);

  let jobsCreated = 0;
  for (const recipient of recipients) {
    const created = await insertNotificationJobIfAbsent({
      category: CATEGORY_TO_JOB_CATEGORY[change.category] ?? change.category,
      recipientUserId: recipient.userId,
      title: copy.title,
      body: copy.body,
      path: copy.path,
      tag: copy.tag,
      dedupeKey: `settle:${pendingId}:${recipient.userId}`,
      scheduledFor: new Date().toISOString(),
      sourceRef: change.factKey,
    });
    if (created) jobsCreated++;
  }
  return jobsCreated;
}

function resolvePersonRecipient(factKey: string, resolution: RecipientResolution): ResolvedRecipient[] {
  const personId = factKey.split(":")[1];
  const recipient = resolution.resolved.get(personId);
  return recipient ? [recipient] : [];
}
