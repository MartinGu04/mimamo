"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X } from "lucide-react";
import { useModalInertBackground } from "@/components/ui/useModalInertBackground";
import { EXPAND_HIT_AREA_CLASS } from "@/components/ui/hitArea";

/** No real external store to watch -- `subscribe` never actually fires. Existing purely so `getSnapshot` (`true`, client) differs from `getServerSnapshot` (`false`, server/first hydration pass), which is what makes `useSyncExternalStore` schedule exactly one re-render right after hydration -- the standard SSR-safe "has this component mounted on the client yet" primitive, and (unlike `useEffect(() => setState(true), [])`) not a lint-flagged setState-in-effect. */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

interface FairnessDetailOverlayProps {
  /** Real, navigable URL with `?person=` removed (mode/month/period preserved) -- every close path (X button, Escape, backdrop) ends up here, so closing is always a genuine back-button-safe navigation, never local-only state. */
  closeHref: string;
  title: string;
  children: ReactNode;
}

/** Every real (non-disabled) focusable element the overlay can contain -- same convention as `CommandPalette`'s own focus trap. */
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Person-detail overlay for the standalone Fairness experience (PR #4) --
 * desktop: a side drawer; mobile: a bottom sheet -- ONE component, purely
 * responsive via Tailwind breakpoints (same `lg:` breakpoint `AppShell`
 * switches Sidebar/BottomNav at), not two separate implementations.
 *
 * Deliberately URL-driven, not local open/close state: this component is
 * only ever MOUNTED by the page when `?person=` already resolved to a real
 * loaded row (never trust a client-supplied id -- see the page's own
 * lookup). Every close path -- the X button, Escape, backdrop click --
 * navigates to `closeHref` (a real `/fairness` URL with `person` stripped,
 * mode/month/period preserved), so the browser Back button and a page
 * reload both behave exactly like closing did, and closing never loses the
 * selected mode/period. `router.push` is used for Escape/backdrop (a
 * genuine navigation, not merely local state) so both stay in lockstep
 * with the real `<Link>` the X button renders.
 *
 * Accessible dialog semantics follow the SAME proven pattern
 * `CommandPalette` already established: `role="dialog"`/`aria-modal`, a
 * real Tab/Shift+Tab focus trap over the dialog's actual focusable
 * controls, Escape-to-close, a backdrop that closes on click, focus moved
 * into the dialog on mount and restored to whatever triggered it on
 * unmount, and rendered via `createPortal` so it never nests inside the
 * card grid's own DOM/z-index context.
 *
 * `useMounted()` guards the `createPortal(..., document.body)` call itself
 * (found during visual QA): unlike `CommandPalette`, which only ever
 * portals once a client-only `open` state flips true, THIS component is
 * unconditionally mounted with real content by its server-rendered parent
 * whenever a person is selected -- so without this guard, `document.body`
 * would be evaluated during the SERVER render pass too (`"use client"`
 * components still render on the server for the initial HTML), where
 * `document` does not exist. Deferring the portal to after mount is the
 * standard fix; the dialog simply appears once hydration completes, same
 * tradeoff every portal-based dialog library makes.
 */
export function FairnessDetailOverlay({ closeHref, title, children }: FairnessDetailOverlayProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLAnchorElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const mounted = useMounted();
  const portalRootRef = useRef<HTMLDivElement>(null);

  // Background app content (everything else under `document.body`) must be
  // inert for AT browse mode/Tab order while this true modal is open --
  // `mounted` is exactly "this modal is currently open" here, since the
  // parent only ever mounts this component while a person is selected (see
  // this component's own docstring).
  useModalInertBackground(mounted, portalRootRef);

  // Depends on `mounted`, not `[]`: the dialog (and `closeButtonRef`'s real
  // DOM node) only exists in the tree from the render AFTER `mounted` flips
  // true (see the SSR-portal guard above) -- an effect tied to the very
  // first commit would run while the ref is still null and never re-fire.
  useEffect(() => {
    if (!mounted) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [mounted]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        router.push(closeHref);
        return;
      }
      if (event.key !== "Tab") return;

      const dialogNode = dialogRef.current;
      if (!dialogNode) return;

      const focusable = getFocusableElements(dialogNode);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialogNode.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogNode.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeHref, router]);

  if (!mounted) return null;

  return createPortal(
    <div ref={portalRootRef} className="fixed inset-0 z-50 flex items-end justify-center lg:items-stretch lg:justify-end">
      <div
        role="presentation"
        aria-hidden="true"
        className="glass-scrim absolute inset-0 bg-black/40"
        onClick={() => router.push(closeHref)}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[85vh] w-full flex-col rounded-t-xl bg-surface-1 shadow-[var(--shadow-elevated)] ring-1 ring-border-strong lg:h-dvh lg:max-h-none lg:w-[420px] lg:max-w-[90vw] lg:rounded-none lg:border-s lg:border-border lg:ring-0"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>
          <Link
            ref={closeButtonRef}
            href={closeHref}
            aria-label="סגירה"
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-overlay-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${EXPAND_HIT_AREA_CLASS}`}
          >
            <X className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
