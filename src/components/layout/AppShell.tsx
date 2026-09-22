import type { ReactNode } from "react";
import { AccessibilityPreferencesButton } from "./AccessibilityPreferencesButton";
import { BottomNav } from "./BottomNav";
import { PageBackdrop } from "./PageBackdrop";
import { EmergencyModeBanner } from "./EmergencyModeBanner";
import { MobileIdentityBar } from "./MobileIdentityBar";
import { PrivacyStorageNotice } from "@/components/privacy/PrivacyStorageNotice";
import { GlobalPushBanner } from "@/components/pwa/GlobalPushBanner";
import { PushDeviceProvider } from "@/components/pwa/PushDeviceProvider";
import { ShellUtilityBar } from "./ShellUtilityBar";
import { Sidebar } from "./Sidebar";
import { MAIN_CONTENT_ID, SkipToMainContentLink } from "./SkipToMainContentLink";

interface AppShellProps {
  children: ReactNode;
  /**
   * `avatarUrl` is presentation-only (the Google account's profile photo,
   * already server-verified as part of the Supabase auth identity -- see
   * `lib/auth/currentUser.ts`) -- it never affects identity matching or
   * authorization, only which `Avatar` renders a photo vs. initials.
   */
  /**
   * `userId` is the authenticated Supabase user id -- an auth-only sibling
   * of `name`/`isManager`/`avatarUrl`, never a personnel/domain identity
   * field (see `PersonalScheduleLoadResult`). It only ever reaches the
   * shell's `PushDeviceProvider` (which uses it to key the per-user/
   * per-device Push notification preference) and `NotificationBell` (which
   * uses it to key that device's per-account install-prompt dismissal).
   */
  person?: { name: string; isManager: boolean; avatarUrl: string | null; userId: string };
  /**
   * Same "HH:mm:ss" (or `null`) contract as `LiveClock.initialTime`, passed
   * straight through to `ShellUtilityBar` -- `null` whenever the caller has
   * no server-derived `localNow` to offer (e.g. a `configuration_error`
   * render), never a client-only `Date.now()` guess.
   */
  initialClockTime?: string | null;
  /** Pre-formatted Hebrew weekday+date for `ShellUtilityBar`'s clock pill -- see there. `null`/omitted alongside `initialClockTime` for the same reason. */
  dateLabel?: string | null;
  /**
   * A safe, server-resolved projection of `OperationalMode` (never a
   * client-only boolean the caller invents) -- `true` renders the global
   * `EmergencyModeBanner` for every authenticated screen (spec section
   * 3). See `src/app/(app)/layout.tsx`, which resolves this via
   * `resolveOperationalMode()` alongside its other per-request reads.
   */
  emergencyModeActive?: boolean;
}

/**
 * Desktop: a right-side sidebar (the natural leading edge in RTL, achieved
 * simply by rendering it first in a `flex` row under `dir="rtl"` -- no
 * flex-row-reverse needed) plus a main column. Its `IdentityFooter` is the
 * desktop sign-out affordance. The sidebar is `sticky`/viewport-bound (see
 * `Sidebar`), so it never stretches down with tall page content -- this
 * outer row only needs `min-h-dvh`, not any special alignment, since an
 * explicit-height flex item ignores the container's default stretch.
 * `dvh` (not the legacy `vh`/`screen`), same as `Sidebar`'s own `h-dvh` --
 * `100vh` on a mobile browser is sized to the LARGEST possible viewport
 * (chrome collapsed), which is taller than what's actually visible on
 * first paint. A `min-height` pinned to that inflated number stretches the
 * shell (and the page) past its own real content, past `BottomNav`'s
 * clearance, into a large scrollable empty region below everything visible
 * -- `dvh` tracks the viewport's actual current size instead.
 *
 * Mobile/tablet: no sidebar at all -- a fixed bottom navigation bar instead
 * (see BottomNav), which has no identity slot of its own, so
 * `MobileIdentityBar` is the mobile sign-out affordance. Content gets
 * enough bottom padding to clear the bottom nav, including the iOS safe
 * area. Both render for every child, including the `configuration_error`
 * content state -- signing out must always be reachable.
 *
 * Content width: capped at 1440px (up from the old 1152px/`max-w-6xl`) so
 * large monitors get real usable canvas instead of a narrow centered
 * column with wasted space either side -- still with sensible horizontal
 * padding, not edge-to-edge.
 *
 * `ShellUtilityBar` (desktop-only, above `main`) is the app shell's ONE
 * live clock -- see there and `LiveClock` for why individual pages
 * (the dashboard included) must never render a second one. Header polish
 * pass: it also now carries the desktop notification bell (moved out of
 * `Sidebar`) and the two organizational logos, framing the clock/date.
 */
export function AppShell({
  children,
  person,
  initialClockTime = null,
  dateLabel = null,
  emergencyModeActive = false,
}: AppShellProps) {
  return (
    /**
     * `PushDeviceProvider` wraps the WHOLE authenticated shell, with
     * `key={person?.userId}` -- this codebase's established "reset all
     * internal state when identity changes" idiom (the same one the two
     * bells previously applied individually). It is what makes the two
     * simultaneously-mounted bells, the global banner, and
     * "המכשירים שלי" share exactly ONE push-device state machine
     * instead of running their own -- see that provider's docstring for
     * the duplicate-round-trip/racing-auto-restore problem that caused.
     */
    <PushDeviceProvider key={person?.userId} userId={person?.userId}>
      <div className="isolate flex min-h-dvh bg-background text-foreground">
        <SkipToMainContentLink />
        <Sidebar person={person} />
        <div className="relative flex min-h-dvh w-full flex-1 flex-col">
          <PageBackdrop />
          {person ? (
            <MobileIdentityBar
              name={person.name}
              isManager={person.isManager}
              avatarUrl={person.avatarUrl}
              userId={person.userId}
            />
          ) : null}
          <ShellUtilityBar initialClockTime={initialClockTime} dateLabel={dateLabel} userId={person?.userId} />
          {emergencyModeActive ? <EmergencyModeBanner /> : null}
          {/* Rendered ONCE here, in the shared main column -- not inside
              either the mobile or the desktop bar -- so it appears on
              every authenticated page at every viewport with no
              duplicate copy to keep in sync. */}
          <GlobalPushBanner userId={person?.userId} />
          <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pb-10 focus:outline-none">
            <div className="mx-auto w-full max-w-[1440px]">{children}</div>
          </main>
        </div>
        <BottomNav isManager={person?.isManager} />
        <AccessibilityPreferencesButton />
        <PrivacyStorageNotice variant="authenticated" />
      </div>
    </PushDeviceProvider>
  );
}
