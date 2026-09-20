"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  markPrivacyStorageNoticeDismissed,
  readPrivacyStorageNoticeDismissed,
} from "@/lib/privacy/privacyStorageNotice";

/**
 * A minimal same-tab pub/sub, same shape as `ThemeProvider`'s own -- lets
 * `useSyncExternalStore` re-render immediately when `markDismissed` below
 * writes the key, without ever calling `setState` inside an effect (which
 * `react-hooks/set-state-in-effect` correctly flags: an effect should
 * synchronize with an external system, not assign React state directly).
 * `localStorage`'s own `storage` event never fires in the tab that made
 * the change, so this app-local notifier is what closes the loop.
 */
let listeners: Array<() => void> = [];

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

/**
 * The SSR/pre-hydration snapshot -- always "dismissed" (hidden), since the
 * server (and the client's very first render) can never know a
 * `localStorage`-only value. `useSyncExternalStore` guarantees this exact
 * value for both the server render and the client's first render (no
 * hydration mismatch), then resyncs to the real client value immediately
 * after -- the same contract `ThemeProvider`'s `theme` already relies on.
 * This is also what satisfies spec section 3: the notice is only ever
 * seen once the client has determined it has not been dismissed.
 */
function getServerSnapshot(): boolean {
  return true;
}

const NOTICE_TITLE = "🍪 עוגיות ואחסון מקומי";
const NOTICE_BODY =
  "המחלבה משתמשת בעוגיות הכרחיות לצורך התחברות ובאחסון מקומי לשמירת העדפות. אין שימוש בעוגיות פרסום או שיווק.";

export type PrivacyStorageNoticeVariant = "public" | "authenticated";

interface PrivacyStorageNoticeProps {
  /**
   * "public": the login route -- always the fixed dark canvas regardless
   * of the app's light/dark preference (see `app/login/page.tsx`), so this
   * uses literal white/opacity styling, matching `LoginErrorNotice`/
   * `LoginFeatureStrip`, never theme tokens.
   *
   * "authenticated": mounted exactly once from `AppShell`, positioned clear
   * of both `BottomNav` and `AccessibilityPreferencesButton`'s own fixed
   * corner (see the component docstring below). Uses `glass-subtle` rather
   * than that button's `glass-medium` -- unlike the button's popover, this
   * notice sits fixed over page content (the sidebar/profile footer) from
   * first paint until dismissed, so it needs to read as solidly separated
   * rather than momentarily floating; `glass-subtle` is this design
   * system's own "close to opaque, glass as a hint not something to read
   * past" level (see `components/ui/glass.ts`), the same one already used
   * for dense overlapping cards like `ShiftFairnessCard`/`IssueRow`.
   */
  variant: PrivacyStorageNoticeVariant;
}

/**
 * Phase 9D -- a small, informational (NOT consent) one-time transparency
 * notice about this app's necessary Supabase auth session cookie and its
 * use of `localStorage` for device/preference state. Not a cookie-consent
 * banner: there is no accept/reject action, no category toggles, and
 * dismissing it never implies agreement to anything -- it only stops this
 * device from being told again. See
 * `lib/privacy/privacyStorageNotice.ts` for the versioned, device-wide
 * (never account-scoped) dismissal key -- deliberately un-namespaced by
 * `userId`, so signing out and back in never brings this back, and
 * deliberately never added to `clearUserScopedDevicePreferences`.
 *
 * Ordinary informational content, not a dialog: no ARIA role, no focus
 * trap, and focus is never moved into it on mount -- a visitor tabbing
 * through the page simply reaches its link/button in source order like
 * any other content. `stored` starts as `true` (hidden) on both the
 * server render and the client's very first render, then resyncs to the
 * real stored value immediately after hydration -- the same "no inline
 * blocking init script" contract `ThemeProvider`/`A11yPreferencesProvider`
 * already use for `data-theme`/`data-a11y-*`, here via
 * `useSyncExternalStore` (never `setState` inside an effect, which
 * `react-hooks/set-state-in-effect` correctly disallows) since this
 * notice, unlike those two, is never read from more than one mounted
 * place at a time (a visitor is either on `/login` or inside the
 * authenticated app, never both) -- the module-level pub/sub above exists
 * purely to satisfy `useSyncExternalStore`'s contract, not because
 * multiple instances ever need to stay in sync with each other.
 *
 * `justDismissed` is a separate, ordinary piece of local state (set only
 * from the "הבנתי" click handler, never from an effect) so a click hides
 * the notice for THIS render immediately even when the underlying
 * `localStorage` write itself throws (private mode, quota, disabled
 * storage) -- see `markPrivacyStorageNoticeDismissed`'s own docstring:
 * such a failure must never leave the notice looking unresponsive, it
 * just won't stay dismissed after a reload on this device.
 *
 * Positioning: anchored to the shell's opposite corner from
 * `AccessibilityPreferencesButton` (which owns the bottom-end/physical-left
 * corner under `dir="rtl"`) and capped short of it, so the two can never
 * overlap. The mobile/authenticated offset reuses that same button's own
 * `calc(4.75rem + env(safe-area-inset-bottom))` bottom clearance, which
 * already clears `BottomNav`.
 */
export function PrivacyStorageNotice({ variant }: PrivacyStorageNoticeProps) {
  const stored = useSyncExternalStore(subscribe, readPrivacyStorageNoticeDismissed, getServerSnapshot);
  const [justDismissed, setJustDismissed] = useState(false);

  const handleDismiss = useCallback(() => {
    markPrivacyStorageNoticeDismissed();
    setJustDismissed(true);
    notifyListeners();
  }, []);

  if (stored || justDismissed) return null;

  const isAuthenticated = variant === "authenticated";

  return (
    <div
      data-testid="privacy-storage-notice"
      className={
        isAuthenticated
          ? "animate-fade-up fixed z-20 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] start-4 end-[4.75rem] lg:start-6 lg:end-auto lg:bottom-6 lg:w-96"
          : "animate-fade-up fixed z-20 inset-x-4 bottom-4 sm:inset-x-auto sm:start-6 sm:end-auto sm:bottom-6 sm:w-96"
      }
      style={!isAuthenticated ? { paddingBottom: "env(safe-area-inset-bottom)" } : undefined}
    >
      <div
        className={
          isAuthenticated
            ? "glass-subtle rounded-xl bg-surface-1 p-4 text-foreground shadow-[var(--shadow-elevated)] ring-1 ring-border-strong"
            : "rounded-xl bg-[#10151f]/90 p-4 text-white ring-1 ring-white/10 backdrop-blur-sm"
        }
      >
        <p className={`text-sm font-semibold ${isAuthenticated ? "text-foreground" : "text-white"}`}>
          {NOTICE_TITLE}
        </p>
        <p className={`mt-1.5 text-xs leading-relaxed ${isAuthenticated ? "text-muted" : "text-white/70"}`}>
          {NOTICE_BODY}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <Link
            href="/privacy"
            className={`rounded text-xs font-medium underline underline-offset-2 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              isAuthenticated
                ? "text-muted decoration-muted/40 hover:text-foreground"
                : "text-white/70 decoration-white/30 hover:text-white"
            }`}
          >
            מדיניות פרטיות
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              isAuthenticated ? "bg-primary text-primary-foreground" : "bg-white text-[#10151f]"
            }`}
          >
            הבנתי
          </button>
        </div>
      </div>
    </div>
  );
}
