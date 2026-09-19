"use client";

import { useEffect, type RefObject } from "react";

/**
 * Module-scoped (not per-hook-instance) hold-tracking per background
 * element -- shared across every mounted modal so two overlapping true
 * modals that both want the SAME element (the app root, or an earlier
 * modal's own dialog node once a second modal opens on top of it) never
 * race to restore it while the other one still needs it. A count reaching
 * 0 is the only time an element's prior state is actually restored --
 * `hadAttr`/`priorValue` are captured once, at the FIRST hold, and are
 * exactly what gets written back at that final release, so an element
 * that already carried this attribute (from something else entirely,
 * before this hook ever touched it) comes back exactly as it was rather
 * than always ending up with the attribute stripped.
 */
interface InertHold {
  count: number;
  hadAttr: boolean;
  priorValue: string | null;
}

const inertHolds = new WeakMap<Element, InertHold>();

/** Feature-detected once, client-side only -- `false` during SSR and in engines (e.g. this repo's jsdom test environment) with no native `inert` IDL property. */
const supportsNativeInert = typeof document !== "undefined" && "inert" in document.createElement("div");

/**
 * The attribute this hook manages, and the value it applies while held --
 * native `inert` where supported, `aria-hidden="true"` as the fallback
 * (older engines: at least keeps assistive-technology browse mode out,
 * though mouse/keyboard focus can still reach it there, since there is no
 * CSS/JS substitute for `inert`'s pointer/focus blocking without touching
 * layout). Exported (alongside `holdInert`/`releaseInert` below) so both
 * paths can be exercised directly in a test regardless of whether the
 * engine running the suite happens to support native `inert` itself.
 */
export function inertAttributeFor(useNativeInert: boolean): { name: string; value: string } {
  return useNativeInert ? { name: "inert", value: "" } : { name: "aria-hidden", value: "true" };
}

/** `useNativeInert` defaults to this engine's real capability -- callers only ever override it in a test, to exercise the other path on an engine that doesn't natively support it. */
export function holdInert(element: Element, useNativeInert: boolean = supportsNativeInert): void {
  const existing = inertHolds.get(element);
  if (existing) {
    existing.count += 1;
    return;
  }
  const { name, value } = inertAttributeFor(useNativeInert);
  inertHolds.set(element, { count: 1, hadAttr: element.hasAttribute(name), priorValue: element.getAttribute(name) });
  element.setAttribute(name, value);
}

export function releaseInert(element: Element, useNativeInert: boolean = supportsNativeInert): void {
  const hold = inertHolds.get(element);
  if (!hold) return;
  if (hold.count > 1) {
    hold.count -= 1;
    return;
  }
  inertHolds.delete(element);
  const { name } = inertAttributeFor(useNativeInert);
  if (hold.hadAttr) {
    element.setAttribute(name, hold.priorValue ?? "");
  } else {
    element.removeAttribute(name);
  }
}

/**
 * Makes every OTHER child of the modal's own portal parent (in practice
 * `document.body`, since every modal here portals straight into it) inert
 * while a true modal is open -- so assistive-technology browse mode and
 * Tab order can no longer reach the underlying application content, only
 * the topmost dialog. Restores each affected element's exact prior state
 * on close/unmount (ref-counted, see `inertHolds`/`InertHold` above --
 * "exact prior state" includes an element that already carried `inert` or
 * `aria-hidden` for its own unrelated reason before this hook ever held
 * it), never the modal node itself.
 *
 * Nested/overlapping modals compose safely by construction: opening a
 * second modal also inerts the first modal's own dialog node (now just
 * another sibling under `document.body`), and closing the second one only
 * lifts the hold off elements nothing else still holds -- the first
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
    siblings.forEach((sibling) => holdInert(sibling));

    return () => {
      siblings.forEach((sibling) => releaseInert(sibling));
    };
  }, [active, dialogRef]);
}
