"use client";

import { useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BellRing, Hourglass, Target, UserCog, X } from "lucide-react";
import { useFocusTrap } from "@/components/ui/useFocusTrap";

interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
  isManager: boolean;
}

/** Same SSR-safe "mounted on the client yet" primitive `CommandPalette`/`ReportOneEditorOverlay` already use, so `createPortal(..., document.body)` is never evaluated during the server render pass. */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Mobile "עוד" (More) bottom sheet -- reached from `BottomNav`'s 5th tab
 * (nav redesign pass). Holds exactly the destinations that are neither part
 * of the small curated bottom-nav set NOR account-related (those live in
 * `MobileProfileMenu` instead): מטווחים and עד מתי??? for every viewer, plus
 * אזור מנהל/מרכז התראות for a manager only -- the SAME `isManager` boundary
 * every other manager-only surface in this app uses (`nav-items.ts`'s own
 * `managerOnly` flag), never a duplicated/looser check. Deliberately never
 * renders סנכרון יומן/theme/logout -- those stay exclusively in the profile
 * menu so "עוד" reads as ordinary app navigation, not a second account menu.
 *
 * It declares real dialog semantics (role="dialog", aria-modal="true") and
 * now behaves like one too: the shared `useFocusTrap` hook (`components/ui/`,
 * extracted from `CommandPalette`) moves focus inside on open (defaulting to
 * the close button, its first focusable element), traps Tab/Shift+Tab within
 * the sheet, closes on Escape, and restores focus to whatever triggered it
 * on close.
 */
export function MoreSheet({ open, onClose, isManager }: MoreSheetProps) {
  const mounted = useMounted();
  const sheetRef = useRef<HTMLDivElement>(null);

  useFocusTrap({ open, onClose, containerRef: sheetRef });

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:hidden">
      <div role="presentation" aria-hidden="true" className="glass-scrim absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="עוד"
        className="relative flex w-full flex-col rounded-t-2xl bg-surface-1 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-elevated)] ring-1 ring-border-strong"
      >
        <div className="flex items-center justify-between px-2 pb-2 pt-1">
          <p className="text-sm font-semibold text-foreground">עוד</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-overlay-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          </button>
        </div>

        <nav className="flex flex-col gap-1" aria-label="עוד ניווט">
          <Link
            href="/shooting-ranges"
            onClick={onClose}
            className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-foreground transition-colors duration-150 hover:bg-overlay-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Target className="h-5 w-5 text-muted" aria-hidden="true" strokeWidth={1.75} />
            מטווחים
          </Link>

          <Link
            href="/countdown"
            onClick={onClose}
            className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-foreground transition-colors duration-150 hover:bg-overlay-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Hourglass className="h-5 w-5 text-muted" aria-hidden="true" strokeWidth={1.75} />
            עד מתי???
          </Link>

          {isManager ? (
            <Link
              href="/manager"
              onClick={onClose}
              className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-foreground transition-colors duration-150 hover:bg-overlay-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <UserCog className="h-5 w-5 text-muted" aria-hidden="true" strokeWidth={1.75} />
              אזור מנהל
            </Link>
          ) : null}

          {isManager ? (
            <Link
              href="/notifications"
              onClick={onClose}
              className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-foreground transition-colors duration-150 hover:bg-overlay-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <BellRing className="h-5 w-5 text-muted" aria-hidden="true" strokeWidth={1.75} />
              מרכז התראות
            </Link>
          ) : null}
        </nav>
      </div>
    </div>,
    document.body,
  );
}
