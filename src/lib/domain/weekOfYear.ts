import type { CalendarDate } from "./dutyBlocks";
import { dayOfWeek } from "./dutyBlocks";

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1];
}

/** 0-indexed day-of-year: January 1st -> 0. */
function zeroIndexedDayOfYear({ year, month, day }: CalendarDate): number {
  let total = day - 1;
  for (let m = 1; m < month; m++) total += daysInMonth(year, m);
  return total;
}

/**
 * Sunday-first week-of-year number, the SAME convention `buildMonthGrid`
 * already uses for its rows (`calendarMonth.ts`) -- this is the ONLY week-
 * numbering convention used anywhere in המחלבה.
 *
 * המחלבה's own convention (deliberately NOT strftime `%U`, which allows a
 * user-visible "week 0" -- unacceptable UX here): the partial week
 * containing January 1st is always WEEK 1, however many days it actually
 * spans (1-7, depending on January 1st's weekday) -- when January 1st
 * itself is a Sunday, that first full Sunday-Saturday week (Jan 1-7) IS
 * week 1. Every Sunday after that first week increments the week number
 * by exactly one. No date ever produces week 0.
 *
 * Deliberately NOT the Monday-first ISO-8601 week number either: an ISO
 * week starts mid-row relative to a Sunday-first grid and ends mid-row
 * the following week, so a single Sunday-Saturday calendar row could
 * straddle two different ISO week numbers. This convention never can --
 * every date within the same Sunday-Saturday span produces the identical
 * result (see `weekOfYear.test.ts`): the day-of-year offset of the
 * Sunday that starts week 2 is fixed for a given year
 * (`7 - <January 1st's weekday>`), so whether a date falls before or
 * after that fixed offset -- and, once after it, which 7-day block it
 * falls in -- never changes within one Sunday-Saturday span.
 */
export function weekOfYear(date: CalendarDate): number {
  const yday = zeroIndexedDayOfYear(date);
  const weekday1 = dayOfWeek({ year: date.year, month: 1, day: 1 });

  // The day-of-year offset (0-indexed) of the Sunday that starts week 2.
  // When January 1st is itself a Sunday (weekday1 === 0), this is 7 --
  // the SECOND Sunday of the year -- since the first Sunday-Saturday
  // week (containing January 1st) is entirely week 1.
  const week2Start = 7 - weekday1;

  if (yday < week2Start) return 1;
  return 2 + Math.floor((yday - week2Start) / 7);
}
