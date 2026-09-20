import { afterEach, describe, expect, it } from "vitest";
import {
  A11Y_INIT_SCRIPT,
  DEFAULT_A11Y_PREFERENCES,
  applyA11yDocumentAttributes,
  parseA11yPreferences,
} from "./preferences";

afterEach(() => {
  document.documentElement.removeAttribute("data-a11y-text");
  document.documentElement.removeAttribute("data-a11y-reduce-motion");
  document.documentElement.removeAttribute("data-a11y-reduce-transparency");
  document.documentElement.removeAttribute("data-a11y-emphasize-links");
});

describe("parseA11yPreferences", () => {
  it("returns the defaults for an empty/invalid JSON string", () => {
    expect(parseA11yPreferences("not json")).toEqual(DEFAULT_A11Y_PREFERENCES);
    expect(parseA11yPreferences("null")).toEqual(DEFAULT_A11Y_PREFERENCES);
    expect(parseA11yPreferences("42")).toEqual(DEFAULT_A11Y_PREFERENCES);
  });

  it("round-trips a fully valid stored value", () => {
    const stored = {
      textSize: "enlarged",
      reduceMotion: true,
      reduceTransparency: true,
      emphasizeLinks: true,
    };
    expect(parseA11yPreferences(JSON.stringify(stored))).toEqual(stored);
  });

  it("falls back field-by-field for a malformed/partial value instead of discarding everything", () => {
    const stored = { textSize: "not-a-real-size", reduceMotion: true, emphasizeLinks: "yes" };
    expect(parseA11yPreferences(JSON.stringify(stored))).toEqual({
      textSize: "default",
      reduceMotion: true,
      reduceTransparency: false,
      emphasizeLinks: false,
    });
  });
});

describe("applyA11yDocumentAttributes", () => {
  it("sets data-a11y-text only for a non-default size, and removes it for default", () => {
    applyA11yDocumentAttributes({ ...DEFAULT_A11Y_PREFERENCES, textSize: "enlarged" });
    expect(document.documentElement.getAttribute("data-a11y-text")).toBe("enlarged");

    applyA11yDocumentAttributes({ ...DEFAULT_A11Y_PREFERENCES, textSize: "xlarge" });
    expect(document.documentElement.getAttribute("data-a11y-text")).toBe("xlarge");

    applyA11yDocumentAttributes(DEFAULT_A11Y_PREFERENCES);
    expect(document.documentElement.hasAttribute("data-a11y-text")).toBe(false);
  });

  it("sets/removes the three boolean attributes to exactly reflect each preference", () => {
    applyA11yDocumentAttributes({ ...DEFAULT_A11Y_PREFERENCES, reduceMotion: true, reduceTransparency: true, emphasizeLinks: true });
    expect(document.documentElement.getAttribute("data-a11y-reduce-motion")).toBe("true");
    expect(document.documentElement.getAttribute("data-a11y-reduce-transparency")).toBe("true");
    expect(document.documentElement.getAttribute("data-a11y-emphasize-links")).toBe("true");

    applyA11yDocumentAttributes(DEFAULT_A11Y_PREFERENCES);
    expect(document.documentElement.hasAttribute("data-a11y-reduce-motion")).toBe(false);
    expect(document.documentElement.hasAttribute("data-a11y-reduce-transparency")).toBe(false);
    expect(document.documentElement.hasAttribute("data-a11y-emphasize-links")).toBe(false);
  });
});

describe("A11Y_INIT_SCRIPT", () => {
  it("is a self-contained blocking script that applies a stored preference before hydration", () => {
    window.localStorage.setItem(
      "hamachlava-a11y-preferences-v1",
      JSON.stringify({ textSize: "xlarge", reduceMotion: true, reduceTransparency: false, emphasizeLinks: true }),
    );

    new Function(A11Y_INIT_SCRIPT)();

    expect(document.documentElement.getAttribute("data-a11y-text")).toBe("xlarge");
    expect(document.documentElement.getAttribute("data-a11y-reduce-motion")).toBe("true");
    expect(document.documentElement.hasAttribute("data-a11y-reduce-transparency")).toBe(false);
    expect(document.documentElement.getAttribute("data-a11y-emphasize-links")).toBe("true");

    window.localStorage.clear();
  });

  it("does nothing when nothing is stored", () => {
    window.localStorage.clear();
    new Function(A11Y_INIT_SCRIPT)();
    expect(document.documentElement.hasAttribute("data-a11y-text")).toBe(false);
    expect(document.documentElement.hasAttribute("data-a11y-reduce-motion")).toBe(false);
  });

  it("never throws for a corrupted stored value", () => {
    window.localStorage.setItem("hamachlava-a11y-preferences-v1", "{not valid json");
    expect(() => new Function(A11Y_INIT_SCRIPT)()).not.toThrow();
    window.localStorage.clear();
  });
});
