import { ChevronLeft, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { IssueSeverity } from "@/lib/domain/operationalIssues";
import type { PersonalIssue } from "@/lib/readModels/types";
import { personalIssueReasonLabel } from "@/lib/presentation/issue";
import { formatCompactDate } from "@/lib/presentation/hebrewDate";
import { scheduleSelfHref } from "@/lib/presentation/scheduleUrl";
import { Panel } from "@/components/ui/Panel";
import {
  ISSUE_SEVERITY_BG_CLASS,
  ISSUE_SEVERITY_RING_CLASS,
  IssueSeverityBadge,
} from "@/components/ui/IssueSeverityBadge";

interface IssuesPanelProps {
  issues: PersonalIssue[];
}

/**
 * A slightly stronger step of the SAME hue each severity's own resting
 * `ISSUE_SEVERITY_BG_CLASS` already uses (never a new, unrelated hover
 * color) -- confirms a dated card is clickable without competing with the
 * severity signal itself.
 */
const ISSUE_SEVERITY_HOVER_BG_CLASS: Record<IssueSeverity, string> = {
  critical: "hover:bg-critical/10",
  review: "hover:bg-warning/10",
  info: "hover:bg-accent/10",
};

/**
 * Issues only take up space when they exist. Machine `IssueReason` values
 * are never rendered -- only the friendly Hebrew mapping. A critical issue
 * may pulse its own small icon, never the whole panel.
 *
 * Every issue with a real, parseable `date` (i.e. `formatCompactDate`
 * doesn't return null -- the same defensive check the date line itself
 * already used) is a single deep link into the viewer's own `/schedule`
 * day, via `scheduleSelfHref` (the app's shared schedule-URL presentation
 * layer, never a hand-built query string here). The WHOLE card is the
 * link (one `<Link>`, no nested interactive elements) rather than a
 * separate "view" button, so the large existing tap target keeps working
 * with no extra affordance to discover. An issue that somehow carries an
 * unparseable date renders as a plain, non-interactive card, same as
 * before this pass.
 */
export function IssuesPanel({ issues }: IssuesPanelProps) {
  if (issues.length === 0) {
    return (
      <Panel variant="compact" className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-success" aria-hidden="true" strokeWidth={1.75} />
        <p className="text-sm font-medium text-foreground">הסידור שלך נראה תקין</p>
      </Panel>
    );
  }

  return (
    <Panel variant="panel" glass="subtle" className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">לתשומת לבך</h3>
      <ul className="space-y-2">
        {issues.map((issue, index) => {
          const compactDate = formatCompactDate(issue.date);
          const cardClassName = `flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1 ${ISSUE_SEVERITY_RING_CLASS[issue.severity]} ${ISSUE_SEVERITY_BG_CLASS[issue.severity]}`;

          if (!compactDate) {
            return (
              <li key={index} className={cardClassName}>
                <IssueSeverityBadge severity={issue.severity} className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{personalIssueReasonLabel(issue)}</p>
                </div>
              </li>
            );
          }

          return (
            <li key={index}>
              <Link
                href={scheduleSelfHref({ date: issue.date })}
                className={`${cardClassName} ${ISSUE_SEVERITY_HOVER_BG_CLASS[issue.severity]} transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
              >
                <IssueSeverityBadge severity={issue.severity} className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{personalIssueReasonLabel(issue)}</p>
                  <p className="mt-0.5 text-xs text-muted">{compactDate}</p>
                </div>
                <span className="mt-0.5 flex shrink-0 items-center gap-0.5 self-center text-xs font-medium text-muted">
                  <span>לצפייה בלוח</span>
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
