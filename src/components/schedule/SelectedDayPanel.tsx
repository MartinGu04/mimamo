import { assignmentEmoji, personalActivityEmoji } from "@/lib/presentation/emoji";
import { absenceKindLabel, dutyFamilyLabel, periodLabel, roleLabel } from "@/lib/presentation/labels";
import type { PersonalCalendarEventView, PersonalEventView, PersonalShiftCompanion } from "@/lib/readModels/types";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { TimeRange } from "@/components/dashboard/TimeRange";
import { SELECTED_DAY_PANEL_MIN_HEIGHT_CLASS } from "./CalendarSurface";
import type { DayMeta } from "./types";

interface SelectedDayPanelProps {
  dayMeta: DayMeta | null;
  events: PersonalCalendarEventView[];
}

/**
 * The event's own emoji -- `assignmentEmoji`'s typed shift/duty/absence
 * mapping, or (for a display-only "status"/"other" personal activity, e.g.
 * סוגר/שלב 9/כנס בטיחות) `personalActivityEmoji`'s title-keyed lookup, the
 * exact same routing `lib/presentation/calendarDayIndicator.ts` uses for
 * the month-grid indicator, so the same event never shows two different
 * emoji between the grid cell and this detail panel.
 */
function eventEmoji(event: PersonalEventView): string | null {
  if (event.category === "status" || event.category === "other") {
    return personalActivityEmoji(event.title);
  }
  return assignmentEmoji(event);
}

/**
 * The structured subtitle line for one event, distinct per category -- a
 * shift's own role/period, a duty's family+slot, an absence's kind. Never
 * re-derives these from `event.title`'s free text; every value here is a
 * typed field run through the app's existing label maps.
 */
function eventSubtitle(event: PersonalEventView): string | null {
  if (event.category === "shift") {
    const parts = [roleLabel(event.role), periodLabel(event.period)].filter(
      (part): part is string => Boolean(part),
    );
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  if (event.category === "duty" && event.dutyFamily) {
    return event.slot !== null ? `${dutyFamilyLabel(event.dutyFamily)} ${event.slot}` : dutyFamilyLabel(event.dutyFamily);
  }
  if (event.category === "absence" && event.absenceKind) {
    return absenceKindLabel(event.absenceKind);
  }
  return null;
}

/**
 * "מי איתי במשמרת" -- who else is working at the same time as THIS shift,
 * sitting directly beneath that shift's own details inside the very same
 * card, separated by nothing louder than a hairline rule. Never a modal,
 * never a popup, and never rendered into a calendar cell: the month grid
 * next to this panel stays exactly as compact as it was.
 *
 * Renders only what the read model already resolved
 * (`PersonalCalendarEventView.shiftCompanions` -- real time overlap, the
 * viewed person excluded, one row per person) and only for a shift: a
 * `null` companion list means the event isn't a shift at all, so the
 * section doesn't exist for it. An empty list is the opposite -- the
 * question WAS asked and nobody else is on this shift, which is worth
 * saying out loud rather than leaving the reader to guess.
 */
function ShiftCompanions({ companions }: { companions: PersonalShiftCompanion[] }) {
  return (
    <div className="mt-2.5 border-t border-border pt-2.5">
      <p className="text-xs font-medium text-muted-2">מי איתי במשמרת</p>
      {companions.length === 0 ? (
        <p className="mt-1 text-xs text-muted">אין שיבוצים נוספים למשמרת זו</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {companions.map((companion) => (
            <li key={companion.personId} className="text-sm text-foreground">
              {[companion.personName, companion.shiftLabel].filter(Boolean).join(" — ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The selected calendar day's full detail -- every shift/duty/absence on
 * that date, never collapsed to one even when there are several, plus the
 * day's full holiday context. This is deliberately where all the detail
 * lives (the month grid cell next to it stays compact, only a couple of
 * short indicators -- see `CalendarGrid`). Shows only what the server
 * already resolved (`timing`) -- never invents a time for something whose
 * hour can't be evaluated, and never shows a time row at all for a duty or
 * absence (neither is a timed shift). Lives in the desktop side column
 * next to the calendar (see `ScheduleCalendar`), stacking below it on
 * mobile. Wrapped in an accessible, addressable `region` -- both a real
 * a11y landmark and how tests scope queries here vs. the calendar grid's
 * own in-cell indicators (the same event can now legitimately appear in
 * both places at once, in different wording).
 */
export function SelectedDayPanel({ dayMeta, events }: SelectedDayPanelProps) {
  if (!dayMeta) return null;

  return (
    <section aria-label="פרטי היום הנבחר">
      {/*
       * Restrained sr-only announcement (Phase 5 remediation) of a real
       * day-selection change -- the visible panel below it fully re-renders
       * per selected day, but nothing previously told assistive tech that
       * happened. `role="status"` (implicit polite/atomic) rather than
       * `alert`: useful to know, never urgent enough to interrupt. This
       * text changes ONLY when `dayMeta`/`events` themselves change (a real
       * new selection) -- an unrelated re-render with the same day produces
       * the identical string, so React never touches this node's content
       * and no repeat/noisy announcement fires while arrow-key navigating
       * within the same day or elsewhere on the page.
       */}
      <p role="status" className="sr-only">
        {dayMeta.dateLabel}
        {events.length > 0 ? `, ${events.length} אירועים` : ", היום פנוי"}
      </p>
      <Panel variant="panel" className={SELECTED_DAY_PANEL_MIN_HEIGHT_CLASS}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-base font-semibold text-foreground sm:text-lg">{dayMeta.dateLabel}</p>
          {dayMeta.holiday ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-overlay-soft px-2 py-0.5 text-xs font-medium text-foreground ring-1 ring-border">
              <span aria-hidden="true">{dayMeta.holiday.emoji}</span>
              {dayMeta.holiday.label}
            </span>
          ) : null}
        </div>

        {events.length === 0 ? (
          <p className="mt-3 text-sm text-muted">היום פנוי אצלך 😌</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {events.map((event, index) => {
              const emoji = eventEmoji(event);
              // A subtitle identical to the title (e.g. an "אפטר"/"חופש"
              // absence, where both the title and the kind label read the
              // same) says nothing the title above it doesn't already --
              // never render it twice.
              const rawSubtitle = eventSubtitle(event);
              const subtitle = rawSubtitle && rawSubtitle !== event.title ? rawSubtitle : null;

              return (
                <li key={index} className="rounded-xl bg-overlay-faint p-3 ring-1 ring-border">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      {emoji ? <span aria-hidden="true">{emoji}</span> : null}
                      {event.title}
                    </p>
                    {event.category === "shift" ? (
                      event.timing.status === "resolved" ? (
                        <TimeRange
                          start={event.timing.startLocalTime}
                          end={event.timing.endLocalTime}
                          className="text-xs text-muted"
                        />
                      ) : (
                        <span className="text-xs text-muted">השעה טרם מוגדרת</span>
                      )
                    ) : null}
                  </div>
                  {subtitle || event.certainty === "tentative" || event.shadow || event.changeNote ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      {subtitle}
                      {event.certainty === "tentative" ? <Badge tone="warning">משוער</Badge> : null}
                      {event.shadow ? <Badge tone="primary">חפיפה / צל</Badge> : null}
                      {event.changeNote ? <span className="w-full text-muted-2">{event.changeNote}</span> : null}
                    </div>
                  ) : null}
                  {event.category === "shift" ? (
                    <ShiftCompanions companions={event.shiftCompanions ?? []} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </section>
  );
}
