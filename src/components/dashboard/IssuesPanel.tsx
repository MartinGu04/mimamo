import { ShieldCheck } from "lucide-react";
import type { PersonalIssue } from "@/lib/readModels/types";
import { personalIssueReasonLabel } from "@/lib/presentation/issue";
import { formatCompactDate } from "@/lib/presentation/hebrewDate";
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
 * Issues only take up space when they exist. Machine `IssueReason` values
 * are never rendered -- only the friendly Hebrew mapping. A critical issue
 * may pulse its own small icon, never the whole panel.
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

          return (
            <li
              key={index}
              className={`flex items-start gap-3 rounded-xl px-3 py-2.5 ring-1 ${ISSUE_SEVERITY_RING_CLASS[issue.severity]} ${ISSUE_SEVERITY_BG_CLASS[issue.severity]}`}
            >
              <IssueSeverityBadge severity={issue.severity} className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{personalIssueReasonLabel(issue)}</p>
                {compactDate ? <p className="mt-0.5 text-xs text-muted">{compactDate}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
