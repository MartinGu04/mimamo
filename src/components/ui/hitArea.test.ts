import { describe, expect, it } from "vitest";
import { EXPAND_HIT_AREA_CLASS, EXPAND_HIT_AREA_VERTICAL_CLASS } from "./hitArea";

describe("hitArea", () => {
  it("EXPAND_HIT_AREA_CLASS expands every side via an invisible ::after, never a visible background", () => {
    expect(EXPAND_HIT_AREA_CLASS).toContain("after:absolute");
    expect(EXPAND_HIT_AREA_CLASS).toContain("after:content-['']");
    expect(EXPAND_HIT_AREA_CLASS).toContain("after:-inset-1.5");
    expect(EXPAND_HIT_AREA_CLASS).not.toMatch(/after:bg-/);
  });

  it("EXPAND_HIT_AREA_VERTICAL_CLASS only grows up/down, never sideways, so packed horizontal neighbors never overlap", () => {
    expect(EXPAND_HIT_AREA_VERTICAL_CLASS).toContain("after:-top-2");
    expect(EXPAND_HIT_AREA_VERTICAL_CLASS).toContain("after:-bottom-2");
    expect(EXPAND_HIT_AREA_VERTICAL_CLASS).toContain("after:inset-x-0");
    expect(EXPAND_HIT_AREA_VERTICAL_CLASS).not.toMatch(/after:-(start|end|left|right|inset-y)-/);
  });
});
