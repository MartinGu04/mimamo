"use client";

import { Badge } from "@/components/ui/Badge";
import type { QualificationStatus } from "@/lib/domain/shootingRangeQualification";
import { computeRemainingProgress, formatDurationParts, formatDurationUnitsLabel } from "@/lib/presentation/shootingRangeDuration";
import { presentQualificationStatus } from "@/lib/presentation/shootingRangeStatus";
import { ProgressRing } from "./ProgressRing";
import { useLiveClock } from "./useLiveClock";

const DAY_MS = 86_400_000;

export interface QualificationLiveCardProps {
  status: QualificationStatus;
  /** "29/06/2026" -- already formatted server-side; null when there's no baseline at all. */
  baselineDateLabel: string | null;
  expiryDateLabel: string | null;
  /** ISO instants (start of the baseline civil day / end of the expiry civil day, Asia/Jerusalem) -- computed server-side, see `lib/time/jerusalemClock.ts`. `null` exactly when the baseline/expiry themselves are null. */
  startInstantIso: string | null;
  expiryInstantIso: string | null;
  /** Server-computed `expiryDate - today` in whole civil days (negative once expired) -- used ONLY for the pre-hydration static render, so that render is byte-identical between server and client (no `Date.now()` before mount). */
  initialDaysRemaining: number | null;
}

/**
 * The personal qualification card's live countdown + progress ring. Server
 * computes the authoritative baseline/expiry INSTANTS once
 * (`lib/readModels/shootingRangeQualification.ts` + the page that renders
 * this); this component only ever runs a local, client-side ticking
 * display off those fixed instants -- never its own server polling.
 *
 * Hydration-safe by construction: `useLiveClock()` is `null` on the very
 * first render (both server and client), so that render always shows the
 * exact same day-granularity snapshot derived from `initialDaysRemaining`
 * (a plain prop, not a client clock read) -- only once mounted does it
 * switch to full ms-precision ticking. See `useLiveClock`'s own docstring.
 */
export function QualificationLiveCard(props: QualificationLiveCardProps) {
  const nowMs = useLiveClock();
  const presentation = presentQualificationStatus(props.status);

  if (props.baselineDateLabel === null || props.startInstantIso === null || props.expiryInstantIso === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p className="text-lg font-semibold text-foreground">כשירות מטווח</p>
        <Badge tone={presentation.badgeTone}>{presentation.label}</Badge>
        <p className="max-w-xs text-sm text-muted">אין עדיין נתוני מטווח מאומתים עבורך.</p>
      </div>
    );
  }

  const startMs = new Date(props.startInstantIso).getTime();
  const expiryMs = new Date(props.expiryInstantIso).getTime();
  const totalWindowMs = Math.max(1, expiryMs - startMs);

  const isLive = nowMs !== null;
  const isExpired = isLive ? nowMs > expiryMs : (props.initialDaysRemaining ?? 0) < 0;

  // Fraction of the qualification window REMAINING (1 = just qualified, 0
  // = at/after expiry) -- the ring visualizes how much validity is left,
  // not how much has elapsed, so it reads consistently with the large
  // days-remaining number in its center (see `computeRemainingProgress`).
  let progress: number;
  let displayMs: number;

  if (isLive) {
    progress = computeRemainingProgress(nowMs, startMs, expiryMs);
    displayMs = isExpired ? nowMs - expiryMs : expiryMs - nowMs;
  } else {
    const daysRemaining = props.initialDaysRemaining ?? 0;
    progress = Math.min(1, Math.max(0, (daysRemaining * DAY_MS) / totalWindowMs));
    displayMs = Math.abs(daysRemaining) * DAY_MS;
  }

  const parts = formatDurationParts(displayMs);

  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <p className="text-lg font-semibold text-foreground">כשירות מטווח</p>

      <ProgressRing
        progress={progress}
        toneClassName={presentation.ringToneClassName}
        showLiveMarker={isLive && progress > 0}
        accessibleLabel="כשירות מטווח"
        accessibleValueText={`${parts.days} ימים ${isExpired ? "מאז פקיעת הכשירות" : "עד לפקיעת הכשירות"}`}
      >
        <div className="flex flex-col items-center">
          <span className="text-3xl font-bold tabular-nums text-foreground">{parts.days}</span>
          <span className="text-xs text-muted">ימים</span>
        </div>
      </ProgressRing>

      <Badge tone={presentation.badgeTone}>{presentation.label}</Badge>

      <span className="text-sm tabular-nums text-muted">
        {isLive ? formatDurationUnitsLabel(parts) : "-- שעות · -- דקות · -- שניות"}
      </span>

      <p className="text-xs text-muted-2">{isExpired ? "מאז פקיעת הכשירות" : "נותרו עד לפקיעת הכשירות"}</p>

      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted">
        <span>מטווח אחרון: {props.baselineDateLabel}</span>
        <span>תוקף עד: {props.expiryDateLabel}</span>
      </div>
    </div>
  );
}
