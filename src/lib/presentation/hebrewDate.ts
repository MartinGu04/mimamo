import { dayOfWeek, isNextCalendarDay, parseCalendarDate } from "@/lib/domain/dutyBlocks";

const WEEKDAY_LABELS = [
  "יום ראשון",
  "יום שני",
  "יום שלישי",
  "יום רביעי",
  "יום חמישי",
  "יום שישי",
  "יום שבת",
];

/** The bare weekday name, without a leading "יום" -- e.g. "חמישי", "שבת". Sunday-first, matching `dayOfWeek`. */
const BARE_WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/**
 * Standard Hebrew single-letter weekday abbreviations, Sunday-first (index
 * 0 = Sunday, matching `dayOfWeek`/every Sunday-first calendar grid in this
 * codebase). Exported directly for a calendar grid's weekday header row.
 */
export const SHORT_WEEKDAY_LABELS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

const MONTH_LABELS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

/**
 * "יום רביעי · 12 באוגוסט" from a plain "YYYY-MM-DD" -- deliberately no
 * `Date`/`Intl` construction. Weekday comes from the domain's pure
 * Sakamoto's-algorithm `dayOfWeek`, so this can never be off by a day due
 * to a runtime timezone. Returns null for an unparseable date (never
 * throws, never silently shows a wrong date).
 */
export function formatHebrewWeekdayAndDate(dateStr: string): string | null {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return null;

  const weekday = WEEKDAY_LABELS[dayOfWeek(parsed)];
  const month = MONTH_LABELS[parsed.month - 1];
  return `${weekday} · ${parsed.day} ב${month}`;
}

/** Just the weekday label, e.g. "יום חמישי". */
export function formatHebrewWeekday(dateStr: string): string | null {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return null;
  return WEEKDAY_LABELS[dayOfWeek(parsed)];
}

/** "יום שבת" from a bare weekday index (0=Sunday..6=Saturday, matching `dayOfWeek`) -- no calendar date needed. Used by the Fixed Notifications Center's own weekly-schedule summary (`lib/presentation/notificationRules.ts`), where a custom recurring rule stores a weekday alone, never a specific date. `null` for an out-of-range index. */
export function hebrewWeekdayName(weekdayIndex: number): string | null {
  return WEEKDAY_LABELS[weekdayIndex] ?? null;
}

/** Just the day-of-month and month label, e.g. "14 באוגוסט" -- no weekday, for a UI that already shows the weekday as its own separate element. */
export function formatHebrewDayAndMonth(dateStr: string): string | null {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return null;
  return `${parsed.day} ב${MONTH_LABELS[parsed.month - 1]}`;
}

/** Just the month label with its "ב" prefix, e.g. "באוגוסט" -- for a UI that shows the day-of-month as its own separately styled element. */
export function formatHebrewMonthName(dateStr: string): string | null {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return null;
  return `ב${MONTH_LABELS[parsed.month - 1]}`;
}

/** "ה׳" -- the standard single-letter Hebrew weekday abbreviation. */
export function formatShortWeekday(dateStr: string): string | null {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return null;
  return SHORT_WEEKDAY_LABELS[dayOfWeek(parsed)];
}

/** Compact "12.8" day.month form, for dense upcoming-list rows. */
export function formatCompactDate(dateStr: string): string | null {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return null;
  return `${parsed.day}.${parsed.month}`;
}

/** "אוגוסט 2026" -- the Hebrew-language Gregorian month/year label for a calendar page header. `month` is 1-12. Returns null for an out-of-range month. */
export function formatHebrewMonthYear(year: number, month: number): string | null {
  if (month < 1 || month > 12) return null;
  return `${MONTH_LABELS[month - 1]} ${year}`;
}

/**
 * A natural-reading Hebrew date or date range, for a single duty/shift
 * block: a single day reads as its full weekday+date ("יום רביעי · 19
 * באוגוסט"); a multi-day range within one Gregorian month is compact
 * ("19–21 באוגוסט"); a range crossing a Gregorian month gives each end its
 * own month name ("31 באוגוסט – 2 בספטמבר"). Returns null for unparseable
 * input, never throws.
 */
export function formatDateRange(startDate: string, endDate: string): string | null {
  if (startDate === endDate) return formatHebrewWeekdayAndDate(startDate);

  const start = parseCalendarDate(startDate);
  const end = parseCalendarDate(endDate);
  if (!start || !end) return null;

  if (start.year === end.year && start.month === end.month) {
    return `${start.day}–${end.day} ב${MONTH_LABELS[start.month - 1]}`;
  }
  return `${start.day} ב${MONTH_LABELS[start.month - 1]} – ${end.day} ב${MONTH_LABELS[end.month - 1]}`;
}

/**
 * "20–26 בספטמבר 2026" -- a Sunday-Saturday operational week's label,
 * ALWAYS with the year (unlike `formatDateRange`'s duty-block wording,
 * which omits it -- a week label needs to disambiguate across years the
 * way a single duty block never has to). Same month: "D–D בMonth Year".
 * Crossing months in the same year: "D בMonth – D בMonth Year". Crossing
 * years (e.g. the last week of December): "D בMonth Year – D בMonth
 * Year", each end carrying its own year. Returns null for unparseable
 * input, never throws.
 */
export function formatHebrewWeekRangeLabel(weekStart: string, weekEnd: string): string | null {
  const start = parseCalendarDate(weekStart);
  const end = parseCalendarDate(weekEnd);
  if (!start || !end) return null;

  if (start.year === end.year && start.month === end.month) {
    return `${start.day}–${end.day} ב${MONTH_LABELS[start.month - 1]} ${start.year}`;
  }
  if (start.year === end.year) {
    return `${start.day} ב${MONTH_LABELS[start.month - 1]} – ${end.day} ב${MONTH_LABELS[end.month - 1]} ${start.year}`;
  }
  return `${start.day} ב${MONTH_LABELS[start.month - 1]} ${start.year} – ${end.day} ב${MONTH_LABELS[end.month - 1]} ${end.year}`;
}

/**
 * The reverse of `formatHebrewWeekday`/`BARE_WEEKDAY_LABELS`: "יום חמישי"
 * or bare "חמישי" -> 4 (Sunday-first, matching `dayOfWeek`). Trims/collapses
 * whitespace and accepts either form; anything else (including a full
 * `WEEKDAY_LABELS` string with different spacing) returns null rather than
 * guessing. Never matches a substring -- "יום חמישי בבוקר" is not a bare
 * weekday query.
 */
export function parseHebrewWeekdayName(raw: string): number | null {
  const normalized = raw.replace(/\s+/g, " ").trim();
  const bare = normalized.startsWith("יום ") ? normalized.slice("יום ".length) : normalized;
  const index = BARE_WEEKDAY_LABELS.indexOf(bare);
  return index === -1 ? null : index;
}

export type RelativeDayLabel = "today" | "tomorrow" | "other";

/** Whether `dateStr` is `todayStr`, the calendar day right after it, or neither -- pure string/date-table comparison, no Date/UTC. */
export function relativeDayLabel(dateStr: string, todayStr: string): RelativeDayLabel {
  if (dateStr === todayStr) return "today";
  if (isNextCalendarDay(todayStr, dateStr)) return "tomorrow";
  return "other";
}
