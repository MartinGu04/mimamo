"use client";

import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { ReportOneDraft } from "@/lib/domain/reportOne";
import { formatReportOneDateDot } from "@/lib/presentation/reportOneFormat";
import { QUICK_ACTION_CARD_CLASS } from "./homeQuickActionCardStyles";
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
 *
 * Redesigned (Home quick-action cards pass) from a full-width banner --
 * where the small trailing "פתיחה" button was the only clickable part --
 * into a compact, WHOLE-card `<button>` sharing `QUICK_ACTION_CARD_CLASS`
 * with its `TeamWeekQuickAction` pair (see `IssuesPanel`'s existing
 * whole-card-`Link` precedent for why the entire surface, not a nested
 * control, is the click target).
 */
export function ReportOneQuickAction({ draft, reserveInclusionByPersonId }: ReportOneQuickActionProps) {
  const [open, setOpen] = useState(false);
  const targetDateLabel = formatReportOneDateDot(draft.targetDate);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={QUICK_ACTION_CARD_CLASS}>
        <p className="text-sm font-semibold text-foreground">🛰️ דוח 1 למחר</p>
        {targetDateLabel ? <p className="text-xs text-muted">מוכן עבור {targetDateLabel}</p> : null}
        <span className="mt-auto flex items-center gap-0.5 pt-2 text-xs font-medium text-muted">
          <span>פתיחה</span>
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
        </span>
      </button>

      {open ? (
        <ReportOneEditorOverlay draft={draft} reserveInclusionByPersonId={reserveInclusionByPersonId} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
