"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import type { ReportOneDraft } from "@/lib/domain/reportOne";
import { formatReportOneDateDot } from "@/lib/presentation/reportOneFormat";
import { ReportOneEditorOverlay } from "./ReportOneEditorOverlay";

interface ReportOneQuickActionProps {
  draft: ReportOneDraft;
  /** Passed straight through to `ReportOneEditorOverlay` -- see that component's own docs. */
  reserveInclusionByPersonId?: Readonly<Record<string, boolean>>;
}

/**
 * The Home quick action for "דוח 1 למחר" (see this repo's Report 1 spec).
 * A Home shortcut only -- deliberately never added to the sidebar, mobile
 * nav, or the profile dropdown (`lib/layout/nav-items.ts` stays untouched).
 * Opens `ReportOneEditorOverlay` via local state; the draft itself is
 * already generated server-side (`getRequestReportOneTomorrow`) by the time
 * this renders, so opening the action is instant -- never a client fetch.
 */
export function ReportOneQuickAction({ draft, reserveInclusionByPersonId }: ReportOneQuickActionProps) {
  const [open, setOpen] = useState(false);
  const targetDateLabel = formatReportOneDateDot(draft.targetDate);

  return (
    <>
      <Panel variant="compact" glass="medium" className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">🛰️ דוח 1 למחר</p>
          {targetDateLabel ? <p className="mt-0.5 text-xs text-muted">מוכן עבור {targetDateLabel}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          פתיחה
        </button>
      </Panel>

      {open ? (
        <ReportOneEditorOverlay draft={draft} reserveInclusionByPersonId={reserveInclusionByPersonId} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
