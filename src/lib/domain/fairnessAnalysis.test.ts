import { describe, expect, it } from "vitest";
import type { FairnessPersonRow } from "./fairnessTable";
import {
  computeGapToTarget,
  computeNormalizedLoad,
  computeScoreDelta,
  resolveComparisonTarget,
  resolveDutyFairnessStatus,
  resolveFairnessAllocationRole,
  sumDisplayedFairnessRows,
} from "./fairnessAnalysis";

describe("resolveFairnessAllocationRole — exact deterministic mapping only", () => {
  it('"טכנאי" -> technician', () => {
    expect(resolveFairnessAllocationRole("טכנאי")).toBe("technician");
  });

  it('אחמ"ש -> supervisor', () => {
    expect(resolveFairnessAllocationRole('אחמ"ש')).toBe("supervisor");
  });

  it("אחמשית (feminine shift-lead form) -> supervisor, same as the masculine form", () => {
    expect(resolveFairnessAllocationRole("אחמשית")).toBe("supervisor");
    expect(resolveFairnessAllocationRole('אחמ"שית')).toBe("supervisor");
  });

  it.each(['ר"צ', "הסמכה", "הסמכת טכנאי אתרים", "משתחרר", "אחמ\"ש מ\"א"])(
    "%s never gets an invented role",
    (label) => {
      expect(resolveFairnessAllocationRole(label)).toBeNull();
    },
  );
});

describe("resolveComparisonTarget", () => {
  const targets = { supervisorTarget: 4, technicianTarget: 8 };

  it("technician label resolves to the technician target", () => {
    expect(resolveComparisonTarget("טכנאי", targets)).toBe(8);
  });

  it("supervisor label resolves to the supervisor target", () => {
    expect(resolveComparisonTarget('אחמ"ש', targets)).toBe(4);
  });

  it("unknown label -> null, even when targets are known", () => {
    expect(resolveComparisonTarget('ר"צ', targets)).toBeNull();
  });

  it("known role but the period's target itself is unknown -> null", () => {
    expect(resolveComparisonTarget("טכנאי", { supervisorTarget: null, technicianTarget: null })).toBeNull();
  });
});

describe("computeScoreDelta", () => {
  it("current - previous when both are known", () => {
    expect(computeScoreDelta(5.1, 6.5)).toBeCloseTo(1.4);
  });

  it("null previous -> null delta, never treated as 0", () => {
    expect(computeScoreDelta(null, 7.75)).toBeNull();
  });

  it("null current -> null delta", () => {
    expect(computeScoreDelta(5, null)).toBeNull();
  });

  it("equal scores -> 0", () => {
    expect(computeScoreDelta(5, 5)).toBe(0);
  });
});

describe("computeGapToTarget", () => {
  it("current - target", () => {
    expect(computeGapToTarget(6.3, 8)).toBeCloseTo(-1.7);
  });

  it("null current -> null", () => {
    expect(computeGapToTarget(null, 8)).toBeNull();
  });

  it("null target -> null", () => {
    expect(computeGapToTarget(6, null)).toBeNull();
  });
});

describe("computeNormalizedLoad — PR #15 §21/§42", () => {
  it("technician: current 6, target 8 -> 0.75", () => {
    expect(computeNormalizedLoad(6, 8)).toBeCloseTo(0.75);
  });

  it("supervisor: current 3, target 4 -> 0.75 (same relative load despite different raw scale)", () => {
    expect(computeNormalizedLoad(3, 4)).toBeCloseTo(0.75);
  });

  it("no target -> null", () => {
    expect(computeNormalizedLoad(6, null)).toBeNull();
  });

  it("no current score -> null", () => {
    expect(computeNormalizedLoad(null, 8)).toBeNull();
  });

  it("zero target -> null, never a division by zero", () => {
    expect(computeNormalizedLoad(6, 0)).toBeNull();
  });

  it("negative/invalid target -> null", () => {
    expect(computeNormalizedLoad(6, -1)).toBeNull();
  });
});

describe("resolveDutyFairnessStatus — PR #3, exact comparison, no tolerance band", () => {
  it("A. below: current < target", () => {
    expect(resolveDutyFairnessStatus(6, 8)).toBe("below");
  });

  it("A. balanced: current === target, exactly (unlike Shift Fairness, no ±0.5 tolerance)", () => {
    expect(resolveDutyFairnessStatus(8, 8)).toBe("balanced");
  });

  it("A. above: current > target", () => {
    expect(resolveDutyFairnessStatus(9, 8)).toBe("above");
  });

  it("A. a gap smaller than Shift Fairness's ±0.5 tolerance is still NOT balanced here -- Duty Fairness has no tolerance band at all", () => {
    expect(resolveDutyFairnessStatus(8.1, 8)).toBe("above");
    expect(resolveDutyFairnessStatus(7.9, 8)).toBe("below");
  });

  it("B. unknown comparison target -> null, never a fake balanced/zero-implied status", () => {
    expect(resolveDutyFairnessStatus(6, null)).toBeNull();
  });

  it("C. unknown current score -> null, even though target is known", () => {
    expect(resolveDutyFairnessStatus(null, 8)).toBeNull();
  });

  it("both unknown -> null", () => {
    expect(resolveDutyFairnessStatus(null, null)).toBeNull();
  });
});

function personRow(overrides: Partial<FairnessPersonRow> = {}): FairnessPersonRow {
  return {
    sourceName: "מרטין בדיקה",
    resolvedPersonId: "p1",
    allocationLabel: "טכנאי",
    previousScore: 5,
    currentScore: 6,
    weekendCount: 2,
    exemptions: [],
    sourceSheet: "sheet",
    sourceCell: "A1",
    ...overrides,
  };
}

describe("sumDisplayedFairnessRows — PR #15 hardening pass (never a validation)", () => {
  it("sums the numeric fields of the currently displayed/parsed rows", () => {
    const rows = [
      personRow({ previousScore: 5, currentScore: 6, weekendCount: 2 }),
      personRow({ previousScore: 5, currentScore: 6, weekendCount: 2 }),
    ];
    const result = sumDisplayedFairnessRows(rows);
    expect(result).toEqual({ displayedPreviousSum: 10, displayedCurrentSum: 12, displayedWeekendSum: 4 });
  });

  it("null/'-' rows are excluded from the sum, never treated as 0", () => {
    const rows = [
      personRow({ previousScore: null, currentScore: 6, weekendCount: null }),
      personRow({ previousScore: 5, currentScore: 6, weekendCount: 2 }),
    ];
    const result = sumDisplayedFairnessRows(rows);
    expect(result).toEqual({ displayedPreviousSum: 5, displayedCurrentSum: 12, displayedWeekendSum: 2 });
  });

  it("empty rows -> all-zero sums, never a crash", () => {
    expect(sumDisplayedFairnessRows([])).toEqual({
      displayedPreviousSum: 0,
      displayedCurrentSum: 0,
      displayedWeekendSum: 0,
    });
  });

  it("never mutates the input rows", () => {
    const rows = [personRow()];
    const before = JSON.stringify(rows);
    sumDisplayedFairnessRows(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("REAL-SHAPE REGRESSION (PR #15 hardening §7): a source-reported total built from a formula that does not equal a naive row sum is simply a DIFFERENT fact, never a discrepancy -- this function only ever computes the displayed-row sum and never looks at (or compares against) any reported total at all", () => {
    // Verified real H1 shape: the previous-score total is `=SUM(Y9:Y19)/4*6`,
    // not a plain sum of the displayed rows. Twelve synthetic person rows,
    // each previousScore=5 -> naive sum would be 60, but the real formula's
    // result (60/4*6=90) is a completely different, unrelated number.
    const rows = Array.from({ length: 12 }, (_, i) => personRow({ sourceName: `אדם ${i}`, previousScore: 5 }));
    const result = sumDisplayedFairnessRows(rows);

    // The displayed-row sum is exactly what it claims to be: a plain sum.
    expect(result.displayedPreviousSum).toBe(60);
    // It carries no knowledge of, and makes no claim about, the sheet's
    // own reported total (90 in this scenario) -- there is no field here
    // that could even represent a "mismatch"/"discrepancy" conclusion.
    expect(result).not.toHaveProperty("hasDiscrepancy");
    expect(result).not.toHaveProperty("previousMismatch");
  });
});
