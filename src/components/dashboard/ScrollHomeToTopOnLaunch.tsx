"use client";

import { useEffect } from "react";

/**
 * Module-scoped (deliberately NOT `useState`/`useRef`): persists across any
 * later remount of this component within the SAME script execution -- an
 * in-app `Link`/back-button return to Home later in this session -- but
 * resets back to `false` whenever the module itself is freshly evaluated,
 * i.e. a genuinely fresh full page load. That is exactly the distinction
 * the MOUNT-time reset below needs, and it falls out of ordinary JS module
 * semantics for free: no timestamp/session-storage bookkeeping required.
 * The RESUME-time reset (see the component's own docstring) is deliberately
 * NOT gated by this flag -- a resume can happen any number of times while
 * the user stays on Home.
 */
let hasScrolledToTopThisPageLoad = false;

/**
 * Forces the Home dashboard to `scrollY = 0`, fixing two distinct cases
 * that both otherwise land the user mid-scroll on what should read as a
 * fresh dashboard:
 *
 *  1. A genuinely fresh full page load (a hard browser reload of `/`, or a
 *     cold iOS standalone-PWA start) -- the browser/WebKit can restore
 *     whatever scroll offset it had persisted for that history entry.
 *     Handled by the plain MOUNT effect below, gated by the module-scoped
 *     flag so it only ever fires once per real page load (see that
 *     variable's own docstring for why an in-app remount must never
 *     re-trigger it). This fires while `loading.tsx` is still the visible
 *     fallback (this component lives in the surrounding layout, which
 *     mounts before the real content resolves) -- real testing showed that
 *     is too EARLY to be the final word: once the real content replaces
 *     the fallback, a browser scroll-anchoring/restoration step can still
 *     land afterward and undo this. `ScrollHomeToTopOnContentReady`
 *     (rendered as part of the actual resolved `page.tsx` content, see its
 *     own docstring) is the reset that actually wins that race -- this
 *     early one is still worth keeping so the fallback itself never
 *     visibly starts mid-scroll.
 *
 *  2. Real-device iOS testing showed (1) alone is NOT enough: reopening
 *     the installed PWA from the Home Screen after merely backgrounding it
 *     does NOT reliably produce a fresh script evaluation or a React
 *     remount at all -- WebKit can resume the EXISTING standalone session
 *     exactly as it was, scroll offset included, with no new navigation
 *     and no module re-evaluation for a mount effect to ever catch. The
 *     only observable signal for that kind of resume is a browser
 *     lifecycle event -- the SAME `visibilitychange`-to-`"visible"` and
 *     BFCache `pageshow` (`event.persisted === true`) signals
 *     `AppRevalidator` already uses to detect a real app resume, for the
 *     identical reason (see that component's own docstring). Unlike case
 *     1, this is intentionally NOT gated by the module flag: it must fire
 *     every time the app resumes while the user happens to be on Home.
 *
 * Also sets `history.scrollRestoration = "manual"` for as long as Home
 * stays mounted, restored to whatever it was on unmount. This is a
 * deliberately Home-only override, never a global one -- Next.js's own
 * push/scroll-to-top and back/restore behavior for ordinary in-app
 * navigation never depends on the browser's NATIVE history-based scroll
 * restoration (see `node_modules/next/dist/docs/.../linking-and-navigating.md`),
 * so disabling it here cannot affect that. What it DOES stop is
 * WebKit/the browser silently re-imposing its own persisted scroll offset
 * in a layout pass around a resume -- exactly the kind of race that would
 * otherwise undo the explicit resets above.
 *
 * Mounted once by `(dashboard)/layout.tsx` (the route group that maps to
 * `/` and nothing else -- see that file and `loading.tsx`'s own docstring
 * for why Home-specific behavior lives there instead of the shared
 * `(app)/layout.tsx`), so this covers every Home surface the page can
 * render (`Dashboard`, `PermanentManagerHome`, the Emergency Mode
 * variants, `ConfigurationErrorState`) without duplicating this effect in
 * each, and never touches any other route. Renders nothing.
 */
export function ScrollHomeToTopOnLaunch() {
  useEffect(() => {
    const previousScrollRestoration =
      "scrollRestoration" in window.history ? window.history.scrollRestoration : undefined;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }

    if (!hasScrolledToTopThisPageLoad) {
      hasScrolledToTopThisPageLoad = true;
      window.scrollTo(0, 0);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") window.scrollTo(0, 0);
    }
    function handlePageShow(event: Event) {
      const persisted = "persisted" in event && (event as { persisted?: boolean }).persisted === true;
      if (persisted) window.scrollTo(0, 0);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      if ("scrollRestoration" in window.history && previousScrollRestoration) {
        window.history.scrollRestoration = previousScrollRestoration;
      }
    };
  }, []);

  return null;
}
