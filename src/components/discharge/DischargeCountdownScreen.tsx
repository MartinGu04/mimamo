"use client";

import {
  resolveDischargeCountdownState,
  resolveDischargeMilestoneCopy,
  type DischargeClockParts,
  type DischargeCountdownState,
} from "@/lib/presentation/dischargeCountdown";
import { useLiveClock } from "./useLiveClock";

export interface DischargeCountdownScreenProps {
  /** "24.01.2027" -- already formatted server-side. */
  dischargeDateLabel: string;
  /** ISO instants resolved server-side (`lib/time/jerusalemClock`, server-only) -- this client component only ever does plain ms arithmetic against them, never its own timezone conversion. */
  dischargeInstantIso: string;
  dischargeDayEndInstantIso: string;
  enlistmentInstantIso: string | null;
}

/**
 * "עד מתי???" -- a full-bleed, always-dark cinematic countdown (spec: "not a
 * normal dashboard card"), ticking every second. Hydration-safe the same
 * way every other live countdown in this app is (`PlannedRangeCountdown`/
 * `QualificationLiveCard`): `useLiveClock()` is `null` on the very first
 * render (identical during SSR and hydration), so a fixed placeholder
 * renders then -- never a `Date.now()` read before mount.
 *
 * All of the actual state (which phase, days/H:M:S, milestone, service
 * progress) comes from the single pure `resolveDischargeCountdownState` --
 * this component only ticks the clock and renders whatever that function
 * says, so there is exactly one place the countdown's math can be wrong.
 */
export function DischargeCountdownScreen({
  dischargeDateLabel,
  dischargeInstantIso,
  dischargeDayEndInstantIso,
  enlistmentInstantIso,
}: DischargeCountdownScreenProps) {
  const nowMs = useLiveClock();

  const state =
    nowMs === null
      ? null
      : resolveDischargeCountdownState(
          nowMs,
          new Date(dischargeInstantIso).getTime(),
          new Date(dischargeDayEndInstantIso).getTime(),
          enlistmentInstantIso ? new Date(enlistmentInstantIso).getTime() : null,
        );

  const serviceProgress =
    state?.phase === "counting_down" || state?.phase === "discharge_day" ? state.serviceProgress : null;
  const daysRemainingForStats = state?.phase === "counting_down" ? state.daysRemaining : 0;
  const showStatsRow = state?.phase === "counting_down" || state?.phase === "discharge_day";

  return (
    <div className="relative flex min-h-[calc(100dvh-10rem)] flex-col items-center justify-center overflow-hidden px-4 py-16 text-center text-foreground sm:px-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--satcom-horizon-glow),_transparent_60%)]"
      />

      <div className="relative flex flex-col items-center gap-2">
        <h1 className="text-4xl font-black tracking-tight sm:text-6xl">עד מתי???</h1>
        {state?.phase === "counting_down" ? (
          <p className="text-sm text-muted sm:text-base">עד השחרור נשארו</p>
        ) : null}
      </div>

      <div className="relative mt-10 flex min-h-[10rem] flex-col items-center justify-center gap-3 sm:mt-14 sm:min-h-[14rem]">
        {renderMainState(state)}
      </div>

      <div className="relative mt-10 flex flex-col items-center gap-1.5 text-sm text-muted sm:mt-14 sm:text-base">
        <p>תאריך שחרור: {dischargeDateLabel}</p>
        {showStatsRow ? (
          <>
            {serviceProgress ? (
              <>
                <p className="font-semibold text-foreground">{serviceProgress.percentServed}% מאחוריך</p>
                <div
                  role="progressbar"
                  aria-label="התקדמות השירות מגיוס ועד שחרור"
                  aria-valuenow={serviceProgress.percentServed}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="mt-1 h-2.5 w-56 max-w-[70vw] overflow-hidden rounded-full bg-overlay-strong sm:w-72"
                >
                  <div
                    className="h-full rounded-full transition-[width] duration-500 ease-out"
                    style={{ width: `${serviceProgress.percentServed}%`, backgroundColor: "#4fc3e8" }}
                  />
                </div>
                <p className="tabular-nums">{serviceProgress.daysServed} ימים בשירות</p>
              </>
            ) : null}
            <p className="tabular-nums">{daysRemainingForStats} ימים נשארו</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

function renderMainState(state: DischargeCountdownState | null) {
  if (!state) {
    return (
      <>
        <span className="text-7xl font-black tabular-nums leading-none sm:text-9xl">--</span>
        <span className="text-2xl font-semibold text-foreground/80 sm:text-4xl">ימים</span>
        <ClockGrid clock={null} />
      </>
    );
  }

  if (state.phase === "discharge_day") {
    return (
      <p className="text-4xl font-black leading-tight sm:text-7xl" style={{ color: "var(--success)" }}>
        זהו. השתחררת.
      </p>
    );
  }

  if (state.phase === "post_discharge") {
    return (
      <p className="text-3xl font-black leading-tight sm:text-6xl">
        משוחרר כבר {state.daysSinceDischarge} ימים
      </p>
    );
  }

  const copy = resolveDischargeMilestoneCopy(state.milestone);

  return (
    <>
      {copy.badge ? (
        <span className="animate-pulse-dot text-lg font-bold sm:text-2xl" style={{ color: copy.accentColor }}>
          {copy.badge}
        </span>
      ) : null}
      <span className="text-7xl font-black tabular-nums leading-none sm:text-9xl" style={{ color: copy.accentColor }}>
        {state.daysRemaining}
      </span>
      <span className="text-2xl font-semibold text-foreground/80 sm:text-4xl">ימים</span>
      <ClockGrid clock={state.clock} />
    </>
  );
}

/**
 * The `HH : MM : SS` row, plus a small "שעות / דקות / שניות" label under each
 * group. Forced `dir="ltr"` (the HTML UA stylesheet applies `unicode-bidi:
 * isolate` to any element with an explicit `dir`, and the inline style below
 * makes that explicit rather than relying on it implicitly) so the digit
 * groups and separators can never be bidi-reordered by the page's own
 * `dir="rtl"` -- without this, "15 : 34 : 32" could visually read out of
 * order inside an RTL context. Rendered as a CSS grid (not three
 * independently-flexed columns) so the label row's three words line up
 * under their matching number group by construction, not by manually
 * matched widths -- the colon columns simply get no label underneath them.
 * `clock: null` renders the same layout with "--" placeholders, so the
 * pre-mount placeholder never lays out differently from the live clock.
 */
function ClockGrid({ clock }: { clock: DischargeClockParts | null }) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const hours = clock ? pad2(clock.hours) : "--";
  const minutes = clock ? pad2(clock.minutes) : "--";
  const seconds = clock ? pad2(clock.seconds) : "--";
  const numberClassName = clock
    ? "font-mono text-3xl font-bold tabular-nums tracking-widest text-foreground/90 sm:text-5xl"
    : "font-mono text-3xl font-bold tabular-nums tracking-widest text-muted sm:text-5xl";
  const labelClassName = "text-center text-[10px] font-medium text-muted-2 sm:text-xs";

  return (
    <div
      dir="ltr"
      data-testid="discharge-clock"
      style={{ unicodeBidi: "isolate" }}
      className="mt-2 grid grid-cols-[auto_auto_auto_auto_auto] items-end justify-center gap-x-1.5 gap-y-1 sm:gap-x-2.5"
    >
      <span className={numberClassName}>{hours}</span>
      <span aria-hidden className={numberClassName}>
        :
      </span>
      <span className={numberClassName}>{minutes}</span>
      <span aria-hidden className={numberClassName}>
        :
      </span>
      <span className={numberClassName}>{seconds}</span>

      <span className={labelClassName}>שעות</span>
      <span aria-hidden />
      <span className={labelClassName}>דקות</span>
      <span aria-hidden />
      <span className={labelClassName}>שניות</span>
    </div>
  );
}
