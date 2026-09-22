import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { resolveSafeNotificationPath } from "./notificationPath";

describe("resolveSafeNotificationPath", () => {
  it("passes through a normal in-app absolute path unchanged", () => {
    expect(resolveSafeNotificationPath("/schedule")).toBe("/schedule");
    expect(resolveSafeNotificationPath("/")).toBe("/");
    expect(resolveSafeNotificationPath("/manager/fairness")).toBe("/manager/fairness");
  });

  it("falls back to '/' for anything not a real string", () => {
    expect(resolveSafeNotificationPath(undefined)).toBe("/");
    expect(resolveSafeNotificationPath(null)).toBe("/");
  });

  it("falls back to '/' for a relative (non-absolute) path", () => {
    expect(resolveSafeNotificationPath("schedule")).toBe("/");
    expect(resolveSafeNotificationPath("")).toBe("/");
  });

  it("rejects a protocol-relative path -- would escape same-origin", () => {
    expect(resolveSafeNotificationPath("//evil.example")).toBe("/");
  });

  it("rejects an absolute external URL", () => {
    expect(resolveSafeNotificationPath("https://evil.example/phish")).toBe("/");
    expect(resolveSafeNotificationPath("javascript:alert(1)")).toBe("/");
  });

  it("rejects a query string or hash -- the shared safe-path pattern only allows a plain path", () => {
    // Matches sw.js's own character class exactly (no '?'/'#') -- a
    // payload that needs one isn't supported yet, by design, not an
    // oversight; widening this would mean widening PR #28's validation.
    expect(resolveSafeNotificationPath("/manager?range=7d")).toBe("/");
    expect(resolveSafeNotificationPath("/schedule#today")).toBe("/");
  });
});

describe("resolveSafeNotificationPath -- cross-checked against the real public/sw.js", () => {
  /**
   * Loads the ACTUAL shipped `public/sw.js` (same `vm`-sandbox technique as
   * `lib/pwa/sw.test.ts`) and drives a fake push event through it, reading
   * back the `path` it stamped onto the resulting notification's `data` --
   * that value is exactly what sw.js's OWN internal
   * `resolveSafeNotificationPath` produced for the given input.
   */
  function resolvePathThroughRealServiceWorker(rawPath: unknown): string {
    const SW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "..", "public", "sw.js"), "utf8");
    let capturedPath: string | undefined;
    const fakeSelf = {
      addEventListener(type: string, handler: (event: unknown) => unknown) {
        if (type !== "push") return;
        handler({
          data: { json: () => ({ title: "t", body: "b", path: rawPath }) },
          waitUntil: () => {},
        });
      },
      clients: { claim: () => Promise.resolve() },
      registration: {
        // Returns a Promise, exactly as the real
        // `ServiceWorkerRegistration.showNotification` does -- sw.js now
        // chains the delivery-receipt ACK onto it, so a `undefined`
        // return here would be an unfaithful stub rather than a
        // simplification.
        showNotification: (_title: string, options: { data?: { path?: string } }) => {
          capturedPath = options.data?.path;
          return Promise.resolve();
        },
      },
      location: { origin: "https://mi-ma-mo.example" },
      skipWaiting: () => {},
    };
    const context = vm.createContext({ self: fakeSelf, URL, console });
    vm.runInContext(SW_SOURCE, context, { filename: "sw.js" });
    return capturedPath ?? "/";
  }

  const cases: Array<string | undefined | null> = [
    "/schedule",
    "/",
    undefined,
    null,
    "schedule",
    "",
    "//evil.example",
    "https://evil.example/phish",
    "javascript:alert(1)",
    "/manager?range=7d",
  ];

  it.each(cases)("resolves %j identically to the TypeScript port", (input) => {
    expect(resolveSafeNotificationPath(input)).toBe(resolvePathThroughRealServiceWorker(input));
  });
});
