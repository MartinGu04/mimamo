import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // `ScrollHomeToTopOnLaunch` tracks "already scrolled" in module-scoped
  // state (see its own docstring) -- reset the module registry between
  // tests so each one observes a fresh "first mount this page load".
  vi.resetModules();
});

describe("DashboardLayout (the (dashboard) route group -- maps to '/' only)", () => {
  it("renders its children", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { default: DashboardLayout } = await import("./layout");

    render(
      <DashboardLayout>
        <div>תוכן הבית</div>
      </DashboardLayout>,
    );

    expect(screen.getByText("תוכן הבית")).toBeInTheDocument();
  });

  it("mounts ScrollHomeToTopOnLaunch -- Home opens at the top on a fresh page load", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { default: DashboardLayout } = await import("./layout");

    render(
      <DashboardLayout>
        <div>תוכן הבית</div>
      </DashboardLayout>,
    );

    expect(scrollTo).toHaveBeenCalledWith(0, 0);
  });
});
