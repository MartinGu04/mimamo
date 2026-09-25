// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { sendTakshalNotification } from "./client";

const config = { endpoint: "https://hub.example/api/source/machlava/notify", sourceSecret: "synthetic-source-secret-for-tests-0123456789" };
const notification = {
  eventId: "job:3f7a0c52-1d7e-4c1b-9a53-0d6b2f1e8c11",
  recipientEmail: "tester@example.com",
  title: "שינוי במשמרת",
  body: "המשמרת שלך עודכנה.",
  target: "/schedule",
  tag: "machlava-0123456789abcdef0123456",
};

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("sendTakshalNotification", () => {
  it("POSTs the v1 request with the source credential, and never follows redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, { accepted: true, delivered: 2, failed: 0, removed: 0 }));
    const result = await sendTakshalNotification(config, notification, { fetchImpl });

    expect(result).toEqual({ ok: true, delivered: 2, duplicate: false, noActiveSubscription: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(config.endpoint);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.sourceSecret}` },
    });
    expect(JSON.parse(init!.body as string)).toEqual({ version: 1, ...notification });
  });

  it.each([
    [{ accepted: true, delivered: 0, reason: "no_active_subscription" }, { ok: true, delivered: 0, duplicate: false, noActiveSubscription: true }],
    [{ accepted: true, duplicate: true, delivered: 0 }, { ok: true, delivered: 0, duplicate: true, noActiveSubscription: false }],
  ])("understands the hub's non-error outcomes %j", async (body, expected) => {
    const result = await sendTakshalNotification(config, notification, { fetchImpl: async () => jsonResponse(200, body) });
    expect(result).toEqual(expected);
  });

  it.each([400, 401, 429, 500, 503])("reports HTTP %i as a failure", async (status) => {
    const result = await sendTakshalNotification(config, notification, { fetchImpl: async () => jsonResponse(status, { error: "x" }) });
    expect(result).toEqual({ ok: false, reason: "http_error", status });
  });

  it.each([
    ["not JSON", () => new Response("<html>oops</html>", { status: 200 })],
    ["an empty object", () => jsonResponse(200, {})],
    ["accepted: false", () => jsonResponse(200, { accepted: false, delivered: 1 })],
    ["a non-numeric count", () => jsonResponse(200, { accepted: true, delivered: "1" })],
    ["an array", () => jsonResponse(200, [{ accepted: true, delivered: 1 }])],
  ])("reports a malformed response (%s) as a failure", async (_name, respond) => {
    const result = await sendTakshalNotification(config, notification, { fetchImpl: async () => respond() });
    expect(result).toMatchObject({ ok: false, reason: "invalid_response" });
  });

  it("reports a network error as a failure, never a throw", async () => {
    const result = await sendTakshalNotification(config, notification, {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(result).toEqual({ ok: false, reason: "network" });
  });

  it("aborts a hanging hub after the timeout", async () => {
    const hanging: typeof fetch = (_url, init) =>
      new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const started = Date.now();
    const result = await sendTakshalNotification(config, notification, { fetchImpl: hanging, timeoutMs: 30 });
    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("never puts the secret or the recipient in its result", async () => {
    for (const fetchImpl of [async () => jsonResponse(500, { error: config.sourceSecret }), async () => jsonResponse(200, { accepted: true, delivered: 1 })]) {
      const text = JSON.stringify(await sendTakshalNotification(config, notification, { fetchImpl }));
      expect(text).not.toContain(config.sourceSecret);
      expect(text).not.toContain(notification.recipientEmail);
    }
  });
});
