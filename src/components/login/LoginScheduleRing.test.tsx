import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { LoginScheduleRing } from "./LoginScheduleRing";

afterEach(() => {
  cleanup();
});

describe("LoginScheduleRing", () => {
  it("renders every illustrative floating card's title, never real schedule data", () => {
    const { getByText } = render(<LoginScheduleRing />);
    for (const title of ["משמרת ערב", "משמרת בוקר", "חופש", "תורנות", "משמרת לילה"]) {
      expect(getByText(title)).toBeInTheDocument();
    }
  });

  it("renders the tick-marked ring's SVG unconditionally -- no mobile/desktop swap, same clock face at every breakpoint", () => {
    const { container } = render(<LoginScheduleRing />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg?.className.baseVal ?? svg?.getAttribute("class") ?? "").not.toContain("hidden");
  });

  it("renders the brand mark image unconditionally (no `hidden`/`lg:flex` gating) so mobile gets the same centered logo as desktop", () => {
    const { container } = render(<LoginScheduleRing />);
    const logo = container.querySelector("img");
    expect(logo).toBeInTheDocument();
    expect(logo?.closest("div")?.className).not.toContain("hidden");
  });

  it("hides every floating card below `lg` -- mobile shows only the ring/ticks/logo/sweep hand, cards are desktop-only", () => {
    const { getByText } = render(<LoginScheduleRing />);
    for (const title of ["משמרת ערב", "משמרת בוקר", "חופש", "תורנות", "משמרת לילה"]) {
      const card = getByText(title).closest("div.absolute");
      expect(card?.className).toContain("hidden");
      expect(card?.className).toContain("lg:flex");
    }
  });

  it("hides the whole illustrative composition from assistive tech (Phase 5 remediation) -- the floating cards' own title/time text used to be exposed even though every OTHER piece here already carried its own aria-hidden", () => {
    const { container, getByText } = render(<LoginScheduleRing />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    // A descendant `aria-hidden="true"` doesn't itself prove the browser's
    // accessibility tree excludes it -- only an ancestor chain up to the
    // root does. Confirm every floating card's title sits inside the
    // hidden root, not just alongside other individually-hidden siblings.
    for (const title of ["משמרת ערב", "משמרת בוקר", "חופש", "תורנות", "משמרת לילה"]) {
      expect(container.firstElementChild).toContainElement(getByText(title));
    }
  });
});
