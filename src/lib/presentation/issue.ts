import type { EventRole } from "@/lib/domain/event";
import type { IssueReason, IssueSeverity } from "@/lib/domain/operationalIssues";
import type { PersonalIssue, PersonalIssueTargetSummary } from "@/lib/readModels/types";
import { assignmentEmoji } from "./emoji";
import { formatCompactDate, formatHebrewWeekdayAndDate, relativeDayLabel } from "./hebrewDate";
import { dutyFamilyLabel, issueReasonLabel, periodLabel, requiredCapabilityLabel, roleLabel } from "./labels";

function oppositeRole(role: EventRole): EventRole {
  if (role === "supervisor") return "technician";
  if (role === "technician") return "supervisor";
  return null;
}

/**
 * Role-specific coverage wording for a `shift_coverage_missing`/
 * `shift_coverage_partial` `PersonalIssue` -- "חסר טכנאי למשמרת שלך" /
 * "חסר אחמ״ש למשמרת שלך" instead of the generic "חסר כיסוי למשמרת שלך",
 * derived from the SAME counterpart role `analyzeShiftCounterparts()`
 * already searched for (the opposite of the assignee's own
 * `targetEvent.role`) -- never a second coverage algorithm, never guessed
 * from rendered names. Falls back to the existing generic
 * `issueReasonLabel` text whenever the missing role can't be determined
 * (no `targetEvent`, or the assignee's own role on it is unspecified) or
 * the reason isn't a coverage issue at all.
 */
export function personalIssueReasonLabel(
  issue: Pick<PersonalIssue, "reason" | "targetEvent"> & Partial<Pick<PersonalIssue, "date">>,
): string {
  const weaponLabel = weaponQualificationIssueReasonLabel(issue);
  if (weaponLabel) return weaponLabel;

  const fallback = issueReasonLabel(issue.reason);
  if (issue.reason !== "shift_coverage_missing" && issue.reason !== "shift_coverage_partial") return fallback;

  const missingRole = issue.targetEvent ? oppositeRole(issue.targetEvent.role) : null;
  const label = missingRole ? roleLabel(missingRole) : null;
  if (!label) return fallback;

  return issue.reason === "shift_coverage_missing" ? `חסר ${label} למשמרת שלך` : `כיסוי ${label} חלקי למשמרת שלך`;
}

/**
 * Dynamic "מטווחים לא בתוקף לקראת אוקסיד – 31.8" wording for
 * `weapon_qualification_invalid`, shared by the personal fallback above
 * AND the manager overview's own `managerIssueReasonLabelFor` -- neither
 * duplicates this string-building, and both stay in sync automatically
 * when the wording changes. States WHY the issue is urgent (which activity,
 * on which date) rather than the generic "qualification expired" -- never
 * static, since both the activity family (שמירה/עתודה/אוקסיד) and date vary
 * per issue. `null` for any other reason, or for the (structurally
 * unreachable in practice) case of a `weapon_qualification_invalid` issue
 * with no `targetEvent`/`dutyFamily` -- callers fall back to the static
 * `issueReasonLabel`/`managerIssueReasonLabel` copy in that case.
 */
export function weaponQualificationIssueReasonLabel(
  issue: Pick<PersonalIssue, "reason" | "targetEvent"> & Partial<Pick<PersonalIssue, "date">>,
): string | null {
  if (issue.reason !== "weapon_qualification_invalid") return null;
  const dutyFamily = issue.targetEvent?.dutyFamily ?? null;
  if (!dutyFamily || issue.date === undefined) return null;

  const dateLabel = formatCompactDate(issue.date) ?? issue.date;
  return `מטווחים לא בתוקף לקראת ${dutyFamilyLabel(dutyFamily)} – ${dateLabel}`;
}

const ISSUE_GUIDANCE_LABELS: Record<IssueReason, string> = {
  blocking_absence_with_assignment: "בדוק איזה מהשניים נכון בסידור.",
  shift_coverage_missing: "בדוק מי אמור להשלים את הכיסוי למשמרת.",
  shift_coverage_partial: "בדוק מי משלים את שעות הכיסוי החסרות.",
  invalid_shift_time: "בדוק את שעות המשמרת בסידור.",
  role_capability_mismatch: 'בדוק שסימון התפקיד בכ"א מעודכן.',
  weapon_qualification_invalid: "יש לתאם חידוש כשירות מטווחים או שיבוץ מחליף לפני מועד הפעילות.",
};

/**
 * Short, presentation-only "what to check" hint for one `IssueReason` --
 * centralized so it's never inlined per-component. No workflow state, no
 * acknowledgement, no "resolved" affordance -- המחלבה stays read-only.
 */
export function issueGuidanceLabel(reason: IssueReason): string {
  return ISSUE_GUIDANCE_LABELS[reason];
}

const STATIC_ISSUE_EXPLANATIONS: Partial<Record<IssueReason, string>> = {
  blocking_absence_with_assignment: "יש באותו יום גם היעדרות חוסמת וגם שיבוץ פעיל. כדאי לבדוק איזה מהם נכון בסידור.",
  invalid_shift_time: "לא ניתן להסתמך על שעות המשמרת כפי שהן כרגע. כדאי לבדוק את שעות ההתחלה/סיום בסידור.",
};

/**
 * Longer explanatory copy for the reasons whose meaning isn't already
 * clear from the date/target alone. Never guesses the absence kind (the
 * safe projection doesn't expose it) and never repairs/invents a shift
 * time. `role_capability_mismatch` is worded cautiously -- the כ"א
 * capability map may simply be stale, never a definitive "you're
 * unqualified". Returns null for reasons with nothing further to add
 * (coverage issues speak for themselves via `missingIntervals`).
 */
export function issueExplanation(
  issue: Pick<PersonalIssue, "reason" | "metadata"> & Partial<Pick<PersonalIssue, "date" | "targetEvent">>,
): string | null {
  if (issue.reason === "role_capability_mismatch") {
    const capability = issue.metadata?.requiredCapability;
    if (!capability) return null;
    return `השיבוץ מוגדר כ${requiredCapabilityLabel(capability)}, אבל סימון התפקיד בכ"א דורש בדיקה.`;
  }
  if (issue.reason === "weapon_qualification_invalid") {
    const dutyFamily = issue.targetEvent?.dutyFamily ?? null;
    const activityLabel = dutyFamily ? dutyFamilyLabel(dutyFamily) : "הפעילות";
    const dateLabel = issue.date ? (formatCompactDate(issue.date) ?? issue.date) : null;
    return dateLabel
      ? `נדרשת כשירות מטווחים בתוקף ל${activityLabel} בתאריך ${dateLabel}, אך הכשירות אינה בתוקף למועד זה.`
      : `נדרשת כשירות מטווחים בתוקף ל${activityLabel}, אך הכשירות אינה בתוקף למועד הפעילות.`;
  }
  return STATIC_ISSUE_EXPLANATIONS[issue.reason] ?? null;
}

/**
 * "טכנאי לילה" for a shift target; the sanitized target title honestly,
 * unmodified, for a duty/other target. Never infers from `rawValue` --
 * `PersonalIssueTargetSummary` doesn't carry it anyway.
 */
export function issueTargetTitle(target: PersonalIssueTargetSummary): string {
  if (target.category !== "shift") return target.title;
  const parts = [roleLabel(target.role), periodLabel(target.period)].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(" ") : target.title;
}

/** The target's semantic emoji for a shift (e.g. "🌙"), null for a duty/other target or an unmapped period. */
export function issueTargetEmoji(target: PersonalIssueTargetSummary): string | null {
  if (target.category !== "shift") return null;
  return assignmentEmoji({ category: "shift", period: target.period, dutyFamily: null, absenceKind: null });
}

/** "היום" / "מחר" / "יום ראשון · 16 באוגוסט" -- the same relative-day convention used across the app. No Date/UTC. */
export function issueDateLabel(date: string, todayDate: string): string {
  const relative = relativeDayLabel(date, todayDate);
  if (relative === "today") return "היום";
  if (relative === "tomorrow") return "מחר";
  return formatHebrewWeekdayAndDate(date) ?? date;
}

function criticalCountLabel(count: number): string {
  return count === 1 ? "1 דחוף" : `${count} דחופים`;
}

function reviewCountLabel(count: number): string {
  return `${count} לבדיקה`;
}

function infoCountLabel(count: number): string {
  return `${count} לתשומת לב`;
}

/**
 * "2 דחופים · 1 לבדיקה" -- a restrained inline summary of non-zero
 * severity counts, in critical/review/info order. Null when there's
 * nothing to summarize, and ALSO null when every visible issue already
 * belongs to a single severity bucket -- the group heading right below it
 * (e.g. "דחוף · 3") already says the same thing, so the summary would be
 * pure duplication. Only renders once it's telling the reader something
 * the group headings alone don't: how the total splits across severities.
 */
export function issueSummaryLabel(issues: readonly Pick<PersonalIssue, "severity">[]): string | null {
  const counts: Record<IssueSeverity, number> = { critical: 0, review: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;

  const parts: string[] = [];
  if (counts.critical > 0) parts.push(criticalCountLabel(counts.critical));
  if (counts.review > 0) parts.push(reviewCountLabel(counts.review));
  if (counts.info > 0) parts.push(infoCountLabel(counts.info));

  return parts.length > 1 ? parts.join(" · ") : null;
}
