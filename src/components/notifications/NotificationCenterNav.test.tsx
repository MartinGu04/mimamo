import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NotificationCenterNav } from "./NotificationCenterNav";

const linkStatus = { pending: false };
vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();
  return { ...actual, useLinkStatus: () => linkStatus };
});

afterEach(() => {
  cleanup();
  linkStatus.pending = false;
});

describe("NotificationCenterNav", () => {
  it("renders the four sections, in product order", () => {
    render(<NotificationCenterNav active="now" />);
    const nav = screen.getByRole("navigation", { name: "מקטעי מרכז התראות" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["עכשיו", "תזמון", "היסטוריה", "קבועות"]);
  });

  it("now is the omitted default -- its href is the bare /notifications", () => {
    render(<NotificationCenterNav active="now" />);
    expect(screen.getByRole("link", { name: "עכשיו" })).toHaveAttribute("href", "/notifications");
  });

  it("every other section links with an explicit ?section=", () => {
    render(<NotificationCenterNav active="now" />);
    expect(screen.getByRole("link", { name: "תזמון" })).toHaveAttribute("href", "/notifications?section=schedule");
    expect(screen.getByRole("link", { name: "היסטוריה" })).toHaveAttribute("href", "/notifications?section=history");
    expect(screen.getByRole("link", { name: "קבועות" })).toHaveAttribute("href", "/notifications?section=fixed");
  });

  it("marks only the active section as current, via aria-current -- never role=tab/aria-selected", () => {
    render(<NotificationCenterNav active="history" />);
    expect(screen.getByRole("link", { name: "היסטוריה" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "עכשיו" })).not.toHaveAttribute("aria-current");
  });

  it("never exposes a fake ARIA tablist -- this is a plain set of navigation links", () => {
    render(<NotificationCenterNav active="now" />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("every tab never wraps its own label -- whitespace-nowrap, shrink-0", () => {
    render(<NotificationCenterNav active="now" />);
    for (const name of ["עכשיו", "תזמון", "היסטוריה", "קבועות"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveClass("whitespace-nowrap");
      expect(link).toHaveClass("shrink-0");
    }
  });

  it("the nav wrapper allows horizontal scrolling when the strip overflows", () => {
    render(<NotificationCenterNav active="now" />);
    expect(screen.getByRole("navigation", { name: "מקטעי מרכז התראות" })).toHaveClass("overflow-x-auto");
  });

  it("a click immediately enters pending state via TabLink's own pending-navigation feedback", () => {
    linkStatus.pending = true;
    const { container } = render(<NotificationCenterNav active="now" />);
    expect(screen.getByRole("link", { name: "תזמון" })).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("clicking an already-pending tab does not fire a second, redundant navigation", () => {
    linkStatus.pending = true;
    render(<NotificationCenterNav active="now" />);
    const notPrevented = fireEvent.click(screen.getByRole("link", { name: "תזמון" }));
    expect(notPrevented).toBe(false);
  });
});
