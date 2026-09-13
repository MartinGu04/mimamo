import type { SemanticFact, SemanticFactCategory, SemanticFactValue } from "./semanticFacts";

export interface FactChange {
  factKey: string;
  category: SemanticFactCategory;
  oldValue: SemanticFactValue | null;
  newValue: SemanticFactValue | null;
}

/**
 * Semantic facts are persisted as Postgres `jsonb`, which does not preserve
 * object-key insertion order. Compare the JSON structure recursively instead
 * of stringifying it so a PostgREST round trip cannot turn an identical fact
 * into a false change. Array order remains significant; every semantic-fact
 * producer already normalizes its arrays before persistence.
 */
export function semanticFactValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;

  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);
  if (leftIsArray || rightIsArray) {
    if (!leftIsArray || !rightIsArray || left.length !== right.length) return false;
    return left.every((value, index) => semanticFactValuesEqual(value, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every(
    (key, index) => key === rightKeys[index] && semanticFactValuesEqual(leftRecord[key], rightRecord[key]),
  );
}

/**
 * Pure structural diff between the last SETTLED facts (`oldFacts`) and a
 * fresh read (`newFacts`) -- a change only exists here when the
 * normalized VALUE actually differs, never because of cell formatting,
 * row order, or an unrelated column moving (those never reach this
 * layer at all, since `semanticFacts.ts` already normalized past them).
 * This is "semantic diffing, not raw cell diffing" (PR #30 spec section
 * 10) made concrete.
 */
export function diffSemanticFacts(
  oldFacts: ReadonlyMap<string, SemanticFact>,
  newFacts: ReadonlyMap<string, SemanticFact>,
): FactChange[] {
  const changes: FactChange[] = [];
  const allKeys = new Set([...oldFacts.keys(), ...newFacts.keys()]);

  for (const key of allKeys) {
    const oldFact = oldFacts.get(key);
    const newFact = newFacts.get(key);
    const oldValue = oldFact?.value ?? null;
    const newValue = newFact?.value ?? null;

    if (semanticFactValuesEqual(oldValue, newValue)) continue;

    changes.push({
      factKey: key,
      category: (newFact ?? oldFact)!.category,
      oldValue,
      newValue,
    });
  }

  return changes;
}
