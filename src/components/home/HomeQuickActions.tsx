import type { ReportOneDraft } from "@/lib/domain/reportOne";
import { ReportOneQuickAction } from "./ReportOneQuickAction";
import { TeamWeekQuickAction } from "./TeamWeekQuickAction";

interface HomeQuickActionsProps {
  /** `null`/omitted whenever "דוח 1 למחר" itself failed to load or this viewer has none -- see `ReportOneQuickAction`'s own docs. */
  reportOneDraft?: ReportOneDraft | null;
  /** Passed straight through to `ReportOneQuickAction` -- see `ReportOneEditorOverlay`'s own docs. */
  reportOneReserveInclusion?: Readonly<Record<string, boolean>>;
}

/**
 * The Home "quick actions" row -- "דוח 1 למחר" + "צוות השבוע" as a
 * compact pair of whole-card actions, side by side on desktop
 * (`sm:flex-row`) and stacked on mobile. Replaces two previously
 * separate, low-discoverability entry points: a full-width
 * `ReportOneQuickAction` banner whose only clickable part was a small
 * trailing button, and a Team Week shortcut that read as a plain section
 * heading (`WeekOverviewSection`/`PermanentManagerHome`'s own former
 * heading-row `Link`, now `TeamWeekQuickAction`).
 *
 * `TeamWeekQuickAction` always renders -- every mapped viewer gets it,
 * same contract its former heading-row copies already had.
 * `ReportOneQuickAction` only renders when `reportOneDraft` itself
 * loaded, same conditional contract both callers (`Dashboard`,
 * `PermanentManagerHome`) already had before this row existed.
 */
export function HomeQuickActions({ reportOneDraft, reportOneReserveInclusion }: HomeQuickActionsProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
      {reportOneDraft ? (
        <ReportOneQuickAction draft={reportOneDraft} reserveInclusionByPersonId={reportOneReserveInclusion} />
      ) : null}
      <TeamWeekQuickAction />
    </div>
  );
}
