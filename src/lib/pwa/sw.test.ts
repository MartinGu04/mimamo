import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * The Service Worker (`public/sw.js`) is a plain static file with no build
 * step -- it must stay that way (see its own header comment: no secrets,
 * no bundler). To test its REAL behavior (not a re-typed duplicate that
 * could silently drift from what actually ships), this loads the exact
 * file text and executes it inside a sandboxed `vm` context standing in
 * for the browser's ServiceWorkerGlobalScope, then dispatches fake
 * events at the handlers it registered via `self.addEventListener`.
 */
const SW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "..", "public", "sw.js"), "utf8");

interface FakeClient {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
}

function makeFakeClient(url: string): FakeClient {
  const client: FakeClient = {
    url,
    focus: vi.fn(),
    navigate: vi.fn(),
  };
  client.focus.mockImplementation(() => Promise.resolve(client));
  client.navigate.mockImplementation(() => Promise.resolve(client));
  return client;
}

function loadServiceWorker() {
  const listeners = new Map<string, Array<(event: unknown) => unknown>>();
  const fakeClients = {
    claim: vi.fn().mockResolvedValue(undefined),
    matchAll: vi.fn().mockResolvedValue([]),
    openWindow: vi.fn().mockResolvedValue(null),
  };
  const fakeRegistration = {
    showNotification: vi.fn().mockResolvedValue(undefined),
  };
  // The delivery-receipt ACK's transport. A real Service Worker always
  // has `fetch`; providing it here keeps the sandbox faithful rather
  // than accidentally testing a no-fetch fallback path.
  const fakeFetch = vi.fn().mockResolvedValue({ ok: true });
  const fakeSelf = {
    addEventListener(type: string, handler: (event: unknown) => unknown) {
      const existing = listeners.get(type) ?? [];
      existing.push(handler);
      listeners.set(type, existing);
    },
    clients: fakeClients,
    registration: fakeRegistration,
    location: { origin: "https://mi-ma-mo.example" },
    skipWaiting: vi.fn(),
  };

  const context = vm.createContext({ self: fakeSelf, URL, console, fetch: fakeFetch });
  vm.runInContext(SW_SOURCE, context, { filename: "sw.js" });

  function dispatch(type: string, event: unknown) {
    const handlers = listeners.get(type) ?? [];
    for (const handler of handlers) handler(event);
  }

  return { listeners, fakeSelf, fakeClients, fakeRegistration, fakeFetch, dispatch };
}

describe("public/sw.js (PR #28)", () => {
  it("registers exactly the expected lifecycle and push handlers, nothing else", () => {
    const { listeners } = loadServiceWorker();
    expect([...listeners.keys()].sort()).toEqual(["activate", "install", "notificationclick", "push"].sort());
    // The whole point of this PR: no offline caching, ever.
    expect(listeners.has("fetch")).toBe(false);
    // No page-side "update now" flow exists anymore -- nothing ever posts
    // a message to this worker, so there is no "message" handler either.
    expect(listeners.has("message")).toBe(false);
  });

  it("install does nothing (never auto-activates a waiting worker)", () => {
    const { listeners, fakeSelf } = loadServiceWorker();
    expect(() => listeners.get("install")?.[0]?.({})).not.toThrow();
    expect(fakeSelf.skipWaiting).not.toHaveBeenCalled();
  });

  it("activate claims clients via waitUntil", async () => {
    const { listeners, fakeClients } = loadServiceWorker();
    let captured: Promise<unknown> | undefined;
    listeners.get("activate")?.[0]?.({ waitUntil: (p: Promise<unknown>) => (captured = p) });
    await captured;
    expect(fakeClients.claim).toHaveBeenCalledTimes(1);
  });

  describe("push", () => {
    it("shows a notification with safe defaults and the requested title/body", async () => {
      const { listeners, fakeRegistration } = loadServiceWorker();
      let captured: Promise<unknown> | undefined;
      listeners.get("push")?.[0]?.({
        data: { json: () => ({ title: "משמרת חדשה", body: "יש לך משמרת מחר", path: "/schedule" }) },
        waitUntil: (p: Promise<unknown>) => (captured = p),
      });
      await captured;

      expect(fakeRegistration.showNotification).toHaveBeenCalledTimes(1);
      const [title, options] = fakeRegistration.showNotification.mock.calls[0] as [string, Record<string, unknown>];
      expect(title).toBe("משמרת חדשה");
      expect(options.body).toBe("יש לך משמרת מחר");
      expect(options.icon).toBe("/icons/icon-192.png");
      expect((options.data as { path: string }).path).toBe("/schedule");
    });

    it("falls back to a default title and never throws on a missing payload", async () => {
      const { listeners, fakeRegistration } = loadServiceWorker();
      let captured: Promise<unknown> | undefined;
      expect(() =>
        listeners.get("push")?.[0]?.({
          data: { json: () => ({}) },
          waitUntil: (p: Promise<unknown>) => (captured = p),
        }),
      ).not.toThrow();
      await captured;
      const [title] = fakeRegistration.showNotification.mock.calls[0] as [string];
      expect(title).toBe("המחלבה");
    });

    it("silently ignores a malformed (non-JSON) push payload -- never crashes the worker", () => {
      const { listeners, fakeRegistration } = loadServiceWorker();
      expect(() =>
        listeners.get("push")?.[0]?.({
          data: {
            json: () => {
              throw new Error("not json");
            },
          },
          waitUntil: vi.fn(),
        }),
      ).not.toThrow();
      expect(fakeRegistration.showNotification).not.toHaveBeenCalled();
    });

    it("does nothing when the push event carries no data at all", () => {
      const { listeners, fakeRegistration } = loadServiceWorker();
      const waitUntil = vi.fn();
      listeners.get("push")?.[0]?.({ data: null, waitUntil });
      expect(waitUntil).not.toHaveBeenCalled();
      expect(fakeRegistration.showNotification).not.toHaveBeenCalled();
    });

    it("does NOT acknowledge a push that carries no receipt token -- receipts degrade silently", async () => {
      const { listeners, fakeFetch } = loadServiceWorker();
      let captured: Promise<unknown> | undefined;
      listeners.get("push")?.[0]?.({
        data: { json: () => ({ title: "t", body: "b" }) },
        waitUntil: (p: Promise<unknown>) => (captured = p),
      });
      await captured;
      expect(fakeFetch).not.toHaveBeenCalled();
    });

    it("an absolute external URL in the payload path is rejected, not carried into the notification's data", async () => {
      const { listeners, fakeRegistration } = loadServiceWorker();
      let captured: Promise<unknown> | undefined;
      listeners.get("push")?.[0]?.({
        data: { json: () => ({ path: "https://evil.example/steal" }) },
        waitUntil: (p: Promise<unknown>) => (captured = p),
      });
      await captured;
      const [, options] = fakeRegistration.showNotification.mock.calls[0] as [string, Record<string, unknown>];
      expect((options.data as { path: string }).path).toBe("/");
    });
  });


  describe("delivery receipt ACK", () => {
    const TOKEN = "a".repeat(64);

    function pushWithToken(token: unknown) {
      const worker = loadServiceWorker();
      let captured: Promise<unknown> | undefined;
      worker.listeners.get("push")?.[0]?.({
        data: { json: () => ({ title: "t", body: "b", path: "/schedule", receiptToken: token }) },
        waitUntil: (p: Promise<unknown>) => (captured = p),
      });
      return { ...worker, captured };
    }

    it("POSTs the token to the narrow same-origin receipt endpoint AFTER showNotification resolves", async () => {
      const { fakeFetch, fakeRegistration, captured } = pushWithToken(TOKEN);
      await captured;

      expect(fakeRegistration.showNotification).toHaveBeenCalledTimes(1);
      expect(fakeFetch).toHaveBeenCalledTimes(1);
      const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/internal/notifications/receipt");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN });
    });

    it("sends NO credentials -- the receipt token is the only authority, so a closed PWA with an expired session still acknowledges", async () => {
      const { fakeFetch, captured } = pushWithToken(TOKEN);
      await captured;

      const [, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
      expect(init.credentials).toBe("omit");
      expect(init.cache).toBe("no-store");
    });

    it("never puts the token in the notification's own data, where notificationclick could read it later", async () => {
      const { fakeRegistration, captured } = pushWithToken(TOKEN);
      await captured;

      const [, options] = fakeRegistration.showNotification.mock.calls[0] as [string, Record<string, unknown>];
      expect(options.data).toEqual({ path: "/schedule" });
      expect(JSON.stringify(options)).not.toContain(TOKEN);
    });

    it("does NOT acknowledge when showNotification fails -- a receipt must only ever follow a real display", async () => {
      const worker = loadServiceWorker();
      worker.fakeRegistration.showNotification.mockRejectedValue(new Error("display failed"));
      let captured: Promise<unknown> | undefined;
      worker.listeners.get("push")?.[0]?.({
        data: { json: () => ({ title: "t", receiptToken: TOKEN }) },
        waitUntil: (p: Promise<unknown>) => (captured = p),
      });

      await expect(captured).rejects.toThrow("display failed");
      expect(worker.fakeFetch).not.toHaveBeenCalled();
    });

    const malformedTokens: { label: string; token: unknown }[] = [
      { label: "empty", token: "" },
      { label: "malformed", token: "not-a-token" },
      { label: "non-string", token: 42 },
      { label: "null", token: null },
      { label: "non-hex", token: "A".repeat(64) },
    ];

    it.each(malformedTokens)("ignores a $label receipt token without a network request", async ({ token }) => {
      const { fakeFetch, captured } = pushWithToken(token);
      await captured;
      expect(fakeFetch).not.toHaveBeenCalled();
    });

    it("a failed ACK never rejects the push event -- the notification was already shown", async () => {
      const worker = loadServiceWorker();
      worker.fakeFetch.mockRejectedValue(new Error("offline"));
      let captured: Promise<unknown> | undefined;
      worker.listeners.get("push")?.[0]?.({
        data: { json: () => ({ title: "t", receiptToken: TOKEN }) },
        waitUntil: (p: Promise<unknown>) => (captured = p),
      });

      await expect(captured).resolves.not.toThrow();
    });
  });

  describe("notificationclick", () => {
    it("always closes the notification", async () => {
      const { listeners } = loadServiceWorker();
      const close = vi.fn();
      let captured: Promise<unknown> | undefined;
      listeners.get("notificationclick")?.[0]?.({
        notification: { close, data: { path: "/schedule" } },
        waitUntil: (p: Promise<unknown>) => (captured = p),
      });
      await captured;
      expect(close).toHaveBeenCalledTimes(1);
    });

    it("focuses an existing window already on the exact target path, rather than opening a new one", async () => {
      const { listeners, fakeClients } = loadServiceWorker();
      const matching = makeFakeClient("https://mi-ma-mo.example/schedule");
      fakeClients.matchAll.mockResolvedValue([matching]);

      let captured: Promise<unknown> | undefined;
      listeners.get("notificationclick")?.[0]?.({
        notification: { close: vi.fn(), data: { path: "/schedule" } },
        waitUntil: (p: Promise<unknown>) => (captured = p),
      });
      await captured;

      expect(matching.focus).toHaveBeenCalledTimes(1);
      expect(matching.navigate).not.toHaveBeenCalled();
      expect(fakeClients.openWindow).not.toHaveBeenCalled();
    });

    it("focuses and navigates a different existing window when none matches the target exactly", async () => {
      const { listeners, fakeClients } = loadServiceWorker();
      const other = makeFakeClient("https://mi-ma-mo.example/duties");
      fakeClients.matchAll.mockResolvedValue([other]);

      let captured: Promise<unknown> | undefined;
      listeners.get("notificationclick")?.[0]?.({
        notification: { close: vi.fn(), data: { path: "/schedule" } },
        waitUntil: (p: Promise<unknown>) => (captured = p),
      });
      await captured;

      expect(other.focus).toHaveBeenCalledTimes(1);
      expect(other.navigate).toHaveBeenCalledWith("https://mi-ma-mo.example/schedule");
      expect(fakeClients.openWindow).not.toHaveBeenCalled();
    });

    it("opens a new window only when there is no existing app window at all", async () => {
      const { listeners, fakeClients } = loadServiceWorker();
      fakeClients.matchAll.mockResolvedValue([]);

      let captured: Promise<unknown> | undefined;
      listeners.get("notificationclick")?.[0]?.({
        notification: { close: vi.fn(), data: { path: "/schedule" } },
        waitUntil: (p: Promise<unknown>) => (captured = p),
      });
      await captured;

      expect(fakeClients.openWindow).toHaveBeenCalledWith("https://mi-ma-mo.example/schedule");
    });

    it("never opens an arbitrary external URL -- an unsafe/absolute destination collapses to the app root", async () => {
      const { listeners, fakeClients } = loadServiceWorker();
      fakeClients.matchAll.mockResolvedValue([]);

      for (const unsafe of ["https://evil.example/phish", "//evil.example", "javascript:alert(1)", "not-a-path"]) {
        fakeClients.openWindow.mockClear();
        let captured: Promise<unknown> | undefined;
        listeners.get("notificationclick")?.[0]?.({
          notification: { close: vi.fn(), data: { path: unsafe } },
          waitUntil: (p: Promise<unknown>) => (captured = p),
        });
        await captured;
        expect(fakeClients.openWindow).toHaveBeenCalledWith("https://mi-ma-mo.example/");
      }
    });

    it("falls back to the app root when the notification carries no path at all", async () => {
      const { listeners, fakeClients } = loadServiceWorker();
      fakeClients.matchAll.mockResolvedValue([]);

      let captured: Promise<unknown> | undefined;
      listeners.get("notificationclick")?.[0]?.({
        notification: { close: vi.fn(), data: undefined },
        waitUntil: (p: Promise<unknown>) => (captured = p),
      });
      await captured;
      expect(fakeClients.openWindow).toHaveBeenCalledWith("https://mi-ma-mo.example/");
    });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
