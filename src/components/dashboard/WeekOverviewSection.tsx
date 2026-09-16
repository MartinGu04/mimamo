import type { PersonalWeekDayView, PersonalWeekOverview } from "@/lib/presentation/personalWeekOverview";
import { formatCompactDate, formatHebrewWeekday } from "@/lib/presentation/hebrewDate";
import { Badge } from "@/components/ui/Badge";
import { TimeRange } from "./TimeRange";
import { WeekOverviewAutoScroll } from "./WeekOverviewAutoScroll";

interface WeekOverviewSectionProps {
  overview: PersonalWeekOverview;
}

const RAIL_ID = "week-overview-rail";

function dayElementId(date: string): string {
  return `week-overview-day-${date}`;
}

/**
 * "השבוע הקרוב" -- a fixed Sunday-Saturday overview of the authenticated
 * person's whole current week, every day shown explicitly (including an
 * empty one). Complements, never replaces, the Hero/"היום שלי"/"הקרובים
 * שלי" -- an event already shown there legitimately shows again here too;
 * this section's whole purpose is the complete week shape, not a
 * non-repetition list.
 *
 * One `<ol>` renders both layouts: a horizontal snap-scroll rail (base
 * through `md`, so a tablet still gets the comfortable rail rather than a
 * cramped intermediate seven-column squeeze) that becomes a plain 7-column
 * grid at `lg` and up, where there's finally room for every day to read
 * comfortably side by side.
 */
export function WeekOverviewSection({ overview }: WeekOverviewSectionProps) {
  const todayDay = overview.days.find((day) => day.isToday);

  return (
    <section aria-labelledby="week-overview-heading">
      <h2 id="week-overview-heading" className="text-base font-semibold text-foreground sm:text-lg">
        השבוע הקרוב
      </h2>

      <ol
        id={RAIL_ID}
        tabIndex={0}
        aria-label="סקירת השבוע, ראשון עד שבת"
        className="-mx-1 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 lg:mx-0 lg:grid lg:grid-cols-7 lg:snap-none lg:overflow-visible lg:px-0 lg:pb-0"
      >
        {overview.days.map((day) => (
          <WeekDayCard key={day.date} day={day} isPastDay={todayDay !== undefined && day.date < todayDay.date} />
        ))}
      </ol>

      {todayDay ? <WeekOverviewAutoScroll railId={RAIL_ID} todayDayId={dayElementId(todayDay.date)} /> : null}
    </section>
  );
}

interface WeekDayCardProps {
  day: PersonalWeekDayView;
  isPastDay: boolean;
}

/**
 * `glass-subtle` on every card, today included: these sit straight on the
 * page canvas with nothing above them, so leaving them opaque made the
 * whole strip read as un-upgraded next to the glassed panels above it.
 * `glass-ring-primary` is what keeps today's selection ring visible
 * THROUGH the material -- the glass levels set `box-shadow` wholesale
 * (see globals.css), which would otherwise erase the `ring-2 ring-primary`
 * that is the only thing marking today.
 */
function WeekDayCard({ day, isPastDay }: WeekDayCardProps) {
  return (
    <li
      id={dayElementId(day.date)}
      aria-current={day.isToday ? "date" : undefined}
      className={`glass-subtle min-w-[78%] shrink-0 snap-center rounded-xl p-4 ring-1 sm:min-w-[280px] lg:min-w-0 ${
        day.isToday ? "glass-ring-primary bg-surface-2 ring-2 ring-primary" : "bg-surface-1 ring-border"
      } ${isPastDay ? "opacity-85" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{formatHebrewWeekday(day.date)}</p>
          <p dir="ltr" className="text-xs text-muted">
            {formatCompactDate(day.date)}
          </p>
        </div>
        {day.isToday ? <Badge tone="primary">היום</Badge> : null}
      </div>

      {day.events.length === 0 ? (
        <p className="mt-3 text-sm text-muted">אין אירועים</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {day.events.map((event) => (
            <li key={event.key} className="rounded-lg bg-overlay-faint p-2.5">
              <p className="flex items-start gap-1.5 text-sm font-medium text-foreground">
                {event.emoji ? (
                  <span aria-hidden="true" className="shrink-0">
                    {event.emoji}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 break-words">{event.title}</span>
              </p>
              {event.timing.status === "resolved" ? (
                <p className="mt-1 text-xs text-muted">
                  <TimeRange start={event.timing.startLocalTime} end={event.timing.endLocalTime} />
                </p>
              ) : null}
              {event.subtitle || event.tentative ? (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  {event.subtitle}
                  {event.tentative ? <Badge tone="warning">משוער</Badge> : null}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
