import type { FairnessStatus } from "./fairnessFoundation";
import type { FairnessPersonRow, FairnessTargets } from "./fairnessTable";
import { isShiftLeadRoleToken } from "./shiftLeadRole";

export type FairnessAllocationRole = "supervisor" | "technician";

const TECHNICIAN_ALLOCATION_LABEL = "טכנאי";

/**
 * The ONLY verified deterministic allocation-label -> target-role mapping
 * (PR #15 §14). Every other allocation label (ר"צ, הסמכה, משתחרר, ...) gets
 * no target -- never an invented one -- unless a future deterministic
 * domain/personnel rule proves one. The supervisor side recognizes the
 * whole shift-lead spelling family via `isShiftLeadRoleToken` (masculine
 * AND feminine, any quote/hyphen variant) -- the same canonical classifier
 * `lib/parsers/event.ts` uses -- rather than a single hard-coded label, so
 * a feminine shift lead's Duty Fairness row is never silently excluded
 * from its target the way her schedule Event once was.
 */
export function resolveFairnessAllocationRole(allocationLabel: string): FairnessAllocationRole | null {
  if (isShiftLeadRoleToken(allocationLabel)) return "supervisor";
  if (allocationLabel === TECHNICIAN_ALLOCATION_LABEL) return "technician";
  return null;
}

/**
 * "יעד השוואה" for one row -- `null` unless the allocation label has a
 * deterministic target role AND that role's period target is itself known
 * (PR #15 §12-15). This is a reference for comparison, never a hard limit.
 */
export function resolveComparisonTarget(allocationLabel: string, targets: FairnessTargets): number | null {
  const role = resolveFairnessAllocationRole(allocationLabel);
  if (role === null) return null;
  return role === "supervisor" ? targets.supervisorTarget : targets.technicianTarget;
}

/**
 * current - previous, only when both scores are known (PR #15 §11). A
 * missing previous score is NEVER treated as zero -- the caller must show
 * "חדש / אין ניקוד קודם" instead of a fabricated delta.
 */
export function computeScoreDelta(previousScore: number | null, currentScore: number | null): number | null {
  if (previousScore === null || currentScore === null) return null;
  return currentScore - previousScore;
}

/** currentScore - comparisonTarget -- context only, never presented as a violation (PR #15 §15). */
export function computeGapToTarget(currentScore: number | null, comparisonTarget: number | null): number | null {
  if (currentScore === null || comparisonTarget === null) return null;
  return currentScore - comparisonTarget;
}

/**
 * currentScore / comparisonTarget -- lets the manager compare people across
 * different target scales (PR #15 §21). `null` whenever either side is
 * missing or the target isn't a usable positive number -- never a division
 * by zero, never a guess.
 */
export function computeNormalizedLoad(currentScore: number | null, comparisonTarget: number | null): number | null {
  if (currentScore === null || comparisonTarget === null) return null;
  if (comparisonTarget <= 0) return null;
  return currentScore / comparisonTarget;
}

/** Duty Fairness's own status vocabulary -- see `resolveDutyFairnessStatus` for why it carries NO tolerance, unlike Shift Fairness's `FairnessShiftStatus`. */
export type DutyFairnessStatus = FairnessStatus;

/**
 * PR #3 -- Duty Fairness status: an EXACT `currentScore` vs `comparisonTarget`
 * comparison, deliberately with NO tolerance band. This is intentionally
 * different from Shift Fairness's `resolveFairnessShiftStatus`, which
 * tolerates a ±0.5-shift gap because a shift target is a fractional
 * opportunity-share estimate that a discrete shift count can never land on
 * exactly. The workbook's `currentScore` and `comparisonTarget` are both
 * already-authoritative source values (not a reconstructed estimate), so
 * "balanced" means exactly equal, nothing more forgiving. `null` whenever
 * either `currentScore` or `comparisonTarget` is unavailable -- never a
 * guessed status standing in for "unknown".
 */
export function resolveDutyFairnessStatus(
  currentScore: number | null,
  comparisonTarget: number | null,
): DutyFairnessStatus | null {
  if (currentScore === null || comparisonTarget === null) return null;
  if (currentScore < comparisonTarget) return "below";
  if (currentScore > comparisonTarget) return "above";
  return "balanced";
}

/**
 * The independently computed sum of the currently parsed/displayed person
 * rows. Deliberately NOT a "validation" of anything -- the real workbook's
 * "סך הכל:" totals are backed by formulas המחלבה never sees at runtime (the
 * Google fetch renders formatted VALUES only, by design -- see
 * `lib/google/fetchWorkbookSnapshot.ts`), and those formulas are not
 * always a naive sum of every displayed row. A verified real example: the
 * H1 previous-score total is `=SUM(Y9:Y19)/4*6`, not `=SUM(...)` of every
 * row המחלבה parses. A difference between this sum and the sheet's own
 * reported total is therefore NOT evidence of an error and must never be
 * labeled as a discrepancy/mismatch (PR #15 hardening pass).
 */
export interface FairnessDisplayedRowsSum {
  displayedPreviousSum: number;
  displayedCurrentSum: number;
  displayedWeekendSum: number;
}

function sumNonNull(values: readonly (number | null)[]): number {
  return values.reduce<number>((sum, value) => (value === null ? sum : sum + value), 0);
}

/**
 * Sums the numeric person rows currently parsed (`null`/"-" rows are
 * naturally excluded). This is a separate fact from `FairnessTotalsRow`'s
 * `reportedXTotal` fields -- the sheet's own "סך הכל:" row -- never a
 * check of one against the other. Never mutates its input.
 */
export function sumDisplayedFairnessRows(rows: readonly FairnessPersonRow[]): FairnessDisplayedRowsSum {
  return {
    displayedPreviousSum: sumNonNull(rows.map((row) => row.previousScore)),
    displayedCurrentSum: sumNonNull(rows.map((row) => row.currentScore)),
    displayedWeekendSum: sumNonNull(rows.map((row) => row.weekendCount)),
  };
}
