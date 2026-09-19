import { Panel } from "@/components/ui/Panel";
import { ManagerPotentialRow } from "./ManagerPotentialRow";
import type { ManagerPotentialRowView } from "./types";

interface ManagerPotentialSectionProps {
  rows: ManagerPotentialRowView[];
}

/**
 * "פוטנציאל מול סידור" -- the FULL reconciled Potential picture for the
 * selected range (every row, not just the problematic ones -- those
 * already surface through "דורש טיפול" in Overview, see
 * `ManagerAttentionSection`). Collapsed behind a disclosure by default
 * (redesign) -- this is the "for a manager who wants to inspect it" deep
 * audit, not something that should always compete for space with the
 * compact shift-coverage grid above it. Never deleted, never duplicated:
 * the SAME `ManagerPotentialRow` rendering, just not always-open.
 */
export function ManagerPotentialSection({ rows }: ManagerPotentialSectionProps) {
  if (rows.length === 0) {
    return (
      <Panel variant="compact" className="text-sm text-muted">
        אין דרישות Potential בטווח שנבחר.
      </Panel>
    );
  }

  return (
    <Panel variant="panel" glass="subtle">
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          הצלבה מלאה מול Potential <span className="font-normal text-muted-2">· {rows.length}</span>
        </summary>
        <ul className="mt-2 divide-y divide-border border-t border-border">
          {rows.map((row) => (
            <ManagerPotentialRow key={row.key} view={row} />
          ))}
        </ul>
      </details>
    </Panel>
  );
}
