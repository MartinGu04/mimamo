import type { DutyFamily } from "@/lib/domain/event";
import type { DutyFairnessStatus } from "@/lib/domain/fairnessAnalysis";
import type { FairnessDataCompleteness, FairnessPeriodStatus } from "@/lib/domain/fairnessFoundation";
import type { FairnessPeriodKey } from "@/lib/domain/fairnessPeriod";
import type { DutyPaceStatus } from "@/lib/domain/dutyPace";

/**
 * PR #3 -- the Duty Fairness read model's safe projections. No email, no
 * `sourceSheet`/`sourceCell`, no raw Google row -- same convention as
 * `ShiftFairnessReadModel` (`lib/readModels/shiftFairnessTypes.ts`), which
 * this is a SEPARATE, parallel read model from: Shift Fairness is
 * opportunity-based and month-oriented, Duty Fairness is workbook-score-based
 * and H1/H2-oriented. The two share only the small proven primitives from
 * `lib/domain/fairnessFoundation.ts` (status vocabulary, period status,
 * model version, data completeness) -- never one combined shape.
 *
 * This is a NEW, additional read-model boundary alongside the existing
 * `ManagerFairnessReadModel` (`lib/readModels/managerFairnessTypes.ts`),
 * which stays exactly as it is and keeps powering `/manager/fairness`
 * unchanged. This one exists to make Duty Fairness consumable by the future
 * standalone Fairness page (PR #4) without that page ever touching the
 * manager-only read model or its route.
 */

/**
 * Which duty population a row's `allocationLabel` belongs to --
 * `resolveDutyFairnessGroupKey` (`buildDutyFairnessReadModel.ts`), a
 * DELIBERATELY SEPARATE classifier from the narrower target-eligibility
 * mapping (`resolveFairnessAllocationRole`, `lib/domain/fairnessAnalysis.ts`):
 * 'אחמ"ש' and 'ר"צ' both belong to the `"supervisor"` group (a decided
 * domain rule -- reservist/ר"צ personnel are part of the אחמ"ש population),
 * "טכנאי" belongs to `"technician"`. `"other"` is every other allocation
 * label (e.g. "הסמכה", an unrecognized label) -- metadata/context, never
 * its own comparison group with an invented target. Landing in the
 * `"supervisor"` group does NOT by itself grant a comparison target -- 'ר"צ'
 * still has `comparisonTarget: null`, since only 'אחמ"ש'/"טכנאי" carry a
 * deterministic X/2X target (see `resolveComparisonTarget`, unchanged).
 */
export type DutyFairnessGroupKey = "supervisor" | "technician" | "other";

/** Manager-safe projection of `FairnessExemption` -- same shape, re-exported at this read-model boundary so components never import `lib/domain` types directly (same convention as `ManagerFairnessExemptionView`). */
export interface DutyFairnessExemptionView {
  raw: string;
  affectedDutyFamilies: readonly DutyFamily[];
}

/**
 * One duty Fairness row, safe for presentation. The workbook's own
 * `currentScore` flows through untouched and remains authoritative --
 * `delta`/`comparisonTarget`/`gapToTarget`/`normalizedLoad`/`status` are all
 * analysis ON TOP of it, never a replacement (PR #15's original rule,
 * unchanged by PR #3). `personId` is `null` for an unresolved/ambiguous
 * source name -- the row still displays fully, it just isn't linkable to a
 * drill-down (same convention as `ManagerFairnessPersonRowView`).
 */
export interface DutyFairnessPersonRowView {
  /** Stable within one read model build -- derived from `personId` (or "unresolved") plus source row order, never from a raw sheet cell reference. */
  key: string;
  personId: string | null;
  sourceName: string;
  /** Raw source allocation text (e.g. "טכנאי", 'אחמ"ש', "הסמכה") -- never a basis for inventing a capability. */
  allocationLabel: string;
  previousScore: number | null;
  currentScore: number | null;
  /** currentScore - previousScore; `null` when there's no previous score to compare against (never treated as 0). */
  delta: number | null;
  /** "יעד השוואה" -- reference only, never a hard limit. `null` when no deterministic target applies to this row, OR the period's own target note is missing/malformed (see `dataCompleteness`). */
  comparisonTarget: number | null;
  /** currentScore - comparisonTarget. */
  gapToTarget: number | null;
  /** currentScore / comparisonTarget -- context only, never a global Fairness score. */
  normalizedLoad: number | null;
  /** below/balanced/above, EXACT comparison with no tolerance band -- `null` whenever currentScore or comparisonTarget is unavailable. */
  status: DutyFairnessStatus | null;
  /**
   * Raw workbook `סופ"שים` aggregate, one number per person per H1/H2
   * period with no per-date breakdown anywhere in the source -- so it can
   * never be trustworthily recomputed to exclude emergency-affected
   * weekends. `null` whenever the selected period overlaps at least one
   * recorded Emergency Mode date (`duty_weekend_count_emergency_period` on
   * `dataCompleteness`), suppressed outright rather than shown contaminated
   * or guessed at.
   */
  weekendCount: number | null;
  /**
   * "הקצאות שבוצעו" -- the WEIGHTED total allocation value of duties this
   * person has ACTUALLY COMPLETED in this period, up to the effective
   * cutoff (`min(today, period end)`). A DIFFERENT fact from `currentScore`
   * (the workbook's own opaque Fairness score) -- this is derived purely
   * from real schedule Events, using the confirmed canonical business-rule
   * weights in `lib/domain/dutyAllocationWeight.ts`'s
   * `computeCompletedDutyAllocation` (day-based weight per family, except
   * guard/reserve which are block-shaped fixed-value allocations). Never a
   * raw event count -- a single 0.25/0.5/1 guard block is ONE allocation
   * regardless of how many days it spans, and different duty families
   * contribute different weights, so this total can differ substantially
   * from a naive count of completed duty events.
   *
   * `null` for TWO distinct reasons, both flagged via `dataCompleteness`:
   * `personId` itself is `null` (`duty_identity_unresolved` -- no person to
   * join schedule Events against), OR a real guard/reserve block's shape
   * doesn't match any of the three confirmed business rules
   * (`duty_allocation_unsupported_block_shape` -- the true total is
   * genuinely unknown, never a partial sum that silently drops it). Unlike
   * `comparisonTarget`, this does NOT depend on having a comparison target:
   * a person who "cannot be compared" (no target-bearing allocation label,
   * `status: null`) still gets a real total here whenever their identity is
   * resolved and every relevant block is classifiable, since it's a plain
   * factual total, not an analysis result.
   */
  completedAllocationTotal: number | null;
  /**
   * Justice Table redesign, corrected -- this specific person's own TARGET:
   * the selected period's workbook Fairness-table value itself, the
   * "ניקוד לפוטנציאל הנוכחי" column, parsed unconditionally as
   * `FairnessPersonRow.currentScore` (`lib/parsers/fairness.ts`) and
   * carried through here untouched -- literally the SAME number as
   * `currentScore` above. This IS the authoritative per-person target for
   * the whole selected period, already computed and published by the
   * workbook itself; המחלבה never derives it.
   *
   * This redesign's FIRST attempt instead reconstructed a total by
   * replaying the published Potential's own operational allocations
   * through the duty weighting engine (`computeCompletedDutyAllocation`
   * over resolved-Potential events). That reconstruction is REMOVED: it
   * was verified against the real 7-12/2026 and 1-6/2026 workbooks to
   * produce incomplete/wrong totals for many real people (e.g. a
   * reconstructed 3.2 where the workbook's own column says 6).
   *
   * Deliberately NEVER `comparisonTarget` (the workbook's role-based X/2X
   * constant, e.g. a flat 4 for every אחמ״ש or 8 for every טכנאי,
   * regardless of what any specific person was actually assigned) -- two
   * people with the SAME `allocationLabel` can have completely different
   * `personalTargetTotal`s, because the workbook publishes a personal
   * figure for each of them. A swap moves who performed a duty (reflected
   * in `completedAllocationTotal`, from the real schedule) without moving
   * who the workbook published the target for (reflected here).
   *
   * `null` only when the workbook cell itself is unavailable ("-"/blank --
   * see `FairnessPersonRow.currentScore`'s own docs). Unlike
   * `completedAllocationTotal`, this does NOT depend on identity
   * resolution -- exactly like `comparisonTarget`, it is read straight off
   * the row (see `duty_identity_unresolved`'s own docs: "score/target/
   * status all still compute normally" for an unresolved row). A real `0`
   * (the workbook itself publishes zero for this person this period) is a
   * normal, complete, truthful outcome, never a gap.
   */
  personalTargetTotal: number | null;
  /**
   * "how much of `personalTargetTotal` is completed", strictly
   * `completedAllocationTotal / personalTargetTotal` (reusing
   * `computeNormalizedLoad` outright, the exact same "ratio with
   * null-safety" math `normalizedLoad` already uses -- just applied to the
   * REAL completed-work total and this person's OWN workbook target
   * instead, per the redesign's own "workbook target = personal target,
   * actual validated schedule = actual completed work" rule). `null`
   * whenever either side is unavailable, exactly like `normalizedLoad`. Can
   * legitimately exceed `1` (over 100% of target) -- never clamped, since
   * that is real, truthful data (see `remainingToTarget` below for the
   * signed complement).
   */
  targetProgressRatio: number | null;
  /**
   * `personalTargetTotal - completedAllocationTotal` -- signed, so a
   * negative value means the target was exceeded (see
   * `remainingToTarget < 0` -> "X points beyond potential" in
   * presentation). `null` whenever either side is unavailable -- never a
   * guessed remaining amount.
   */
  remainingToTarget: number | null;
  /**
   * Progress (target completion %) vs. pace (given how much of the period
   * has elapsed, are they where they should be) are different questions --
   * see `lib/domain/dutyPace.ts`'s own docs, including its documented
   * limitation (no reliable per-person participation window exists for
   * Duty Fairness today, so every person's pace is measured against the
   * SAME whole-period elapsed fraction). `null` whenever `targetProgressRatio`
   * is unavailable (no target, or completed work unknown) -- pace is never
   * computed without a real progress figure to compare.
   */
  paceStatus: DutyPaceStatus | null;
  /**
   * A real, CONFIRMED, completion-based duty (flat-allocation or
   * guard/reserve) currently ACTIVE for this person, not yet reflected in
   * `completedAllocationTotal` because it hasn't finished yet
   * (`lib/domain/dutyAllocationWeight.ts`'s `resolveActiveDutyBlock`) --
   * lets the UI show a calm "LIVE, points will be added on completion"
   * state instead of the duty silently appearing to contribute nothing.
   * Always `null` for a closed period (only the period containing "today"
   * can have something live), for an unresolved `personId`, or for a
   * day-based family (rasar/daily_kitchen), which already accrues per day.
   */
  liveDuty: { dutyFamily: DutyFamily; slot: number | null } | null;
  exemptions: readonly DutyFairnessExemptionView[];
  /** Only ever non-empty for a genuinely verified gap (unresolved identity, or a target-bearing role missing its period target note) -- never noise on every row. */
  dataCompleteness: FairnessDataCompleteness;
  /**
   * The person's presentation-only Google avatar photo, when known --
   * `undefined`/`null` both mean "no photo, fall back to initials", and
   * always `null`/absent when `personId` itself is `null` (an unresolved
   * source name has no person to look a photo up for). Never required by
   * `buildDutyFairnessReadModel` itself (which never sets it --
   * calculations/sorting/eligibility are entirely untouched by this
   * field). Stamped on AFTER the read model is built, by
   * `loadDutyFairnessReadModel` (`dutyFairness.ts`), from
   * `FairnessWorkbookContext.avatarByPersonId`.
   */
  avatarUrl?: string | null;
}

export interface DutyFairnessGroupView {
  key: DutyFairnessGroupKey;
  /** Sorted by the existing established Duty Fairness ordering (lowest normalized load first, unavailable last, stable tie-break) -- never re-sorted into a "priority"/"next up" queue. */
  rows: readonly DutyFairnessPersonRowView[];
}

export interface DutyFairnessTargetsView {
  supervisorTarget: number | null;
  technicianTarget: number | null;
}

/**
 * Two independent facts about the fairness table's totals -- never compared/
 * validated against each other (same convention as `ManagerFairnessTotalsView`;
 * see that type's own docs for why a difference is never a "discrepancy").
 */
export interface DutyFairnessTotalsView {
  reportedPreviousTotal: number | null;
  reportedCurrentTotal: number | null;
  reportedWeekendTotal: number | null;
  displayedPreviousSum: number;
  displayedCurrentSum: number;
  displayedWeekendSum: number;
}

export interface DutyFairnessPeriodView {
  key: FairnessPeriodKey;
  year: number;
  /** "1–6/2026" / "7–12/2026" -- already period+year formatted, ready to render. */
  label: string;
  /** Whether THIS specific H1/H2 period is still in progress or already over, via the shared `fairnessFoundation.ts` foundation -- never a separately duplicated current/closed computation. */
  status: FairnessPeriodStatus;
}

/**
 * The Duty Fairness read model (PR #3) -- workbook-score-based, H1/H2
 * periods. Never carries email, `sourceSheet`/`sourceCell`, raw Google rows,
 * or the spreadsheet id.
 */
export interface DutyFairnessReadModel {
  fetchedAt: string;
  /** `FAIRNESS_MODEL_VERSION` at build time -- carried for a future historical snapshot (PR #5) to know which rules produced it; no snapshot storage exists yet. */
  fairnessModelVersion: number;
  period: DutyFairnessPeriodView;
  targets: DutyFairnessTargetsView;
  /** Supervisor, then technician, then other -- omitted entirely when empty, never rendered as an empty bucket. */
  groups: readonly DutyFairnessGroupView[];
  /** `null` when the sheet has no "סך הכל:" row to compare against. */
  totals: DutyFairnessTotalsView | null;
}
