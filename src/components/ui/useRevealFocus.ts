"use client";

import { useEffect, useRef, type RefObject } from "react";

interface UseRevealFocusOptions {
  /** Whether the confirmation/inline-reveal UI this hook manages is currently shown. */
  revealed: boolean;
  /** Focused the moment `revealed` flips to true -- the confirmation's primary action or heading, whichever best matches the component's structure. */
  onRevealFocusRef: RefObject<HTMLElement | null>;
  /**
   * The specific trigger to restore focus to once `revealed` flips back to
   * false, for a caller whose trigger button is ITSELF conditionally
   * rendered -- hidden for as long as `revealed` is true, as with
   * `CalendarSyncSection`'s reset/disable buttons and
   * `EmergencyModeControlClient`'s activate/deactivate buttons. A snapshot
   * of this REF OBJECT (not its `.current` node) is taken the moment
   * `revealed` becomes true, so a caller with more than one possible
   * trigger can point at the right one per reveal; its `.current` is then
   * read fresh at restore time, after the trigger has been re-mounted as a
   * brand-new DOM node in the very same commit that hid the confirmation --
   * never the stale node that was there before, which by then has already
   * been torn down and would always fail an `isConnected` check. Omit this
   * when the trigger stays mounted throughout (e.g. `NotificationBell`'s
   * bell button) -- then whatever was actually focused right before reveal
   * is restored instead.
   */
  restoreFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Focused back once `revealed` flips to false again, if neither
   * `restoreFocusRef` nor the originally-focused trigger is available (e.g.
   * a successful destructive action removes the whole confirmed section,
   * trigger included). Keeps focus from silently falling through to
   * `<body>`.
   */
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Connected to the document AND actually able to take focus right now --
 * a restore target can be both while sitting behind a trailing `disabled`
 * state for one extra render (e.g. a still-`isPending` trigger button that
 * reappears in the very same commit its own confirmation's action just
 * resolved in): a disabled control never accepts programmatic `.focus()`,
 * so blindly calling it here would silently strand focus on whatever the
 * confirmation's own removal already fell back to (typically `<body>`).
 */
function isFocusable(el: HTMLElement): boolean {
  return el.isConnected && !(el as HTMLButtonElement).disabled;
}

/**
 * Predictable focus in/out for an inline confirmation reveal -- no modal
 * dialog, no Tab trap, no Escape handling, since this is ordinary page
 * content appearing/disappearing in place (e.g. `CalendarSyncSection`'s
 * reset/disable confirm, `EmergencyModeControlClient`'s activate/deactivate
 * confirm). On reveal, remembers whatever was focused and moves focus into
 * the confirmation (`onRevealFocusRef`). Once hidden again -- whether by
 * cancelling or the action completing -- restores focus to `restoreFocusRef`
 * if given and connected, else to whatever was focused before reveal if
 * that's still connected, else to `fallbackFocusRef` rather than losing
 * focus to `<body>`.
 */
export function useRevealFocus({ revealed, onRevealFocusRef, restoreFocusRef, fallbackFocusRef }: UseRevealFocusOptions): void {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const capturedRestoreRef = useRef<RefObject<HTMLElement | null> | undefined>(undefined);
  const wasRevealedRef = useRef(false);

  // Captured synchronously during render, the instant `revealed` flips to
  // true -- NOT in an effect. Both `CalendarSyncSection` and
  // `EmergencyModeControlClient` hide their own trigger button the moment a
  // confirmation appears, so by the time any `useEffect` could run (after
  // commit), that trigger has already been unmounted and the browser has
  // already reset `document.activeElement` to `<body>` as a side effect of
  // the removal -- capturing it there would silently remember `<body>`
  // instead of the real trigger. Render runs before commit, while the
  // previous DOM (trigger still mounted and focused) is still what's on
  // screen, so this is the only point that still sees the real answer.
  // `restoreFocusRef` itself (the ref OBJECT, not its node) is snapshotted
  // here too, for the same reason `previousFocusRef`'s node capture must
  // happen now: by restore time the caller's own JSX may already reflect a
  // different (or no) trigger.
  if (revealed && !wasRevealedRef.current) {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    capturedRestoreRef.current = restoreFocusRef;
  }
  wasRevealedRef.current = revealed;

  useEffect(() => {
    if (revealed) {
      onRevealFocusRef.current?.focus();
      return;
    }

    // `restoreFocusRef.current` is read fresh here, not from a snapshot --
    // by now the commit that hid the confirmation has already re-mounted
    // the trigger this ref is attached to (a NEW DOM node, distinct from
    // whatever `previousFocusRef` captured), so this is the one place that
    // correctly sees it as connected.
    const explicitTarget = capturedRestoreRef.current?.current;
    if (explicitTarget && isFocusable(explicitTarget)) {
      explicitTarget.focus();
      previousFocusRef.current = null;
      return;
    }

    const target = previousFocusRef.current;
    if (!target) return; // Nothing was ever revealed (e.g. initial mount) -- nothing to restore.
    previousFocusRef.current = null;

    // `<body>` is always "connected" but focusing it is a no-op that just
    // leaves whatever was already focused in place -- it's what
    // `document.activeElement` reports when nothing was really focused
    // before reveal (e.g. a trigger activated without ever gaining focus
    // itself), never a meaningful restore target in its own right.
    if (target !== document.body && isFocusable(target)) {
      target.focus();
    } else {
      fallbackFocusRef?.current?.focus();
    }
    // `onRevealFocusRef`/`fallbackFocusRef` are stable ref objects passed by
    // the caller (always from `useRef()`) -- included for exhaustive-deps
    // correctness, never causing an extra run since their identity never
    // changes across renders. `restoreFocusRef` is read via the render-phase
    // snapshot above instead, deliberately not a dependency here.
  }, [revealed, onRevealFocusRef, fallbackFocusRef]);
}
