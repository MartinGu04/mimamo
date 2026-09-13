import { describe, expect, it } from "vitest";
import type { SemanticFact } from "./semanticFacts";
import { diffSemanticFacts } from "./diffFacts";

function facts(entries: SemanticFact[]): Map<string, SemanticFact> {
  return new Map(entries.map((fact) => [fact.factKey, fact]));
}

describe("diffSemanticFacts", () => {
  it("produces no change when a fact's value is identical", () => {
    const shift: SemanticFact = { factKey: "shift:p1:2026-08-18", category: "shift", value: { entries: [{ period: "day", role: "technician", shadow: false }] } };
    const changes = diffSemanticFacts(facts([shift]), facts([shift]));
    expect(changes).toEqual([]);
  });

  it("treats a jsonb round trip with reordered object keys as the same semantic value", () => {
    const fromPostgres: SemanticFact = {
      factKey: "shift:p1:2026-08-18",
      category: "shift",
      value: { entries: [{ role: "technician", period: "day", shadow: false }] },
    };
    const fresh: SemanticFact = {
      factKey: "shift:p1:2026-08-18",
      category: "shift",
      value: { entries: [{ period: "day", role: "technician", shadow: false }] },
    };

    expect(diffSemanticFacts(facts([fromPostgres]), facts([fresh]))).toEqual([]);
  });

  it("detects a genuine value change", () => {
    const oldFact: SemanticFact = { factKey: "shift:p1:2026-08-18", category: "shift", value: { entries: [{ period: "day", role: "technician", shadow: false }] } };
    const newFact: SemanticFact = { factKey: "shift:p1:2026-08-18", category: "shift", value: { entries: [{ period: "night", role: "technician", shadow: false }] } };
    const changes = diffSemanticFacts(facts([oldFact]), facts([newFact]));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      factKey: "shift:p1:2026-08-18",
      category: "shift",
      oldValue: oldFact.value,
      newValue: newFact.value,
    });
  });

  it("a fact appearing for the first time has oldValue null", () => {
    const newFact: SemanticFact = { factKey: "shift:p1:2026-08-18", category: "shift", value: { entries: [{ period: "day", role: "technician", shadow: false }] } };
    const changes = diffSemanticFacts(facts([]), facts([newFact]));
    expect(changes).toEqual([{ factKey: "shift:p1:2026-08-18", category: "shift", oldValue: null, newValue: newFact.value }]);
  });

  it("a fact disappearing has newValue null", () => {
    const oldFact: SemanticFact = { factKey: "shift:p1:2026-08-18", category: "shift", value: { entries: [{ period: "day", role: "technician", shadow: false }] } };
    const changes = diffSemanticFacts(facts([oldFact]), facts([]));
    expect(changes).toEqual([{ factKey: "shift:p1:2026-08-18", category: "shift", oldValue: oldFact.value, newValue: null }]);
  });

  it("unrelated unchanged facts never appear in the diff -- only genuinely different keys are returned", () => {
    const unchanged: SemanticFact = { factKey: "duty:p2:2026-08-19", category: "duty", value: { entries: [] } };
    const changes = diffSemanticFacts(facts([unchanged]), facts([unchanged]));
    expect(changes).toEqual([]);
  });
});
