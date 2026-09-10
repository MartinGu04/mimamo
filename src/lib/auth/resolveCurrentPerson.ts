import "server-only";
import { fetchRawWorkbookSnapshot } from "@/lib/google";
import { parsePersonnelSheet } from "@/lib/parsers/personnel";
import type { Person } from "@/lib/domain/types";
import { getAuthenticatedIdentity, type AuthIdentityResult } from "./currentUser";

export type ResolveCurrentPersonResult =
  | { status: "unauthenticated" }
  | { status: "missing_email" }
  | { status: "unmapped"; email: string }
  | { status: "ambiguous_identity" }
  | { status: "ok"; person: Person };

export type PersonEmailLookupResult =
  | { status: "not_found" }
  | { status: "found"; person: Person }
  | { status: "ambiguous" };

/**
 * Matches an authenticated email against parsed כ"א personnel by email
 * only — never by display-name similarity. Comparison is trimmed and
 * case-insensitive (and nothing further: email equality, not fuzzy
 * matching). Fails closed: if the normalized email matches more than one
 * personnel record, this is "ambiguous", never a silent first-match —
 * two people sharing a (differently-cased/spaced) email in כ"א must never
 * let either of them in as the other. Pure and independently testable
 * with synthetic Person[].
 */
export function findPersonByEmail(people: readonly Person[], email: string): PersonEmailLookupResult {
  const normalized = normalizeEmailForComparison(email);
  const matches = people.filter(
    (person) => person.email !== null && normalizeEmailForComparison(person.email) === normalized,
  );

  if (matches.length === 0) return { status: "not_found" };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "found", person: matches[0] };
}

function normalizeEmailForComparison(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The identity <-> personnel mapping step, factored out as a pure function
 * of an already-resolved `AuthIdentityResult` and an already-parsed
 * personnel list. This is what lets a caller that has already fetched and
 * parsed כ"א for its own purposes (e.g. the personal schedule read model)
 * reuse the exact same fail-closed mapping behavior without triggering a
 * second Google personnel request or a second personnel parse.
 */
export function resolveIdentityAgainstPeople(
  identity: AuthIdentityResult,
  people: readonly Person[],
): ResolveCurrentPersonResult {
  if (identity.status === "unauthenticated") return { status: "unauthenticated" };
  if (identity.status === "missing_email") return { status: "missing_email" };

  const lookup = findPersonByEmail(people, identity.email);

  if (lookup.status === "not_found") return { status: "unmapped", email: identity.email };
  if (lookup.status === "ambiguous") return { status: "ambiguous_identity" };

  return { status: "ok", person: lookup.person };
}

/**
 * Maps the authenticated Supabase user to a parsed כ"א `Person`, given an
 * already-parsed personnel list (e.g. from a caller that batch-fetched
 * personnel alongside other sheets). Fetches nothing from Google itself —
 * only resolves the Supabase identity and delegates to
 * `resolveIdentityAgainstPeople` for the exact same fail-closed mapping
 * behavior as `resolveCurrentPerson`.
 */
export async function resolveCurrentPersonFromPeople(
  people: readonly Person[],
): Promise<ResolveCurrentPersonResult> {
  const identity = await getAuthenticatedIdentity();
  return resolveIdentityAgainstPeople(identity, people);
}

/**
 * Maps the authenticated Supabase user to a parsed כ"א `Person`:
 *
 * 1. requires an authenticated Supabase user with a usable email (never
 *    trusts a client-supplied email, never falls back to name/user-ID
 *    matching)
 * 2. fetches the workbook snapshot server-side (reuses the existing
 *    read-only Google layer — no duplicate API access)
 * 3. parses the personnel sheet (reuses the existing parser — no
 *    duplicate personnel parsing)
 * 4. finds the matching Person by email
 *
 * A valid Google/Supabase login does NOT by itself grant המחלבה access —
 * an authenticated email absent from כ"א resolves to "unmapped", an
 * account with no usable email resolves to "missing_email", and an email
 * matching more than one כ"א record resolves to "ambiguous_identity" —
 * none of these are a Person. Manager status is whatever `Person.isManager`
 * says; this function invents no separate allowlist.
 */
export async function resolveCurrentPerson(): Promise<ResolveCurrentPersonResult> {
  const identity = await getAuthenticatedIdentity();

  if (identity.status === "unauthenticated") return { status: "unauthenticated" };
  if (identity.status === "missing_email") return { status: "missing_email" };

  const snapshot = await fetchRawWorkbookSnapshot(["personnel"]);
  const personnelSheet = snapshot.sheets[0];
  const people = parsePersonnelSheet(personnelSheet);

  return resolveIdentityAgainstPeople(identity, people);
}
