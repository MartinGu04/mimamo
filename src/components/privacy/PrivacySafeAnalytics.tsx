"use client";

import { Analytics } from "@vercel/analytics/next";
import type { BeforeSendEvent } from "@vercel/analytics/next";
import { sanitizeAnalyticsUrl } from "@/lib/analytics/sanitizeAnalyticsUrl";

/**
 * Privacy Phase 9B: a dedicated Client Component that owns
 * `@vercel/analytics`'s `beforeSend` callback, so `app/layout.tsx` can
 * stay a Server Component -- a function prop can never cross the
 * server/client boundary, so `beforeSend` must be defined (and passed to
 * `<Analytics />`) entirely within a Client Component, never in the root
 * layout itself.
 *
 * Strips every outgoing event's query string and fragment before it can
 * be sent -- see `sanitizeAnalyticsUrl`'s own docstring for why (this
 * app's `?person=`/`?view=`/`?range=`/etc. URL state has no business
 * reaching an analytics event) and for its fail-closed contract, which
 * `sanitizeAnalyticsEvent` below relies on directly: a URL that can't be
 * parsed drops the whole event (`null`) rather than sending it
 * unsanitized. Adds no custom analytics events and no metadata (user id,
 * person id, name, email, role, ...) to any event -- the only change made
 * to an event here is replacing its `url`.
 */
export function sanitizeAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = sanitizeAnalyticsUrl(event.url);
  if (url === null) return null;
  return { ...event, url };
}

export function PrivacySafeAnalytics() {
  return <Analytics beforeSend={sanitizeAnalyticsEvent} />;
}
