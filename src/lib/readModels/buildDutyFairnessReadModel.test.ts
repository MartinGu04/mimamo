import { describe, expect, it } from "vitest";
import type { Event } from "@/lib/domain/event";
import type { LocalNow } from "@/lib/domain/localNow";
import type { FairnessPersonRow, FairnessTableParseResult, FairnessTargets, FairnessTotalsRow } from "@/lib/domain/fairnessTable";
import { buildDutyFairnessReadModel } from "./buildDutyFairnessReadModel";

function dutyEvent(overrides: Partial<Event> = {}): Event {
  return {
    personId: "p1",
    personName: "מרטין בדיקה",
    date: "2026-03-10",
    title: 'רס"ר',
    rawValue: 'רס"ר',
    category: "duty",
    certainty: "confirmed",
    role: null,
    period: "unspecified",
    sourceSheet: "sheet",
    sourceCell: "A1",
    slot: null,
    shadow: false,
    startTimeOverride: null,
    endTimeOverride: null,
    changeNote: null,
    dutyFamily: "rasar",
    absenceKind: null,
    ...overrides,
  };
}

function guardEvent(date: string, overrides: Partial<Event> = {}): Event {
  return dutyEvent({ date, title: "שומר 1", rawValue: "שומר 1", dutyFamily: "guard", slot: 1, ...overrides });
}

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
    sourceCell: "Y10",
    ...overrides,
  };
}

const EMPTY_TARGETS: FairnessTargets = { supervisorTarget: null, technicianTarget: null };

function parseResult(overrides: Partial<FairnessTableParseResult> = {}): FairnessTableParseResult {
  return { personRows: [], totals: null, targets: EMPTY_TARGETS, ...overrides };
}

const NOW: LocalNow = { date: "2026-08-15", minuteOfDay: 600 };

describe("buildDutyFairnessReadModel — period (K)", () => {
  it("H1 of the current year, with today inside it, is reported current", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult(),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.period).toEqual({ key: "h1", year: 2026, label: "1–6/2026", status: "closed" });
  });

  it("H2 of the current year, with today inside it, is reported current", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult(),
      periodIdentity: { key: "h2", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.period.status).toBe("current");
  });

  it("a past year's H2 is reported closed via the SHARED foundation logic, not a duplicated computation", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult(),
      periodIdentity: { key: "h2", year: 2025 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.period).toEqual({ key: "h2", year: 2025, label: "7–12/2025", status: "closed" });
  });

  it("a future year's H1 is reported current", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult(),
      periodIdentity: { key: "h1", year: 2027 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.period.status).toBe("current");
  });

  it("carries the shared FAIRNESS_MODEL_VERSION", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult(),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.fairnessModelVersion).toBe(1);
  });
});

describe("buildDutyFairnessReadModel — E. existing deterministic target mapping preserved", () => {
  const targets: FairnessTargets = { supervisorTarget: 4, technicianTarget: 8 };

  it("a technician row gets the technician target", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ allocationLabel: "טכנאי", currentScore: 6 })],
        targets,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.comparisonTarget).toBe(8);
    expect(row?.status).toBe("below");
  });

  it('a supervisor row (\'אחמ"ש\') gets the supervisor target', () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ allocationLabel: 'אחמ"ש', currentScore: 4 })],
        targets,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "supervisor")?.rows[0];
    expect(row?.comparisonTarget).toBe(4);
    expect(row?.status).toBe("balanced");
  });

  it("a feminine-form supervisor row ('אחמשית') gets the SAME supervisor target and group as the masculine form -- regression coverage", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ allocationLabel: "אחמשית", currentScore: 4 })],
        targets,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.groups.map((g) => g.key)).toEqual(["supervisor"]);
    const row = model.groups.find((g) => g.key === "supervisor")?.rows[0];
    expect(row?.comparisonTarget).toBe(4);
    expect(row?.status).toBe("balanced");
  });

  it("an unknown/non-target-bearing allocation label never receives an invented target, even though period targets are known", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ allocationLabel: "הסמכה", currentScore: 3 })],
        targets,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "other")?.rows[0];
    expect(row?.comparisonTarget).toBeNull();
    expect(row?.status).toBeNull();
    // Not target-bearing at all -- this is the normal, complete outcome, not a flagged gap.
    expect(row?.dataCompleteness.reasons).not.toContain("duty_target_unavailable");
  });

  it("a target-bearing role whose period target note is missing is flagged, not silently zeroed", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ allocationLabel: "טכנאי", currentScore: 6 })],
        targets: EMPTY_TARGETS,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.comparisonTarget).toBeNull();
    expect(row?.status).toBeNull();
    expect(row?.dataCompleteness.status).toBe("partial");
    expect(row?.dataCompleteness.reasons).toContain("duty_target_unavailable");
  });
});

describe("buildDutyFairnessReadModel — F. grouping vs target eligibility are separate facts", () => {
  it('a \'ר"צ\'-labeled row belongs to the SUPERVISOR presentation group (a decided domain rule), but that grouping alone grants it no target', () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ allocationLabel: 'ר"צ', currentScore: 5, weekendCount: 1, exemptions: ["מטבח"] })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.groups.map((g) => g.key)).toEqual(["supervisor"]);
    const row = model.groups[0].rows[0];
    // Real workbook scores/weekend/exemptions still fully preserved.
    expect(row.currentScore).toBe(5);
    expect(row.weekendCount).toBe(1);
    expect(row.exemptions).toEqual([{ raw: "מטבח", affectedDutyFamilies: ["daily_kitchen", "full_kitchen", "weekend_kitchen"] }]);
    // But grouping alone never grants a target -- 'ר"צ' is not a target-bearing label.
    expect(row.comparisonTarget).toBeNull();
    expect(row.gapToTarget).toBeNull();
    expect(row.normalizedLoad).toBeNull();
    expect(row.status).toBeNull();
    // Not a genuine target gap either -- this is the normal, expected outcome for a non-target-bearing label.
    expect(row.dataCompleteness.reasons).not.toContain("duty_target_unavailable");
  });

  it('a \'ר"צ\'-labeled row sits alongside real \'אחמ"ש\' rows in the SAME supervisor group', () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [
          personRow({ resolvedPersonId: "p_rats", sourceName: "רס", allocationLabel: 'ר"צ', currentScore: 5 }),
          personRow({ resolvedPersonId: "p_sup", sourceName: "אחמש", allocationLabel: 'אחמ"ש', currentScore: 4 }),
        ],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.groups.map((g) => g.key)).toEqual(["supervisor"]);
    const supervisorGroup = model.groups.find((g) => g.key === "supervisor");
    expect(supervisorGroup?.rows).toHaveLength(2);
    const ratzRow = supervisorGroup?.rows.find((r) => r.allocationLabel === 'ר"צ');
    const supRow = supervisorGroup?.rows.find((r) => r.allocationLabel === 'אחמ"ש');
    expect(ratzRow?.comparisonTarget).toBeNull();
    expect(supRow?.comparisonTarget).toBe(4);
  });

  it("groups omit entirely when empty -- no invented empty supervisor/technician bucket", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ allocationLabel: "טכנאי" })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.groups.map((g) => g.key)).toEqual(["technician"]);
  });

  it("orders groups supervisor, technician, other when all three are present", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [
          personRow({ resolvedPersonId: "p_a", allocationLabel: "הסמכה" }),
          personRow({ resolvedPersonId: "p_b", allocationLabel: "טכנאי" }),
          personRow({ resolvedPersonId: "p_c", allocationLabel: 'אחמ"ש' }),
        ],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.groups.map((g) => g.key)).toEqual(["supervisor", "technician", "other"]);
  });
});

describe("buildDutyFairnessReadModel — G. exemptions are descriptive and never rewrite history", () => {
  it("an exemption is preserved, previous/current scores stay untouched, and status is not force-rewritten", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [
          personRow({
            allocationLabel: "טכנאי",
            previousScore: 5,
            currentScore: 6,
            exemptions: ["מטבח"],
          }),
        ],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.exemptions).toEqual([{ raw: "מטבח", affectedDutyFamilies: ["daily_kitchen", "full_kitchen", "weekend_kitchen"] }]);
    expect(row?.previousScore).toBe(5);
    expect(row?.currentScore).toBe(6);
    expect(row?.delta).toBe(1);
    // The exemption alone does not force any particular status -- it's a normal below/balanced/above from the real scores.
    expect(row?.status).toBe("below");
  });
});

describe("buildDutyFairnessReadModel — D. missing previous score", () => {
  it("null previous score -> null delta, never treated as 0, while current score/target/status still compute normally", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ allocationLabel: "טכנאי", previousScore: null, currentScore: 8 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.previousScore).toBeNull();
    expect(row?.delta).toBeNull();
    expect(row?.currentScore).toBe(8);
    expect(row?.status).toBe("balanced");
  });
});

describe("buildDutyFairnessReadModel — H. weekend count preserved, never a Shift Fairness weekend computation", () => {
  it("the source weekend count flows through untouched", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ allocationLabel: "טכנאי", weekendCount: 3 })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.weekendCount).toBe(3);
  });

  it("unavailable weekend count stays null, never 0", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ allocationLabel: "טכנאי", weekendCount: null })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.weekendCount).toBeNull();
  });
});

describe("buildDutyFairnessReadModel — I. totals: reported vs displayed are separate facts", () => {
  it("reported totals pass through untouched; displayed sums are independently computed; a difference is never labeled an error", () => {
    const totals: FairnessTotalsRow = {
      reportedPreviousTotal: 90,
      reportedCurrentTotal: 100,
      reportedWeekendTotal: 20,
      sourceSheet: "sheet",
      sourceCell: "Y30",
    };
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [
          personRow({ resolvedPersonId: "p_a", previousScore: 5, currentScore: 6, weekendCount: 2 }),
          personRow({ resolvedPersonId: "p_b", previousScore: 5, currentScore: 6, weekendCount: 2 }),
        ],
        totals,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.totals).toEqual({
      reportedPreviousTotal: 90,
      reportedCurrentTotal: 100,
      reportedWeekendTotal: 20,
      displayedPreviousSum: 10,
      displayedCurrentSum: 12,
      displayedWeekendSum: 4,
    });
    expect(model.totals).not.toHaveProperty("hasDiscrepancy");
  });

  it("no totals row in the source -> null, not a fabricated zero total", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({ personRows: [personRow()] }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    expect(model.totals).toBeNull();
  });
});

describe("buildDutyFairnessReadModel — unresolved identity stays visible, flagged, not discarded", () => {
  it("resolvedPersonId null -> personId null, row still fully displays with a real score/target, and the row is flagged", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: null, allocationLabel: "טכנאי", currentScore: 6 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.personId).toBeNull();
    expect(row?.currentScore).toBe(6);
    expect(row?.comparisonTarget).toBe(8);
    expect(row?.status).toBe("below");
    expect(row?.dataCompleteness.reasons).toContain("duty_identity_unresolved");
  });
});

describe("buildDutyFairnessReadModel — J. privacy: presentation-safe, no source implementation details", () => {
  it("no row carries email, sourceSheet, sourceCell, or any raw sheet array", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ allocationLabel: "טכנאי" })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row).not.toHaveProperty("email");
    expect(row).not.toHaveProperty("sourceSheet");
    expect(row).not.toHaveProperty("sourceCell");
    expect(JSON.stringify(model)).not.toContain("sourceCell");
    expect(JSON.stringify(model)).not.toContain("sourceSheet");
  });

  it("the row key never embeds a raw sheet cell reference", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", sourceCell: "Y42", allocationLabel: "טכנאי" })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.key).not.toContain("Y42");
    expect(row?.key).toBe("p1-0");
  });
});

describe("buildDutyFairnessReadModel — sorting: established ordering preserved (lowest normalized load first, unavailable last)", () => {
  it("sorts ascending by normalized load, unavailable-target rows after every modelable row, stable tie-break", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [
          personRow({ resolvedPersonId: "p_high", sourceName: "גבוה", allocationLabel: "טכנאי", currentScore: 7 }), // 7/8
          personRow({ resolvedPersonId: "p_low", sourceName: "נמוך", allocationLabel: "טכנאי", currentScore: 2 }), // 2/8
          personRow({ resolvedPersonId: "p_none", sourceName: "אין יעד", allocationLabel: "הסמכה", currentScore: 5 }), // no target
        ],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const allRows = model.groups.flatMap((g) => g.rows);
    expect(allRows.map((r) => r.sourceName)).toEqual(["נמוך", "גבוה", "אין יעד"]);
  });
});

describe("buildDutyFairnessReadModel — completedAllocationTotal: weighted, independent of the workbook score", () => {
  it("derives the weighted total from real schedule Events for the row's resolved person, distinct from the workbook's own currentScore", () => {
    const events: Event[] = [
      dutyEvent({ personId: "p1", date: "2026-01-10" }), // rasar 0.2
      dutyEvent({ personId: "p1", date: "2026-02-15" }), // rasar 0.2
      dutyEvent({ personId: "p1", date: "2026-03-20" }), // rasar 0.2
    ];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", currentScore: 6 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.completedAllocationTotal).toBeCloseTo(0.6);
    // Untouched workbook score, exactly as PR #3 already established -- this PR never recomputes it.
    expect(row?.currentScore).toBe(6);
    expect(row?.completedAllocationTotal).not.toBe(row?.currentScore);
  });

  it("a raw guard block flows through the block-based rules end to end: a 4-day Thu-Sun weekend block is ONE 1.0 allocation, never 4 x a per-day rate", () => {
    // 2026-01-01 is a real Thursday.
    const events: Event[] = [
      guardEvent("2026-01-01"),
      guardEvent("2026-01-02"),
      guardEvent("2026-01-03"),
      guardEvent("2026-01-04"),
    ];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי" })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.completedAllocationTotal).toBe(1);
  });

  it("an unsupported guard/reserve block shape makes the total null and flags duty_allocation_unsupported_block_shape, never a guessed weight", () => {
    const events: Event[] = [guardEvent("2026-01-05"), guardEvent("2026-01-06")]; // a real 2-day block -- no matching business rule
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי" })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.completedAllocationTotal).toBeNull();
    expect(row?.dataCompleteness.status).toBe("partial");
    expect(row?.dataCompleteness.reasons).toContain("duty_allocation_unsupported_block_shape");
  });

  it("never counts a future/planned duty, even inside the selected period", () => {
    const events: Event[] = [
      dutyEvent({ personId: "p1", date: "2026-08-14" }), // completed, before NOW (2026-08-15)
      dutyEvent({ personId: "p1", date: "2026-12-20" }), // still inside h2, but in the future relative to NOW
    ];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי" })],
      }),
      periodIdentity: { key: "h2", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.completedAllocationTotal).toBeCloseTo(0.2);
  });

  it("respects the SELECTED fairness period -- a duty from the other half-year is excluded", () => {
    const events: Event[] = [
      dutyEvent({ personId: "p1", date: "2026-03-01" }), // H1
      dutyEvent({ personId: "p1", date: "2026-08-01" }), // H2 -- not H1
    ];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי" })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.completedAllocationTotal).toBeCloseTo(0.2);
  });

  it('a non-comparable person (e.g. \'ר"צ\', null target/status) still shows a real completed-allocation total when the identity is resolved', () => {
    const events: Event[] = [dutyEvent({ personId: "p_rats", date: "2026-02-01" }), dutyEvent({ personId: "p_rats", date: "2026-03-01" })];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p_rats", sourceName: "רס", allocationLabel: 'ר"צ', currentScore: 5 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "supervisor")?.rows[0];
    expect(row?.status).toBeNull();
    expect(row?.comparisonTarget).toBeNull();
    expect(row?.completedAllocationTotal).toBeCloseTo(0.4);
  });

  it("an unresolved source name (personId null) gets a null completedAllocationTotal, never a fabricated 0", () => {
    const events: Event[] = [dutyEvent({ personId: "p1", date: "2026-02-01" })];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: null, allocationLabel: "טכנאי", currentScore: 6 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.personId).toBeNull();
    expect(row?.completedAllocationTotal).toBeNull();
  });

  describe("ROOT-CAUSE TRACE: a rasar-only person (Steven-shaped) rendering '—' is NEVER caused by computeCompletedDutyAllocation itself", () => {
    // Real production report: a person with six completed rasar days and
    // ZERO guard/reserve duty renders "—" instead of the expected 1.2. This
    // pair proves EXACTLY where that null can and cannot originate in this
    // read model, using the person's real duty shape (six rasar days,
    // fixture personId/name -- never the real person).
    const sixRasarDays: Event[] = [
      dutyEvent({ personId: "p_steven_shaped", date: "2026-07-03" }),
      dutyEvent({ personId: "p_steven_shaped", date: "2026-07-10" }),
      dutyEvent({ personId: "p_steven_shaped", date: "2026-07-17" }),
      dutyEvent({ personId: "p_steven_shaped", date: "2026-07-24" }),
      dutyEvent({ personId: "p_steven_shaped", date: "2026-07-31" }),
      dutyEvent({ personId: "p_steven_shaped", date: "2026-08-07" }),
    ];

    it("with a RESOLVED identity, the exact same six real rasar days correctly compute to 1.2 -- the scoring engine is innocent", () => {
      const model = buildDutyFairnessReadModel({
        parseResult: parseResult({
          personRows: [personRow({ resolvedPersonId: "p_steven_shaped", sourceName: "פיקציה בדיקה", allocationLabel: "טכנאי" })],
        }),
        periodIdentity: { key: "h2", year: 2026 },
        fetchedAt: "2026-08-19T10:00:00.000Z",
        now: { date: "2026-08-19", minuteOfDay: 600 },
        events: sixRasarDays,
      });
      const row = model.groups.find((g) => g.key === "technician")?.rows[0];
      expect(row?.completedAllocationTotal).toBeCloseTo(1.2);
      expect(row?.dataCompleteness.reasons).not.toContain("duty_allocation_unsupported_block_shape");
    });

    it("with an UNRESOLVED identity (the Fairness-table row name didn't match exactly one personnel record), the SAME six real rasar days never reach the scoring engine at all -- this is the true, and only, mechanism that can null a rasar-only person's total, flagged duty_identity_unresolved, never duty_allocation_unsupported_block_shape", () => {
      const model = buildDutyFairnessReadModel({
        parseResult: parseResult({
          // resolvedPersonId: null models `resolveSourcePersonId` failing to
          // find EXACTLY ONE personnel match for this row's source name --
          // e.g. a spelling/nickname/duplicate-name mismatch between the
          // Potential sheet's "טבלת צדק" row and the personnel (כ"א) sheet.
          // The real schedule events for this person (sixRasarDays, keyed
          // by their TRUE personId) are still supplied here to prove they
          // are simply never joined -- not recomputed incorrectly, not
          // partially dropped, just never reached.
          personRows: [personRow({ resolvedPersonId: null, sourceName: "פיקציה בדיקה", allocationLabel: "טכנאי" })],
        }),
        periodIdentity: { key: "h2", year: 2026 },
        fetchedAt: "2026-08-19T10:00:00.000Z",
        now: { date: "2026-08-19", minuteOfDay: 600 },
        events: sixRasarDays,
      });
      const row = model.groups.find((g) => g.key === "technician")?.rows[0];
      expect(row?.personId).toBeNull();
      expect(row?.completedAllocationTotal).toBeNull();
      expect(row?.dataCompleteness.reasons).toContain("duty_identity_unresolved");
      // Specifically NOT the guard/reserve shape reason -- there is no
      // guard/reserve duty involved anywhere in this scenario.
      expect(row?.dataCompleteness.reasons).not.toContain("duty_allocation_unsupported_block_shape");
    });
  });

  it("no events supplied (default []) -> 0 for a resolved person, never a crash", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי" })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.completedAllocationTotal).toBe(0);
  });
});

describe("buildDutyFairnessReadModel — Justice Table redesign, corrected: progress/remaining/pace against the workbook's own currentScore", () => {
  const targets: FairnessTargets = { supervisorTarget: 4, technicianTarget: 8 };

  it("personalTargetTotal is the workbook's own currentScore value, completely independent of comparisonTarget/targets -- and targetProgressRatio uses it, never the workbook role-based constant", () => {
    const events: Event[] = [
      dutyEvent({ personId: "p1", date: "2026-02-01" }),
      dutyEvent({ personId: "p1", date: "2026-02-08" }),
    ]; // 2 rasar days -> completedAllocationTotal 0.4
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", currentScore: 0.8 })],
        targets,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.completedAllocationTotal).toBeCloseTo(0.4);
    expect(row?.personalTargetTotal).toBe(0.8);
    expect(row?.targetProgressRatio).toBeCloseTo(0.5); // 0.4 / 0.8 -- NOT 0.4 / 8
    expect(row?.normalizedLoad).toBeCloseTo(0.1); // 0.8 / 8 -- currentScore/comparisonTarget-based, entirely unaffected
  });

  it("two people with the SAME allocationLabel (hence the SAME workbook comparisonTarget) get DIFFERENT personalTargetTotal/targetProgressRatio, because the workbook publishes a personal currentScore for each of them", () => {
    const lightPersonRow = personRow({ resolvedPersonId: "p_light", allocationLabel: "טכנאי", currentScore: 2 });
    const heavyPersonRow = personRow({ resolvedPersonId: "p_heavy", allocationLabel: "טכנאי", currentScore: 8 });

    const events: Event[] = [
      dutyEvent({ personId: "p_light", date: "2026-02-01" }), // 0.2 completed
      dutyEvent({ personId: "p_heavy", date: "2026-02-01" }), // 0.2 completed -- SAME as p_light
    ];

    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({ personRows: [lightPersonRow, heavyPersonRow], targets }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const rows = model.groups.find((g) => g.key === "technician")?.rows ?? [];
    const lightRow = rows.find((r) => r.personId === "p_light");
    const heavyRow = rows.find((r) => r.personId === "p_heavy");

    expect(lightRow?.completedAllocationTotal).toBeCloseTo(0.2);
    expect(heavyRow?.completedAllocationTotal).toBeCloseTo(0.2);
    // Same completed work, same workbook comparisonTarget (both טכנאי) --
    // but genuinely different personal targets and therefore progress.
    expect(lightRow?.comparisonTarget).toBe(heavyRow?.comparisonTarget);
    expect(lightRow?.personalTargetTotal).toBe(2);
    expect(heavyRow?.personalTargetTotal).toBe(8);
    expect(lightRow?.targetProgressRatio).toBeCloseTo(0.1); // 0.2 / 2
    expect(heavyRow?.targetProgressRatio).toBeCloseTo(0.025); // 0.2 / 8
  });

  it("remainingToTarget is signed: positive while under target, negative ('beyond potential') once exceeded -- against personalTargetTotal (the workbook's currentScore), never comparisonTarget", () => {
    const under: Event[] = [dutyEvent({ personId: "p1", date: "2026-02-01" })]; // 0.2 completed
    const modelUnder = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", currentScore: 1 })],
        targets,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events: under,
    });
    const rowUnder = modelUnder.groups.find((g) => g.key === "technician")?.rows[0];
    expect(rowUnder?.personalTargetTotal).toBe(1);
    expect(rowUnder?.remainingToTarget).toBeCloseTo(0.8); // 1.0 - 0.2

    const overEvents: Event[] = [
      guardEvent("2026-01-01"), // weekend 1.0
      guardEvent("2026-01-02"),
      guardEvent("2026-01-03"),
      guardEvent("2026-01-04"),
    ];
    const modelOver = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: 'אחמ"ש', currentScore: 0.25 })],
        targets,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events: overEvents,
    });
    const rowOver = modelOver.groups.find((g) => g.key === "supervisor")?.rows[0];
    expect(rowOver?.completedAllocationTotal).toBe(1);
    expect(rowOver?.personalTargetTotal).toBe(0.25);
    expect(rowOver?.remainingToTarget).toBeCloseTo(-0.75); // 0.25 - 1
  });

  it("personalTargetTotal is null exactly when the workbook's own currentScore cell is unavailable ('-'/blank) -- completely independent of completedAllocationTotal's own unsupported-block-shape gap, which stays a real, SEPARATE fact", () => {
    const events: Event[] = [
      guardEvent("2026-02-05", { personId: "p_rats" }),
      guardEvent("2026-02-06", { personId: "p_rats" }),
    ]; // a real 2-day block -- no matching business rule -> completedAllocationTotal null
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p_rats", allocationLabel: 'ר"צ', currentScore: null })],
        targets,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "supervisor")?.rows[0];
    expect(row?.completedAllocationTotal).toBeNull();
    expect(row?.personalTargetTotal).toBeNull();
    expect(row?.targetProgressRatio).toBeNull();
    expect(row?.remainingToTarget).toBeNull();
    expect(row?.paceStatus).toBeNull();
    expect(row?.dataCompleteness.reasons).toContain("duty_allocation_unsupported_block_shape");
  });

  it("a real zero personalTargetTotal (the workbook's own currentScore is exactly 0) makes progress/pace null, never a divide-by-zero/guessed 0%", () => {
    const events: Event[] = [dutyEvent({ personId: "p1", date: "2026-02-01" })]; // 0.2 completed
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", currentScore: 0 })],
        targets,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.personalTargetTotal).toBe(0);
    expect(row?.targetProgressRatio).toBeNull();
    expect(row?.paceStatus).toBeNull();
  });

  it("paceStatus compares progress% against the SAME whole-period elapsed% for everyone (no personal participation window)", () => {
    // H1 2026: Jan 1 - Jun 30 (180 days). NOW = 2026-08-15 is used for a
    // CLOSED h1 period here so effectiveEndDate is fixed at period end
    // (Jun 30) regardless of "today" -- elapsed% is therefore 100%.
    const events: Event[] = [
      dutyEvent({ personId: "p1", date: "2026-01-05" }),
      dutyEvent({ personId: "p1", date: "2026-02-05" }),
    ]; // 2 rasar days -> 0.4 completed
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", currentScore: 0.25 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW, // period already closed
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    // 0.4/0.25 = 160% progress vs. 100% elapsed -> well ahead of pace.
    expect(row?.targetProgressRatio).toBeCloseTo(1.6);
    expect(row?.paceStatus).toBe("ahead_of_pace");
  });

  it("paceStatus is on_pace when progress and elapsed% roughly match", () => {
    // H2 2026: Jul 1 - Dec 31 (183 days). now = 2026-09-29 -> 90 days elapsed, ~49.2%.
    const now: LocalNow = { date: "2026-09-29", minuteOfDay: 600 };
    // A confirmed Thu-Sun weekend guard block (2026-07-02 is a real
    // Thursday) -> completedAllocationTotal 1.0. Workbook target 2.0 ->
    // 1.0 / 2.0 = 50% progress, matching the ~49% elapsed time within ±5pp.
    const events: Event[] = [
      guardEvent("2026-07-02"),
      guardEvent("2026-07-03"),
      guardEvent("2026-07-04"),
      guardEvent("2026-07-05"),
    ];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: 'אחמ"ש', currentScore: 2 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h2", year: 2026 },
      fetchedAt: "2026-09-29T10:00:00.000Z",
      now,
      events,
    });
    const row = model.groups.find((g) => g.key === "supervisor")?.rows[0];
    expect(row?.completedAllocationTotal).toBe(1);
    expect(row?.personalTargetTotal).toBe(2);
    expect(row?.targetProgressRatio).toBeCloseTo(0.5);
    expect(row?.paceStatus).toBe("on_pace");
  });
});

describe("buildDutyFairnessReadModel — Emergency Mode: excludedDates and isEmergencyModeActive default to zero-behavior-change (spec section 19)", () => {
  it("omitting excludedDates/isEmergencyModeActive entirely behaves byte-for-byte identically to passing an empty set / false", () => {
    const events: Event[] = [dutyEvent({ personId: "p1", date: "2026-01-05" })];
    const input = {
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", currentScore: 0.25 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 } as const,
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    };
    const withoutFields = buildDutyFairnessReadModel(input);
    const withExplicitDefaults = buildDutyFairnessReadModel({ ...input, excludedDates: new Set(), isEmergencyModeActive: false });
    expect(withoutFields).toEqual(withExplicitDefaults);
  });

  it("excludedDates removes a completed duty on that date from completedAllocationTotal", () => {
    const events: Event[] = [
      dutyEvent({ personId: "p1", date: "2026-01-05" }),
      dutyEvent({ personId: "p1", date: "2026-02-05" }),
    ]; // 2 rasar days -> 0.4 completed, unless excluded
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", currentScore: 0.25 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
      excludedDates: new Set(["2026-01-05"]),
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.completedAllocationTotal).toBeCloseTo(0.2); // only 02-05 counts
  });

  it("excludedDates shrinks the elapsed-time denominator used for paceStatus (numerator and denominator both exclude the same dates)", () => {
    // H1 2026: Jan 1 - Jun 30 (181 days incl. both ends). NOW closes the
    // period, so effectiveEndDate = periodEndDate either way -- this test
    // isolates the excludedDates effect on completedAllocationTotal/target
    // progress rather than elapsed%, which is already 100% for a closed
    // period regardless of exclusion (see dutyPace.test.ts for elapsed%
    // exclusion coverage in isolation).
    const events: Event[] = [dutyEvent({ personId: "p1", date: "2026-01-05" })]; // excluded below
    const excludedModel = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", currentScore: 0.25 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
      excludedDates: new Set(["2026-01-05"]),
    });
    const excludedRow = excludedModel.groups.find((g) => g.key === "technician")?.rows[0];
    expect(excludedRow?.completedAllocationTotal).toBe(0);
    expect(excludedRow?.targetProgressRatio).toBe(0);
  });

  it("isEmergencyModeActive: true forces paceStatus to 'suspended' EVEN WHEN progress/elapsed% would otherwise resolve to a real below/on/ahead verdict", () => {
    // Same fixture as the "ahead_of_pace" test above -- without
    // isEmergencyModeActive this would resolve to "ahead_of_pace".
    const events: Event[] = [
      dutyEvent({ personId: "p1", date: "2026-01-05" }),
      dutyEvent({ personId: "p1", date: "2026-02-05" }),
    ];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", currentScore: 0.25 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
      isEmergencyModeActive: true,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.targetProgressRatio).toBeCloseTo(1.6); // progress itself is unaffected
    expect(row?.paceStatus).toBe("suspended");
  });

  it("isEmergencyModeActive: true still forces 'suspended' even for a row with no progress ratio at all (paceStatus would otherwise be null)", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", currentScore: null })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events: [],
      isEmergencyModeActive: true,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.targetProgressRatio).toBeNull();
    expect(row?.paceStatus).toBe("suspended");
  });

  it("isEmergencyModeActive: false (the default) never forces 'suspended' -- normal pace judgment applies", () => {
    const events: Event[] = [
      dutyEvent({ personId: "p1", date: "2026-01-05" }),
      dutyEvent({ personId: "p1", date: "2026-02-05" }),
    ];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", currentScore: 0.25 })],
        targets: { supervisorTarget: 4, technicianTarget: 8 },
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
      isEmergencyModeActive: false,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.paceStatus).toBe("ahead_of_pace");
  });
});

describe("buildDutyFairnessReadModel — weekendCount suppression when the period overlaps an Emergency Mode date (product requirement: never distort normal fairness)", () => {
  // H1 2026 runs 2026-01-01..2026-06-30 -- there is NO per-date breakdown
  // anywhere in the source `weekendCount` figure (it's one raw workbook
  // aggregate per person per period), so it can never be trustworthily
  // recomputed to exclude an emergency weekend -- the whole value must be
  // suppressed instead, never guessed at.
  it("nulls weekendCount and adds duty_weekend_count_emergency_period when an excluded date falls inside the selected period", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", weekendCount: 4 })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      excludedDates: new Set(["2026-03-12"]),
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.weekendCount).toBeNull();
    expect(row?.dataCompleteness.reasons).toContain("duty_weekend_count_emergency_period");
  });

  it("leaves weekendCount untouched when excludedDates is non-empty but no date falls inside the selected period", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", weekendCount: 4 })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      excludedDates: new Set(["2026-08-20"]), // inside H2, not H1
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.weekendCount).toBe(4);
    expect(row?.dataCompleteness.reasons).not.toContain("duty_weekend_count_emergency_period");
  });

  it("suppresses weekendCount for a date exactly on the period's own start/end boundary (inclusive)", () => {
    const startBoundaryModel = buildDutyFairnessReadModel({
      parseResult: parseResult({ personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", weekendCount: 4 })] }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      excludedDates: new Set(["2026-01-01"]),
    });
    const endBoundaryModel = buildDutyFairnessReadModel({
      parseResult: parseResult({ personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", weekendCount: 4 })] }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      excludedDates: new Set(["2026-06-30"]),
    });
    expect(startBoundaryModel.groups.find((g) => g.key === "technician")?.rows[0]?.weekendCount).toBeNull();
    expect(endBoundaryModel.groups.find((g) => g.key === "technician")?.rows[0]?.weekendCount).toBeNull();
  });

  it("applies uniformly to every row in the period, not just the person whose duty happened during the emergency", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [
          personRow({ resolvedPersonId: "p1", sourceName: "אדם ראשון", allocationLabel: "טכנאי", weekendCount: 4 }),
          personRow({ resolvedPersonId: "p2", sourceName: "אדם שני", allocationLabel: "טכנאי", weekendCount: 1 }),
        ],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      excludedDates: new Set(["2026-03-12"]),
    });
    const rows = model.groups.find((g) => g.key === "technician")?.rows ?? [];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.weekendCount).toBeNull();
      expect(row.dataCompleteness.reasons).toContain("duty_weekend_count_emergency_period");
    }
  });

  it("an empty excludedDates set (the default) never suppresses weekendCount", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", weekendCount: 4 })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.weekendCount).toBe(4);
    expect(row?.dataCompleteness.reasons).not.toContain("duty_weekend_count_emergency_period");
  });

  it("suppression is independent of isEmergencyModeActive -- a PAST recorded emergency inside a closed period still suppresses even though Emergency Mode is not currently active", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", weekendCount: 4 })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      excludedDates: new Set(["2026-03-12"]),
      isEmergencyModeActive: false,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.weekendCount).toBeNull();
  });

  it("a weekendCount already null for an unrelated reason (no workbook figure) is NOT tagged with the emergency reason when there's no overlap", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי", weekendCount: null })],
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.weekendCount).toBeNull();
    expect(row?.dataCompleteness.reasons).not.toContain("duty_weekend_count_emergency_period");
  });
});

describe("buildDutyFairnessReadModel — real-workbook regression: personalTargetTotal reuses the workbook's own currentScore, never the removed Potential-event reconstruction", () => {
  const targets: FairnessTargets = { supervisorTarget: 4, technicianTarget: 8 };

  it("period 7-12/2026: Steven (6.3), Lior (6.2), and Gidon (6) share the SAME technician role but get their own real workbook targets, not the role's flat 8 and not a reconstructed total", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [
          personRow({ resolvedPersonId: "p_steven", sourceName: "סטיבן פופנרוב", allocationLabel: "טכנאי", currentScore: 6.3 }),
          personRow({ resolvedPersonId: "p_lior", sourceName: "ליאור בגון", allocationLabel: "טכנאי", currentScore: 6.2 }),
          personRow({ resolvedPersonId: "p_gidon", sourceName: "גדעון פולין", allocationLabel: "טכנאי", currentScore: 6 }),
        ],
        targets,
      }),
      periodIdentity: { key: "h2", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const rows = model.groups.find((g) => g.key === "technician")?.rows ?? [];
    expect(rows.find((r) => r.personId === "p_steven")?.personalTargetTotal).toBe(6.3);
    expect(rows.find((r) => r.personId === "p_lior")?.personalTargetTotal).toBe(6.2);
    expect(rows.find((r) => r.personId === "p_gidon")?.personalTargetTotal).toBe(6);
    // Every one of them shares the SAME role-based comparisonTarget (8) --
    // proving the personal target is genuinely independent of it.
    expect(rows.find((r) => r.personId === "p_steven")?.comparisonTarget).toBe(8);
    expect(rows.find((r) => r.personId === "p_lior")?.comparisonTarget).toBe(8);
    expect(rows.find((r) => r.personId === "p_gidon")?.comparisonTarget).toBe(8);
  });

  it("period 1-6/2026: Lior's (2.9) and Steven's (5.8) targets are the workbook's own figures for THIS period -- proving personalTargetTotal is read straight from the row, never a fixed per-person constant either", () => {
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [
          personRow({ resolvedPersonId: "p_lior", sourceName: "ליאור בגון", allocationLabel: "טכנאי", currentScore: 2.9 }),
          personRow({ resolvedPersonId: "p_steven", sourceName: "סטיבן פופנרוב", allocationLabel: "טכנאי", currentScore: 5.8 }),
        ],
        targets,
      }),
      periodIdentity: { key: "h1", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
    });
    const rows = model.groups.find((g) => g.key === "technician")?.rows ?? [];
    expect(rows.find((r) => r.personId === "p_lior")?.personalTargetTotal).toBe(2.9);
    expect(rows.find((r) => r.personId === "p_steven")?.personalTargetTotal).toBe(5.8);
  });
});

describe("buildDutyFairnessReadModel — Justice Table redesign: LIVE duty", () => {
  it("reports liveDuty for a currently in-progress completion-based block, only within the CURRENT period", () => {
    // h2 2026 is current as of NOW (2026-08-15). A weekend guard block
    // starting today (Thu 2026-08-13 -> Sun 2026-08-16) is still active.
    const events: Event[] = [
      guardEvent("2026-08-13"),
      guardEvent("2026-08-14"),
      guardEvent("2026-08-15"),
      guardEvent("2026-08-16"),
    ];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי" })],
      }),
      periodIdentity: { key: "h2", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.liveDuty).toEqual({ dutyFamily: "guard", slot: 1 });
    // Not yet counted as completed, since it hasn't finished.
    expect(row?.completedAllocationTotal).toBe(0);
  });

  it("never reports liveDuty for a CLOSED period, even if a real-world block happens to overlap today", () => {
    const events: Event[] = [
      guardEvent("2026-08-13"),
      guardEvent("2026-08-14"),
      guardEvent("2026-08-15"),
      guardEvent("2026-08-16"),
    ];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי" })],
      }),
      periodIdentity: { key: "h1", year: 2026 }, // already closed as of NOW
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.liveDuty).toBeNull();
  });

  it("never reports liveDuty for an unresolved identity", () => {
    const events: Event[] = [
      guardEvent("2026-08-13"),
      guardEvent("2026-08-14"),
      guardEvent("2026-08-15"),
      guardEvent("2026-08-16"),
    ];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: null, allocationLabel: "טכנאי" })],
      }),
      periodIdentity: { key: "h2", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.liveDuty).toBeNull();
  });

  it("never reports liveDuty for a day-based family (rasar) -- it already accrues per day, nothing withheld", () => {
    const events: Event[] = [dutyEvent({ personId: "p1", date: "2026-08-15" })];
    const model = buildDutyFairnessReadModel({
      parseResult: parseResult({
        personRows: [personRow({ resolvedPersonId: "p1", allocationLabel: "טכנאי" })],
      }),
      periodIdentity: { key: "h2", year: 2026 },
      fetchedAt: "2026-08-15T10:00:00.000Z",
      now: NOW,
      events,
    });
    const row = model.groups.find((g) => g.key === "technician")?.rows[0];
    expect(row?.liveDuty).toBeNull();
  });
});
