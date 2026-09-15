import { describe, expect, it } from "vitest";
import { satcomVariantForPath } from "./satcom-variants";

describe("satcomVariantForPath", () => {
  it("gives the open, low-density pages the full composition", () => {
    expect(satcomVariantForPath("/")).toBe("rich");
    expect(satcomVariantForPath("/countdown")).toBe("rich");
  });

  it("keeps dense data surfaces on atmosphere only", () => {
    expect(satcomVariantForPath("/schedule")).toBe("calm");
    expect(satcomVariantForPath("/fairness")).toBe("calm");
  });

  it("gives ordinary content pages the middle treatment", () => {
    expect(satcomVariantForPath("/duties")).toBe("standard");
    expect(satcomVariantForPath("/settings")).toBe("standard");
    expect(satcomVariantForPath("/notifications")).toBe("standard");
  });

  it("ignores a trailing slash", () => {
    expect(satcomVariantForPath("/duties/")).toBe("standard");
    expect(satcomVariantForPath("/")).toBe("rich");
    expect(satcomVariantForPath("///")).toBe("rich");
  });

  it("lets a nested route inherit its section rather than the fallback", () => {
    // /manager is "standard", so its sub-pages follow it instead of dropping
    // to the conservative default.
    expect(satcomVariantForPath("/manager/fairness")).toBe("standard");
    expect(satcomVariantForPath("/shooting-ranges/manager")).toBe("standard");
  });

  it("falls back to the quietest treatment for an unmapped route", () => {
    // A page nobody has tuned yet must never get the loudest background.
    expect(satcomVariantForPath("/some-future-page")).toBe("calm");
    expect(satcomVariantForPath("/a/b/c")).toBe("calm");
  });
});
