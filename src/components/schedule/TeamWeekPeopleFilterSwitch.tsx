import Link from "next/link";
import type { TeamWeekPeopleFilter } from "@/lib/presentation/teamWeekFilter";

interface TeamWeekPeopleFilterSwitchProps {
  activeFilter: TeamWeekPeopleFilter;
  activeHref: string;
  allHref: string;
}

/**
 * "פעילים השבוע | כולם" -- compact, visually secondary to
 * `ScheduleEveryoneViewSwitch`'s "חודש | שבוע צוות" tabs (smaller text/
 * padding, same pill-tab language, deliberately not the same visual weight
 * so it reads as a filter ON the matrix rather than another top-level
 * view). Plain server-rendered `Link`s, same convention as every other
 * schedule nav control -- switching the filter is a normal `?people=`
 * navigation, never client state.
 */
export function TeamWeekPeopleFilterSwitch({ activeFilter, activeHref, allHref }: TeamWeekPeopleFilterSwitchProps) {
  const TAB_BASE =
    "rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

  return (
    <nav aria-label="סינון אנשי צוות" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-overlay-soft p-0.5">
      <Link
        href={activeHref}
        scroll={false}
        aria-current={activeFilter === "active" ? "page" : undefined}
        className={`${TAB_BASE} ${activeFilter === "active" ? "bg-surface-1 text-primary ring-1 ring-border" : "text-muted hover:text-foreground"}`}
      >
        פעילים השבוע
      </Link>
      <Link
        href={allHref}
        scroll={false}
        aria-current={activeFilter === "all" ? "page" : undefined}
        className={`${TAB_BASE} ${activeFilter === "all" ? "bg-surface-1 text-primary ring-1 ring-border" : "text-muted hover:text-foreground"}`}
      >
        כולם
      </Link>
    </nav>
  );
}
