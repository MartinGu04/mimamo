import { describe, expect, it } from "vitest";
import {
  countdownEveryoneHref,
  countdownPersonHref,
  countdownPersonalHref,
  parseDischargeCountdownPersonId,
  parseDischargeCountdownView,
} from "./dischargeCountdownUrl";

describe("parseDischargeCountdownView", () => {
  it("reads the everyone view only from the exact value", () => {
    expect(parseDischargeCountdownView("everyone")).toBe("everyone");
  });

  it("falls back to the personal countdown for anything else", () => {
    // The personal view is both the default and the safe answer for a viewer
    // who may not be allowed the roster at all.
    for (const raw of [undefined, null, "", "personal", "Everyone", "all", ["everyone"]]) {
      expect(parseDischargeCountdownView(raw)).toBe("personal");
    }
  });
});

describe("parseDischargeCountdownPersonId", () => {
  it("accepts a single non-empty value", () => {
    expect(parseDischargeCountdownPersonId("p_7")).toBe("p_7");
  });

  it("treats missing, blank and repeated values as no selection", () => {
    for (const raw of [undefined, null, "", "   ", ["p_1", "p_2"]]) {
      expect(parseDischargeCountdownPersonId(raw)).toBeNull();
    }
  });
});

describe("countdown hrefs", () => {
  it("leaves the default view out of the personal URL entirely", () => {
    expect(countdownPersonalHref()).toBe("/countdown");
  });

  it("always says everyone explicitly, since it is never the default", () => {
    expect(countdownEveryoneHref()).toBe("/countdown?view=everyone");
  });

  it("keeps the everyone view alongside a selected person, so the way back is known", () => {
    expect(countdownPersonHref("p_7")).toBe("/countdown?view=everyone&person=p_7");
  });

  it("encodes a person id that needs it", () => {
    expect(countdownPersonHref("a b&c")).toBe("/countdown?view=everyone&person=a+b%26c");
  });

  it("round-trips through the parsers", () => {
    const url = new URL(countdownPersonHref("p_9"), "https://example.test");
    expect(parseDischargeCountdownView(url.searchParams.get("view"))).toBe("everyone");
    expect(parseDischargeCountdownPersonId(url.searchParams.get("person"))).toBe("p_9");
  });
});
