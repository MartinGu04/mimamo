"use client";

import { useEffect } from "react";

/**
 * Module-scoped (deliberately NOT `useState`/`useRef`): persists across any
 * later remount of this component within the SAME script execution -- an
 * in-app `Link`/back-button return to Home later in this session -- but
 * resets back to `false` whenever the module itself is freshly evaluated,
 * i.e. a genuinely fresh full page load. That is exactly the distinction
 * this component needs, and it falls out of ordinary JS module semantics
 * for free: no timestamp/session-storage bookkeeping required.
 */
let hasScrolledToTopThisPageLoad = false;

/**
 * Forces the Home dashboard to open at `scrollY = 0` exactly once per full
 * page load, fixing iOS standalone PWA relaunches (manifest `start_url` is
 * `/`) and hard browser reloads of `/` that otherwise restore whatever
 * scroll offset the browser/WebKit had persisted for that history entry --
 * landing the user mid-scroll on a "fresh" dashboard instead of at the top.
 *
 * Deliberately keyed off a REACT MOUNT effect, never a
 * `visibilitychange`/`pageshow` listener (contrast `AppRevalidator`, which
 * intentionally listens for those to detect a real app RESUME): resuming a
 * merely-backgrounded/frozen tab -- switching to another app and back --
 * never re-evaluates this module or re-mounts this component, so a user's
 * current reading position on Home is never disturbed by that. Only a
 * genuinely fresh script execution resets `hasScrolledToTopThisPageLoad`
 * to `false`, so a later in-app navigation back to Home (Link/back button,
 * still the SAME page load) is a no-op here and is left entirely to
 * Next.js's own existing push/back scroll behavior.
 *
 * Mounted once by `(dashboard)/layout.tsx` (the route group that maps to
 * `/` and nothing else -- see that file and `loading.tsx`'s own docstring
 * for why Home-specific behavior lives there instead of the shared
 * `(app)/layout.tsx`), so this covers every Home surface the page can
 * render (`Dashboard`, `PermanentManagerHome`, the Emergency Mode
 * variants, `ConfigurationErrorState`) without duplicating this effect in
 * each. Renders nothing.
 */
export function ScrollHomeToTopOnLaunch() {
  useEffect(() => {
    if (hasScrolledToTopThisPageLoad) return;
    hasScrolledToTopThisPageLoad = true;
    window.scrollTo(0, 0);
  }, []);

  return null;
}
