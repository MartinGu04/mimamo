import { Suspense, type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Fresh module instance each call -- resets the module-scoped "already scrolled this page load" flag, simulating a genuinely new page load/relaunch. */
async function loadFreshModule() {
  return import("./ScrollHomeToTopOnContentReady");
}

describe("ScrollHomeToTopOnContentReady", () => {
  it("scrolls to the top on mount -- this only ever happens once the real resolved content exists (see docstring: it's rendered inside the Suspense-resolved page content, never the loading fallback)", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnContentReady } = await loadFreshModule();

    render(<ScrollHomeToTopOnContentReady />);

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("re-asserts once more via requestAnimationFrame, to beat a browser scroll-anchoring/restoration pass landing in the same or next paint", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    let rafCallback: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallback = cb;
      return 1;
    });
    const { ScrollHomeToTopOnContentReady } = await loadFreshModule();

    render(<ScrollHomeToTopOnContentReady />);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    expect(rafCallback).not.toBeNull();
    rafCallback!(0);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("cancels the scheduled requestAnimationFrame re-assertion on unmount -- navigating away before the next frame must never deliver a delayed scrollTo to whatever page the user is on by then", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", () => 42);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const { ScrollHomeToTopOnContentReady } = await loadFreshModule();

    const { unmount } = render(<ScrollHomeToTopOnContentReady />);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    unmount();

    // The real browser API guarantees a cancelled id's callback never
    // fires -- asserting the cancellation call itself (with the exact id
    // requestAnimationFrame returned) is what proves this component asks
    // for that guarantee, rather than leaving the frame to fire unchecked.
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("does NOT scroll again on a later remount within the SAME page load (an in-app Link/back-button return to Home, which also mounts fresh resolved content on this force-dynamic route)", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnContentReady } = await loadFreshModule();

    const first = render(<ScrollHomeToTopOnContentReady />);
    first.unmount();
    render(<ScrollHomeToTopOnContentReady />);

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("scrolls to the top again after a genuinely fresh page load (a new module instance)", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const first = await loadFreshModule();
    render(<first.ScrollHomeToTopOnContentReady />);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    vi.resetModules();
    const second = await loadFreshModule();
    render(<second.ScrollHomeToTopOnContentReady />);

    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("renders nothing", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { ScrollHomeToTopOnContentReady } = await loadFreshModule();

    const { container } = render(<ScrollHomeToTopOnContentReady />);

    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * Models the ACTUAL bug report end-to-end: `/` renders `loading.tsx` at the
 * top, then the real resolved Home content replaces it -- via a real React
 * `Suspense` boundary and a genuinely suspending child, the same mechanism
 * Next.js's own `loading.tsx` convention is built on (a Suspense boundary
 * around the page, with the route's `loading.tsx` as its `fallback`). This
 * is deliberately NOT just another mount/remount test: it exercises the
 * actual fallback -> resolved-content SWAP, the exact sequence the reported
 * failure mode depends on (a scroll reset that fires only while the
 * fallback is showing is too early to fix it).
 */
describe("ScrollHomeToTopOnContentReady -- the real loading.tsx -> resolved-content swap", () => {
  function createSuspender() {
    let resolveFn!: () => void;
    let status: "pending" | "done" = "pending";
    const promise = new Promise<void>((resolve) => {
      resolveFn = () => {
        status = "done";
        resolve();
      };
    });
    return {
      resolve: resolveFn,
      read() {
        if (status === "pending") throw promise;
      },
    };
  }

  function FakeLoadingSkeleton() {
    return <div>LOADING SKELETON</div>;
  }

  /** `Marker` is passed in per-test as a freshly (re-)imported module reference -- see each test's own `vi.resetModules()` + dynamic import -- so this component never hardcodes a stale, already-fired module instance across tests. */
  function FakeHomeContent({
    resource,
    Marker,
  }: {
    resource: ReturnType<typeof createSuspender>;
    Marker: ComponentType;
  }) {
    resource.read();
    return (
      <>
        <Marker />
        <div>REAL HOME CONTENT</div>
      </>
    );
  }

  it("never scrolls while only the loading fallback is showing, then scrolls to the top the moment the real content replaces it", async () => {
    vi.resetModules();
    const { ScrollHomeToTopOnContentReady } = await import("./ScrollHomeToTopOnContentReady");
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const resource = createSuspender();

    render(
      <Suspense fallback={<FakeLoadingSkeleton />}>
        <FakeHomeContent resource={resource} Marker={ScrollHomeToTopOnContentReady} />
      </Suspense>,
    );

    // Still on the fallback -- the marker isn't even in the tree yet, so it
    // must be impossible for it to have scrolled anything.
    expect(screen.getByText("LOADING SKELETON")).toBeInTheDocument();
    expect(screen.queryByText("REAL HOME CONTENT")).toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();

    // The real content resolves and replaces the fallback in one commit.
    await act(async () => {
      resource.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("REAL HOME CONTENT")).toBeInTheDocument();
    expect(screen.queryByText("LOADING SKELETON")).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("even if a scroll offset was set WHILE the fallback was showing (simulating a browser restoring an old position early), the resolved content still ends at the top", async () => {
    vi.resetModules();
    const { ScrollHomeToTopOnContentReady } = await import("./ScrollHomeToTopOnContentReady");
    const scrollValues: number[] = [];
    vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
      const y = typeof args[0] === "object" && args[0] !== null ? (args[0] as { top?: number }).top : args[1];
      if (typeof y === "number") scrollValues.push(y);
    });
    const resource = createSuspender();

    render(
      <Suspense fallback={<FakeLoadingSkeleton />}>
        <FakeHomeContent resource={resource} Marker={ScrollHomeToTopOnContentReady} />
      </Suspense>,
    );

    // A restoration landing while only the fallback exists -- irrelevant to
    // the user experience (nothing real is visible yet), but included to
    // show the later reset isn't merely "the first call ever".
    window.scrollTo(0, 1200);

    await act(async () => {
      resource.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("REAL HOME CONTENT")).toBeInTheDocument();
    expect(scrollValues.at(-1)).toBe(0);
  });
});
