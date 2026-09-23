import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TeamWeekNav } from "./TeamWeekNav";

afterEach(() => {
  cleanup();
});

describe("TeamWeekNav", () => {
  it("renders the week label, and prev/next/today links with the given hrefs", () => {
    render(
      <TeamWeekNav
        prevHref="/schedule?person=all&view=team-week&week=2026-08-02"
        nextHref="/schedule?person=all&view=team-week&week=2026-08-16"
        todayHref="/schedule?person=all&view=team-week"
        isOnCurrentWeek={false}
        weekLabel="9–15 באוגוסט 2026"
      />,
    );
    expect(screen.getByText("9–15 באוגוסט 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "שבוע קודם" })).toHaveAttribute(
      "href",
      "/schedule?person=all&view=team-week&week=2026-08-02",
    );
    expect(screen.getByRole("link", { name: "שבוע הבא" })).toHaveAttribute(
      "href",
      "/schedule?person=all&view=team-week&week=2026-08-16",
    );
    expect(screen.getByRole("link", { name: "היום" })).toHaveAttribute("href", "/schedule?person=all&view=team-week");
  });

  it("marks the היום pill as the current selection only when isOnCurrentWeek", () => {
    render(
      <TeamWeekNav
        prevHref="/a"
        nextHref="/b"
        todayHref="/c"
        isOnCurrentWeek={true}
        weekLabel="9–15 באוגוסט 2026"
      />,
    );
    expect(screen.getByRole("link", { name: "היום" })).toHaveAttribute("aria-current", "date");
  });

  it("does not mark היום as current when viewing a different week", () => {
    render(<TeamWeekNav prevHref="/a" nextHref="/b" todayHref="/c" isOnCurrentWeek={false} weekLabel="16–22 באוגוסט 2026" />);
    expect(screen.getByRole("link", { name: "היום" })).not.toHaveAttribute("aria-current");
  });
});
