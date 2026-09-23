import "server-only";
import { getRequestAuthenticatedIdentity } from "@/lib/auth/getRequestAuthenticatedIdentity";
import { resolveIdentityAgainstPeople } from "@/lib/auth/resolveCurrentPerson";
import { SHEET_SOURCES, type RawSheet, type RawWorkbookSnapshot, type SheetSourceKey } from "@/lib/google";
import type { Person } from "@/lib/domain/types";
import { parsePersonnelSheet } from "@/lib/parsers/personnel";
import { getWorkbookSnapshot } from "@/lib/sync";

export type ScheduleWorkbookContextResult =
  /** No live authenticated Supabase user at all -- the workbook is never fetched for this caller. */
  | { status: "unauthenticated" }
  /** Authenticated, but no usable email -- the workbook is never fetched for this caller. */
  | { status: "missing_email" }
  /** Authenticated with a usable email that matches no כ"א record. */
  | { status: "unmapped" }
  /** Authenticated with a usable email that matches more than one כ"א record. */
  | { status: "ambiguous_identity" }
  | { status: "ok"; context: ScheduleWorkbookContext };

/**
 * Everything the Team Schedule ("everyone"/"שבוע צוות") perspective needs
 * for ANY authenticated, uniquely-mapped viewer -- deliberately NOT "the
 * manager". See `loadScheduleWorkbookContext`'s own docs for why this is a
 * genuinely separate boundary from `managerWorkbookContext.ts`'s manager
 * authorization, not a relaxed copy of it.
 */
export interface ScheduleWorkbookContext {
  viewer: Person;
  people: Person[];
  snapshot: RawWorkbookSnapshot;
}

/**
 * The exact same 5 sources `personalSchedule.ts`'s `REQUIRED_SOURCES`
 * already fetches for EVERY authenticated, mapped request (personnel +
 * schedule + settings + potentialH1 + potentialH2) -- deliberately NOT the
 * 6-source `MANAGER_WORKBOOK_SOURCES` (which adds `shootingRanges` purely
 * so the OTHER manager-only pages -- Manager Overview, Fairness, Report 1
 * -- share one cache entry with EACH OTHER). Team Schedule access is no
 * longer manager-only, so making every mapped viewer's request also pull
 * in a manager-only sheet just to align with those pages would be paying
 * an "unrelated source" cost on every non-manager request for a benefit
 * (manager-to-manager-page cache alignment) that no longer applies to this
 * boundary. Matching `REQUIRED_SOURCES` exactly instead means THIS fetch
 * resolves to the SAME `getWorkbookSnapshot` cache entry the protected
 * `(app)/layout.tsx` (and `getRequestPersonalSchedule()` generally) already
 * populated for this exact request, for every caller -- see
 * `schedule.ts`'s own docs for the full request/fetch write-up.
 */
export const SCHEDULE_WORKBOOK_SOURCES: SheetSourceKey[] = ["personnel", "schedule", "settings", "potentialH1", "potentialH2"];

export function getScheduleWorkbookSheet(snapshot: RawWorkbookSnapshot, key: SheetSourceKey): RawSheet {
  const name = SHEET_SOURCES[key];
  const sheet = snapshot.sheets.find((candidate) => candidate.name === name);
  if (!sheet) {
    throw new Error(`Schedule workbook snapshot is missing the "${name}" sheet.`);
  }
  return sheet;
}

/**
 * The shared authenticated + uniquely-mapped VIEWER boundary for Team
 * Schedule -- deliberately, explicitly NOT manager-gated. This is the
 * primitive that makes "may this person view the read-only team
 * month/Team Week" a genuinely separate question from "is this person a
 * manager", rather than the old architecture where `/schedule` treated
 * `!person.isManager` as an immediate self-only floor and only a manager
 * ever reached anything past it.
 *
 * Mirrors `managerWorkbookContext.ts`'s `loadManagerWorkbookContext` in
 * every step EXCEPT the one thing that function adds on top of this:
 * `person.isManager === true`. A caller that additionally needs manager-
 * only data (the arbitrary-person picker, Manager Area, Fairness, Report 1,
 * notification management, ...) still goes through
 * `loadManagerWorkbookContext` for that -- layering its own `isManager`
 * check on its OWN fetch, never reusing this function's result as if it
 * were manager-authorized. Nothing in this file ever inspects
 * `Person.isManager` at all.
 *
 * 1. A live authenticated Supabase user (`getRequestAuthenticatedIdentity()`
 *    -- request-scoped `cache()`-memoized, still a genuinely live,
 *    server-verified check every new request).
 * 2. That user's email resolves unambiguously against personnel, from a
 *    FRESH parse of THIS fetch's own snapshot (never trusted from an
 *    earlier/different fetch).
 * 3. Only THEN is `{viewer, people, snapshot}` ever returned to the caller
 *    -- every non-`"ok"` branch returns a bare `{status}` with no
 *    `context` at all, so an unauthenticated/unmapped/ambiguous caller
 *    never receives anything derived from the fetched snapshot. Same
 *    "fetch, then resolve, never hand data to an unauthorized caller"
 *    shape every other identity-resolving loader in this codebase already
 *    uses (see `loadManagerWorkbookContext`'s own docs for the fuller
 *    argument for why fetching before authorization completes is safe --
 *    identical reasoning applies here).
 */
export async function loadScheduleWorkbookContext(): Promise<ScheduleWorkbookContextResult> {
  const identity = await getRequestAuthenticatedIdentity();
  if (identity.status === "unauthenticated") return { status: "unauthenticated" };
  if (identity.status === "missing_email") return { status: "missing_email" };

  const snapshot = await getWorkbookSnapshot(SCHEDULE_WORKBOOK_SOURCES);
  const people = parsePersonnelSheet(getScheduleWorkbookSheet(snapshot, "personnel"));
  const identityResult = resolveIdentityAgainstPeople(identity, people);

  if (identityResult.status === "unmapped" || identityResult.status === "ambiguous_identity") {
    return { status: identityResult.status };
  }
  if (identityResult.status !== "ok") {
    // Structurally unreachable: `identity.status` was already checked
    // "authenticated" with a usable email above, so
    // `resolveIdentityAgainstPeople` can only return "unmapped",
    // "ambiguous_identity", or "ok" from here -- both non-ok cases are
    // already handled. Guarded explicitly rather than an unsafe cast.
    throw new Error("resolveIdentityAgainstPeople returned an unreachable status for an authenticated identity.");
  }

  return { status: "ok", context: { viewer: identityResult.person, people, snapshot } };
}
