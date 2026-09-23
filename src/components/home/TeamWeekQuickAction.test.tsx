import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamWeekQuickAction } from "./TeamWeekQuickAction";

afterEach(() => {
  cleanup();
});

describe("TeamWeekQuickAction", () => {
  it("renders a one-click 'צוות השבוע' link", () => {
    render(<TeamWeekQuickAction />);
    expect(screen.getByRole("link", { name: /צוות השבוע/ })).toBeInTheDocument();
  });

  it("its href is exactly the canonical current Team Week route -- /schedule?person=all&view=team-week, no week= anchor", () => {
    render(<TeamWeekQuickAction />);
    expect(screen.getByRole("link", { name: /צוות השבוע/ })).toHaveAttribute(
      "href",
      "/schedule?person=all&view=team-week",
    );
  });

  it("is a single whole-card link, not a nested control -- no manager/role prop gates it", () => {
    render(<TeamWeekQuickAction />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
