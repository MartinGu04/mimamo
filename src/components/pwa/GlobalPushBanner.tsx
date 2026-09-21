"use client";

import { Loader2 } from "lucide-react";
import { usePwaInstall } from "./PwaInstallProvider";
import { usePushDevice } from "./PushDeviceProvider";
import { shouldShowGlobalPushBanner } from "./globalPushBanner";

/**
 * The global "ההתראות לא פעילות במכשיר הזה" banner.
 *
 * Rendered ONCE, by `AppShell`, in the shared main column above
 * `<main>` -- exactly where `EmergencyModeBanner` already sits. That
 * placement is what makes it appear on every authenticated page
 * regardless of which one the user opened, and what guarantees there is
 * never a duplicate mobile and desktop copy (both viewports render this
 * same single element; only the two bells are duplicated, which is
 * precisely why the push state itself lives in `PushDeviceProvider`).
 *
 * Deliberately NOT a modal or pop-up: it is an inline strip that pushes
 * content down, never an overlay, never focus-trapping, never something
 * to dismiss before using the app. Someone who wants to ignore it can
 * ignore it; someone who explicitly opted out never sees it at all (see
 * `shouldShowGlobalPushBanner`).
 *
 * The CTA calls the SHARED `enable()` from `usePushDevice()` -- the
 * exact same flow the bell's own "הפעל התראות" uses, not a second
 * permission/subscription implementation. The click is itself the user
 * gesture the browser's own permission prompt requires, which is why
 * this is a real button wired straight to that flow rather than
 * something that opens the bell first. Once the installation is
 * genuinely subscribed for the current user the shared state flips to
 * `"enabled"` and this disappears immediately -- there is no separate
 * dismissal to keep in sync.
 *
 * `role="status"` rather than `EmergencyModeBanner`'s `role="alert"`:
 * missing notifications is important but not assertive-interrupt
 * important, and a polite live region is the right register for
 * something that appears on load.
 */
export function GlobalPushBanner({ userId }: { userId?: string }) {
  const { isReady: installReady, isStandalone } = usePwaInstall();
  const { state, preference, enable } = usePushDevice();

  const visible = shouldShowGlobalPushBanner({
    installReady,
    isStandalone,
    hasUserId: Boolean(userId),
    pushState: state,
    preference,
  });
  if (!visible) return null;

  const pending = state === "enabling";

  return (
    <div
      role="status"
      data-testid="global-push-banner"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-surface-1 px-4 py-2.5 sm:px-6 lg:px-10"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          <span aria-hidden="true">🔔</span> ההתראות לא פעילות במכשיר הזה
        </p>
        <p className="mt-0.5 text-xs text-muted">כדי שלא תפספס משמרות ותורנויות, הפעל אותן במכשיר הזה.</p>
      </div>
      <button
        type="button"
        onClick={enable}
        disabled={pending}
        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={1.75} /> : null}
        {pending ? "מפעיל..." : "הפעל התראות"}
      </button>
    </div>
  );
}
