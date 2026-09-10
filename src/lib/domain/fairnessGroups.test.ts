import { describe, expect, it } from "vitest";
import {
  buildFairnessComparisonGroups,
  buildFairnessPersonContext,
  resolveFairnessComparisonGroupKey,
} from "./fairnessGroups";
import type { Person } from "./types";

const PERIOD_START = "2026-08-01";
const PERIOD_END = "2026-08-31";

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "p_x",
    name: "שם",
    email: null,
    isManager: false,
    isTechnician: false,
    isSupervisor: false,
    personnelType: "חובה",
    dischargeDate: null,
    enlistmentDate: null,
    ...overrides,
  };
}

describe("resolveFairnessComparisonGroupKey", () => {
  it("supervisor capability -> supervisor", () => {
    expect(resolveFairnessComparisonGroupKey(person({ isSupervisor: true }))).toBe("supervisor");
  });

  it("technician capability -> technician", () => {
    expect(resolveFairnessComparisonGroupKey(person({ isTechnician: true }))).toBe("technician");
  });

  it("neither capability -> null, never a fabricated 'other' group", () => {
    expect(resolveFairnessComparisonGroupKey(person())).toBeNull();
  });
});

describe("buildFairnessComparisonGroups", () => {
  it("groups by actual rotation capability, never by personnelType/title", () => {
    const supervisor = person({ id: "p_sup", isSupervisor: true });
    const technician = person({ id: "p_tech", isTechnician: true });

    const groups = buildFairnessComparisonGroups([supervisor, technician]);

    expect(groups).toEqual([
      { key: "supervisor", personIds: ["p_sup"] },
      { key: "technician", personIds: ["p_tech"] },
    ]);
  });

  it("a person who is neither supervisor- nor technician-capable is omitted entirely -- never forced into a catch-all 'other' group", () => {
    const supervisor = person({ id: "p_sup", isSupervisor: true });
    const neither = person({ id: "p_neither" });

    const groups = buildFairnessComparisonGroups([supervisor, neither]);

    expect(groups).toEqual([{ key: "supervisor", personIds: ["p_sup"] }]);
    expect(groups.some((group) => group.personIds.includes("p_neither"))).toBe(false);
  });

  it("everyone lacking a capability -> no groups at all, never an empty-but-present 'other' bucket", () => {
    const groups = buildFairnessComparisonGroups([person({ id: "p_a" }), person({ id: "p_b" })]);
    expect(groups).toEqual([]);
  });

  it("an empty group is omitted, never rendered as an empty bucket", () => {
    const technician = person({ id: "p_tech", isTechnician: true });
    const groups = buildFairnessComparisonGroups([technician]);
    expect(groups).toEqual([{ key: "technician", personIds: ["p_tech"] }]);
  });

  it("supervisor takes precedence for a dual-capability person -- appears once, in supervisor only", () => {
    const dual = person({ id: "p_dual", isSupervisor: true, isTechnician: true });
    const groups = buildFairnessComparisonGroups([dual]);
    expect(groups).toEqual([{ key: "supervisor", personIds: ["p_dual"] }]);
  });

  it('אחמ"ש + ר"צ: a person whose personnelType/title metadata is anything else still lands in the supervisor group purely from isSupervisor -- role-title text is never consulted', () => {
    // המחלבה does not store a "ר״צ" title field on Person today -- only
    // the personnelType service category (קבע/חובה/מילואים) and the
    // isSupervisor/isTechnician capability flags. This test documents the
    // domain rule that will keep such a person correctly grouped once
    // richer role-metadata (e.g. a displayed "אחמ״ש + ר״צ" label) exists:
    // grouping never depends on that metadata, only on actual capability.
    const razatzhWhoWorksSupervisorRotation = person({
      id: "p_razatzh",
      personnelType: "קבע",
      dischargeDate: null,
      enlistmentDate: null,
      isSupervisor: true,
      isTechnician: false,
    });
    const groups = buildFairnessComparisonGroups([razatzhWhoWorksSupervisorRotation]);
    expect(groups).toEqual([{ key: "supervisor", personIds: ["p_razatzh"] }]);
  });
});

describe("buildFairnessPersonContext", () => {
  it("ties group + participation + eligibility + combined data completeness together", () => {
    const p = person({ id: "p_ctx", isSupervisor: true, personnelType: "חובה" });
    const context = buildFairnessPersonContext(p, [], PERIOD_START, PERIOD_END);

    expect(context.personId).toBe("p_ctx");
    expect(context.group).toBe("supervisor");
    expect(context.participation.basis).toBe("full_period");
    expect(context.eligibility).toHaveLength(2);
    expect(context.eligibility.find((entry) => entry.role === "supervisor")?.eligible).toBe(true);
    expect(context.eligibility.find((entry) => entry.role === "technician")?.eligible).toBe(false);
    // Both participation (assumed full_period) and eligibility (undated) are only partially known today, so the combined result is partial too.
    expect(context.dataCompleteness.status).toBe("partial");
    expect(context.dataCompleteness.reasons).toEqual(
      expect.arrayContaining(["participation_assumed_full_period", "eligibility_undated"]),
    );
    // A capable, grouped person contributes no "fairness_group_unassigned" reason.
    expect(context.dataCompleteness.reasons).not.toContain("fairness_group_unassigned");
  });

  it("carries participation's own incompleteness reason through to the combined result", () => {
    const p = person({ id: "p_res", isSupervisor: true, personnelType: "מילואים" });
    const context = buildFairnessPersonContext(p, [], PERIOD_START, PERIOD_END);
    expect(context.participation.basis).toBe("unknown");
    expect(context.dataCompleteness.reasons).toEqual(
      expect.arrayContaining(["participation_unknown", "eligibility_undated"]),
    );
  });

  it("a person in no meaningful comparison group gets group: null and a 'fairness_group_unassigned' completeness reason", () => {
    const p = person({ id: "p_neither", personnelType: "חובה" });
    const context = buildFairnessPersonContext(p, [], PERIOD_START, PERIOD_END);
    expect(context.group).toBeNull();
    expect(context.dataCompleteness.reasons).toContain("fairness_group_unassigned");
  });
});
