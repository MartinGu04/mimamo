import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import type { DischargeCountdownPersonSummary } from "@/lib/readModels/dischargeCountdown";
import {
  formatDischargeDateLabel,
  resolveDischargeCountdownState,
  type DischargeCountdownState,
} from "@/lib/presentation/dischargeCountdown";
import { countdownPersonHref } from "@/lib/presentation/dischargeCountdownUrl";

interface DischargeEveryoneOverviewProps {
  people: readonly DischargeCountdownPersonSummary[];
  /** Resolved server-side with the rest of the view (`resolvedAtIso`) -- never read from the clock here, which would be an impure render. */
  nowMs: number;
}

/**
 * "כולם" -- a scannable overview of regular-service discharge countdowns,
 * soonest first (the roster arrives already filtered and sorted; see
 * `lib/domain/dischargeRoster.ts`).
 *
 * Deliberately a SERVER component with no ticking: every card's numbers come
 * from the single `resolvedAtIso` the read model already stamped, so a roster
 * of any size costs zero timers and zero client state. Days-remaining and percent-served
 * only change on a day boundary, and the route is already `force-dynamic`,
 * so a per-navigation value is as live as these figures can meaningfully be.
 * The full `HH:MM:SS` tick stays where it belongs -- on the one person's
 * countdown you opened.
 *
 * Every figure still comes from `resolveDischargeCountdownState`, the same
 * authoritative calculator the personal view uses, rather than a second
 * days-between-dates implementation that could drift from it.
 */
export function DischargeEveryoneOverview({ people, nowMs }: DischargeEveryoneOverviewProps) {
  if (people.length === 0) {
    return (
      <p className="py-16 text-center text-base text-muted">אין כרגע אנשי סדיר עם ספירה לשחרור.</p>
    );
  }

  return (
    <ul className="grid list-none grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {people.map((person) => (
        <li key={person.personId}>
          <PersonCard person={person} nowMs={nowMs} />
        </li>
      ))}
    </ul>
  );
}

function PersonCard({ person, nowMs }: { person: DischargeCountdownPersonSummary; nowMs: number }) {
  // A person with no discharge date on record never reaches the countdown
  // calculator -- there is nothing to count to, and inventing a date would be
  // worse than saying so.
  const state =
    person.dischargeInstantIso && person.dischargeDayEndInstantIso
      ? resolveDischargeCountdownState(
          nowMs,
          new Date(person.dischargeInstantIso).getTime(),
          new Date(person.dischargeDayEndInstantIso).getTime(),
          person.enlistmentInstantIso ? new Date(person.enlistmentInstantIso).getTime() : null,
        )
      : null;

  const dateLabel = person.dischargeDate ? formatDischargeDateLabel(person.dischargeDate) : null;
  const progress = state && state.phase !== "post_discharge" ? state.serviceProgress : null;

  return (
    <Link
      href={countdownPersonHref(person.personId)}
      className="glass-subtle glass-ring-none flex h-full items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors duration-200 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {/* No avatarUrl: כ"א carries no photos, and a profile photo only exists
          for the signed-in user's own Supabase identity -- so Avatar's
          initials fallback is the real rendering here for everyone. */}
      <Avatar name={person.personName} size="md" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-sm font-semibold text-foreground">{person.personName}</p>
        <p className="text-xs text-muted">{dateLabel ? `שחרור: ${dateLabel}` : "אין תאריך שחרור"}</p>

        {progress ? (
          <div className="mt-0.5 flex items-center gap-2">
            <div
              role="progressbar"
              aria-label={`התקדמות השירות של ${person.personName}`}
              aria-valuenow={progress.percentServed}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-overlay-strong"
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${progress.percentServed}%` }} />
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted">{progress.percentServed}%</span>
          </div>
        ) : null}
      </div>

      <RemainingFigure state={state} />
    </Link>
  );
}

/** The card's anchor figure -- days remaining, or the equivalent for every other phase. */
function RemainingFigure({ state }: { state: DischargeCountdownState | null }) {
  if (state === null) {
    return <span className="shrink-0 text-xs text-muted-2">—</span>;
  }

  if (state.phase === "discharge_day") {
    return <span className="shrink-0 text-sm font-bold text-success">היום!</span>;
  }

  if (state.phase === "post_discharge") {
    return (
      <span className="shrink-0 text-end text-xs text-muted">
        השתחרר/ה
        <br />
        <span className="tabular-nums">לפני {state.daysSinceDischarge} ימים</span>
      </span>
    );
  }

  return (
    <span className="flex shrink-0 flex-col items-center leading-none">
      <span className="text-2xl font-black tabular-nums text-foreground">{state.daysRemaining}</span>
      <span className="mt-0.5 text-[10px] font-medium text-muted">ימים</span>
    </span>
  );
}
