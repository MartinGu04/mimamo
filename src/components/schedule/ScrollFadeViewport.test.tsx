import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScrollFadeViewport } from "./ScrollFadeViewport";

const SELF_HEADER_SELECTOR = '[data-team-week-self-header="true"]';

function rect(left: number, right: number): DOMRect {
  return {
    x: left,
    y: 0,
    width: right - left,
    height: 30,
    top: 0,
    bottom: 30,
    left,
    right,
    toJSON: () => ({}),
  } as DOMRect;
}

function renderViewport(enableFindMe = true) {
  const utils = render(
    <ScrollFadeViewport ariaLabel="לוח בדיקה" className="viewport" enableFindMe={enableFindMe}>
      <table>
        <thead>
          <tr>
            <th data-team-week-self-header="true">עצמי</th>
            <th>אחר</th>
          </tr>
        </thead>
      </table>
    </ScrollFadeViewport>,
  );
  const viewport = screen.getByRole("region", { name: "לוח בדיקה" });
  const target = viewport.querySelector<HTMLElement>(SELF_HEADER_SELECTOR)!;
  return { ...utils, viewport, target };
}

describe("ScrollFadeViewport — 'איפה אני?' Find Me (15-18, 22)", () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView -- a plain no-op prototype
    // stub makes `typeof target.scrollIntoView === "function"` true so
    // `locate()`'s real branch runs; each test then spies on the specific
    // element(s) it cares about via `vi.spyOn`, so calls on the viewport
    // and the target are tracked independently rather than sharing one
    // prototype-level mock.
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = function scrollIntoView() {};
    }
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("12/15. does not render the control at all when Find Me is disabled -- and, when enabled, clicking it scrolls the viewer's own header cell specifically, RTL-safe (inline: center), never the viewport or another element", () => {
    const { rerender } = render(
      <ScrollFadeViewport ariaLabel="לוח בדיקה" className="viewport" enableFindMe={false}>
        <table>
          <thead>
            <tr>
              <th data-team-week-self-header="true">עצמי</th>
            </tr>
          </thead>
        </table>
      </ScrollFadeViewport>,
    );
    expect(screen.queryByRole("button", { name: /איפה אני/ })).toBeNull();

    rerender(
      <ScrollFadeViewport ariaLabel="לוח בדיקה" className="viewport" enableFindMe>
        <table>
          <thead>
            <tr>
              <th data-team-week-self-header="true">עצמי</th>
            </tr>
          </thead>
        </table>
      </ScrollFadeViewport>,
    );
    const viewport = screen.getByRole("region", { name: "לוח בדיקה" });
    const target = viewport.querySelector<HTMLElement>(SELF_HEADER_SELECTOR)!;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(rect(0, 300));
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect(400, 500)); // outside the viewport -> needs a scroll
    const targetScrollIntoView = vi.spyOn(target, "scrollIntoView");
    const viewportScrollIntoView = vi.spyOn(viewport, "scrollIntoView");

    fireEvent.click(screen.getByRole("button", { name: /איפה אני/ }));

    expect(targetScrollIntoView).toHaveBeenCalledTimes(1);
    expect(targetScrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth", inline: "center", block: "nearest" }),
    );
    expect(viewportScrollIntoView).not.toHaveBeenCalled();
  });

  it("16. an already-visible target does not unnecessarily reposition -- scrollIntoView is skipped and the highlight starts immediately", () => {
    const { viewport, target } = renderViewport();
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(rect(0, 300));
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect(50, 150)); // fully inside
    const targetScrollIntoView = vi.spyOn(target, "scrollIntoView");

    fireEvent.click(screen.getByRole("button", { name: /איפה אני/ }));

    expect(targetScrollIntoView).not.toHaveBeenCalled();
    expect(viewport.classList.contains("team-week-locating-self")).toBe(true);
  });

  it("17. repeated Find Me clicks restart the highlight instead of leaving it to expire on the first click's timer", () => {
    vi.useFakeTimers();
    const { viewport, target } = renderViewport();
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(rect(0, 300));
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect(50, 150)); // already visible -> pulse starts synchronously

    fireEvent.click(screen.getByRole("button", { name: /איפה אני/ }));
    expect(viewport.classList.contains("team-week-locating-self")).toBe(true);

    // Most of the way through the first click's pulse window.
    vi.advanceTimersByTime(1800);
    expect(viewport.classList.contains("team-week-locating-self")).toBe(true);

    // A second click restarts the timer -- advancing by the SAME remaining
    // amount the first click's timer would have needed must NOT clear the
    // class, because the second click reset the countdown.
    fireEvent.click(screen.getByRole("button", { name: /איפה אני/ }));
    vi.advanceTimersByTime(1800);
    expect(viewport.classList.contains("team-week-locating-self")).toBe(true);

    // Now let the SECOND click's own full timer elapse.
    vi.advanceTimersByTime(400);
    expect(viewport.classList.contains("team-week-locating-self")).toBe(false);
  });

  it("18. no pulse timer or scroll-settle listener leaks past unmount", () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const { viewport, target, unmount } = renderViewport();
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(rect(0, 300));
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rect(400, 500)); // not visible -> schedules a settle-fallback timer

    fireEvent.click(screen.getByRole("button", { name: /איפה אני/ }));
    const callsBeforeUnmount = clearTimeoutSpy.mock.calls.length;

    unmount();

    // Unmount cleanup must clear the pending settle-fallback timer (and, if
    // a pulse had already started, its own timer too) -- never left to fire
    // against a detached element.
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(callsBeforeUnmount);

    // Advancing timers past every deadline after unmount must not throw --
    // proof nothing still-scheduled reaches into the unmounted component.
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });

  it("22. the existing scroll-fade listener keeps reacting on the same viewport element Find Me scrolls -- no stale fade state", () => {
    const { viewport } = renderViewport();

    Object.defineProperty(viewport, "scrollWidth", { value: 1000, configurable: true });
    Object.defineProperty(viewport, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(viewport, "scrollLeft", { value: 0, configurable: true, writable: true });

    // The "start" (reading-start/rightmost) edge fade -- identified by its
    // own `right-0` class, distinct from the "end" fade's `left-0`.
    const startFade = () => viewport.parentElement?.querySelector(".right-0");

    fireEvent.scroll(viewport);
    // At the reading-start edge (RTL scrollLeft === 0), there's nothing
    // further to reveal in the start direction -- that fade stays hidden.
    expect(startFade()?.className).toContain("opacity-0");
    expect(startFade()?.className).not.toContain("opacity-100");

    // Simulate the viewport having scrolled (as a real scrollIntoView call
    // would do) -- the SAME scroll listener must still pick this up and
    // reveal the start fade now that there's content behind the start edge.
    Object.defineProperty(viewport, "scrollLeft", { value: -400, configurable: true, writable: true });
    fireEvent.scroll(viewport);

    expect(startFade()?.className).toContain("opacity-100");
  });
});
