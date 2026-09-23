import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SchedulePerspectiveSwitch } from "./SchedulePerspectiveSwitch";

afterEach(() => {
  cleanup();
});

describe("SchedulePerspectiveSwitch — 7. non-manager שלי | כולם switch", () => {
  it("renders both tabs with the given hrefs", () => {
    render(<SchedulePerspectiveSwitch activePerspective="self" selfHref="/schedule" allHref="/schedule?person=all" />);
    expect(screen.getByRole("link", { name: "שלי" })).toHaveAttribute("href", "/schedule");
    expect(screen.getByRole("link", { name: "כולם" })).toHaveAttribute("href", "/schedule?person=all");
  });

  it("marks שלי current when activePerspective is 'self'", () => {
    render(<SchedulePerspectiveSwitch activePerspective="self" selfHref="/a" allHref="/b" />);
    expect(screen.getByRole("link", { name: "שלי" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "כולם" })).not.toHaveAttribute("aria-current");
  });

  it("marks כולם current when activePerspective is 'all'", () => {
    render(<SchedulePerspectiveSwitch activePerspective="all" selfHref="/a" allHref="/b" />);
    expect(screen.getByRole("link", { name: "כולם" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "שלי" })).not.toHaveAttribute("aria-current");
  });
});
