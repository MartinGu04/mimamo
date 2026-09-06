import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Fresh module instance each call -- resets the module-scoped "already scrolled this page load" flag, simulating a genuinely new page load/relaunch. */
async function loadFreshModule() {
  return import("./ScrollHomeToTopOnLaunch");
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, writable: true, configurable: true });
}

function fireVisibilityChange() {
  document.dispatchEvent(new Event("visibilitychange"));
}

/** A genuine BFCache-restore pageshow -- `event.persisted === true`, the SAME iOS/WebKit resume signal `AppRevalidator` already relies on. */
function firePersistedPageShow() {
  const event = new Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true, configurable: true });
  window.dispatchEvent(event);
}

/** An ordinary (non-BFCache) pageshow, as fires on every normal navigation/first paint. */
function fireOrdinaryPageShow() {
  window.dispatchEvent(new Event("pageshow"));
}

/** jsdom's `History` never implements `scrollRestoration` at all (no getter/setter exists until something defines it) -- this stubs it present with a given starting value, matching every real browser's default `"auto"`. */
function stubScrollRestoration(initial: "auto" | "manual") {
  let value: string = initial;
  Object.defineProperty(window.history, "scrollRestoration", {
    configurable: true,
    get: () => value,
    set: (next: string) => {
      value = next;
    },
  });
}

describe("ScrollHomeToTopOnLaunch -- fresh page load", () => {
  it("scrolls to the top exactly once on the first mount of a fresh page load", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnLaunch } = await loadFreshModule();

    render(<ScrollHomeToTopOnLaunch />);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("does NOT scroll again on a later remount within the SAME page load (an in-app Link/back-button return to Home)", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnLaunch } = await loadFreshModule();

    const first = render(<ScrollHomeToTopOnLaunch />);
    first.unmount();
    render(<ScrollHomeToTopOnLaunch />);

    // A later in-app navigation back to Home must never re-trigger the
    // forced reset -- that would fight Next.js's own normal navigation/back
    // scroll behavior and could destroy a user's current reading position.
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("scrolls to the top again after a genuinely fresh page load (a new module instance)", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const first = await loadFreshModule();
    render(<first.ScrollHomeToTopOnLaunch />);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    vi.resetModules();
    const second = await loadFreshModule();
    render(<second.ScrollHomeToTopOnLaunch />);

    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("renders nothing", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnLaunch } = await loadFreshModule();

    const { container } = render(<ScrollHomeToTopOnLaunch />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("ScrollHomeToTopOnLaunch -- iOS standalone PWA resume (the actual real-device bug)", () => {
  it("scrolls to the top when the document becomes visible again, WITHOUT any new mount -- the real iOS relaunch-from-Home-Screen case, which resumes the existing session instead of reloading", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnLaunch } = await loadFreshModule();
    render(<ScrollHomeToTopOnLaunch />);
    scrollTo.mockClear(); // isolate the resume call from the initial-mount call

    setVisibility("visible");
    act(() => fireVisibilityChange());

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("does nothing when visibility changes to hidden (only a return to visible resets scroll)", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnLaunch } = await loadFreshModule();
    render(<ScrollHomeToTopOnLaunch />);
    scrollTo.mockClear();

    setVisibility("hidden");
    act(() => fireVisibilityChange());

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls to the top on a genuine BFCache pageshow restore (event.persisted === true)", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnLaunch } = await loadFreshModule();
    render(<ScrollHomeToTopOnLaunch />);
    scrollTo.mockClear();

    act(() => firePersistedPageShow());

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("ignores an ORDINARY (non-BFCache) pageshow -- never double-fires on a normal first paint", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnLaunch } = await loadFreshModule();
    render(<ScrollHomeToTopOnLaunch />);
    scrollTo.mockClear();

    act(() => fireOrdinaryPageShow());

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("resets scroll on EVERY resume while the user stays on Home -- deliberately NOT a once-per-page-load guard, unlike the mount-time reset", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnLaunch } = await loadFreshModule();
    render(<ScrollHomeToTopOnLaunch />);
    scrollTo.mockClear();

    setVisibility("visible");
    act(() => fireVisibilityChange());
    act(() => fireVisibilityChange());
    act(() => firePersistedPageShow());

    expect(scrollTo).toHaveBeenCalledTimes(3);
  });

  it("stops listening once unmounted -- no further forced resets after leaving Home", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnLaunch } = await loadFreshModule();
    const { unmount } = render(<ScrollHomeToTopOnLaunch />);
    scrollTo.mockClear();
    unmount();

    setVisibility("visible");
    act(() => fireVisibilityChange());
    act(() => firePersistedPageShow());

    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("ScrollHomeToTopOnLaunch -- history.scrollRestoration", () => {
  it("switches the browser's native scroll restoration to 'manual' while mounted, so WebKit/the browser can never silently re-impose a persisted scroll offset", async () => {
    stubScrollRestoration("auto");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnLaunch } = await loadFreshModule();

    render(<ScrollHomeToTopOnLaunch />);

    expect(window.history.scrollRestoration).toBe("manual");
  });

  it("restores the PREVIOUS scrollRestoration value on unmount -- a Home-only override, never a global one", async () => {
    stubScrollRestoration("auto");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnLaunch } = await loadFreshModule();

    const { unmount } = render(<ScrollHomeToTopOnLaunch />);
    expect(window.history.scrollRestoration).toBe("manual");
    unmount();

    expect(window.history.scrollRestoration).toBe("auto");
  });
});
