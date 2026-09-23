import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScheduleEveryoneViewSwitch } from "./ScheduleEveryoneViewSwitch";

afterEach(() => {
  cleanup();
});

describe("ScheduleEveryoneViewSwitch", () => {
  it("renders both tabs with the given hrefs", () => {
    render(
      <ScheduleEveryoneViewSwitch
        activeView="month"
        monthHref="/schedule?person=all"
        teamWeekHref="/schedule?person=all&view=team-week"
      />,
    );
    expect(screen.getByRole("link", { name: "חודש" })).toHaveAttribute("href", "/schedule?person=all");
    expect(screen.getByRole("link", { name: "שבוע צוות" })).toHaveAttribute(
      "href",
      "/schedule?person=all&view=team-week",
    );
  });

  it("marks חודש current when activeView is 'month'", () => {
    render(<ScheduleEveryoneViewSwitch activeView="month" monthHref="/a" teamWeekHref="/b" />);
    expect(screen.getByRole("link", { name: "חודש" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "שבוע צוות" })).not.toHaveAttribute("aria-current");
  });

  it("marks שבוע צוות current when activeView is 'team-week'", () => {
    render(<ScheduleEveryoneViewSwitch activeView="team-week" monthHref="/a" teamWeekHref="/b" />);
    expect(screen.getByRole("link", { name: "שבוע צוות" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "חודש" })).not.toHaveAttribute("aria-current");
  });
});
