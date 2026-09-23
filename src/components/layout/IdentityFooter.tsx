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
  /** Authenticated Supabase user id -- threaded through only to `IdentityFooterSignOutButton`'s sign-out cleanup (Privacy Phase 9B). */
  userId: string;
}

/**
 * Identity card for the protected shell, ordered bottom-to-top by how
 * often it's touched: quiet informational/legal links (Phase 7 & 9C) at
 * the top, a divider, the version/settings/theme utility row, then
 * (anchoring the very bottom of the sidebar, PR #38 / footer hierarchy
 * polish) avatar/name/manager indication/sign out as the LAST child so
 * the account block keeps anchoring the very bottom of the rail. The
 * theme control (sidebar/mobile-nav refinement pass) reads as part of
 * the account/personal controls next to the user block instead of a stray
 * toggle above the nav list. This is the ONLY theme control in the
 * sidebar; `Sidebar` itself renders none, and it's a single compact
 * icon-only light/dark action (`IdentityFooterThemeAction`), not the
 * 3-option `ThemeToggle`.
 */
export function IdentityFooter({ name, isManager, avatarUrl, userId }: IdentityFooterProps) {
  return (
    <div className="border-t border-sidebar-border px-5 py-5">
      {/* Phase 7/9C: the discoverable links into the public accessibility
          statement and privacy notice from the desktop shell -- legal/
          informational links, not app navigation. Laid out as a single
          horizontal row (wrapping only if a narrow sidebar forces it)
          rather than stacked, so the two quiet footer links read as one
          group instead of two separate lines. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href="/accessibility"
          className="rounded px-1 text-[11px] text-sidebar-muted underline decoration-sidebar-muted/40 underline-offset-2 transition-colors duration-150 hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          הצהרת נגישות
        </Link>
        <Link
          href="/privacy"
          className="rounded px-1 text-[11px] text-sidebar-muted underline decoration-sidebar-muted/40 underline-offset-2 transition-colors duration-150 hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          מדיניות פרטיות
        </Link>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-sidebar-border px-1 pt-3">
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
      <div className="mt-3.5 flex items-center gap-3 rounded-xl px-1 py-1.5">
        <Avatar name={name} size="md" avatarUrl={avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-sidebar-foreground">{name}</p>
          {isManager ? <p className="text-xs text-sidebar-muted">מנהל/ת</p> : null}
        </div>
        <form action={signOutAction}>
          <PushEndpointHiddenField />
          <IdentityFooterSignOutButton userId={userId} />
        </form>
      </div>
    </div>
  );
}
