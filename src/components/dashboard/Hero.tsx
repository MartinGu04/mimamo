import { CalendarClock } from "lucide-react";
import type {
  PersonalAdjacentShiftContext,
  PersonalAssignmentView,
  PersonalEventView,
  PersonalNextAssignmentGroup,
  PersonalShiftContext,
} from "@/lib/readModels/types";
import type { AssignmentTiming } from "@/lib/domain/assignmentTiming";
import type { EventPeriod, EventRole } from "@/lib/domain/event";
import { jerusalemLocalTimeToInstant } from "@/lib/time/jerusalemClock";
import { relativeDayLabel, formatHebrewWeekdayAndDate } from "@/lib/presentation/hebrewDate";
import { assignmentEmoji } from "@/lib/presentation/emoji";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { AdjacentShiftContextRow } from "./AdjacentShiftContext";
import { CounterpartPanel } from "./CounterpartPanel";
import { EventLiveProgress } from "./EventLiveProgress";
import { PulseIndicator } from "./PulseIndicator";
import { TimeRange } from "./TimeRange";

interface HeroProps {
  currentAssignments: PersonalAssignmentView[];
  nextAssignmentGroup: PersonalNextAssignmentGroup | null;
  /** Every current-shift counterpart context the read model computed -- Hero picks the one that actually matches its lead shift, never index 0 blindly. */
  currentShiftContexts: PersonalShiftContext[];
  nextShiftContexts: PersonalShiftContext[];
  /** מי לפניי / מי אחריי context for the current shift -- same matching rule as `currentShiftContexts`, never rendered for `nextShiftContexts` (upcoming shifts are out of scope for adjacency). */
  currentAdjacentShiftContexts: PersonalAdjacentShiftContext[];
  /** A known blocking absence (vacation/abroad/medical/day_off) dated today, only when there is no current shift/duty already active. */
  vacationEvent: PersonalEventView | null;
  /** Today's other Events besides `vacationEvent` -- preserved so a vacation day is never falsely reported as fully empty. */
  otherTodayEvents: PersonalEventView[];
  fetchedAt: string;
  localNowDate: string;
}

/**
 * The dominant "what is happening to me now?" element. States, in
 * priority order: a current assignment (shift preferred as lead, live
 * pulse + progress); a known vacation/leave day with nothing currently
 * active (calm, never falsely "fully free" if other Events exist today);
 * an upcoming assignment (calmer, countdown only where genuinely known);
 * or a quiet empty state. "Who is with me?" renders embedded in the same
 * surface when relevant -- never a disconnected card.
 */
export function Hero({
  currentAssignments,
  nextAssignmentGroup,
  currentShiftContexts,
  nextShiftContexts,
  currentAdjacentShiftContexts,
  vacationEvent,
  otherTodayEvents,
  fetchedAt,
  localNowDate,
}: HeroProps) {
  if (currentAssignments.length > 0) {
    return (
      <CurrentHero
        assignments={currentAssignments}
        shiftContexts={currentShiftContexts}
        adjacentShiftContexts={currentAdjacentShiftContexts}
        fetchedAt={fetchedAt}
      />
    );
  }

  if (vacationEvent) {
    return <VacationHero vacationEvent={vacationEvent} otherTodayEvents={otherTodayEvents} />;
  }

  if (nextAssignmentGroup) {
    return (
      <NextHero
        group={nextAssignmentGroup}
        shiftContexts={nextShiftContexts}
        fetchedAt={fetchedAt}
        localNowDate={localNowDate}
      />
    );
  }

  return <EmptyHero />;
}

/**
 * A counterpart (or adjacent-shift) context may only be embedded when it
 * actually corresponds to the shift being displayed as the hero's lead --
 * matched on the safe date/role/period fields already on both sides, never
 * by array index. `nextShiftContexts` in particular is computed
 * independently of `nextAssignmentGroup` (it's the earliest upcoming SHIFT
 * specifically, which can land on a later date than a duty-only next
 * group), so index 0 can silently belong to a different, later shift than
 * the one shown. Generic over both `PersonalShiftContext` and
 * `PersonalAdjacentShiftContext`, which share this exact matching shape.
 */
function findMatchingShiftContext<T extends { date: string; role: EventRole; period: EventPeriod }>(
  lead: PersonalAssignmentView,
  contexts: readonly T[],
): T | null {
  if (lead.category !== "shift") return null;
  return (
    contexts.find(
      (context) => context.date === lead.date && context.role === lead.role && context.period === lead.period,
    ) ?? null
  );
}

type ResolvedTiming = Extract<AssignmentTiming, { status: "resolved" }>;

/**
 * The real Asia/Jerusalem instants (ISO) for a resolved shift timing,
 * anchored to the event's own calendar `date` -- the one place `Hero`
 * turns local schedule time into a real instant, via the app's one
 * Jerusalem time-conversion utility (`lib/time/jerusalemClock`), never a
 * separate interpretation. `endInstant` reuses the already-resolved
 * `durationMinutes` rather than re-deriving whether the shift wraps past
 * midnight -- that overnight logic already lives once, in `domain`.
 */
function resolveEventInstants(date: string, timing: ResolvedTiming): { startInstant: string; endInstant: string } {
  const [startHour, startMinute] = timing.startLocalTime.split(":").map(Number);
  const start = jerusalemLocalTimeToInstant(date, startHour, startMinute);
  const end = new Date(start.getTime() + timing.durationMinutes * 60_000);
  return { startInstant: start.toISOString(), endInstant: end.toISOString() };
}

/** A small restrained emoji anchor, rendered before the title it describes. Returns null (renders nothing) when the assignment maps to no known emoji. */
function EmojiAnchor({ emoji }: { emoji: string | null }) {
  if (!emoji) return null;
  return (
    <span aria-hidden="true" className="me-2">
      {emoji}
    </span>
  );
}

function CurrentHero({
  assignments,
  shiftContexts,
  adjacentShiftContexts,
  fetchedAt,
}: {
  assignments: PersonalAssignmentView[];
  shiftContexts: PersonalShiftContext[];
  adjacentShiftContexts: PersonalAdjacentShiftContext[];
  fetchedAt: string;
}) {
  const lead = assignments.find((a) => a.category === "shift") ?? assignments[0];
  const secondary = assignments.filter((a) => a !== lead);
  const shiftContext = findMatchingShiftContext(lead, shiftContexts);
  const adjacentContext = findMatchingShiftContext(lead, adjacentShiftContexts);
  const emoji = assignmentEmoji(lead);

  return (
    <Panel variant="hero" className="animate-fade-up relative overflow-hidden border-s-2 border-s-primary">
      <div className="relative flex items-center gap-2 text-sm font-semibold text-primary">
        <PulseIndicator />
        <span>פעיל עכשיו</span>
      </div>

      <h2 className="relative mt-3 text-2xl font-semibold text-balance text-foreground sm:text-3xl">
        <EmojiAnchor emoji={emoji} />
        {lead.title}
      </h2>

      {lead.category === "shift" && lead.certainty === "tentative" ? (
        <p className="relative mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone="warning">משוער</Badge>
        </p>
      ) : null}

      {lead.timing.status === "resolved" ? (
        <p className="relative mt-3 text-sm text-muted">
          <TimeRange start={lead.timing.startLocalTime} end={lead.timing.endLocalTime} />
        </p>
      ) : null}

      {lead.category === "shift" && lead.timing.status === "resolved" ? (
        <div className="relative mt-5">
          <EventLiveProgress
            {...resolveEventInstants(lead.date, lead.timing)}
            mode="active"
            fetchedAt={fetchedAt}
          />
        </div>
      ) : null}

      {secondary.length > 0 ? (
        <div className="relative mt-5 flex flex-wrap gap-2">
          {secondary.map((assignment, index) => (
            <span
              key={index}
              className="rounded-full bg-overlay-soft px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border"
            >
              {assignment.title}
            </span>
          ))}
        </div>
      ) : null}

      {shiftContext ? (
        <div className="relative mt-6 border-t border-border pt-5">
          <CounterpartPanel context={shiftContext} compact />
          <AdjacentShiftContextRow context={adjacentContext} />
        </div>
      ) : null}
    </Panel>
  );
}

function VacationHero({
  vacationEvent,
  otherTodayEvents,
}: {
  vacationEvent: PersonalEventView;
  otherTodayEvents: PersonalEventView[];
}) {
  const emoji = assignmentEmoji(vacationEvent) ?? "🏖️";
  const hasOtherItems = otherTodayEvents.length > 0;

  return (
    <Panel variant="hero" className="animate-fade-up text-center sm:text-start">
      <span aria-hidden="true" className="text-3xl">
        {emoji}
      </span>
      <h2 className="mt-3 text-xl font-semibold text-foreground sm:text-2xl">{vacationEvent.title}</h2>
      <p className="mt-1.5 text-sm text-muted">{hasOtherItems ? "אין לך שיבוץ פעיל כרגע" : "היום שלך פנוי"}</p>

      {hasOtherItems ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
          {otherTodayEvents.map((event, index) => (
            <span
              key={index}
              className="rounded-full bg-overlay-soft px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border"
            >
              {event.title}
            </span>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function NextHero({
  group,
  shiftContexts,
  fetchedAt,
  localNowDate,
}: {
  group: PersonalNextAssignmentGroup;
  shiftContexts: PersonalShiftContext[];
  fetchedAt: string;
  localNowDate: string;
}) {
  const lead = group.events.find((e) => e.category === "shift" && e.timing.status === "resolved") ?? group.events[0];
  const others = group.events.filter((e) => e !== lead);
  const shiftContext = findMatchingShiftContext(lead, shiftContexts);
  const emoji = assignmentEmoji(lead);

  const relDay = relativeDayLabel(group.date, localNowDate);
  const dateLabel =
    relDay === "today" ? "היום" : relDay === "tomorrow" ? "מחר" : (formatHebrewWeekdayAndDate(group.date) ?? "");

  return (
    <Panel variant="hero" className="animate-fade-up">
      <div className="flex items-center gap-2 text-sm font-semibold text-muted">
        <CalendarClock className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        <span>הבא שלך</span>
      </div>

      <h2 className="mt-3 text-2xl font-semibold text-balance text-foreground sm:text-3xl">
        <EmojiAnchor emoji={emoji} />
        {lead.title}
      </h2>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span>{dateLabel}</span>
        <span aria-hidden="true">·</span>
        {lead.timing.status === "resolved" ? (
          <TimeRange start={lead.timing.startLocalTime} end={lead.timing.endLocalTime} />
        ) : (
          <span>השעה טרם מוגדרת</span>
        )}
        {lead.certainty === "tentative" ? <Badge tone="warning">משוער</Badge> : null}
      </p>

      {lead.timing.status === "resolved" ? (
        <div className="mt-4">
          <EventLiveProgress
            {...resolveEventInstants(lead.date, lead.timing)}
            mode="countdown"
            fetchedAt={fetchedAt}
          />
        </div>
      ) : null}

      {others.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {others.map((event, index) => (
            <span
              key={index}
              className="rounded-full bg-overlay-soft px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border"
            >
              {event.title}
            </span>
          ))}
        </div>
      ) : null}

      {shiftContext ? (
        <div className="mt-6 border-t border-border pt-5">
          <CounterpartPanel context={shiftContext} compact />
        </div>
      ) : null}
    </Panel>
  );
}

function EmptyHero() {
  return (
    <Panel variant="hero" className="animate-fade-up text-center sm:text-start">
      <span aria-hidden="true" className="text-3xl">
        😌
      </span>
      <h2 className="mt-3 text-xl font-semibold text-foreground">הכול שקט כרגע</h2>
      <p className="mt-1.5 text-sm text-muted">אין לך שיבוצים קרובים בלוח.</p>
    </Panel>
  );
}
