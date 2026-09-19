import { AlertCircle, CircleCheck, CircleHelp } from "lucide-react";
import type { ManagerPotentialRowView } from "./types";

const STATUS_LABEL: Record<ManagerPotentialRowView["status"], string> = {
  covered: "מכוסה",
  partial: "מכוסה חלקית",
  missing: "חסר",
  not_evaluable: "לא ניתן להצליב אוטומטית",
};

const STATUS_ICON = {
  covered: CircleCheck,
  partial: AlertCircle,
  missing: AlertCircle,
  not_evaluable: CircleHelp,
} as const;

const STATUS_TEXT_CLASS: Record<ManagerPotentialRowView["status"], string> = {
  covered: "text-success",
  partial: "text-warning",
  missing: "text-critical",
  not_evaluable: "text-muted",
};

const ROOT_CLASS = {
  row: "flex items-start gap-3 py-3",
  card: "glass-subtle flex items-start gap-3 rounded-xl bg-surface-1 ring-1 ring-border p-4",
} as const;

/**
 * One "פוטנציאל מול סידור" row -- דרישה / מקור / בסידור בפועל / סטטוס,
 * using ONLY the typed reconciliation domain's own conclusion (PR #14
 * §9/§18). The Potential source label is never displayed as the actual
 * schedule person -- "בסידור בפועל" always comes from `actualAssigneeNames`
 * (the internal schedule's own match), never from `sourceAllocationLabel`.
 * A source conflict (a named source person blocked internally the same
 * date) is shown as an independent note -- it never overrides `status`.
 *
 * `variant` mirrors `IssueRow`'s: "row" (default) sits inside a parent
 * `divide-y` list (`ManagerPotentialSection`'s full reconciliation);
 * "card" is its own bordered surface for a bare grid cell (the Overview
 * "דורש טיפול" grid, see `ManagerAttentionSection`).
 */
export function ManagerPotentialRow({ view, variant = "row" }: { view: ManagerPotentialRowView; variant?: "row" | "card" }) {
  const Icon = STATUS_ICON[view.status];

  return (
    <li className={ROOT_CLASS[variant]}>
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${STATUS_TEXT_CLASS[view.status]}`}
        aria-hidden="true"
        strokeWidth={2}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs text-muted">{view.dateLabel}</p>
        <p className="text-sm font-medium text-foreground">{view.requirementTitle}</p>
        <p className="text-xs text-muted">
          <span className="text-muted-2">מקור:</span> {view.sourceAllocationLabel}
        </p>
        <p className="text-xs text-muted">
          <span className="text-muted-2">בסידור בפועל:</span>{" "}
          {view.actualAssigneeNames.length > 0 ? view.actualAssigneeNames.join(", ") : "לא שובץ"}
        </p>
        {view.sourceConflictNote ? <p className="text-xs text-muted">{view.sourceConflictNote}</p> : null}
        <p className={`text-xs font-medium ${STATUS_TEXT_CLASS[view.status]}`}>[{STATUS_LABEL[view.status]}]</p>
      </div>
    </li>
  );
}
