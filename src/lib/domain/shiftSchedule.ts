import type { Event, EventPeriod } from "./event";
import { addCalendarDays, formatCalendarDate, subtractCalendarDays } from "./dateRange";
import { parseCalendarDate } from "./dutyBlocks";
import type { LocalNow } from "./localNow";

/**
 * המחלבה currently models every shift as exactly 12 hours. Documented here
 * as the one domain constant the whole day/night derivation is built on.
 */
export const SHIFT_DURATION_MINUTES = 12 * 60;

/** Minutes in one calendar day — the modulus for the schedule-clock timeline. */
export const MINUTES_PER_DAY = 24 * 60;

/** Thrown when the configured day-shift start time is missing or not a valid clock value. */
export class ShiftConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShiftConfigurationError";
  }
}

/**
 * A day/night shift schedule expressed on a single deterministic minute
 * timeline, where minute 0 is midnight of "today" (the schedule date an
 * Event is stored on). Values past 1439 fall on the following calendar
 * day — this is how a night shift crosses midnight without ever touching
 * `Date`/UTC. `Event.date` itself is never changed by any of this.
 */
export interface ShiftSchedule {
  dayStartMinute: number;
  dayEndMinute: number;
  nightStartMinute: number;
  nightEndMinute: number;
}

const CLOCK_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Builds the day/night shift schedule from the workbook's configured
 * "תחילת משמרת יום" value (e.g. "07:30" or "07:30:00"). Night is simply
 * the 12 hours immediately after day ends. Never falls back to a default
 * time — a missing or invalid value throws ShiftConfigurationError so bad
 * configuration can never silently produce a plausible-looking schedule.
 */
export function buildShiftSchedule(configuredDayStart: string | null | undefined): ShiftSchedule {
  if (!configuredDayStart || configuredDayStart.trim() === "") {
    throw new ShiftConfigurationError(
      'Missing shift start time configuration ("תחילת משמרת יום").',
    );
  }

  const dayStartMinute = parseClockToMinuteOfDay(configuredDayStart);
  const dayEndMinute = dayStartMinute + SHIFT_DURATION_MINUTES;
  const nightStartMinute = dayEndMinute;
  const nightEndMinute = nightStartMinute + SHIFT_DURATION_MINUTES;

  return { dayStartMinute, dayEndMinute, nightStartMinute, nightEndMinute };
}

function parseClockToMinuteOfDay(raw: string): number {
  const match = raw.trim().match(CLOCK_RE);
  if (!match) {
    throw new ShiftConfigurationError(
      `Invalid shift start time configuration: "${raw}". Expected "HH:mm" or "HH:mm:ss".`,
    );
  }

  const [, hourStr, minuteStr, secondStr] = match;
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = secondStr === undefined ? 0 : Number(secondStr);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    throw new ShiftConfigurationError(
      `Invalid shift start time configuration: "${raw}". Hour must be 00-23 and minute/second must be 00-59.`,
    );
  }

  return hour * 60 + minute;
}

// ---------------------------------------------------------------------------
// Effective shift interval for a single Event
// ---------------------------------------------------------------------------

export interface MinuteInterval {
  startMinute: number;
  endMinute: number;
}

export type ShiftIntervalResolution =
  | { status: "resolved"; interval: MinuteInterval }
  /** Not a shift Event at all (duty/absence/constraint/status/context/change_note/other/unknown). */
  | { status: "not_applicable" }
  /** A shift Event with an unspecified (or otherwise non-day/night) period — no canonical window to resolve. */
  | { status: "not_evaluable" }
  /** A shift Event whose start/end override is out of range or outside the canonical shift window. */
  | { status: "invalid" };

/**
 * Resolves the effective start/end minute interval of a shift Event against
 * a schedule, respecting `startTimeOverride`/`endTimeOverride`. Pure and
 * deterministic — no Date/UTC, no mutation of the Event.
 *
 * This is STRUCTURAL timing only: it does not know or care whether the
 * Event is `confirmed` or `tentative`. A future rules engine decides
 * whether tentative coverage should count as operationally confirmed.
 */
export function resolveEventShiftInterval(
  event: Event,
  schedule: ShiftSchedule,
): ShiftIntervalResolution {
  if (event.category !== "shift") {
    return { status: "not_applicable" };
  }

  if (event.period !== "day" && event.period !== "night") {
    return { status: "not_evaluable" };
  }

  const canonicalStart = event.period === "day" ? schedule.dayStartMinute : schedule.nightStartMinute;
  const canonicalEnd = event.period === "day" ? schedule.dayEndMinute : schedule.nightEndMinute;

  const startMinute =
    event.startTimeOverride === null
      ? canonicalStart
      : mapClockOntoWindow(event.startTimeOverride, canonicalStart, canonicalEnd);
  if (startMinute === null) return { status: "invalid" };

  const endMinute =
    event.endTimeOverride === null
      ? canonicalEnd
      : mapClockOntoWindow(event.endTimeOverride, canonicalStart, canonicalEnd);
  if (endMinute === null) return { status: "invalid" };

  if (startMinute >= endMinute) return { status: "invalid" };

  return { status: "resolved", interval: { startMinute, endMinute } };
}

/**
 * Maps an "HH:mm" clock time onto whichever occurrence of it (today,
 * tomorrow, ...) falls inside [windowStart, windowEnd] — this is what lets
 * "00:00" in a night-shift override mean the midnight *after* the shift
 * started, not before it. Returns null for an invalid clock value or one
 * that doesn't fall in the window at all (never silently accepted).
 */
function mapClockOntoWindow(clock: string, windowStart: number, windowEnd: number): number | null {
  const clockMinute = parseValidClockMinute(clock);
  if (clockMinute === null) return null;

  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const candidate = clockMinute + dayOffset * MINUTES_PER_DAY;
    if (candidate >= windowStart && candidate <= windowEnd) {
      return candidate;
    }
  }

  return null;
}

/** Strict "HH:mm" (00-23 / 00-59) — rejects structurally-parsed-but-invalid values like "99:99". */
function parseValidClockMinute(clock: string): number | null {
  const match = clock.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return hour * 60 + minute;
}

// ---------------------------------------------------------------------------
// Adjacent shift on the canonical day/night timeline (מי לפניי / מי אחריי)
// ---------------------------------------------------------------------------

export interface AdjacentShiftPeriod {
  date: string;
  period: "day" | "night";
}

/**
 * The shift immediately preceding `(date, period)` on the canonical
 * day → night → day → ... timeline: a night shift is always preceded by
 * that same date's day shift; a day shift is always preceded by the
 * PREVIOUS date's night shift (crossing the calendar-date boundary). Only
 * day/night have a canonical position on this timeline — morning/
 * unspecified return null, never a guessed adjacency.
 */
export function previousShiftPeriod(date: string, period: EventPeriod): AdjacentShiftPeriod | null {
  if (period !== "day" && period !== "night") return null;
  if (period === "night") return { date, period: "day" };

  const parsed = parseCalendarDate(date);
  if (!parsed) return null;
  return { date: formatCalendarDate(subtractCalendarDays(parsed, 1)), period: "night" };
}

/** The shift immediately following `(date, period)` on the same timeline — see `previousShiftPeriod`. */
export function nextShiftPeriod(date: string, period: EventPeriod): AdjacentShiftPeriod | null {
  if (period !== "day" && period !== "night") return null;
  if (period === "day") return { date, period: "night" };

  const parsed = parseCalendarDate(date);
  if (!parsed) return null;
  return { date: formatCalendarDate(addCalendarDays(parsed, 1)), period: "day" };
}

/**
 * Which canonical shift is active right now, independent of any Event/
 * assignment -- the day/night cycle is exactly back-to-back 12h blocks with
 * no gaps (`nightEndMinute` always equals `dayStartMinute` + 1440), so
 * exactly one of {today's day shift, today's night shift, yesterday's night
 * shift still running past midnight} always contains `now.minuteOfDay`.
 * This is the one primitive `previousShiftPeriod`/`nextShiftPeriod` and
 * `resolveEventShiftInterval` don't provide on their own -- both require an
 * existing Event to anchor on, whereas coverage for the CURRENT shift must
 * stay correct even when nobody at all is staffed on it yet.
 */
export function resolveCurrentShiftPeriod(now: LocalNow, schedule: ShiftSchedule): AdjacentShiftPeriod {
  if (now.minuteOfDay >= schedule.dayStartMinute && now.minuteOfDay < schedule.dayEndMinute) {
    return { date: now.date, period: "day" };
  }
  if (now.minuteOfDay >= schedule.nightStartMinute) {
    return { date: now.date, period: "night" };
  }

  const parsed = parseCalendarDate(now.date);
  if (!parsed) {
    throw new ShiftConfigurationError(`Invalid local date: "${now.date}".`);
  }
  return { date: formatCalendarDate(subtractCalendarDays(parsed, 1)), period: "night" };
}
