"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { CalendarSync, Loader2, LogOut } from "lucide-react";
import { signOutAction } from "@/lib/auth/actions";
import { Avatar } from "@/components/ui/Avatar";
import { PushEndpointHiddenField } from "@/components/pwa/PushEndpointHiddenField";
import { unsubscribeCurrentPushSubscription } from "@/lib/push/browserSubscription";
import { EXPAND_HIT_AREA_VERTICAL_CLASS } from "@/components/ui/hitArea";

interface MobileProfileMenuProps {
  name: string;
  isManager: boolean;
  /** Presentation-only Google account photo -- see `lib/auth/currentUser.ts`. `null` falls back to initials in `Avatar`. */
  avatarUrl: string | null;
}

/**
 * The form's submit button, split out so `useFormStatus` reflects the
 * enclosing `<form action={signOutAction}>`'s real pending state --
 * disabling the button and swapping in a spinner for the network round
 * trip, so a second tap can't fire a duplicate sign-out.
 */
function SignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      onClick={() => {
        unsubscribeCurrentPushSubscription();
      }}
      disabled={pending}
      aria-busy={pending}
      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start text-sm font-medium text-critical transition-colors duration-150 hover:bg-critical/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-critical disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={1.75} />
      ) : (
        <LogOut className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
      )}
      {pending ? "מתנתק..." : "התנתקות"}
    </button>
  );
}

/**
 * The mobile header's profile trigger + dropdown (Design Pass PR #22
 * "mobile header polish", stripped down to account-only content in the nav
 * redesign pass). Replaces the old `MobileIdentityBar` pattern of showing
 * name/role/manager-link/theme-control/logout permanently in the header --
 * all of that now lives behind this single Avatar button, kept as a
 * lightweight custom popover (no menu/dropdown dependency).
 *
 * Account-only by design (nav redesign pass): current identity/role,
 * "סנכרון יומן" (`/settings`), and sign-out -- nothing else. App navigation
 * (מטווחים, and for a manager אזור מנהל/מרכז התראות) moved to `MoreSheet`
 * (`BottomNav`'s "עוד" tab); the theme control moved to
 * `MobileTopBarThemeAction` in the mobile top bar itself. This menu must
 * never again grow back into a secondary navigation surface -- it is
 * account controls only, mirroring what `IdentityFooter` is for desktop.
 * One deliberate exception (Phase 7): a small "הצהרת נגישות" link to the
 * public `/accessibility` statement, the same footer-style carve-out
 * `IdentityFooter` gets on desktop -- a legal/compliance link, not app
 * navigation, so it doesn't reopen this surface to feature creep.
 *
 * Deliberately NOT `role="menu"`/`"menuitem"`/`aria-haspopup="menu"`
 * (Phase 5 remediation) -- this popover implements none of the real ARIA
 * menu's required keyboard model (Arrow/Home/End roving focus,
 * typeahead), so claiming that role would promise assistive tech
 * behavior that isn't there. It's genuinely just an ordinary disclosure
 * revealing a plain link and a plain submit button, Tab-navigated like
 * anywhere else on the page -- `role="group"` names the revealed panel
 * as a labeled group of related controls without promising a menu's
 * interaction model, and no `aria-haspopup` on the trigger either (none
 * of its enumerated values -- menu/listbox/tree/grid/dialog -- fit a
 * plain grouped disclosure). `aria-expanded`/`aria-controls` on the
 * trigger, and the Escape/outside-pointerdown dismissal below, are
 * unrelated to this and unchanged.
 *
 * Uses only the already-safe `name`/`isManager` passed down from the app
 * shell (the same identity the request-scoped read model already
 * resolved) -- no email, no new fetch. Sign-out is still the plain
 * `signOutAction` form (works with no client JS).
 */
export function MobileProfileMenu({ name, isManager, avatarUrl }: MobileProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`תפריט פרופיל של ${name}`}
        onClick={() => setOpen((prev) => !prev)}
        // Vertical-only expansion (Phase 6): sits in `MobileIdentityBar`'s
        // tight Search/Theme/Bell/Avatar cluster, only a few px from its
        // left neighbor -- see `EXPAND_HIT_AREA_VERTICAL_CLASS`'s own docs.
        className={`relative rounded-full transition-transform duration-150 hover:opacity-90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${EXPAND_HIT_AREA_VERTICAL_CLASS}`}
      >
        <Avatar name={name} size="sm" avatarUrl={avatarUrl} />
      </button>

      {open ? (
        <div
          id={menuId}
          role="group"
          aria-label="תפריט פרופיל"
          // Anchored to the trigger's END edge (physically its left edge in
          // RTL), not its start edge: the Avatar sits near the physical
          // LEFT edge of the screen (see MobileIdentityBar), so a
          // start-anchored popup would expand further left and run off the
          // viewport. Anchoring to `end-0` instead makes it expand
          // rightward, into the visible content area.
          className="glass-medium absolute end-0 top-full z-50 mt-2 w-56 rounded-xl bg-surface-1 p-1.5 shadow-[var(--shadow-elevated)] ring-1 ring-border-strong"
        >
          <div className="flex items-center gap-2.5 px-2.5 py-2">
            <Avatar name={name} size="sm" avatarUrl={avatarUrl} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{name}</p>
              {isManager ? <p className="text-xs text-muted">מנהל/ת</p> : null}
            </div>
          </div>

          <div className="my-1 h-px bg-border" />

          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-overlay-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <CalendarSync className="h-4 w-4 text-muted" aria-hidden="true" strokeWidth={1.75} />
            סנכרון יומן
          </Link>

          <Link
            href="/accessibility"
            onClick={() => setOpen(false)}
            className="block rounded-xl px-2.5 py-1.5 text-xs font-medium text-muted transition-colors duration-150 hover:bg-overlay-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            הצהרת נגישות
          </Link>

          <div className="my-1 h-px bg-border" />

          <form action={signOutAction}>
            <PushEndpointHiddenField />
            <SignOutButton />
          </form>
        </div>
      ) : null}
    </div>
  );
}
