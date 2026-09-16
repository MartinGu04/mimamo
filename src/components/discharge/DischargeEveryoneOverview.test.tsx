import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { DischargeEveryoneOverview } from "./DischargeEveryoneOverview";
import type { DischargeCountdownPersonSummary } from "@/lib/readModels/dischargeCountdown";

afterEach(() => {
  cleanup();
});

/** A fixed "now" so every expectation below is deterministic. */
const NOW_MS = Date.parse("2026-09-16T09:00:00.000Z");
const DAY_MS = 86_400_000;

function summary(overrides: Partial<DischargeCountdownPersonSummary> = {}): DischargeCountdownPersonSummary {
  const discharge = NOW_MS + 100 * DAY_MS;
  return {
    personId: "p_1",
    personName: "דני בדיקה",
    dischargeDate: "2026-12-25",
    dischargeInstantIso: new Date(discharge).toISOString(),
    dischargeDayEndInstantIso: new Date(discharge + DAY_MS - 1).toISOString(),
    enlistmentInstantIso: new Date(NOW_MS - 300 * DAY_MS).toISOString(),
    ...overrides,
  };
}

describe("DischargeEveryoneOverview", () => {
  it("shows a message rather than an empty grid when nobody is listed", () => {
    render(<DischargeEveryoneOverview people={[]} nowMs={NOW_MS} />);
    expect(screen.getByText(/אין כרגע אנשי סדיר/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders one card per person, in the order given", () => {
    render(
      <DischargeEveryoneOverview
        people={[
          summary({ personId: "p_1", personName: "ראשון" }),
          summary({ personId: "p_2", personName: "שני" }),
        ]}
        nowMs={NOW_MS}
      />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("ראשון");
    expect(items[1]).toHaveTextContent("שני");
  });

  it("gives each card the name, days remaining, discharge date and service percentage", () => {
    render(<DischargeEveryoneOverview people={[summary()]} nowMs={NOW_MS} />);
    const card = screen.getByRole("listitem");

    expect(within(card).getByText("דני בדיקה")).toBeInTheDocument();
    expect(within(card).getByText("100")).toBeInTheDocument();
    expect(within(card).getByText(/25\.12\.2026/)).toBeInTheDocument();
    // 300 days served of 400 total.
    expect(within(card).getByText("75%")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  });

  it("links each card to that person's own countdown", () => {
    render(<DischargeEveryoneOverview people={[summary({ personId: "p_7" })]} nowMs={NOW_MS} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/countdown?view=everyone&person=p_7");
  });

  it("shows no live HH:MM:SS clock -- the overview is date-derived only", () => {
    render(<DischargeEveryoneOverview people={[summary()]} nowMs={NOW_MS} />);
    expect(screen.queryByTestId("discharge-clock")).toBeNull();
    expect(screen.getByRole("listitem").textContent).not.toMatch(/\d{2}\s*:\s*\d{2}/);
  });

  it("falls back to initials when there is no profile photo, which is every person here", () => {
    // כ"א carries no photos -- a profile photo only exists for the signed-in
    // user's own Supabase identity, so no card ever renders an <img>.
    render(<DischargeEveryoneOverview people={[summary({ personName: "דני בדיקה" })]} nowMs={NOW_MS} />);
    const card = screen.getByRole("listitem");
    expect(within(card).queryByRole("img")).toBeNull();
    expect(card.textContent).toContain("דב");
  });

  describe("edge cases", () => {
    it("says so for a person with no discharge date, and shows no progress bar", () => {
      render(
        <DischargeEveryoneOverview
          people={[
            summary({ dischargeDate: null, dischargeInstantIso: null, dischargeDayEndInstantIso: null }),
          ]}
          nowMs={NOW_MS}
        />,
      );
      const card = screen.getByRole("listitem");
      expect(within(card).getByText("אין תאריך שחרור")).toBeInTheDocument();
      expect(within(card).queryByRole("progressbar")).toBeNull();
    });

    it("marks a discharge happening today", () => {
      const start = NOW_MS - 3 * 3_600_000;
      render(
        <DischargeEveryoneOverview
          people={[
            summary({
              dischargeInstantIso: new Date(start).toISOString(),
              dischargeDayEndInstantIso: new Date(start + DAY_MS - 1).toISOString(),
            }),
          ]}
          nowMs={NOW_MS}
        />,
      );
      expect(screen.getByText("היום!")).toBeInTheDocument();
    });

    it("handles a discharge date that has already passed", () => {
      const past = NOW_MS - 10 * DAY_MS;
      render(
        <DischargeEveryoneOverview
          people={[
            summary({
              dischargeInstantIso: new Date(past).toISOString(),
              dischargeDayEndInstantIso: new Date(past + DAY_MS - 1).toISOString(),
            }),
          ]}
          nowMs={NOW_MS}
        />,
      );
      const card = screen.getByRole("listitem");
      expect(card).toHaveTextContent(/השתחרר\/ה/);
      expect(card).toHaveTextContent(/10 ימים/);
    });

    it("still renders a person with a discharge date but no enlistment date, just without a percentage", () => {
      render(<DischargeEveryoneOverview people={[summary({ enlistmentInstantIso: null })]} nowMs={NOW_MS} />);
      const card = screen.getByRole("listitem");
      expect(within(card).getByText("100")).toBeInTheDocument();
      expect(within(card).queryByRole("progressbar")).toBeNull();
    });
  });

  describe("responsive layout", () => {
    it("stacks to a single column on mobile and only widens on larger screens", () => {
      // The one-column base is what keeps narrow screens free of horizontal
      // scrolling; the extra columns are opt-in at sm/xl.
      render(<DischargeEveryoneOverview people={[summary()]} nowMs={NOW_MS} />);
      const list = screen.getByRole("list");
      expect(list.className).toContain("grid-cols-1");
      expect(list.className).toContain("sm:grid-cols-2");
      expect(list.className).toContain("xl:grid-cols-3");
    });

    it("truncates a long name instead of letting the card grow sideways", () => {
      render(
        <DischargeEveryoneOverview
          people={[summary({ personName: "שם ארוך במיוחד שלא אמור לדחוף את הכרטיס לרוחב" })]}
          nowMs={NOW_MS}
        />,
      );
      const name = screen.getByText(/שם ארוך במיוחד/);
      expect(name.className).toContain("truncate");
      expect(name.closest("div")?.className).toContain("min-w-0");
    });
  });
});
