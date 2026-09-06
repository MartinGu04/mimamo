import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
});

/** Fresh module instance each call -- resets the module-scoped "already scrolled this page load" flag, simulating a genuinely new page load/relaunch. */
async function loadFreshModule() {
  return import("./ScrollHomeToTopOnLaunch");
}

describe("ScrollHomeToTopOnLaunch", () => {
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
