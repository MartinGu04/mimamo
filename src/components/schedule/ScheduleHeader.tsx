interface ScheduleHeaderProps {
  /**
   * The page's own title line -- defaults to "הלוח שלי" (every existing
   * caller's expectation, unchanged). `/schedule` overrides this
   * contextually once a non-self perspective is showing ("לוח הצוות" for
   * team month, "צוות השבוע" for Team Week) so the page never claims to be
   * showing "my" schedule while actually showing the team's -- see
   * `SchedulePage`'s own `scheduleTitle` helper.
   */
  title?: string;
  monthLabel: string | null;
  monthRangeSubtitle: string | null;
}

/**
 * The Schedule page's own title + the displayed month, mirroring the
 * dashboard header's restrained hierarchy: title strongest, month
 * secondary, optional Hebrew-calendar range smallest.
 *
 * The range subtitle line is deliberately always rendered at the same
 * height, whether or not `monthRangeSubtitle` has content -- some months
 * (e.g. one that spans a Hebrew-year boundary, see `formatHebrewMonthRange`)
 * legitimately have no range to show, and letting that line collapse
 * shifted every element below it (including the calendar itself) by that
 * exact amount, month to month -- part of the PR #38 follow-up jump fix.
 */
export function ScheduleHeader({ title = "הלוח שלי", monthLabel, monthRangeSubtitle }: ScheduleHeaderProps) {
  return (
    <div className="min-w-0">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">{title}</h1>
      {monthLabel ? <p className="mt-1.5 text-lg font-semibold text-foreground sm:text-xl">{monthLabel}</p> : null}
      <p className="mt-0.5 text-xs text-muted" aria-hidden={monthRangeSubtitle ? undefined : "true"}>
        {monthRangeSubtitle ?? " "}
      </p>
    </div>
  );
}
