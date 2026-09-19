import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TabLink } from "./TabLink";

const linkStatus = { pending: false };
vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();
  return { ...actual, useLinkStatus: () => linkStatus };
});

afterEach(() => {
  cleanup();
  linkStatus.pending = false;
});

describe("TabLink -- native-navigation semantics, not a fake ARIA tab", () => {
  it("renders as a plain link with the destination's href", () => {
    render(
      <TabLink href="/manager?category=shifts" isActive={false} className="">
        משמרות
      </TabLink>,
    );
    expect(screen.getByRole("link", { name: "משמרות" })).toHaveAttribute("href", "/manager?category=shifts");
  });

  it("marks the active item with aria-current='page'", () => {
    render(
      <TabLink href="/manager" isActive className="">
        סקירה
      </TabLink>,
    );
    expect(screen.getByRole("link", { name: "סקירה" })).toHaveAttribute("aria-current", "page");
  });

  it("carries no aria-current at all when inactive -- never aria-current='false'", () => {
    render(
      <TabLink href="/manager" isActive={false} className="">
        סקירה
      </TabLink>,
    );
    expect(screen.getByRole("link", { name: "סקירה" })).not.toHaveAttribute("aria-current");
  });

  it("REGRESSION: never exposes role='tab' or aria-selected -- this is a real navigation link, not an ARIA tab with an unimplemented keyboard model", () => {
    render(
      <TabLink href="/manager" isActive className="">
        סקירה
      </TabLink>,
    );
    const link = screen.getByRole("link", { name: "סקירה" });
    expect(link).not.toHaveAttribute("role", "tab");
    expect(link).not.toHaveAttribute("aria-selected");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("a non-pending link is not aria-busy and shows no spinner", () => {
    const { container } = render(
      <TabLink href="/manager" isActive={false} className="">
        סקירה
      </TabLink>,
    );
    expect(screen.getByRole("link", { name: "סקירה" })).toHaveAttribute("aria-busy", "false");
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("a click immediately enters pending state: aria-busy flips and a spinner shows, label stays visible", () => {
    linkStatus.pending = true;
    const { container } = render(
      <TabLink href="/manager" isActive={false} className="">
        סקירה
      </TabLink>,
    );
    const link = screen.getByRole("link", { name: "סקירה" });
    expect(link).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(link).toHaveTextContent("סקירה");
  });

  it("clicking an already-pending link does not fire a second, redundant navigation", () => {
    linkStatus.pending = true;
    render(
      <TabLink href="/manager" isActive={false} className="">
        סקירה
      </TabLink>,
    );
    const notPrevented = fireEvent.click(screen.getByRole("link", { name: "סקירה" }));
    expect(notPrevented).toBe(false);
  });
});
