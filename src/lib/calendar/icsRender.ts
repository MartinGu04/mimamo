import { addCalendarDays, formatCalendarDate } from "@/lib/domain/dateRange";
import { parseCalendarDate } from "@/lib/domain/dutyBlocks";
import { APP_NAME } from "@/lib/config/productName";
import { buildIcsLine, escapeIcsText } from "./icsEncoding";

/**
 * One VEVENT's already-resolved timing -- either a real UTC instant range
 * (a shift, whose start/end is known down to the minute) or a single
 * all-day calendar date (a duty/absence day, which this app never assigns
 * a clock time to). `IcsCalendarItem` never carries a raw `Event`/domain
 * type -- `icsItems.ts` is the one place that resolves either shape,
 * keeping this renderer free of shift-schedule/timezone knowledge.
 */
export type IcsEventTiming =
  | { kind: "timed"; startUtc: Date; endUtc: Date }
  | { kind: "allDay"; date: string };

export interface IcsCalendarItem {
  /** Stable across regenerations for the same underlying assignment -- see `icsItems.ts`'s `calendarEventUid`. Never includes the "@..." suffix itself (added here). */
  uid: string;
  summary: string;
  description: string | null;
  timing: IcsEventTiming;
  /**
   * RFC 7986 §5.9 `COLOR` value (a CSS3 extended color keyword, e.g.
   * "royalblue") -- `null` omits the property entirely rather than
   * emitting an empty/guessed one. Best-effort: see `icsColor.ts`'s own
   * docstring for why an ignoring client is never a problem.
   */
  color: string | null;
}

export interface IcsFeedInput {
  /** Used only for `X-WR-CALNAME` -- never any identity field beyond the display name already safe to show this person. */
  personName: string;
  items: readonly IcsCalendarItem[];
  /** The instant this feed text was generated -- stamped on every VEVENT's DTSTAMP and the calendar's own DTSTAMP-equivalent freshness marker. */
  generatedAt: Date;
}

const UID_DOMAIN = "mi-ma-mo.app";

/** "YYYYMMDDTHHMMSSZ" -- RFC 5545 §3.3.5 UTC date-time form. */
function formatIcsDateTimeUtc(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** "YYYYMMDD" -- RFC 5545 §3.3.4 date form, from an already-validated "YYYY-MM-DD" string. */
function formatIcsDateOnly(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

/** All-day DTEND is exclusive per RFC 5545 -- one civil day after the (inclusive) event date. Falls back to the same date if `date` is ever unparseable, rather than throwing. */
function exclusiveAllDayEnd(dateStr: string): string {
  const parsed = parseCalendarDate(dateStr);
  if (!parsed) return dateStr;
  return formatCalendarDate(addCalendarDays(parsed, 1));
}

function renderTiming(timing: IcsEventTiming): string {
  if (timing.kind === "timed") {
    return (
      buildIcsLine("DTSTART", formatIcsDateTimeUtc(timing.startUtc)) +
      buildIcsLine("DTEND", formatIcsDateTimeUtc(timing.endUtc))
    );
  }
  return (
    buildIcsLine("DTSTART;VALUE=DATE", formatIcsDateOnly(timing.date)) +
    buildIcsLine("DTEND;VALUE=DATE", formatIcsDateOnly(exclusiveAllDayEnd(timing.date)))
  );
}

function renderEvent(item: IcsCalendarItem, generatedAt: Date): string {
  let text = "BEGIN:VEVENT\r\n";
  text += buildIcsLine("UID", `${item.uid}@${UID_DOMAIN}`);
  text += buildIcsLine("DTSTAMP", formatIcsDateTimeUtc(generatedAt));
  text += renderTiming(item.timing);
  text += buildIcsLine("SUMMARY", escapeIcsText(item.summary));
  if (item.description !== null && item.description !== "") {
    text += buildIcsLine("DESCRIPTION", escapeIcsText(item.description));
  }
  if (item.color !== null) {
    text += buildIcsLine("COLOR", item.color);
  }
  text += "END:VEVENT\r\n";
  return text;
}

/**
 * Renders a complete `VCALENDAR` document for one person's feed. Pure --
 * every timing decision has already been made by `icsItems.ts`; this only
 * formats/escapes/folds. `METHOD:PUBLISH` marks this as a published,
 * read-only calendar (never an invitation requiring RSVP) -- matching the
 * one-way המחלבה -> external calendar sync this feature is (see the
 * spec's "important behavior" section).
 *
 * `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` are hints, not guarantees -- Apple
 * Calendar honors them loosely; Google Calendar ignores both and refreshes
 * subscribed-by-URL calendars on its own coarse, non-configurable schedule
 * (observed to be anywhere from several hours to about a day). This is a
 * genuine platform limitation, not a bug here -- see the feature's own
 * README for why the app's existing push-notification system stays the
 * only channel for timely alerts.
 */
export function renderIcsFeed(input: IcsFeedInput): string {
  let text = "BEGIN:VCALENDAR\r\n";
  text += buildIcsLine("VERSION", "2.0");
  text += buildIcsLine("PRODID", "-//mi-ma-mo//Personal Calendar//HE");
  text += buildIcsLine("CALSCALE", "GREGORIAN");
  text += buildIcsLine("METHOD", "PUBLISH");
  text += buildIcsLine("X-WR-CALNAME", escapeIcsText(`${APP_NAME} — ${input.personName}`));
  text += buildIcsLine("X-WR-TIMEZONE", "Asia/Jerusalem");
  text += buildIcsLine("REFRESH-INTERVAL;VALUE=DURATION", "PT1H");
  text += buildIcsLine("X-PUBLISHED-TTL", "PT1H");

  for (const item of input.items) {
    text += renderEvent(item, input.generatedAt);
  }

  text += "END:VCALENDAR\r\n";
  return text;
}
