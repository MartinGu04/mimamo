import { ChevronLeft, Users } from "lucide-react";
import Link from "next/link";
import { scheduleTeamWeekHref } from "@/lib/presentation/scheduleUrl";
import { QUICK_ACTION_CARD_CLASS } from "./homeQuickActionCardStyles";

/**
 * The Home quick action for "צוות השבוע" -- see `scheduleTeamWeekHref`'s
 * own docs for the canonical route this always points to.
 *
 * Previously a small `Link` tucked beside a section heading (one copy in
 * `WeekOverviewSection`'s own heading row, an identical copy in
 * `PermanentManagerHome`) -- both read too much like a static heading to
 * be discoverable. This is now the ONE Team Week entry point on Home,
 * rendered from `HomeQuickActions` alongside the "דוח 1 למחר" card as a
 * WHOLE-card `Link` (never a nested control -- see `IssuesPanel`'s
 * established precedent for the same pattern).
 *
 * Renders unconditionally, with no manager/role prop to gate it -- the
 * exact same contract the two heading-row copies it replaces already
 * had: every mapped viewer (regular/reserve/manager alike) can reach
 * Team Week in one click from Home.
 */
export function TeamWeekQuickAction() {
  return (
    <Link href={scheduleTeamWeekHref()} className={QUICK_ACTION_CARD_CLASS}>
      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Users className="h-4 w-4 shrink-0" aria-hidden="true" strokeWidth={2} />
        צוות השבוע
      </p>
      <p className="text-xs text-muted">מי עובד השבוע</p>
      <span className="mt-auto flex items-center gap-0.5 pt-2 text-xs font-medium text-muted">
        <span>פתיחה</span>
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
      </span>
    </Link>
  );
}
