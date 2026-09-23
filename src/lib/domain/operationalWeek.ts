import type { CalendarDate } from "./dutyBlocks";
import { dayOfWeek, parseCalendarDate } from "./dutyBlocks";
import { addCalendarDays, formatCalendarDate, subtractCalendarDays } from "./dateRange";
import type { LocalNow } from "./localNow";

/**
 * The operational week: Sunday-based, seven calendar dates, ascending.
 * No canonical "current week" helper existed anywhere in the codebase
 * before PR #30 (grepped and confirmed) -- this composes the same
 * primitives `dateRange.ts`/`dutyBlocks.ts` already use elsewhere
 * (`dayOfWeek` for Sunday-anchoring, `addCalendarDays` for pure integer
 * calendar arithmetic), never `Date`/UTC.
 */
export interface OperationalWeek {
  /** "YYYY-MM-DD" -- the week's Sunday. */
  weekStart: string;
  /** "YYYY-MM-DD" -- the week's Saturday. */
  weekEnd: string;
  /** All seven calendar dates in the week, ascending. */
  dates: string[];
}

function buildWeek(sunday: CalendarDate): OperationalWeek {
  const dates = Array.from({ length: 7 }, (_, i) => formatCalendarDate(addCalendarDays(sunday, i)));
  return { weekStart: dates[0], weekEnd: dates[6], dates };
}

/**
 * The Sunday-based operational week containing an arbitrary "YYYY-MM-DD"
 * date -- e.g. a `?week=` URL param anchor, never trusted without going
 * through this. Returns `null` for unparseable input, never a fabricated
 * week -- callers decide their own safe fallback (see `getOperationalWeek`
 * below for the "today" one).
 */
export function getOperationalWeekForDate(dateStr: string): OperationalWeek | null {
  const date = parseCalendarDate(dateStr);
  if (!date) return null;
  const sunday = subtractCalendarDays(date, dayOfWeek(date));
  return buildWeek(sunday);
}

/** The Sunday-based operational week containing `localNow.date`. */
export function getOperationalWeek(localNow: LocalNow): OperationalWeek {
  // localNow.date is trusted to already be a valid "YYYY-MM-DD" (it comes
  // from getJerusalemLocalNow()) -- the fallback here only guards against
  // ever crashing if that trust is somehow violated, staying honest rather
  // than producing a silently-wrong week.
  return getOperationalWeekForDate(localNow.date) ?? buildWeek({ year: 1970, month: 1, day: 4 }); // 1970-01-04 is a Sunday
}

/** The operational week immediately following `week`. */
export function getNextOperationalWeek(week: OperationalWeek): OperationalWeek {
  const sunday = parseCalendarDate(week.weekStart);
  if (!sunday) return week;
  return buildWeek(addCalendarDays(sunday, 7));
}

/** The operational week immediately preceding `week`. */
export function getPreviousOperationalWeek(week: OperationalWeek): OperationalWeek {
  const sunday = parseCalendarDate(week.weekStart);
  if (!sunday) return week;
  return buildWeek(subtractCalendarDays(sunday, 7));
}

/** "YYYY-MM-DD" for the calendar date immediately after `dateStr`. */
export function nextCalendarDateString(dateStr: string): string | null {
  const date = parseCalendarDate(dateStr);
  if (!date) return null;
  return formatCalendarDate(addCalendarDays(date, 1));
}
