import { classifyPersonnelType } from "@/lib/domain/personnelType";
import type { Person } from "@/lib/domain/types";

/**
 * Who may open "עד מתי???"'s "כולם" overview, and who appears in it.
 *
 * Both answers are domain semantics rather than a UI concern, and both are
 * enforced server-side (see `readModels/dischargeCountdown.ts`) -- the
 * toggle's absence from the client is a consequence, never the gate itself.
 * Classification always goes through `classifyPersonnelType`, never a
 * re-implemented string comparison against "חובה"/"קבע"/"מילואים".
 */

/**
 * The overview is for regular-service (סדיר/"חובה") personnel and managers.
 *
 * Deliberately fail-closed for everyone else: a reserve or permanent person
 * who is not a manager gets the personal countdown exactly as before, and an
 * `unclassified` personnel type -- a blank or unrecognised כ"א value -- never
 * counts as regular service, so an unproven classification can't open a
 * roster-wide view.
 */
export function canViewDischargeRoster(person: Pick<Person, "isManager" | "personnelType">): boolean {
  return person.isManager || classifyPersonnelType(person.personnelType) === "regular";
}

/**
 * The overview's contents: regular-service personnel only, soonest discharge
 * first.
 *
 * Permanent (קבע) and reserve (מילואים) personnel are excluded regardless of
 * who is looking -- a manager sees the same regular-service roster a regular
 * user does, since this view is about conscript discharge dates specifically.
 * `unclassified` is excluded for the same fail-closed reason as above.
 *
 * Sorting is lexicographic on the "YYYY-MM-DD" string, which is chronological
 * for that format, so no date parsing or timezone handling is needed to
 * order the list. People with no discharge date on record sort after every
 * dated entry rather than being dropped (they are still real personnel, and
 * silently vanishing would read as a bug), and ties -- including the whole
 * undated tail -- fall back to name order so the list is stable across
 * renders instead of inheriting sheet order.
 */
export function selectDischargeRoster<T extends Pick<Person, "personnelType" | "dischargeDate" | "name">>(
  people: readonly T[],
): T[] {
  return people
    .filter((person) => classifyPersonnelType(person.personnelType) === "regular")
    .slice()
    .sort((a, b) => {
      if (a.dischargeDate !== b.dischargeDate) {
        if (a.dischargeDate === null) return 1;
        if (b.dischargeDate === null) return -1;
        return a.dischargeDate < b.dischargeDate ? -1 : 1;
      }
      return a.name.localeCompare(b.name, "he");
    });
}
