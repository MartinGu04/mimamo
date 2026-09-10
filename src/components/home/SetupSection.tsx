"use client";

import { useState, type ComponentType } from "react";
import Link from "next/link";
import { BellRing, CalendarSync, Smartphone, X } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { usePwaInstall } from "@/components/pwa/PwaInstallProvider";
import { usePushSubscription } from "@/components/pwa/usePushSubscription";
import { deriveInstallGuidance, type InstallGuidance } from "@/components/pwa/bellOnboarding";
import { markSetupItemSkipped, readSkippedSetupItems, type SetupItemKey } from "@/lib/onboarding/setupCardPreference";
import { APP_NAME } from "@/lib/config/productName";

interface SetupSectionProps {
  /** Authenticated Supabase user id -- keys the per-device skip preference and the Push subscription state, same as every other consumer of these (see `usePushSubscription`'s own docstring). `undefined` degrades gracefully (no persistence, no card at all) rather than throwing. */
  userId?: string;
  /**
   * The authoritative calendar-sync state (`lib/calendar/feedStore.ts`'s
   * `getCalendarFeedForCurrentUser().enabled`) -- the SAME server-verified
   * signal `/settings` itself renders from, never re-derived or guessed
   * here. This is real, reliable completion evidence (spec point 8): a
   * user who already enabled sync, including a veteran from before this
   * card existed, is never shown this item as outstanding.
   */
  calendarSyncEnabled: boolean;
  /**
   * Account-level onboarding eligibility (pre-merge correction), computed
   * server-side by `(dashboard)/page.tsx` from `lib/config/onboardingRollout.ts`'s
   * `isEligibleForOnboarding(accountCreatedAt)` -- Supabase's authoritative
   * account-creation timestamp compared against a centralized rollout
   * cutoff. This is a COMPLETELY SEPARATE gate from every per-item
   * completion check below: `false` hides the entire card outright,
   * regardless of install/Push/calendar-sync state, so a veteran account
   * signing in from a brand-new browser (no PWA install, no local Push
   * subscription -- exactly what a genuinely new account also looks like
   * on first login) is never mistaken for a new user. Only once this is
   * `true` do the real device/account signals below decide which rows
   * actually show.
   */
  eligibleForOnboarding: boolean;
}

function installGuidanceText(guidance: Exclude<InstallGuidance, "completed">): string {
  if (guidance === "ios") {
    return `כדי להשתמש במסך מלא ולקבל התראות בצורה אמינה, הוסיפו את ${APP_NAME} למסך הבית מכפתור השיתוף.`;
  }
  if (guidance === "native") {
    return `התקינו את ${APP_NAME} למסך הבית לחוויית אפליקציה מלאה ולהתראות אמינות.`;
  }
  return `אפשר להוסיף את ${APP_NAME} למסך הבית דרך תפריט הדפדפן.`;
}

interface SetupItemRowProps {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean; strokeWidth?: number }>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  href?: string;
  onSkip: () => void;
}

function SetupItemRow({ icon: Icon, title, description, actionLabel, onAction, href, onSkip }: SetupItemRowProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg bg-overlay-faint p-3 ring-1 ring-border">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden={true} strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
        {actionLabel && href ? (
          <Link
            href={href}
            className="mt-2 inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-strong"
          >
            {actionLabel}
          </Link>
        ) : null}
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-2 inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-strong"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onSkip}
        aria-label={`דלג על ${title}`}
        className="shrink-0 rounded-full p-1 text-muted transition-colors duration-150 hover:bg-overlay-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.75} />
      </button>
    </div>
  );
}

/**
 * "השלמת הגדרה" -- the Overview page's compact, skippable setup card
 * (spec point 7). Exactly three possible actions, never more: add to Home
 * Screen/PWA install, enable notifications, synchronize calendar. Every
 * item's completion state is derived from a REAL existing source of truth
 * (spec point 8) -- never invented:
 *
 * - install: `PwaInstallProvider`'s `isStandalone`/`installCompleted` (the
 *   same detection `NotificationBell`'s own onboarding card already uses).
 * - notifications: `usePushSubscription`'s real permission + confirmed
 *   subscription state (the same hook backing the bell's Push controls).
 * - calendar_sync: the server-verified `calendarSyncEnabled` prop, sourced
 *   from `getCalendarFeedForCurrentUser()` -- the SAME authoritative state
 *   `/settings` itself renders from.
 *
 * A veteran user who already completed all three (or a browser tab that's
 * already standalone-installed) sees nothing here at all -- this renders
 * `null` the instant every item is either complete or explicitly skipped,
 * never a default-visible "welcome" card. Skips persist per-device via
 * `setupCardPreference.ts` (this codebase's established
 * localStorage-keyed-by-userId pattern, see that module's own docstring)
 * and never resurface once skipped.
 *
 * Whether this card can appear AT ALL for the current account is a
 * SEPARATE, account-level decision (pre-merge correction) -- see
 * `eligibleForOnboarding`'s own docstring and `lib/config/onboardingRollout.ts`.
 * A veteran account's device/Push/calendar state can look exactly like a
 * new account's (nothing installed, nothing subscribed yet on THIS
 * browser), so per-item completion alone can never be trusted to decide
 * whether the card should exist for this account in the first place.
 *
 * Deliberately renders nothing until both `usePwaInstall()`'s one-time
 * environment detection AND `usePushSubscription()`'s initial status check
 * have resolved (`isReady`/`pushState !== "checking"`) -- same "never
 * guess, wait for the real answer" rule `deriveBellOnboardingCard` already
 * follows, so this can never show a stale "incomplete" flash that
 * immediately flips complete right after hydration.
 *
 * `eligibleForOnboarding` is checked FIRST, before any device-state gate --
 * see its own docstring. This is what actually fixes the veteran-user bug:
 * device/browser state (not standalone, no Push subscription) looks
 * IDENTICAL for a veteran account on a fresh browser and a genuinely new
 * account, so only an account-level signal can tell them apart.
 */
export function SetupSection({ userId, calendarSyncEnabled, eligibleForOnboarding }: SetupSectionProps) {
  const { isReady, isStandalone, canPromptInstall, isIos, installCompleted, promptInstall } = usePwaInstall();
  const { state: pushState, enable } = usePushSubscription(userId);

  // A lazy `useState` initializer, not `useSyncExternalStore`: this read is
  // a plain `Set`, a fresh object identity on every call, which would fail
  // `useSyncExternalStore`'s "getSnapshot must return a cached/stable value"
  // contract and loop forever re-rendering. Safe here specifically because
  // the initializer's value is never part of the SSR-matched first paint --
  // this component still returns `null` on that pass regardless (gated by
  // `isReady`/`pushStateKnown` below, both real `useSyncExternalStore`s of
  // their own), so a lazy-init value disagreeing between server and client
  // can never surface as a visible hydration mismatch.
  const [skippedItems, setSkippedItems] = useState<ReadonlySet<SetupItemKey>>(() =>
    userId ? readSkippedSetupItems(userId) : new Set(),
  );

  function isSkipped(item: SetupItemKey): boolean {
    return skippedItems.has(item);
  }

  function skip(item: SetupItemKey): void {
    if (userId) markSetupItemSkipped(userId, item);
    setSkippedItems((previous) => new Set(previous).add(item));
  }

  if (!eligibleForOnboarding) return null;

  const pushStateKnown = pushState !== "checking";
  if (!isReady || !pushStateKnown) return null;

  const installComplete = isStandalone || installCompleted;
  const showInstallItem = !installComplete && !isSkipped("install");

  const notificationsUnsupported = pushState === "unsupported";
  const notificationsComplete = pushState === "enabled" || pushState === "disabling";
  const showNotificationsItem = !notificationsUnsupported && !notificationsComplete && !isSkipped("notifications");

  const showCalendarItem = !calendarSyncEnabled && !isSkipped("calendar_sync");

  if (!showInstallItem && !showNotificationsItem && !showCalendarItem) return null;

  const installGuidance = deriveInstallGuidance({ isIos, canPromptInstall, installCompleted });

  return (
    <Panel variant="panel" className="flex flex-col gap-3" data-testid="setup-section">
      <div>
        <h2 className="text-sm font-semibold text-foreground">השלמת הגדרה</h2>
        <p className="mt-0.5 text-xs text-muted">כמה צעדים קצרים כדי להפיק את המקסימום מ{APP_NAME}</p>
      </div>

      <div className="flex flex-col gap-2">
        {showInstallItem && installGuidance !== "completed" ? (
          <SetupItemRow
            icon={Smartphone}
            title="הוספה למסך הבית"
            description={installGuidanceText(installGuidance)}
            actionLabel={installGuidance === "native" ? "התקנה" : undefined}
            onAction={installGuidance === "native" ? () => void promptInstall() : undefined}
            onSkip={() => skip("install")}
          />
        ) : null}

        {showNotificationsItem ? (
          <SetupItemRow
            icon={BellRing}
            title="הפעלת התראות"
            description={`קבלו תזכורות ועדכונים חשובים מ${APP_NAME} גם כשהיא סגורה.`}
            actionLabel="הפעלה"
            onAction={() => void enable()}
            onSkip={() => skip("notifications")}
          />
        ) : null}

        {showCalendarItem ? (
          <SetupItemRow
            icon={CalendarSync}
            title="סנכרון יומן"
            description="קבלו את המשמרות והתורנויות שלכם אוטומטית ביומן האישי."
            actionLabel="הגדרה"
            href="/settings"
            onSkip={() => skip("calendar_sync")}
          />
        ) : null}
      </div>
    </Panel>
  );
}
