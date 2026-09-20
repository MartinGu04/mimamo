import { describe, expect, it } from "vitest";
import { sanitizeAnalyticsUrl } from "./sanitizeAnalyticsUrl";

describe("sanitizeAnalyticsUrl", () => {
  it("strips a ?person= query parameter", () => {
    expect(sanitizeAnalyticsUrl("https://example.com/manager?person=p_123")).toBe("https://example.com/manager");
  });

  it("strips multiple query parameters at once", () => {
    expect(sanitizeAnalyticsUrl("https://example.com/manager?person=p_123&range=30d&category=shifts")).toBe(
      "https://example.com/manager",
    );
  });

  it("strips unknown/future query parameters just as readily -- no allowlist/denylist of specific names", () => {
    expect(sanitizeAnalyticsUrl("https://example.com/whatever?some_future_param=value&another=1")).toBe(
      "https://example.com/whatever",
    );
  });

  it("strips a URL fragment/hash", () => {
    expect(sanitizeAnalyticsUrl("https://example.com/duties#history")).toBe("https://example.com/duties");
  });

  it("strips both a query string and a fragment together", () => {
    expect(sanitizeAnalyticsUrl("https://example.com/manager?person=p_123&view=x#foo")).toBe(
      "https://example.com/manager",
    );
  });

  it("preserves the pathname exactly", () => {
    expect(sanitizeAnalyticsUrl("https://example.com/schedule?person=p_1")).toBe("https://example.com/schedule");
    expect(sanitizeAnalyticsUrl("https://example.com/fairness/nested?person=p_1")).toBe(
      "https://example.com/fairness/nested",
    );
  });

  it("preserves the origin exactly, including a non-default port", () => {
    expect(sanitizeAnalyticsUrl("https://mi-ma-mo.example.com/manager?person=p_1")).toBe(
      "https://mi-ma-mo.example.com/manager",
    );
    expect(sanitizeAnalyticsUrl("http://localhost:3000/manager?person=p_1")).toBe("http://localhost:3000/manager");
  });

  it("passes a URL with no query/fragment through unchanged (origin + pathname only)", () => {
    expect(sanitizeAnalyticsUrl("https://example.com/countdown")).toBe("https://example.com/countdown");
  });

  it("returns null for a malformed URL -- fails closed rather than sending the raw value", () => {
    expect(sanitizeAnalyticsUrl("not a url at all")).toBeNull();
    expect(sanitizeAnalyticsUrl("")).toBeNull();
  });
});
