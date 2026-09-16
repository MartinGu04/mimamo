import { daysBetweenCalendarDates } from "./dutyBlocks";
import type { Event } from "./event";
import {
  MINUTES_PER_DAY,
  resolveEventShiftInterval,
  type MinuteInterval,
  type ShiftSchedule,
} from "./shiftSchedule";

/**
 * "מי איתי במשמרת" -- who is ACTUALLY working at the same time as a given
 * shift, answered by real interval overlap rather than by the
 * date+period equality `buildShiftRoster` uses.
 *
 * Why a second, stricter question next to `buildShiftRoster`: that one
 * answers "who shares this canonical shift slot" (same `date`, same
 * `period`), which is the right primitive for coverage/roster grouping but
 * is both too wide and too narrow for companionship. Too wide, because two
 * people can hold the same date+period slot with disjoint
 * `startTimeOverride`/`endTimeOverride` windows (e.g. 07:30-10:00 and
 * 12:00-19:30) and never actually be on shift together. Too narrow,
 * because an overridden window can legitimately reach across midnight into
 * the next calendar date, where a date equality check can never see it.
 *
 * Both problems disappear once every shift is placed on ONE absolute minute
 * timeline: `resolveEventShiftInterval` already returns minutes measured
 * from the Event's own date at midnight (a night shift simply runs past
 * 1439 -- see `shiftSchedule.ts`), so shifting a candidate's interval by
 * `daysBetweenCalendarDates × MINUTES_PER_DAY` puts both intervals in the
 * same coordinate system with no Date/UTC and no date-string arithmetic of
 * its own.
 *
 * Deliberately NOT a coverage/adequacy signal -- exactly like
 * `buildShiftRoster`, and for the same reason (see its docs). This only
 * ever answers "were these two people on shift at the same moment".
 */

/**
 * `event`'s effective shift interval, expressed in minutes from
 * `anchorDate` at midnight instead of from the event's own date. `null`
 * whenever the interval can't be resolved at all (a non-shift Event, an
 * unspecified/morning period, an invalid time override) or either date
 * fails to parse -- never a guessed placement on the timeline.
 */
export function resolveShiftIntervalRelativeTo(
  event: Event,
  anchorDate: string,
  schedule: ShiftSchedule,
): MinuteInterval | null {
  const resolution = resolveEventShiftInterval(event, schedule);
  if (resolution.status !== "resolved") return null;

  const dayOffset = daysBetweenCalendarDates(anchorDate, event.date);
  if (dayOffset === null) return null;

  const offsetMinutes = dayOffset * MINUTES_PER_DAY;
  return {
    startMinute: resolution.interval.startMinute + offsetMinutes,
    endMinute: resolution.interval.endMinute + offsetMinutes,
  };
}

/**
 * Whether two shift Events are on shift at the same time. Half-open
 * comparison (`startA < endB && startB < endA`), so two back-to-back shifts
 * that merely touch -- a day shift ending exactly when the night shift
 * starts, the canonical no-gap case -- are never counted as overlapping.
 *
 * Non-shift Events are always false: a vacation, a הפנייה, a duty, or a
 * display-only activity is never a shift companion, no matter that it
 * happens to fall on the same date.
 *
 * Falls back to the structural `date`+`period` rule (exactly
 * `buildShiftRoster`'s own matching) whenever EITHER side's interval can't
 * be resolved -- a period-unspecified shift has no canonical window to
 * place on the timeline, and silently dropping it would LOSE a companion
 * the app already considers to share that shift. The fallback is never
 * "same date" alone: the period must match too.
 */
export function shiftsOverlapInTime(a: Event, b: Event, schedule: ShiftSchedule): boolean {
  if (a.category !== "shift" || b.category !== "shift") return false;

  const intervalA = resolveShiftIntervalRelativeTo(a, a.date, schedule);
  const intervalB = resolveShiftIntervalRelativeTo(b, a.date, schedule);
  if (!intervalA || !intervalB) return a.date === b.date && a.period === b.period;

  return intervalA.startMinute < intervalB.endMinute && intervalB.startMinute < intervalA.endMinute;
}

/**
 * Every OTHER person's shift Event that overlaps `target` in time -- the
 * structural answer behind "מי איתי במשמרת".
 *
 * Excludes every one of the target person's OWN Events by `personId` (so a
 * split shift never lists its owner as their own companion), and every
 * non-shift Event outright. Duplicates are preserved exactly like
 * `buildShiftRoster` does: a genuine two-Event split-shift colleague
 * returns two Events here, and collapsing that into one row per person is
 * the read-model projection's decision, not this function's.
 *
 * `events` may be any superset of the candidates -- callers that already
 * index Events by date can pass just the neighbouring dates (a shift never
 * reaches further than one calendar day from its own date), and the result
 * is identical to passing the full set.
 */
export function findOverlappingShiftCompanionEvents(
  target: Event,
  events: readonly Event[],
  schedule: ShiftSchedule,
): Event[] {
  if (target.category !== "shift") return [];

  return events.filter(
    (event) =>
      event.category === "shift" &&
      event.personId !== target.personId &&
      shiftsOverlapInTime(target, event, schedule),
  );
}
