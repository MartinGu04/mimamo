import Link from "next/link";

export type ScheduleEveryoneView = "month" | "team-week";

interface ScheduleEveryoneViewSwitchProps {
  activeView: ScheduleEveryoneView;
  monthHref: string;
  teamWeekHref: string;
}

/**
 * Same pill-tab visual language as `EmergencyScheduleRangeSelector`/
 * `ManagerRangeSelector` -- duplicated locally rather than imported, same
 * reasoning those components already document (a small Tailwind-string
 * duplication is a lighter coupling than importing a stranger component
 * for one shared class string).
 */
const TAB_BASE =
  "rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * "חודש | שבוע צוות" -- the entry point into the "כולם" perspective's
 * second, optional matrix presentation (see `TeamWeekMatrix`). Only ever
 * rendered by the page when `model.perspective === "all"`, which itself
 * only exists for an already-verified manager -- this component never
 * performs its own authorization check, same convention as every other
 * schedule nav control (`MonthNav`, `ScheduleManagerSelector`). Plain
 * server-rendered `Link`s, no client JS: switching views is a normal
 * navigation, same as `MonthNav`/`EmergencyScheduleRangeSelector`.
 */
export function ScheduleEveryoneViewSwitch({ activeView, monthHref, teamWeekHref }: ScheduleEveryoneViewSwitchProps) {
  return (
    <nav aria-label="תצוגת הלוח" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-overlay-soft p-1">
      <Link
        href={monthHref}
        scroll={false}
        aria-current={activeView === "month" ? "page" : undefined}
        className={`${TAB_BASE} ${activeView === "month" ? "bg-surface-1 text-primary ring-1 ring-border" : "text-muted hover:text-foreground"}`}
      >
        חודש
      </Link>
      <Link
        href={teamWeekHref}
        scroll={false}
        aria-current={activeView === "team-week" ? "page" : undefined}
        className={`${TAB_BASE} ${activeView === "team-week" ? "bg-surface-1 text-primary ring-1 ring-border" : "text-muted hover:text-foreground"}`}
      >
        שבוע צוות
      </Link>
    </nav>
  );
}
