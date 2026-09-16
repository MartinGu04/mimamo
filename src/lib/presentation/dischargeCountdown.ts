import { parseCalendarDate } from "@/lib/domain/dutyBlocks";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "24.01.2027" -- zero-padded day.month.year, for the "תאריך שחרור:" line. Returns null for an unparseable date, never a guessed date. */
export function formatDischargeDateLabel(dateStr: string): string | null {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return null;
  return `${pad2(parsed.day)}.${pad2(parsed.month)}.${parsed.year}`;
}

/** The five discrete "special" days the spec calls out, plus "none" for every other day. Only meaningful while `phase: "counting_down"` -- the discharge-day/post-discharge phases are their own distinct states, not milestones of this countdown. */
export type DischargeMilestone = "none" | "hundred" | "fifty" | "thirty" | "week" | "tomorrow";

export interface DischargeClockParts {
  hours: number;
  minutes: number;
  seconds: number;
}

export interface DischargeServiceProgress {
  /** Whole days served since enlistment, clamped to >= 0. */
  daysServed: number;
  /** Whole days remaining until discharge -- 0 once the discharge day itself arrives. */
  daysRemaining: number;
  /** 0-100, whole percent of service completed. */
  percentServed: number;
}

export type DischargeCountdownState =
  | {
      phase: "counting_down";
      daysRemaining: number;
      clock: DischargeClockParts;
      milestone: DischargeMilestone;
      serviceProgress: DischargeServiceProgress | null;
    }
  | { phase: "discharge_day"; serviceProgress: DischargeServiceProgress | null }
  | { phase: "post_discharge"; daysSinceDischarge: number };

/**
 * An EXACT match against the five called-out days -- never a range. A badge
 * carries a specific number (or implies one, like "השבוע האחרון"), so
 * showing it on a day that doesn't actually match would be a lie (e.g.
 * "100 ימים!" while 51 actually remain). Every other day -- including the
 * days between two milestones -- resolves to "none": the plain countdown
 * with no badge.
 */
function resolveMilestone(daysRemaining: number): DischargeMilestone {
  if (daysRemaining === 100) return "hundred";
  if (daysRemaining === 50) return "fifty";
  if (daysRemaining === 30) return "thirty";
  if (daysRemaining === 7) return "week";
  if (daysRemaining === 1) return "tomorrow";
  return "none";
}

/**
 * `null` when there's no enlistment instant to measure from (spec: reuse
 * existing fields, never invent a start date), or when the resulting
 * service window is empty (e.g. a malformed record where enlistment isn't
 * actually before discharge) -- a genuinely absent stat, never a guessed
 * 0%/100%.
 */
function resolveServiceProgress(
  nowMs: number,
  enlistmentInstantMs: number | null,
  daysRemaining: number,
): DischargeServiceProgress | null {
  if (enlistmentInstantMs === null) return null;

  const daysServed = Math.max(0, Math.floor((nowMs - enlistmentInstantMs) / DAY_MS));
  const total = daysServed + daysRemaining;
  if (total <= 0) return null;

  return { daysServed, daysRemaining, percentServed: Math.round((daysServed / total) * 100) };
}

/**
 * The single source of truth for "עד מתי???"'s live state -- a pure
 * function of plain epoch-ms numbers (no `Date` construction, no timezone
 * conversion), so it's trivially unit-testable and safe to re-run every
 * second from a client component's tick.
 *
 * `dischargeInstantMs`/`dischargeDayEndInstantMs` are the real UTC instants
 * of 00:00:00.000 / 23:59:59.999 Asia/Jerusalem on the discharge date (see
 * `lib/time/jerusalemClock.ts`'s `jerusalemStartOfDayInstant`/
 * `jerusalemEndOfDayInstant`, resolved server-side) -- this is what lets
 * "the discharge day" be a genuine whole civil day, DST-safe, rather than a
 * single instant that would otherwise flip straight from "counting down" to
 * "משוחרר כבר X ימים" with no day in between to say "זהו. השתחררת."
 */
export function resolveDischargeCountdownState(
  nowMs: number,
  dischargeInstantMs: number,
  dischargeDayEndInstantMs: number,
  enlistmentInstantMs: number | null,
): DischargeCountdownState {
  if (nowMs > dischargeDayEndInstantMs) {
    const daysSinceDischarge = Math.floor((nowMs - dischargeDayEndInstantMs) / DAY_MS) + 1;
    return { phase: "post_discharge", daysSinceDischarge };
  }

  if (nowMs >= dischargeInstantMs) {
    return { phase: "discharge_day", serviceProgress: resolveServiceProgress(nowMs, enlistmentInstantMs, 0) };
  }

  const remainingMs = dischargeInstantMs - nowMs;
  const daysRemaining = Math.floor(remainingMs / DAY_MS);
  const clock: DischargeClockParts = {
    hours: Math.floor((remainingMs % DAY_MS) / HOUR_MS),
    minutes: Math.floor((remainingMs % HOUR_MS) / MINUTE_MS),
    seconds: Math.floor((remainingMs % MINUTE_MS) / SECOND_MS),
  };

  return {
    phase: "counting_down",
    daysRemaining,
    clock,
    milestone: resolveMilestone(daysRemaining),
    serviceProgress: resolveServiceProgress(nowMs, enlistmentInstantMs, daysRemaining),
  };
}

export interface DischargeMilestoneCopy {
  /** null for "none" -- the default state gets no badge at all, only the plain countdown. */
  badge: string | null;
  /**
   * A fixed hex color, NOT a theme-aware `--foreground`/`--primary` token --
   * this screen is a deliberately always-dark cinematic canvas regardless of
   * the page background like every other screen, so these are theme tokens
   * rather than fixed hexes. Each one below used to be hardcoded to exactly
   * its own token's DARK value (`--foreground` was `#edf1f4`, `--accent`
   * `#4fc3e8`, and so on), back when this screen sat on a fixed dark panel
   * that made a light-mode tone wrong. That panel is gone, so the fixed
   * hexes would now put near-white digits on a near-white page -- pointing
   * at the tokens keeps dark mode pixel-identical and lets light mode pick
   * up the contrast-tuned tone it always had available.
   */
  accentColor: string;
}

const MILESTONE_COPY: Record<DischargeMilestone, DischargeMilestoneCopy> = {
  none: { badge: null, accentColor: "var(--foreground)" },
  hundred: { badge: "100 ימים!", accentColor: "var(--accent)" },
  fifty: { badge: "50 ימים!", accentColor: "var(--primary)" },
  thirty: { badge: "30 הימים האחרונים!", accentColor: "var(--warning)" },
  week: { badge: "השבוע האחרון!", accentColor: "var(--success)" },
  tomorrow: { badge: "מחר!", accentColor: "var(--success)" },
};

/** The badge copy + accent color for a given milestone phase -- a plain lookup, kept as its own function so the mapping is independently testable. */
export function resolveDischargeMilestoneCopy(milestone: DischargeMilestone): DischargeMilestoneCopy {
  return MILESTONE_COPY[milestone];
}
