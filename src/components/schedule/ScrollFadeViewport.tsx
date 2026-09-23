"use client";

import { Locate } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface ScrollFadeViewportProps {
  ariaLabel: string;
  className: string;
  children: React.ReactNode;
  /**
   * When true, renders the compact "איפה אני?" Find Me control above the
   * scroll viewport -- only ever passed `true` when `TeamWeekMatrix` has
   * confirmed the viewer's own column is among the currently rendered
   * columns (case A of the active/all filter interaction; see that
   * component's docs). Omitted/false renders no button at all -- this
   * component never re-derives that eligibility itself.
   */
  enableFindMe?: boolean;
}

/** The single, unambiguous query target for the viewer's own header cell -- see `TeamWeekMatrix.tsx`'s `SELF_HEADER_ATTRIBUTE`. Kept as a plain string here (not a shared import) since this is the only other file that needs it, and a data-attribute selector string is a stable, load-bearing contract either way. */
const SELF_HEADER_SELECTOR = '[data-team-week-self-header="true"]';

/**
 * The CSS class toggled on the scroll viewport itself while the Find Me
 * highlight is active -- `globals.css`'s `.team-week-locating-self
 * .team-week-self-column` descendant selector then reaches every marked
 * header/cell inside it. Toggled on `viewportRef.current` (not some outer
 * wrapper) so the selector's ancestor really is the scrollable region.
 */
const LOCATING_SELF_CLASS = "team-week-locating-self";

/**
 * Slightly LONGER than the 2s CSS keyframe duration (`globals.css`'s
 * `team-week-self-pulse`) so the JS-side cleanup timeout never races the
 * animation and clips it a frame early -- the class removal is a safety
 * net for a non-animation (reduced-motion) case and a guard against a
 * leaked class if the animation is somehow interrupted, not what visually
 * ends the pulse in the common case.
 */
const PULSE_DURATION_MS = 2100;

/** Fallback ceiling for "the scroll has settled" when the `scrollend` event either isn't supported or never fires (observed in some browsers for very short/instant scrolls) -- a smooth `scrollIntoView` on a matrix-sized viewport always finishes well within this window. */
const SCROLL_SETTLE_FALLBACK_MS = 500;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  const manual = document.documentElement.getAttribute("data-a11y-reduce-motion") === "true";
  if (manual) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Is `target` already comfortably inside `viewport`'s visible horizontal bounds? Geometry-based (`getBoundingClientRect`), never a manually-computed LTR `scrollLeft` assumption -- correct under RTL's negative-`scrollLeft` Chromium behavior without needing to know about it at all. */
function isSufficientlyVisible(target: Element, viewport: Element): boolean {
  const t = target.getBoundingClientRect();
  const v = viewport.getBoundingClientRect();
  return t.left >= v.left && t.right <= v.right;
}

/**
 * A narrow client boundary around the Team Week matrix's real scroll
 * viewport -- NOT the matrix or its data becoming client-side, just this
 * one wrapper. Measuring `scrollLeft`/`scrollWidth`/`clientWidth` is
 * inherently a DOM/client concern, so this is the one sliver that needs
 * `"use client"`; `TeamWeekMatrix` itself, and everything it's built from
 * (`buildScheduleTeamWeekView`, the read model), stays exactly as
 * server-rendered as before.
 *
 * Renders two subtle edge-fade overlays (start/end) that each disappear
 * once there's nothing left to reveal in that direction -- a HINT only,
 * never the only way to discover the scroll: native scrolling (mouse
 * wheel, touch, the `region`'s own keyboard arrow-key scrolling) keeps
 * working identically whether or not a fade is showing.
 *
 * The app is always RTL (`dir="rtl"` on `<html>`, per CLAUDE.md/AGENTS.md)
 * -- Chromium reports `scrollLeft` as `0` at the reading-start edge
 * (rightmost, where the table begins) and increasingly NEGATIVE toward the
 * reading-end edge (leftmost) for RTL content, so the two fades are read
 * directly off that fixed RTL behavior, not a direction-agnostic
 * abstraction this app has no use for.
 *
 * When `enableFindMe` is set, also owns the "איפה אני?" locate+pulse
 * interaction end to end: finds the viewer's own header cell inside this
 * SAME scroll viewport (`SELF_HEADER_SELECTOR`), scrolls it into view with
 * `scrollIntoView({inline:"center"})` (RTL-safe by construction -- never a
 * manually computed `scrollLeft`), waits for the scroll to genuinely
 * settle, then toggles `LOCATING_SELF_CLASS` on the viewport itself so the
 * scoped CSS pulse (`globals.css`) can animate the whole self column
 * (header + all seven body cells) via a plain descendant selector, never
 * per-cell inline styling. Already-visible targets skip the scroll and
 * pulse immediately. Reduced-motion users get an instant jump (no smooth
 * scroll) and a STATIC highlight (no pulse animation) for the same ~2s,
 * handled entirely by `globals.css`'s own reduced-motion override for the
 * same class -- this component only ever toggles one class either way.
 */
export function ScrollFadeViewport({ ariaLabel, className, children, enableFindMe = false }: ScrollFadeViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [showStartFade, setShowStartFade] = useState(false);
  const [showEndFade, setShowEndFade] = useState(false);

  const pulseTimeoutRef = useRef<number | undefined>(undefined);
  const settleCleanupRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    function update() {
      if (!el) return;
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 1) {
        setShowStartFade(false);
        setShowEndFade(false);
        return;
      }
      // scrollLeft === 0 -> at the start (rightmost); scrollLeft === -maxScroll -> at the end (leftmost).
      setShowStartFade(el.scrollLeft < -1);
      setShowEndFade(el.scrollLeft > -(maxScroll - 1));
    }

    update();
    el.addEventListener("scroll", update, { passive: true });

    // jsdom (unit tests) has no ResizeObserver -- the fades simply stay
    // hidden there (both dimensions read 0), never a crash.
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(update);
      resizeObserver.observe(el);
    }

    return () => {
      el.removeEventListener("scroll", update);
      resizeObserver?.disconnect();
    };
  }, []);

  // Cleanup on unmount -- never leaks the pulse timeout or a pending
  // scroll-settle listener/fallback timer if the page navigates away
  // mid-animation.
  useEffect(() => {
    return () => {
      window.clearTimeout(pulseTimeoutRef.current);
      settleCleanupRef.current?.();
    };
  }, []);

  const startPulse = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    el.classList.remove(LOCATING_SELF_CLASS);
    // Force a reflow between remove/add so a rapid repeat click restarts
    // the CSS animation from 0% instead of a no-op re-add of an
    // already-present class (a class toggle alone doesn't restart a
    // running CSS animation).
    void el.offsetWidth;
    el.classList.add(LOCATING_SELF_CLASS);
    window.clearTimeout(pulseTimeoutRef.current);
    pulseTimeoutRef.current = window.setTimeout(() => {
      el.classList.remove(LOCATING_SELF_CLASS);
    }, PULSE_DURATION_MS);
  }, []);

  const locate = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const target = viewport.querySelector<HTMLElement>(SELF_HEADER_SELECTOR);
    if (!target) return;

    // Cancel any pending settle-wait from a previous, still-in-flight click.
    settleCleanupRef.current?.();
    settleCleanupRef.current = undefined;

    const reduced = prefersReducedMotion();
    const alreadyVisible = isSufficientlyVisible(target, viewport);

    if (alreadyVisible || reduced) {
      if (!alreadyVisible && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
      }
      startPulse();
      return;
    }

    let settled = false;
    function cleanup() {
      viewport?.removeEventListener("scrollend", onSettle);
      window.clearTimeout(fallbackId);
      settleCleanupRef.current = undefined;
    }
    function onSettle() {
      if (settled) return;
      settled = true;
      cleanup();
      startPulse();
    }
    viewport.addEventListener("scrollend", onSettle, { once: true });
    const fallbackId = window.setTimeout(onSettle, SCROLL_SETTLE_FALLBACK_MS);
    settleCleanupRef.current = cleanup;

    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    } else {
      onSettle();
    }
  }, [startPulse]);

  return (
    <div className="flex flex-col gap-1.5">
      {enableFindMe ? (
        <button
          type="button"
          onClick={locate}
          className="inline-flex w-fit items-center gap-1 self-start rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Locate aria-hidden="true" className="size-3.5 text-primary" />
          איפה אני?
        </button>
      ) : null}
      {/* `overflow-hidden` here (not just `min-w-0`) is load-bearing, not
          decorative: this wrapper is a flex item inside the page's own
          `flex flex-col` shell, and a wide table inside only gets clipped by
          ITS OWN `overflow-auto` region once the boundary between "clipped
          content" and "flex-sized box" sits on an element whose own overflow
          is non-`visible` -- otherwise the flex layout keeps sizing this
          wrapper to the table's full min-content width and the whole PAGE
          grows horizontally instead of just this one region scrolling
          (verified in a real browser: dropping `overflow-hidden` here
          reproduces exactly that page-level horizontal overflow on a narrow
          viewport with a wide roster). */}
      <div className="relative min-w-0 overflow-hidden">
        <div ref={viewportRef} role="region" aria-label={ariaLabel} tabIndex={0} className={className}>
          {children}
        </div>
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 right-0 w-6 rounded-e-xl bg-gradient-to-l from-surface-1 to-transparent transition-opacity duration-150 motion-reduce:transition-none ${
            showStartFade ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 left-0 w-6 rounded-s-xl bg-gradient-to-r from-surface-1 to-transparent transition-opacity duration-150 motion-reduce:transition-none ${
            showEndFade ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
    </div>
  );
}
