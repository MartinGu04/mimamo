import type { IssueReason } from "@/lib/domain/operationalIssues";
import type { MinuteInterval } from "@/lib/domain/shiftSchedule";
import type { ManagerIssueRecommendation, ManagerRecommendationCandidate } from "@/lib/readModels/managerTypes";
import { formatMissingIntervals } from "./scheduleTime";

/**
 * PR #37 -- Hebrew copy for the manager's "פעולה מומלצת" candidate search.
 * Hamachlava is narrowing the search, never making the staffing decision: no
 * sentence here ever claims a person IS available (`זמין`/`פנוי`) or is
 * the best/optimal choice -- only that they may be "worth checking with"
 * against what the product can actually prove, with the limitation always
 * stated honestly (a private constraint communicated outside the product,
 * e.g. WhatsApp, is simply unknown to Hamachlava).
 */

/**
 * One piece of a recommendation sentence: either restrained literal Hebrew
 * text, or a specific candidate whose name should be presented as a link to
 * their own manager drill-down (`/manager?person=<personId>`). Kept as a
 * structured sequence -- never flattened into one string -- so the UI can
 * render a candidate's name as a `<Link>` using its own `personId` straight
 * from the domain-produced candidate, with no name-to-id parsing/lookup
 * ever needed downstream.
 */
export type IssueRecommendationTextPart =
  | { kind: "text"; value: string }
  | { kind: "candidateLink"; personId: string; personName: string };

export interface IssueRecommendationLastResortView {
  /** "מוצא אחרון · הצג אפשרויות נוספות" -- the collapsed disclosure's own summary/trigger. */
  triggerLabel: string;
  text: readonly IssueRecommendationTextPart[];
  disclaimer: string;
}

/**
 * `disclaimer` is paired 1:1 with `primaryText` -- set whenever `primaryText`
 * is an actual candidate suggestion, null when `primaryText` is instead the
 * "לא נמצאו טכנאים מתאימים" statement (nothing was suggested yet at that
 * level, so the personal-constraints caveat would be a non-sequitur there;
 * it still appears, combined with the last-resort framing, inside
 * `lastResort.disclaimer` once that nested section is opened).
 */
export interface IssueRecommendationView {
  primaryText: readonly IssueRecommendationTextPart[];
  disclaimer: string | null;
  lastResort: IssueRecommendationLastResortView | null;
}

const CONSTRAINTS_DISCLAIMER = "ייתכנו אילוצים אישיים שלא מופיעים במערכת.";
const TECHNICIAN_NOT_FOUND_TEXT = "לא נמצאו טכנאים מתאימים לפי המידע הקיים.";
const LAST_RESORT_TRIGGER_LABEL = "מוצא אחרון · הצג אפשרויות נוספות";
const LAST_RESORT_DISCLAIMER = "האפשרויות האלו מוצגות כמוצא אחרון בלבד, וייתכנו אילוצים אישיים שלא מופיעים במערכת.";

function textPart(value: string): IssueRecommendationTextPart {
  return { kind: "text", value };
}

function candidateLinkPart(candidate: ManagerRecommendationCandidate): IssueRecommendationTextPart {
  return { kind: "candidateLink", personId: candidate.personId, personName: candidate.personName };
}

/**
 * "X" / "X או Y" / "X, Y או Z" as a part sequence -- the SAME join shape the
 * former flat-string `joinHebrewNames` produced (never implies X is better
 * than Y, just lists every candidate), except each name is its own
 * `candidateLink` part rather than text baked into a joined string, so the
 * UI never has to parse a name back out of anything.
 */
function joinCandidateParts(candidates: readonly ManagerRecommendationCandidate[]): IssueRecommendationTextPart[] {
  if (candidates.length === 0) return [];
  if (candidates.length === 1) return [candidateLinkPart(candidates[0])];

  const parts: IssueRecommendationTextPart[] = [];
  const allButLast = candidates.slice(0, -1);
  allButLast.forEach((candidate, index) => {
    if (index > 0) parts.push(textPart(", "));
    parts.push(candidateLinkPart(candidate));
  });
  parts.push(textPart(" או "));
  parts.push(candidateLinkPart(candidates[candidates.length - 1]));
  return parts;
}

/**
 * Only ever appended for `shift_coverage_partial` -- a `shift_coverage_missing`
 * gap is the whole canonical shift window, which the missing-coverage
 * sentence already implies without spelling out redundant start/end times.
 * Reuses `formatMissingIntervals` (the SAME formatting `IssueRow`'s own
 * "שעות חסרות"/"חסר כיסוי" callout already uses) -- never a second time
 * formatter, and only ever built from the canonical coverage analysis's
 * own `missingIntervals`, never guessed.
 */
function intervalSuffix(reason: IssueReason, missingIntervals: readonly MinuteInterval[] | null): string {
  if (reason !== "shift_coverage_partial" || !missingIntervals || missingIntervals.length === 0) return "";
  return ` בין ${formatMissingIntervals(missingIntervals).join(" · ")}`;
}

/**
 * Builds the final presentation copy from the safe `ManagerIssueRecommendation`
 * projection. Pure -- no data access, no eligibility logic (that already
 * happened in `lib/domain/shiftCoverageRecommendation.ts`); this only ever
 * turns an already-decided candidate list into restrained Hebrew sentences.
 *
 * Returns `null` whenever `recommendation` itself is `null` (an unsupported
 * issue reason, or the domain layer couldn't safely establish any
 * candidate) -- `IssueRow` then renders no recommendation UI at all, never
 * a placeholder.
 */
export function buildIssueRecommendationView(
  recommendation: ManagerIssueRecommendation | null,
  reason: IssueReason,
  missingIntervals: readonly MinuteInterval[] | null,
): IssueRecommendationView | null {
  if (!recommendation) return null;

  if (recommendation.primaryCandidates.length > 0) {
    return {
      primaryText: [
        textPart("לפי הסידור הקיים, אפשר לבדוק עם "),
        ...joinCandidateParts(recommendation.primaryCandidates),
        textPart(` לגבי הכיסוי${intervalSuffix(reason, missingIntervals)}.`),
      ],
      disclaimer: CONSTRAINTS_DISCLAIMER,
      lastResort: null,
    };
  }

  if (recommendation.missingRole === "technician" && recommendation.fallbackCandidates.length > 0) {
    const capabilityNote =
      recommendation.fallbackCandidates.length === 1
        ? "שמסומן גם כבעל יכולת טכנית"
        : "שמסומנים גם כבעלי יכולת טכנית";
    return {
      primaryText: [textPart(TECHNICIAN_NOT_FOUND_TEXT)],
      disclaimer: null,
      lastResort: {
        triggerLabel: LAST_RESORT_TRIGGER_LABEL,
        text: [
          textPart("לא נמצאו טכנאים רגילים מתאימים. לפי הסידור הקיים, אפשר לבדוק גם עם "),
          ...joinCandidateParts(recommendation.fallbackCandidates),
          textPart(`, ${capabilityNote}.`),
        ],
        disclaimer: LAST_RESORT_DISCLAIMER,
      },
    };
  }

  // Structurally unreachable given how `buildShiftCoverageRecommendation`
  // constructs its result (both candidate lists empty only ever produces
  // `null`, never a recommendation object) -- kept as a safe fallback
  // rather than assuming that invariant can never change silently.
  return null;
}
