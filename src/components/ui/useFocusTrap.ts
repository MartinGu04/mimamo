"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Every real (non-disabled) focusable element a trapped container can hold. Mirrors `CommandPalette`'s own original selector. */
const FOCUSABLE_SELECTOR = 'input:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

interface UseFocusTrapOptions {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  /** Focused first when the trap opens, if given; otherwise the container's own first focusable element (e.g. a sheet's close button). */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * A real Tab/Shift+Tab focus trap + Escape-to-close + focus-restore-on-close
 * for a modal-style dialog/sheet -- extracted from `CommandPalette` (PR #35)
 * so every modal surface in the app shares ONE proven implementation
 * instead of reinventing (and re-introducing the same bugs) per component.
 * On open: remembers whatever was focused, then focuses `initialFocusRef`
 * or the container's first focusable element. While open: Tab/Shift+Tab
 * cycles through the container's real focusable elements, wrapping at the
 * edges (or reclaiming focus if it somehow left the container entirely);
 * Escape calls `onClose` from anywhere inside. On close: refocuses whatever
 * was focused right before the trap opened.
 */
export function useFocusTrap({ open, onClose, containerRef, initialFocusRef }: UseFocusTrapOptions): void {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const target = initialFocusRef?.current ?? (containerRef.current ? getFocusableElements(containerRef.current)[0] : null);
    target?.focus();
  }, [open, containerRef, initialFocusRef]);

  useEffect(() => {
    if (open) return;
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const container = containerRef.current;
      if (!container) return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      // Wrap at the edges (or reclaim focus if it somehow left the
      // container entirely) -- everything in between is normal browser Tab
      // order, so every real control inside stays keyboard-reachable,
      // unlike pinning focus to one element unconditionally.
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, containerRef]);
}
