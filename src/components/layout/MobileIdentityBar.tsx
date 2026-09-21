import { BrandMark } from "@/components/brand/BrandMark";
import { NotificationBell } from "@/components/pwa/NotificationBell";
import { SearchTriggerButton } from "@/components/search/SearchTriggerButton";
import { MobileProfileMenu } from "./MobileProfileMenu";
import { MobileTopBarThemeAction } from "./MobileTopBarThemeAction";

interface MobileIdentityBarProps {
  name: string;
  isManager: boolean;
  /** Presentation-only Google account photo -- see `lib/auth/currentUser.ts`. `null` falls back to initials. */
  avatarUrl: string | null;
  /** Authenticated Supabase user id, threaded through to `NotificationBell` (which keys this device's per-account install-prompt dismissal by it) and, since Privacy Phase 9B, to `MobileProfileMenu`'s sign-out cleanup. Push state itself now comes from `AppShell`'s shared `PushDeviceProvider`, not from the bell. */
  userId: string;
}

/**
 * The mobile app header (Design Pass PR #22 "mobile header polish") --
 * replaces the old identity ROW (name, role, manager shortcut, 3-button
 * theme control, and logout all visible at once) with a clean product
 * header: the `BrandMark` (symbol + wordmark) on the physical right, and a
 * compact [Search, Bell, Avatar] cluster on the physical left -- the Avatar
 * is the single entry point into everything the old row exposed
 * permanently (identity, "אזור מנהל" for a manager, theme, sign-out), now
 * behind `MobileProfileMenu`.
 *
 * Still the only mobile sign-out affordance (below `lg`, `Sidebar`/
 * `IdentityFooter` is hidden and `BottomNav` has no identity slot) --
 * reached via the profile menu. `/manager`/`/notifications` moved out of
 * this menu in the nav redesign pass (they now live in `BottomNav`'s "עוד"
 * sheet instead). The Bell is the real `NotificationBell` (PR #29) -- same
 * spot the PR #28 "בקרוב" placeholder reserved for it; it stays the
 * personal notification inbox, distinct from the manager-only "מרכז
 * התראות" destination. `SearchTriggerButton` (PR #35) opens the global
 * command palette; it renders nothing when search data isn't available.
 * `MobileTopBarThemeAction` (nav redesign pass) sits right next to Search
 * -- the mobile app's ONE theme control (moved out of `MobileProfileMenu`,
 * same "exactly one control" rule `IdentityFooter` already follows on
 * desktop), reusing the same shared `ThemeProvider` state, never a second
 * theme system.
 *
 * Uses only the already-safe name/isManager passed down from the app
 * shell (the same identity the request-scoped read model already
 * resolved) -- no email, no extra Google/auth fetch.
 */
export function MobileIdentityBar({ name, isManager, avatarUrl, userId }: MobileIdentityBarProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 lg:hidden">
      <BrandMark size="sm" className="text-foreground" />

      <div className="flex shrink-0 items-center gap-1.5">
        <SearchTriggerButton variant="mobile" />
        <MobileTopBarThemeAction />
        {/* `key={userId}` forces a fresh `NotificationBell` instance
            whenever the authenticated user changes -- this codebase's
            established idiom for "reset all internal state when an
            identity prop changes" (see `NotificationScheduleSection`'s
            `key={editingItem?.id ?? "new"}`) -- so an account switch on a
            shared device can never let the previous user's per-account
            bell state (its install-prompt dismissal) linger, even for a
            single frame. The PUSH state it renders is no longer this
            component's: `AppShell` applies the same idiom one level up,
            to the single shared `PushDeviceProvider`. */}
        <NotificationBell key={userId} variant="mobile" userId={userId} />
        <MobileProfileMenu name={name} isManager={isManager} avatarUrl={avatarUrl} userId={userId} />
      </div>
    </div>
  );
}
