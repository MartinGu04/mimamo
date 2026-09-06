"use client";

import { useLayoutEffect } from "react";

/**
 * Module-scoped, same "once per real page load" contract as
 * `ScrollHomeToTopOnLaunch`'s own flag -- but a SEPARATE variable, tracking
 * a DIFFERENT moment. See this component's own docstring for why one flag
 * can't do both jobs.
 */
let hasScrolledToTopOnContentReady = false;

/**
 * Fixes a failure mode real testing surfaced that has nothing to do with
 * iOS/PWA resume at all: `/` renders `loading.tsx` at the top correctly
 * (`(dashboard)/layout.tsx`'s `ScrollHomeToTopOnLaunch` resets scroll while
 * that fallback is still showing), but once the ACTUAL resolved Home
 * content replaces the fallback -- a separate, later commit; the layout
 * itself never remounts for this -- a browser scroll-anchoring/restoration
 * step can re-apply a previously-recorded scroll offset AFTER that swap,
 * undoing the earlier reset. `ScrollHomeToTopOnLaunch`'s mount effect fires
 * too early (before the real content exists) to ever catch this.
 *
 * The fix: this component is rendered as part of the actual resolved
 * `page.tsx` content itself (`DashboardPage`'s own `withHomeContentReady`
 * helper wraps every branch it can return -- see that file), never the
 * surrounding layout. A Suspense boundary (`loading.tsx` implicitly wraps
 * every page in its route segment) commits its subtree atomically -- only
 * once nothing inside it is still pending -- so this can only ever mount in
 * the SAME commit as the real Dashboard/PermanentManagerHome/Emergency-mode
 * content, never while `loading.tsx` is still the visible fallback.
 *
 * Uses `useLayoutEffect`, not `useEffect`: it runs synchronously right
 * after the real content commits to the DOM, before the browser paints it
 * -- as early as humanly possible relative to the actual content existing.
 * Since a browser/WebKit scroll-anchoring pass can still land in that same
 * paint or the very next one, this re-asserts once more via
 * `requestAnimationFrame` -- a single call timed to the browser's own
 * render loop, deliberately never an arbitrary `setTimeout` delay.
 *
 * Gated by its OWN module-scoped flag, separate from
 * `ScrollHomeToTopOnLaunch`'s -- for the identical reason that one has a
 * flag at all: a later in-app `Link`/back-button return to Home also mounts
 * fresh resolved content (this route is `force-dynamic`), and that
 * ordinary navigation must be left entirely to Next.js's own existing
 * push/back scroll behavior, never forced back to the top a second time.
 *
 * The scheduled `requestAnimationFrame` re-assertion is cancelled in the
 * effect's own cleanup -- if the user navigates away before the next frame
 * fires (this component unmounts, e.g. by clicking a `Link` moments after
 * Home's content resolves), there is no reason for a deferred `scrollTo`
 * to land on whatever page they've navigated to in the meantime. Renders
 * nothing.
 */
export function ScrollHomeToTopOnContentReady() {
  useLayoutEffect(() => {
    if (hasScrolledToTopOnContentReady) return;
    hasScrolledToTopOnContentReady = true;

    window.scrollTo(0, 0);
    let rafId: number | null = null;
    if (typeof requestAnimationFrame === "function") {
      rafId = requestAnimationFrame(() => window.scrollTo(0, 0));
    }

    return () => {
      if (rafId !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return null;
}
