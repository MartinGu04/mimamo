import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DischargeViewToggle } from "./DischargeViewToggle";

const linkStatus = { pending: false };
vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();
  return { ...actual, useLinkStatus: () => linkStatus };
});

afterEach(() => {
  cleanup();
  linkStatus.pending = false;
});

describe("DischargeViewToggle", () => {
  it("links to the correct hrefs", () => {
    render(<DischargeViewToggle active="personal" />);
    expect(screen.getByRole("link", { name: "אישי" })).toHaveAttribute("href", "/countdown");
    expect(screen.getByRole("link", { name: "כולם" })).toHaveAttribute("href", "/countdown?view=everyone");
  });

  it("marks 'אישי' as current via aria-current when active -- never role=tab/aria-selected", () => {
    render(<DischargeViewToggle active="personal" />);
    expect(screen.getByRole("link", { name: "אישי" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "כולם" })).not.toHaveAttribute("aria-current");
  });

  it("marks 'כולם' as current when active", () => {
    render(<DischargeViewToggle active="everyone" />);
    expect(screen.getByRole("link", { name: "כולם" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "אישי" })).not.toHaveAttribute("aria-current");
  });

  it("is exposed as a real navigation landmark, not a fake ARIA tablist with no keyboard model", () => {
    render(<DischargeViewToggle active="personal" />);
    expect(screen.getByRole("navigation", { name: "מצב תצוגה" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });
});

describe("DischargeViewToggle -- pending navigation feedback", () => {
  it("a click immediately enters pending state via TabLink's own pending-navigation feedback", () => {
    linkStatus.pending = true;
    const { container } = render(<DischargeViewToggle active="personal" />);
    expect(screen.getByRole("link", { name: "כולם" })).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("clicking an already-pending destination does not fire a second, redundant navigation", () => {
    linkStatus.pending = true;
    render(<DischargeViewToggle active="personal" />);
    const notPrevented = fireEvent.click(screen.getByRole("link", { name: "כולם" }));
    expect(notPrevented).toBe(false);
  });
});
