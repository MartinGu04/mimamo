/**
 * "עודכן עכשיו" / "עודכן לפני 4 דקות" / "עודכן לפני שעה" / "עודכן לפני
 * יומיים" -- a restrained, deterministic relative-age label for a read
 * model's `fetchedAt` (PR #17, day buckets added in PR #18).
 * `fetchedAt` means WHEN המחלבה FETCHED THE SNAPSHOT from Google Sheets --
 * never when someone last edited the spreadsheet -- so this label never
 * claims otherwise, and never calls older data "wrong" or "out of sync"
 * (Google Sheets remains the source of truth; המחלבה only shows the age of
 * its own read-only snapshot of it).
 *
 * Pure: takes `now` explicitly rather than reading `Date.now()`/`new
 * Date()` itself, so it is deterministically testable. Only ever called
 * client-side, after mount (see `DataFreshnessStatus`) -- never during a
 * Server Component render, which would embed a request-time-dependent
 * string into the HTML and risk a hydration mismatch against the
 * browser's own clock.
 */

const FALLBACK_LABEL = "עודכן";
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/**
 * An unparseable `fetchedAt` fails safe -- a generic label with no age
 * claim, never a crash, never "NaN", never a fabricated time.
 *
 * A negative elapsed duration (the fetched instant reads as being in the
 * future -- ordinary clock skew between server and browser clocks) is
 * treated the same as "just now": never a negative number, never
 * "בעוד X שניות".
 */
export function formatDataFreshnessLabel(fetchedAt: string, now: Date): string {
  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return FALLBACK_LABEL;

  const elapsedSeconds = Math.floor((now.getTime() - fetchedAtMs) / 1000);
  if (elapsedSeconds < SECONDS_PER_MINUTE) return "עודכן עכשיו";

  const elapsedMinutes = Math.floor(elapsedSeconds / SECONDS_PER_MINUTE);
  if (elapsedMinutes < MINUTES_PER_HOUR) {
    return elapsedMinutes === 1 ? "עודכן לפני דקה" : `עודכן לפני ${elapsedMinutes} דקות`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / MINUTES_PER_HOUR);
  if (elapsedHours < HOURS_PER_DAY) {
    return elapsedHours === 1 ? "עודכן לפני שעה" : `עודכן לפני ${elapsedHours} שעות`;
  }

  const elapsedDays = Math.floor(elapsedHours / HOURS_PER_DAY);
  if (elapsedDays === 1) return "עודכן לפני יום";
  if (elapsedDays === 2) return "עודכן לפני יומיים";
  return `עודכן לפני ${elapsedDays} ימים`;
}
