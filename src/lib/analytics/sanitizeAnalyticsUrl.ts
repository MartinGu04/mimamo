/**
 * Strips every query string and URL fragment from an analytics event URL,
 * keeping only origin + pathname (Privacy Phase 9B). This app's URL state
 * (`?person=`, `?view=`, `?range=`, `?month=`, `?date=`, `?category=`,
 * `?problems=`, and any future param) is internal navigation state --
 * never anything Vercel Web Analytics needs for aggregate page-view
 * analytics -- and `?person=` in particular is a stable pseudonymous
 * personnel identifier (`stableIdFromName()`, `lib/parsers/personnel.ts`)
 * that has no business reaching an analytics event.
 *
 * Deliberately no allow/deny list of "safe" param names: that drifts the
 * moment a new feature adds a new param, so every query string and
 * fragment is unconditionally removed instead -- see
 * `PrivacySafeAnalytics`, this function's one caller.
 *
 * Fails closed: a URL that cannot be parsed (malformed input, never
 * expected from the real `@vercel/analytics` client but not trusted
 * blindly either) returns `null` rather than the original, unsanitized
 * string -- the caller must never fall back to sending the raw value.
 */
export function sanitizeAnalyticsUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}
