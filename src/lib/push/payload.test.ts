import { describe, expect, it } from "vitest";
import { APP_NAME } from "@/lib/config/productName";
import { TEST_NOTIFICATION_PAYLOAD, buildNotificationPayload, serializeNotificationPayload } from "./payload";

describe("buildNotificationPayload", () => {
  it("fills icon/badge defaults and normalizes a safe path through", () => {
    const payload = buildNotificationPayload({ title: "כותרת", body: "גוף ההודעה", path: "/schedule" });
    expect(payload).toEqual({
      title: "כותרת",
      body: "גוף ההודעה",
      path: "/schedule",
      tag: undefined,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
    });
  });

  it("defaults path to '/' when omitted", () => {
    const payload = buildNotificationPayload({ title: "t", body: "b" });
    expect(payload.path).toBe("/");
  });

  it("never lets an unsafe/external path through -- collapses to '/'", () => {
    const payload = buildNotificationPayload({ title: "t", body: "b", path: "https://evil.example/steal" });
    expect(payload.path).toBe("/");
  });

  it("passes tag through when given", () => {
    const payload = buildNotificationPayload({ title: "t", body: "b", tag: "shift-reminder" });
    expect(payload.tag).toBe("shift-reminder");
  });
});

describe("serializeNotificationPayload", () => {
  it("produces valid JSON containing exactly the payload's own fields", () => {
    const payload = buildNotificationPayload({ title: "t", body: "b", path: "/duties", tag: "x" });
    const json = serializeNotificationPayload(payload);
    expect(JSON.parse(json)).toEqual(payload);
  });
});

describe("TEST_NOTIFICATION_PAYLOAD", () => {
  it("matches the exact specified copy and opens the root path", () => {
    expect(TEST_NOTIFICATION_PAYLOAD).toEqual({
      title: `${APP_NAME} 🐮`,
      body: "ההתראות עובדות כמו שצריך 🎉",
      path: "/",
      tag: "test-notification",
    });
  });

  it("never contains confidential operational scheduling data", () => {
    const text = `${TEST_NOTIFICATION_PAYLOAD.title} ${TEST_NOTIFICATION_PAYLOAD.body}`;
    expect(text).not.toMatch(/@/); // no email
    expect(text).not.toMatch(/משמרת|תורנות|שיבוץ/); // no shift/duty/assignment specifics
  });
});
