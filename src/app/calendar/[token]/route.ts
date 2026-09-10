import { NextResponse, type NextRequest } from "next/server";
import { loadCalendarFeedForToken } from "@/lib/calendar/loadCalendarFeedForToken";

/**
 * The personal ICS subscription feed: `GET /calendar/<token>.ics`.
 * Deliberately placed OUTSIDE `src/app/api` -- `src/app/apiSurface.test.ts`'s
 * "37. no public schedule/personnel API route exists yet" regression test
 * asserts that directory does not exist at all, same substitution the
 * notification worker's `/internal/notifications/tick` already made for
 * the same reason (see that route's own docstring).
 *
 * Auth is the URL token itself, never a Supabase session cookie --
 * external calendar clients (Google/Apple Calendar) fetch this
 * periodically with no session context at all, so possession of the
 * private token IS the authorization for this one request (PR spec §3).
 * Every heavy-lifting step (token -> owning person -> that person's own
 * shift/duty/absence Events -> rendered ICS text) lives in
 * `lib/calendar/loadCalendarFeedForToken.ts`, never inline here -- this
 * file only handles the HTTP shape (path parsing, status codes, response
 * headers) and does not itself import any raw workbook/personnel parsing.
 *
 * Every failure (malformed token, unknown/revoked token, token whose
 * owner no longer maps to a כ"א person) responds with the SAME generic
 * 404 body -- never a distinguishable error that could help a caller
 * probe which case they hit, and never any detail about who the token
 * would have belonged to.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token: rawSegment } = await context.params;

  if (!rawSegment.endsWith(".ics")) {
    return new NextResponse("Not found", { status: 404 });
  }
  const token = rawSegment.slice(0, -".ics".length);

  // Cheap format sanity check before any DB/Google work at all -- rejects
  // obviously-malformed requests (empty, wrong charset, wildly wrong
  // length) without even attempting the token lookup. Matches the shape
  // `generateCalendarFeedToken()` actually produces (32 random bytes,
  // base64url, ~43 chars) with generous margin for a future token-format
  // change, never so tight that a legitimate token could ever fail it.
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const result = await loadCalendarFeedForToken(token);
  if (result.status !== "ok") {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(result.icsText, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="hamachlava.ics"',
      // Bounded, private caching: the feed is per-person data behind an
      // unguessable token (never shared-cacheable), but a short max-age
      // absorbs a calendar client re-fetching the same URL faster than
      // the underlying schedule can realistically change, without
      // hammering the Google Sheets read behind it. This is a courtesy
      // to our own backend, not the actual refresh cadence external
      // clients use -- see `renderIcsFeed`'s own docstring for why
      // Google/Apple's real subscription refresh interval is entirely
      // outside this app's control.
      "Cache-Control": "private, max-age=900",
    },
  });
}
