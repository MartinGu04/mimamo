import Link from "next/link";
import { CalendarSync } from "lucide-react";
import { signOutAction } from "@/lib/auth/actions";
import { Avatar } from "@/components/ui/Avatar";
import { PushEndpointHiddenField } from "@/components/pwa/PushEndpointHiddenField";
import { APP_VERSION } from "@/lib/config/appVersion";
import { IdentityFooterSignOutButton } from "./IdentityFooterSignOutButton";
import { IdentityFooterThemeAction } from "./IdentityFooterThemeAction";

interface IdentityFooterProps {
  name: string;
  isManager: boolean;
  /** Presentation-only Google account photo -- see `lib/auth/currentUser.ts`. `null` falls back to initials in `Avatar`. */
  avatarUrl: string | null;
}

/**
 * Identity card for the protected shell: app version, theme control, and
 * (anchoring the very bottom of the sidebar, PR #38 footer hierarchy
 * polish) avatar/name/manager indication/sign out. Version+theme sit ABOVE
 * the user/profile row deliberately -- the account block is the thing that
 * should visually anchor the bottom of the rail, with the quieter
 * utility row (version, theme) sitting just above it rather than below.
 * The theme control (sidebar/mobile-nav refinement pass) reads as part of
 * the account/personal controls next to the user block instead of a stray
 * toggle above the nav list. This is the ONLY theme control in the
 * sidebar; `Sidebar` itself renders none, and it's a single compact
 * icon-only light/dark action (`IdentityFooterThemeAction`), not the
 * 3-option `ThemeToggle`.
 */
export function IdentityFooter({ name, isManager, avatarUrl }: IdentityFooterProps) {
  return (
    <div className="border-t border-sidebar-border px-5 py-5">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="text-[11px] text-sidebar-muted">גרסה {APP_VERSION}</p>
        <div className="flex items-center gap-1">
          <Link
            href="/settings"
            aria-label="סנכרון יומן"
            title="סנכרון יומן"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-muted transition-colors duration-200 hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <CalendarSync className="h-[16px] w-[16px]" aria-hidden="true" strokeWidth={1.75} />
          </Link>
          <IdentityFooterThemeAction />
        </div>
      </div>
      {/* Phase 7: the one discoverable link into the public accessibility
          statement from the desktop shell -- deliberately grouped with the
          version/settings/theme utility row above the profile row, NOT
          appended after it: the account/profile row below must stay the
          LAST child so it keeps anchoring the very bottom of the rail (see
          this component's own docstring, PR #38). */}
      <Link
        href="/accessibility"
        className="mt-1.5 block rounded px-1 text-[11px] text-sidebar-muted underline decoration-sidebar-muted/40 underline-offset-2 transition-colors duration-150 hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        הצהרת נגישות
      </Link>
      <div className="mt-3.5 flex items-center gap-3 rounded-xl px-1 py-1.5">
        <Avatar name={name} size="md" avatarUrl={avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-sidebar-foreground">{name}</p>
          {isManager ? <p className="text-xs text-sidebar-muted">מנהל/ת</p> : null}
        </div>
        <form action={signOutAction}>
          <PushEndpointHiddenField />
          <IdentityFooterSignOutButton />
        </form>
      </div>
    </div>
  );
}
