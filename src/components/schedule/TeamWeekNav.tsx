import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { EXPAND_HIT_AREA_CLASS } from "@/components/ui/hitArea";

interface TeamWeekNavProps {
  prevHref: string;
  nextHref: string;
  todayHref: string;
  isOnCurrentWeek: boolean;
  /** The already-resolved, server-computed week label (`formatHebrewWeekRangeLabel`), e.g. "20–26 בספטמבר 2026" -- never recomputed client-side. */
  weekLabel: string;
}

/** Same arrow-button treatment as `MonthNav`'s own `ARROW_BUTTON_CLASSES`, duplicated for the same "week nav is its own small control, not a variant of month nav" reason `EmergencyScheduleRangeSelector` already documents for its own tab styling. */
const ARROW_BUTTON_CLASSES =
  `relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground transition-colors duration-200 hover:bg-surface-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:h-8 sm:w-8 ${EXPAND_HIT_AREA_CLASS}`;

/**
 * "שבוע צוות" mode's week navigation -- the same visual language as
 * `MonthNav` (a standalone "היום" pill plus a pill containing prev-arrow /
 * current week label / next-arrow), but resolving an operational
 * Sunday-Saturday week instead of a calendar month. Rendered in the SAME
 * header slot `MonthNav` occupies for the "חודש" presentation -- the two
 * are never shown together (see `SchedulePage`).
 *
 * `scroll={false}` on all three links, matching `MonthNav`: a week change
 * is an in-place navigation, the viewport must never jump to the top.
 * `todayHref` always omits `?week=` entirely, resolving through the
 * page's own Jerusalem-local "today" fallback rather than a client-
 * computed date, same convention as `MonthNav.todayHref`.
 */
export function TeamWeekNav({ prevHref, nextHref, todayHref, isOnCurrentWeek, weekLabel }: TeamWeekNavProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <Link
        href={todayHref}
        scroll={false}
        aria-label="היום"
        aria-current={isOnCurrentWeek ? "date" : undefined}
        className={`rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-3 sm:py-2 sm:text-sm ${
          isOnCurrentWeek
            ? "bg-overlay-soft text-primary"
            : "text-foreground ring-1 ring-border hover:bg-overlay-soft"
        }`}
      >
        היום
      </Link>

      <nav
        aria-label="ניווט שבועות"
        className="flex items-center gap-0.5 rounded-full bg-overlay-soft p-1 sm:gap-1"
      >
        <Link href={prevHref} scroll={false} aria-label="שבוע קודם" className={ARROW_BUTTON_CLASSES}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
        </Link>
        <span className="min-w-[9.5rem] px-1 text-center text-xs font-semibold text-foreground sm:min-w-[13rem] sm:text-sm">
          {weekLabel}
        </span>
        <Link href={nextHref} scroll={false} aria-label="שבוע הבא" className={ARROW_BUTTON_CLASSES}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
        </Link>
      </nav>
    </div>
  );
}
