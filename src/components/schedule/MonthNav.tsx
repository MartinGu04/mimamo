import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { EXPAND_HIT_AREA_CLASS } from "@/components/ui/hitArea";

interface MonthNavProps {
  prevHref: string;
  nextHref: string;
  todayHref: string;
  isOnCurrentMonth: boolean;
  /** The ACTUAL currently displayed month/year, e.g. "אוגוסט 2026" -- always the server-authoritative label the page itself already computed (`formatHebrewMonthYear`), never recomputed/guessed client-side. */
  monthLabel: string;
}

/**
 * `relative` + `EXPAND_HIT_AREA_CLASS` (Phase 6): the pill's own `p-1`
 * padding plus the `gap-1.5`/`gap-2` to the neighboring "היום" pill leaves
 * comfortable clearance, so the invisible expansion never overlaps another
 * control -- only the non-interactive month label sits directly next to
 * these arrows, at 2-4px, and that label never captures a tap.
 */
const ARROW_BUTTON_CLASSES =
  `relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground transition-colors duration-200 hover:bg-surface-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:h-8 sm:w-8 ${EXPAND_HIT_AREA_CLASS}`;

/**
 * Server-rendered month navigation, redesigned (PR #38 shell-unification
 * round) into two compact controls -- a standalone "היום" pill, and one
 * pill containing prev-arrow / current month-year / next-arrow -- replacing
 * the previous three-item "חודש קודם | היום | חודש הבא" row. "חודש קודם"/
 * "חודש הבא" are never shown as visible text anymore; both meanings remain
 * available via `aria-label` on their arrow buttons, and the CENTER of the
 * pill always shows the real displayed month/year text instead.
 *
 * `scroll={false}` on all three links (unchanged from the previous round):
 * a month change is an IN-PLACE calendar navigation -- the user's viewport
 * position must never move. Next's `<Link>` scrolls to the top of the page
 * by default on every successful navigation (including a search-param-only
 * change like this one); this disables exactly that reset, nothing else.
 * `todayHref` always points at `/schedule` with no query param, so "today"
 * resolves through the page's own Jerusalem-local fallback rather than a
 * client-computed date.
 */
export function MonthNav({ prevHref, nextHref, todayHref, isOnCurrentMonth, monthLabel }: MonthNavProps) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <Link
        href={todayHref}
        scroll={false}
        aria-label="היום"
        aria-current={isOnCurrentMonth ? "date" : undefined}
        className={`rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-3 sm:py-2 sm:text-sm ${
          isOnCurrentMonth
            ? "bg-overlay-soft text-primary"
            : "text-foreground ring-1 ring-border hover:bg-overlay-soft"
        }`}
      >
        היום
      </Link>

      <nav
        aria-label="ניווט חודשים"
        className="flex items-center gap-0.5 rounded-full bg-overlay-soft p-1 sm:gap-1"
      >
        <Link href={prevHref} scroll={false} aria-label="חודש קודם" className={ARROW_BUTTON_CLASSES}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
        </Link>
        <span className="min-w-[5.5rem] px-1 text-center text-xs font-semibold text-foreground sm:min-w-[7.5rem] sm:text-sm">
          {monthLabel}
        </span>
        <Link href={nextHref} scroll={false} aria-label="חודש הבא" className={ARROW_BUTTON_CLASSES}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" strokeWidth={2} />
        </Link>
      </nav>
    </div>
  );
}
