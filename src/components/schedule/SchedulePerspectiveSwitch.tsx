import Link from "next/link";

export type ScheduleSelfPerspective = "self" | "all";

interface SchedulePerspectiveSwitchProps {
  activePerspective: ScheduleSelfPerspective;
  selfHref: string;
  allHref: string;
}

/**
 * "שלי | כולם" -- the compact perspective switch for every mapped viewer
 * who is NOT a manager. Deliberately not the manager's `ScheduleManagerSelector`
 * (a full arbitrary-person `PersonPicker`): a non-manager can only ever be
 * in "self" or "all" (never "person" -- a non-manager's `?person=<id>`
 * always normalizes/falls back to "self" at the read-model layer, see
 * `schedule.ts`), so a simple two-way tab switch is the whole UI this
 * viewer ever needs. `SchedulePage` renders EXACTLY ONE of this or
 * `ScheduleManagerSelector`, never both (`model.manager !== null` decides
 * which).
 *
 * Same pill-tab visual language as `ScheduleEveryoneViewSwitch`/
 * `TeamWeekPeopleFilterSwitch` -- duplicated locally rather than imported,
 * same reasoning those components already document (a small Tailwind-string
 * duplication is a lighter coupling than importing a stranger component for
 * one shared class string). Plain server-rendered `Link`s: switching
 * perspective is a normal `?person=` navigation, never client state.
 */
export function SchedulePerspectiveSwitch({ activePerspective, selfHref, allHref }: SchedulePerspectiveSwitchProps) {
  const TAB_BASE =
    "rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

  return (
    <nav aria-label="תצוגת לוח" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-overlay-soft p-1">
      <Link
        href={selfHref}
        scroll={false}
        aria-current={activePerspective === "self" ? "page" : undefined}
        className={`${TAB_BASE} ${activePerspective === "self" ? "bg-surface-1 text-primary ring-1 ring-border" : "text-muted hover:text-foreground"}`}
      >
        שלי
      </Link>
      <Link
        href={allHref}
        scroll={false}
        aria-current={activePerspective === "all" ? "page" : undefined}
        className={`${TAB_BASE} ${activePerspective === "all" ? "bg-surface-1 text-primary ring-1 ring-border" : "text-muted hover:text-foreground"}`}
      >
        כולם
      </Link>
    </nav>
  );
}
