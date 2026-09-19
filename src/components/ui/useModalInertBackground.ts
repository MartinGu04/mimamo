"use client";

import { useEffect, type RefObject } from "react";

/**
 * Module-scoped (not per-hook-instance) ref count per background element --
 * shared across every mounted modal so two overlapping true modals that
 * both want the SAME element (the app root, or an earlier modal's own
 * dialog node once a second modal opens on top of it) never race to
 * remove `inert` while the other one still needs it. A count reaching 0
 * is the only time an element's prior state is actually restored.
 */
const inertHolds = new WeakMap<Element, number>();

/** Feature-detected once, client-side only -- `false` during SSR (this module has no server-side callers either way; every use is inside an effect). */
const supportsNativeInert = typeof document !== "undefined" && "inert" in document.createElement("div");

function holdInert(element: Element): void {
  const holds = inertHolds.get(element) ?? 0;
  if (holds === 0) {
    if (supportsNativeInert) {
      element.setAttribute("inert", "");
    } else {
      // Older engines without native `inert`: `aria-hidden` at least keeps
      // assistive-technology browse mode out (mouse/keyboard focus can
      // still reach it there, since there is no CSS/JS substitute for
      // `inert`'s pointer/focus blocking without touching layout).
      element.setAttribute("aria-hidden", "true");
    }
  }
  inertHolds.set(element, holds + 1);
}

function releaseInert(element: Element): void {
  const holds = inertHolds.get(element) ?? 0;
  if (holds <= 1) {
    inertHolds.delete(element);
    if (supportsNativeInert) {
      element.removeAttribute("inert");
    } else {
      element.removeAttribute("aria-hidden");
    }
    return;
  }
  inertHolds.set(element, holds - 1);
}

/**
 * Makes every OTHER child of the modal's own portal parent (in practice
 * `document.body`, since every modal here portals straight into it) inert
 * while a true modal is open -- so assistive-technology browse mode and
 * Tab order can no longer reach the underlying application content, only
 * the topmost dialog. Restores each affected element's exact prior state
 * on close/unmount (ref-counted, see `inertHolds` above), never the modal
 * node itself.
 *
 * Nested/overlapping modals compose safely by construction: opening a
 * second modal also inerts the first modal's own dialog node (now just
 * another sibling under `document.body`), and closing the second one only
 * lifts `inert` off elements nothing else still holds -- the first
 * modal's node included, once its own hold is the only one left.
 *
 * `dialogRef` must point at the modal's own top-level DOM node -- the
 * element `createPortal` appends directly under its target -- so that
 * node is the one skipped and never marked inert itself.
 */
export function useModalInertBackground(active: boolean, dialogRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const dialogNode = dialogRef.current;
    if (!dialogNode || !dialogNode.parentElement) return;

    const siblings = Array.from(dialogNode.parentElement.children).filter((sibling) => sibling !== dialogNode);
    siblings.forEach(holdInert);

    return () => {
      siblings.forEach(releaseInert);
    };
  }, [active, dialogRef]);
}
