import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScheduleHeader } from "./ScheduleHeader";

afterEach(() => {
  cleanup();
});

describe("ScheduleHeader", () => {
  it("shows the page title and the month label", () => {
    render(<ScheduleHeader monthLabel="אוגוסט 2026" monthRangeSubtitle="אב–אלול תשפ״ו" />);
    expect(screen.getByRole("heading", { name: "הלוח שלי" })).toBeInTheDocument();
    expect(screen.getByText("אוגוסט 2026")).toBeInTheDocument();
    expect(screen.getByText("אב–אלול תשפ״ו")).toBeInTheDocument();
  });

  it("omits the Hebrew-calendar subtitle when not cleanly derivable", () => {
    render(<ScheduleHeader monthLabel="ספטמבר 2026" monthRangeSubtitle={null} />);
    expect(screen.getByText("ספטמבר 2026")).toBeInTheDocument();
    expect(screen.queryByText("–")).toBeNull();
  });

  it("keeps the page title as the strongest line", () => {
    render(<ScheduleHeader monthLabel="אוגוסט 2026" monthRangeSubtitle={null} />);
    const heading = screen.getByRole("heading", { name: "הלוח שלי" });
    expect(heading.tagName).toBe("H1");
  });

  it("always renders the subtitle line's own paragraph, even with no range -- never a collapsed height (PR #38 follow-up: calendar-jump fix)", () => {
    const { container } = render(<ScheduleHeader monthLabel="ספטמבר 2026" monthRangeSubtitle={null} />);
    // The subtitle <p> (month label's next sibling) still exists in the DOM
    // and still has visible whitespace content -- an empty/collapsed <p>
    // (or a conditionally-omitted one) is exactly what shifted every
    // element below it, including the calendar, month to month.
    const subtitle = container.querySelector("h1 + p + p");
    expect(subtitle).not.toBeNull();
    expect(subtitle?.textContent).toMatch(/^\s+$/);
    expect(subtitle?.textContent?.trim()).toBe("");
    expect(subtitle).toHaveAttribute("aria-hidden", "true");
  });

  it("marks the subtitle as NOT aria-hidden when it has real content", () => {
    const { container } = render(<ScheduleHeader monthLabel="אוגוסט 2026" monthRangeSubtitle="אב–אלול תשפ״ו" />);
    const subtitle = container.querySelector("h1 + p + p");
    expect(subtitle).not.toHaveAttribute("aria-hidden");
  });

  it("renders a contextual title override -- e.g. 'לוח הצוות' for the team month, or 'צוות השבוע' for Team Week -- instead of the default 'הלוח שלי'", () => {
    render(<ScheduleHeader title="לוח הצוות" monthLabel="אוגוסט 2026" monthRangeSubtitle={null} />);
    expect(screen.getByRole("heading", { name: "לוח הצוות" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "הלוח שלי" })).toBeNull();
  });
});
