"use client";

import { useEffect, useRef, useState } from "react";

interface ScrollFadeViewportProps {
  ariaLabel: string;
  className: string;
  children: React.ReactNode;
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
 */
export function ScrollFadeViewport({ ariaLabel, className, children }: ScrollFadeViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [showStartFade, setShowStartFade] = useState(false);
  const [showEndFade, setShowEndFade] = useState(false);

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

  return (
    // `overflow-hidden` here (not just `min-w-0`) is load-bearing, not
    // decorative: this wrapper is a flex item inside the page's own
    // `flex flex-col` shell, and a wide table inside only gets clipped by
    // ITS OWN `overflow-auto` region once the boundary between "clipped
    // content" and "flex-sized box" sits on an element whose own overflow
    // is non-`visible` -- otherwise the flex layout keeps sizing this
    // wrapper to the table's full min-content width and the whole PAGE
    // grows horizontally instead of just this one region scrolling
    // (verified in a real browser: dropping `overflow-hidden` here
    // reproduces exactly that page-level horizontal overflow on a narrow
    // viewport with a wide roster).
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
  );
}
