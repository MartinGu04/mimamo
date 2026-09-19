import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MonthNav } from "./MonthNav";

afterEach(() => {
  cleanup();
});

const BASE_PROPS = {
  prevHref: "/schedule?month=2026-07",
  nextHref: "/schedule?month=2026-09",
  todayHref: "/schedule",
  monthLabel: "אוגוסט 2026",
};

describe("MonthNav", () => {
  it("links to the correct prev/next/today hrefs", () => {
    render(<MonthNav {...BASE_PROPS} isOnCurrentMonth={false} />);
    expect(screen.getByRole("link", { name: "חודש קודם" })).toHaveAttribute("href", "/schedule?month=2026-07");
    expect(screen.getByRole("link", { name: "חודש הבא" })).toHaveAttribute("href", "/schedule?month=2026-09");
    expect(screen.getByRole("link", { name: "היום" })).toHaveAttribute("href", "/schedule");
  });

  it("the today link is a normal server-rendered link, not a query-param-driven client date", () => {
    render(<MonthNav {...BASE_PROPS} isOnCurrentMonth />);
    const todayLink = screen.getByRole("link", { name: "היום" });
    expect(todayLink.getAttribute("href")).not.toContain("?month=");
  });

  it("marks today as the current view when already on the current month", () => {
    render(<MonthNav {...BASE_PROPS} isOnCurrentMonth />);
    expect(screen.getByRole("link", { name: "היום" })).toHaveAttribute("aria-current", "date");
  });

  it("does not mark today as current when viewing a different month", () => {
    render(<MonthNav {...BASE_PROPS} isOnCurrentMonth={false} />);
    expect(screen.getByRole("link", { name: "היום" })).not.toHaveAttribute("aria-current");
  });

  describe("compact pill redesign (PR #38 shell-unification round)", () => {
    it("displays the dynamic month/year label the page itself computed, never a hardcoded value", () => {
      render(<MonthNav {...BASE_PROPS} monthLabel="ספטמבר 2026" isOnCurrentMonth={false} />);
      expect(screen.getByText("ספטמבר 2026")).not.toBeNull();
    });

    it("never shows the old verbose 'חודש קודם'/'חודש הבא' labels as visible text -- only via accessible name", () => {
      const { container } = render(<MonthNav {...BASE_PROPS} isOnCurrentMonth={false} />);
      // The accessible names still exist (tested above via getByRole), but
      // there is no plain visible text node reading the old verbose labels.
      expect(container.textContent).not.toContain("חודש קודם");
      expect(container.textContent).not.toContain("חודש הבא");
    });

    it("keeps prev/next inside one navigable region carrying an accessible name", () => {
      render(<MonthNav {...BASE_PROPS} isOnCurrentMonth={false} />);
      expect(screen.getByRole("navigation", { name: "ניווט חודשים" })).not.toBeNull();
    });

    it("today is its own standalone control, outside the month-nav pill", () => {
      render(<MonthNav {...BASE_PROPS} isOnCurrentMonth={false} />);
      const nav = screen.getByRole("navigation", { name: "ניווט חודשים" });
      const todayLink = screen.getByRole("link", { name: "היום" });
      expect(nav.contains(todayLink)).toBe(false);
    });
  });

  describe("touch-target hardening (Phase 6)", () => {
    it("prev/next arrows carry an invisible expanded hit area without changing their visible size", () => {
      render(<MonthNav {...BASE_PROPS} isOnCurrentMonth={false} />);
      const prevArrow = screen.getByRole("link", { name: "חודש קודם" });
      const nextArrow = screen.getByRole("link", { name: "חודש הבא" });
      for (const arrow of [prevArrow, nextArrow]) {
        expect(arrow.className).toContain("h-7 w-7");
        expect(arrow.className).toContain("after:content-['']");
      }
    });
  });
});
