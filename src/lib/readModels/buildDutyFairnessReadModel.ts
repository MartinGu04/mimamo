import { computeCompletedDutyAllocation, resolveActiveDutyBlock } from "@/lib/domain/dutyAllocationWeight";
import type { Event } from "@/lib/domain/event";
import {
  computeGapToTarget,
  computeNormalizedLoad,
  computeScoreDelta,
  resolveComparisonTarget,
  resolveDutyFairnessStatus,
  resolveFairnessAllocationRole,
  sumDisplayedFairnessRows,
} from "@/lib/domain/fairnessAnalysis";
import { resolveFairnessExemptions } from "@/lib/domain/fairnessExemptions";
import {
  fairnessDataCompleteness,
  FAIRNESS_MODEL_VERSION,
  resolveFairnessPeriodStatus,
  type FairnessDataCompletenessReason,
  type FairnessPeriodStatus,
} from "@/lib/domain/fairnessFoundation";
import {
  fairnessPeriodEndDate,
  fairnessPeriodIdentityLabel,
  fairnessPeriodStartDate,
  type FairnessPeriodIdentity,
} from "@/lib/domain/fairnessPeriod";
import type { FairnessPersonRow, FairnessTableParseResult, FairnessTargets } from "@/lib/domain/fairnessTable";
import { isShiftLeadRoleToken } from "@/lib/domain/shiftLeadRole";
import {
  computePeriodElapsedPercentExcludingDates,
  resolveDutyPaceStatus,
  type DutyPaceStatus,
} from "@/lib/domain/dutyPace";
import type { LocalNow } from "@/lib/domain/localNow";
import type {
  DutyFairnessGroupKey,
  DutyFairnessGroupView,
  DutyFairnessPersonRowView,
  DutyFairnessReadModel,
  DutyFairnessTotalsView,
} from "./dutyFairnessTypes";

export interface BuildDutyFairnessReadModelInput {
  parseResult: FairnessTableParseResult;
  /** Which H1/H2 period AND which year -- see `fairnessPeriod.ts`'s own year-safety docs; this builder never guesses a year from `now`. */
  periodIdentity: FairnessPeriodIdentity;
  fetchedAt: string;
  now: LocalNow;
  /**
   * Real schedule Events, used ONLY to derive each row's
   * `completedAllocationTotal` (`computeCompletedDutyAllocation`) -- never
   * consulted for score/target/delta/status, which stay entirely
   * workbook-sourced per this module's own docs. Defaults to an empty
   * array -- a genuinely safe default (zero supplied Events really does
   * mean zero completed allocation to sum, never a guess standing in for
   * unknown data) for any existing caller/test that predates this field.
   */
  events?: readonly Event[];
  /**
   * Emergency Mode date exclusion (spec section 19) -- every calendar
   * date any recorded Emergency Mode period ever touched. Excludes
   * duties on those dates from `completedAllocationTotal`, and removes
   * them from BOTH the numerator and denominator of the elapsed-time
   * pace calculation (`computePeriodElapsedPercentExcludingDates`) --
   * never from the source target itself. Defaults to an empty set for
   * any existing caller/test that predates this field (byte-for-byte
   * unchanged behavior).
   */
  excludedDates?: ReadonlySet<string>;
  /**
   * Whether Emergency Mode is CURRENTLY active (not merely whether any
   * excluded dates exist historically) -- while true, every row's
   * `paceStatus` is forced to `"suspended"` regardless of elapsed time,
   * per spec section 19 ("do NOT display 'מתחת לצפי' merely because time
   * passed while duties were not operational"). Defaults to `false`.
   */
  isEmergencyModeActive?: boolean;
}

/**
 * Pure, deterministic construction of `DutyFairnessReadModel` from an
 * already-parsed `FairnessTableParseResult` -- no network, no auth, no
 * `Date`/UTC, never mutates any input (same convention as
 * `buildManagerFairnessReadModel.ts` and `buildShiftFairnessReadModel.ts`).
 *
 * This PR does NOT recalculate duty scores, does NOT apply Shift Fairness's
 * ±0.5-shift tolerance, and does NOT invent a weighted combined score. The
 * Google Sheet's `currentScore` flows through untouched as the
 * authoritative Duty Fairness score -- every value computed here
 * (delta/target/gap/normalizedLoad/status) is analysis ON TOP of it, never
 * a replacement (PR #15 §10, unchanged).
 *
 * GROUPING AND TARGET ELIGIBILITY ARE DELIBERATELY TWO SEPARATE
 * CLASSIFIERS, not one. Presentation grouping (`resolveDutyFairnessGroupKey`,
 * below) is a decided domain rule: 'ר"צ' is part of the supervisor duty
 * population, alongside 'אחמ"ש'. Target eligibility
 * (`resolveFairnessAllocationRole`/`resolveComparisonTarget`,
 * `fairnessAnalysis.ts`, UNCHANGED) stays the narrower, proven mapping --
 * only 'אחמ"ש' and "טכנאי" carry a deterministic X/2X target. 'ר"צ'
 * therefore lands in the `"supervisor"` GROUP with a real, visible score,
 * but `comparisonTarget`/`gapToTarget`/`normalizedLoad`/`status` stay
 * `null` for it, exactly as they would for any other non-target-bearing
 * label -- landing in a group never by itself grants a target.
 */
export function buildDutyFairnessReadModel(input: BuildDutyFairnessReadModelInput): DutyFairnessReadModel {
  const { parseResult, periodIdentity, fetchedAt, now, events = [], excludedDates = EMPTY_EXCLUDED_DATES, isEmergencyModeActive = false } = input;
  const { personRows, totals, targets } = parseResult;

  const periodStartDate = fairnessPeriodStartDate(periodIdentity);
  const periodEndDate = fairnessPeriodEndDate(periodIdentity);
  const periodStatus = resolveFairnessPeriodStatus(periodEndDate, now);

  // "period start -> min(today, period end)" -- the one effective range
  // `computeCompletedDutyAllocation` ever sees; a future/not-yet-reached
  // period end never lets a not-yet-happened duty contribute.
  const effectiveEndDate = now.date < periodEndDate ? now.date : periodEndDate;

  // ONE elapsed-time fraction for the whole read model -- see
  // `lib/domain/dutyPace.ts`'s own documented limitation: no reliable
  // per-person participation window exists for Duty Fairness today, so
  // pace is measured against the same whole-period elapsed % for everyone,
  // never a fabricated personalized window. Emergency dates are excluded
  // from BOTH the numerator and denominator (spec section 19) -- an empty
  // `excludedDates` set behaves identically to the original
  // `computePeriodElapsedPercent`.
  const periodElapsedPercent = computePeriodElapsedPercentExcludingDates(
    periodStartDate,
    periodEndDate,
    effectiveEndDate,
    excludedDates,
  );

  // Period-level fact, computed once, never per-row: does the SELECTED
  // period (its full start..end range, not merely the elapsed-to-date
  // portion `effectiveEndDate` uses) overlap at least one date any recorded
  // Emergency Mode period ever touched? Reused for every row via
  // `duty_weekend_count_emergency_period` -- see that reason's own docs for
  // why `weekendCount` can never be trustworthily recomputed instead of
  // suppressed outright.
  const weekendCountSuppressed = periodOverlapsExcludedDates(periodStartDate, periodEndDate, excludedDates);

  const rows = personRows.map((row, index) =>
    toRowView(
      row,
      targets,
      index,
      events,
      periodStartDate,
      effectiveEndDate,
      periodStatus,
      periodElapsedPercent,
      excludedDates,
      isEmergencyModeActive,
      weekendCountSuppressed,
    ),
  );
  const sortedRows = [...rows].sort(compareDutyFairnessRows);

  return {
    fetchedAt,
    fairnessModelVersion: FAIRNESS_MODEL_VERSION,
    period: {
      key: periodIdentity.key,
      year: periodIdentity.year,
      label: fairnessPeriodIdentityLabel(periodIdentity),
      status: periodStatus,
    },
    targets: { supervisorTarget: targets.supervisorTarget, technicianTarget: targets.technicianTarget },
    groups: buildGroups(sortedRows),
    totals: totals ? toTotalsView(personRows, totals) : null,
  };
}

function toRowView(
  row: FairnessPersonRow,
  targets: FairnessTargets,
  index: number,
  events: readonly Event[],
  periodStartDate: string,
  effectiveEndDate: string,
  periodStatus: FairnessPeriodStatus,
  periodElapsedPercent: number | null,
  excludedDates: ReadonlySet<string>,
  isEmergencyModeActive: boolean,
  weekendCountSuppressed: boolean,
): DutyFairnessPersonRowView {
  const role = resolveFairnessAllocationRole(row.allocationLabel);
  const comparisonTarget = resolveComparisonTarget(row.allocationLabel, targets);
  const currentScore = row.currentScore;

  const reasons: FairnessDataCompletenessReason[] = [];
  if (row.resolvedPersonId === null) reasons.push("duty_identity_unresolved");
  if (role !== null && comparisonTarget === null) reasons.push("duty_target_unavailable");
  if (weekendCountSuppressed) reasons.push("duty_weekend_count_emergency_period");

  // Independent of `comparisonTarget`/`status` -- a person who cannot be
  // compared (no target-bearing allocation label) still gets a real
  // allocation total here whenever their identity is resolved, since this
  // is a plain factual total, not an analysis result (see
  // `DutyFairnessPersonRowView.completedAllocationTotal`'s own docs).
  let completedAllocationTotal: number | null = null;
  let liveDuty: DutyFairnessPersonRowView["liveDuty"] = null;
  if (row.resolvedPersonId !== null) {
    const allocation = computeCompletedDutyAllocation(events, row.resolvedPersonId, periodStartDate, effectiveEndDate, excludedDates);
    completedAllocationTotal = allocation.total;
    if (allocation.unsupportedBlocks.length > 0) reasons.push("duty_allocation_unsupported_block_shape");

    // Only the period containing "today" can have something genuinely
    // live right now -- a closed period never reports one, regardless of
    // real-world "today" (see `liveDuty`'s own docs).
    if (periodStatus === "current") {
      const active = resolveActiveDutyBlock(events, row.resolvedPersonId, effectiveEndDate);
      if (active) liveDuty = { dutyFamily: active.dutyFamily, slot: active.slot };
    }
  }

  // Justice Table redesign, corrected -- the person's own TARGET is the
  // selected period's workbook Fairness-table value itself: the
  // "ניקוד לפוטנציאל הנוכחי" column, already parsed unconditionally as
  // `FairnessPersonRow.currentScore` (`lib/parsers/fairness.ts`) and
  // flowing through untouched, same as `currentScore` above -- this IS the
  // authoritative per-person target for the whole selected period, already
  // computed and published by the workbook itself. This redesign's FIRST
  // attempt instead reconstructed a total by replaying the published
  // Potential's own operational allocations through the duty weighting
  // engine (`computeCompletedDutyAllocation` over resolved-Potential
  // events) -- verified against the real 7-12/2026 and 1-6/2026 workbooks
  // to produce incomplete/wrong totals for many real people (e.g. a
  // reconstructed 3.2 where the workbook's own column says 6), so that
  // reconstruction is REMOVED, not merely stopped-using. Deliberately
  // NEVER `comparisonTarget` (the workbook's role-based X/2X constant, a
  // SEPARATE, unchanged, pre-existing feature -- see its own docs).
  // Identity resolution is NOT required here, exactly like
  // `comparisonTarget` above -- see `duty_identity_unresolved`'s own docs
  // ("score/target/status all still compute normally" for an unresolved
  // row): unlike `completedAllocationTotal` above, this is a plain
  // workbook column value, never derived from Event-matching by personId.
  const personalTargetTotal = currentScore;

  // "workbook target = personal target, actual validated schedule = actual
  // completed work" -- reuses the SAME ratio-with-null-safety math
  // `computeNormalizedLoad` already provides, applied to the real
  // completed-work total and the person's own workbook target instead (see
  // `targetProgressRatio`'s own docs -- no new formula).
  const targetProgressRatio = computeNormalizedLoad(completedAllocationTotal, personalTargetTotal);
  const remainingToTarget =
    personalTargetTotal !== null && completedAllocationTotal !== null ? personalTargetTotal - completedAllocationTotal : null;
  // Spec section 19 -- while Emergency Mode is CURRENTLY active, elapsed
  // period time must never be read as "behind schedule": the pace verdict
  // is forced to `"suspended"` unconditionally, taking precedence over the
  // ordinary below/on/ahead computation below (never silently falling
  // through to a stale "below_pace" just because `isEmergencyModeActive`
  // happens to also have a resolvable ratio).
  const paceStatus: DutyPaceStatus | null = isEmergencyModeActive
    ? "suspended"
    : targetProgressRatio !== null && periodElapsedPercent !== null
      ? resolveDutyPaceStatus(targetProgressRatio * 100, periodElapsedPercent)
      : null;

  return {
    key: `${row.resolvedPersonId ?? "unresolved"}-${index}`,
    personId: row.resolvedPersonId,
    sourceName: row.sourceName,
    allocationLabel: row.allocationLabel,
    previousScore: row.previousScore,
    currentScore,
    delta: computeScoreDelta(row.previousScore, currentScore),
    comparisonTarget,
    gapToTarget: computeGapToTarget(currentScore, comparisonTarget),
    normalizedLoad: computeNormalizedLoad(currentScore, comparisonTarget),
    status: resolveDutyFairnessStatus(currentScore, comparisonTarget),
    // Never a partial/guessed adjustment -- see `duty_weekend_count_emergency_period`'s own docs.
    weekendCount: weekendCountSuppressed ? null : row.weekendCount,
    completedAllocationTotal,
    personalTargetTotal,
    targetProgressRatio,
    remainingToTarget,
    paceStatus,
    liveDuty,
    exemptions: resolveFairnessExemptions(row.exemptions),
    dataCompleteness: fairnessDataCompleteness(reasons),
  };
}

function toTotalsView(
  personRows: readonly FairnessPersonRow[],
  totals: NonNullable<FairnessTableParseResult["totals"]>,
): DutyFairnessTotalsView {
  const displayed = sumDisplayedFairnessRows(personRows);
  return {
    reportedPreviousTotal: totals.reportedPreviousTotal,
    reportedCurrentTotal: totals.reportedCurrentTotal,
    reportedWeekendTotal: totals.reportedWeekendTotal,
    displayedPreviousSum: displayed.displayedPreviousSum,
    displayedCurrentSum: displayed.displayedCurrentSum,
    displayedWeekendSum: displayed.displayedWeekendSum,
  };
}

/** Safe zero-exclusion default -- mirrors `dutyAllocationWeight.ts`'s own `EMPTY_EXCLUDED_DATES`, kept as a separate module-local constant since that one is not exported. */
const EMPTY_EXCLUDED_DATES: ReadonlySet<string> = new Set();

/**
 * Whether ANY date in `excludedDates` falls within `[periodStartDate,
 * periodEndDate]` (inclusive both ends) -- plain lexicographic comparison,
 * valid for `"YYYY-MM-DD"` strings (same convention as the rest of this
 * codebase's date-range checks). `excludedDates` holds every date any
 * recorded Emergency Mode period EVER touched (`getEmergencyDateSet`), not
 * merely a currently-active one, so a past emergency inside an otherwise
 * long-closed period still counts.
 */
function periodOverlapsExcludedDates(periodStartDate: string, periodEndDate: string, excludedDates: ReadonlySet<string>): boolean {
  if (excludedDates.size === 0) return false;
  for (const date of excludedDates) {
    if (date >= periodStartDate && date <= periodEndDate) return true;
  }
  return false;
}

const GROUP_ORDER: readonly DutyFairnessGroupKey[] = ["supervisor", "technician", "other"];

const RESERVIST_SUPERVISOR_LABEL = 'ר"צ';
const TECHNICIAN_LABEL = "טכנאי";

/**
 * Duty Fairness PRESENTATION grouping -- a decided domain rule, and a
 * DELIBERATELY SEPARATE classifier from `resolveFairnessAllocationRole`'s
 * target-eligibility mapping (`fairnessAnalysis.ts`): 'ר"צ' is part of the
 * supervisor duty population, same as the whole אחמ"ש spelling family, but
 * it is NOT one of the labels that carries a deterministic X/2X target, so
 * it must not be classified with the SAME function used to decide target
 * eligibility (that would silently grant it a target it was never proven
 * to have). The אחמ"ש side of this grouping shares `isShiftLeadRoleToken`
 * with `resolveFairnessAllocationRole` (masculine/feminine, any
 * quote/hyphen variant), so a feminine shift lead lands in the same group
 * as her masculine counterpart. Every other unrecognized/non-target-bearing
 * label (הסמכה, משתחרר, ...) falls to `"other"`, same as before.
 */
function resolveDutyFairnessGroupKey(allocationLabel: string): DutyFairnessGroupKey {
  if (isShiftLeadRoleToken(allocationLabel) || allocationLabel === RESERVIST_SUPERVISOR_LABEL) return "supervisor";
  if (allocationLabel === TECHNICIAN_LABEL) return "technician";
  return "other";
}

/**
 * Buckets the ALREADY-sorted rows by `resolveDutyFairnessGroupKey` -- never
 * re-sorts within a bucket, so each group preserves the exact relative
 * order established by `compareDutyFairnessRows`. A group with zero rows
 * is omitted entirely, never rendered as an empty bucket.
 */
function buildGroups(sortedRows: readonly DutyFairnessPersonRowView[]): DutyFairnessGroupView[] {
  const byGroup = new Map<DutyFairnessGroupKey, DutyFairnessPersonRowView[]>();
  for (const row of sortedRows) {
    const key = resolveDutyFairnessGroupKey(row.allocationLabel);
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(row);
    else byGroup.set(key, [row]);
  }

  const groups: DutyFairnessGroupView[] = [];
  for (const key of GROUP_ORDER) {
    const rowsForGroup = byGroup.get(key);
    if (!rowsForGroup || rowsForGroup.length === 0) continue;
    groups.push({ key, rows: rowsForGroup });
  }
  return groups;
}

/**
 * Lowest normalized load first, then rows without one (source order via
 * `key`), stable tiebreak by source name then key -- the SAME established
 * ordering `buildManagerFairnessReadModel.ts`'s `compareFairnessRows`
 * already implements (PR #15 §31), preserved here unchanged. Pure
 * relative-load ordering -- never labeled "הבא בתור" / "עדיפות לשיבוץ" by
 * any caller.
 */
function compareDutyFairnessRows(a: DutyFairnessPersonRowView, b: DutyFairnessPersonRowView): number {
  const aHasLoad = a.normalizedLoad !== null;
  const bHasLoad = b.normalizedLoad !== null;

  if (aHasLoad && bHasLoad && a.normalizedLoad !== b.normalizedLoad) {
    return (a.normalizedLoad as number) - (b.normalizedLoad as number);
  }
  if (aHasLoad !== bHasLoad) return aHasLoad ? -1 : 1;

  if (a.sourceName !== b.sourceName) return a.sourceName < b.sourceName ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
