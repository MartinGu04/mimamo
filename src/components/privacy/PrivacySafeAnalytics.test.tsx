import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const AnalyticsMock = vi.fn(() => null);
vi.mock("@vercel/analytics/next", () => ({ Analytics: AnalyticsMock }));

const { PrivacySafeAnalytics, sanitizeAnalyticsEvent } = await import("./PrivacySafeAnalytics");

afterEach(() => {
  cleanup();
  AnalyticsMock.mockClear();
});

describe("sanitizeAnalyticsEvent -- the beforeSend callback itself", () => {
  it("strips ?person= from a pageview event's url", () => {
    const result = sanitizeAnalyticsEvent({ type: "pageview", url: "https://example.com/manager?person=p_123" });
    expect(result).toEqual({ type: "pageview", url: "https://example.com/manager" });
  });

  it("strips multiple query params from a custom event's url", () => {
    const result = sanitizeAnalyticsEvent({
      type: "event",
      url: "https://example.com/fairness?person=p_1&range=30d&month=2026-08",
    });
    expect(result).toEqual({ type: "event", url: "https://example.com/fairness" });
  });

  it("strips a URL fragment", () => {
    const result = sanitizeAnalyticsEvent({ type: "pageview", url: "https://example.com/duties#history" });
    expect(result).toEqual({ type: "pageview", url: "https://example.com/duties" });
  });

  it("strips unknown/future query params without any allowlist", () => {
    const result = sanitizeAnalyticsEvent({ type: "pageview", url: "https://example.com/x?brand_new_param=1" });
    expect(result).toEqual({ type: "pageview", url: "https://example.com/x" });
  });

  it("preserves origin and pathname exactly", () => {
    const result = sanitizeAnalyticsEvent({ type: "pageview", url: "https://mi-ma-mo.example.com/schedule?person=p_1" });
    expect(result).toEqual({ type: "pageview", url: "https://mi-ma-mo.example.com/schedule" });
  });

  it("preserves the event's own type field (pageview vs. event) unchanged", () => {
    expect(sanitizeAnalyticsEvent({ type: "event", url: "https://example.com/x" })?.type).toBe("event");
    expect(sanitizeAnalyticsEvent({ type: "pageview", url: "https://example.com/x" })?.type).toBe("pageview");
  });

  it("returns null (drops the event) for a malformed url instead of sending it unsanitized", () => {
    expect(sanitizeAnalyticsEvent({ type: "pageview", url: "not a url" })).toBeNull();
  });

  it("never adds any extra field to the event -- no person id, user id, name, or email metadata", () => {
    const result = sanitizeAnalyticsEvent({ type: "pageview", url: "https://example.com/manager?person=p_123" });
    expect(result && Object.keys(result).sort()).toEqual(["type", "url"]);
  });
});

describe("PrivacySafeAnalytics -- wiring", () => {
  it("renders the real Analytics component with sanitizeAnalyticsEvent as its beforeSend", () => {
    render(<PrivacySafeAnalytics />);
    expect(AnalyticsMock).toHaveBeenCalledTimes(1);
    const receivedProps = AnalyticsMock.mock.calls[0] as unknown as [{ beforeSend?: unknown }];
    expect(receivedProps[0]).toEqual({ beforeSend: sanitizeAnalyticsEvent });
  });
});
