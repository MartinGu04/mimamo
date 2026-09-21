import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const recordDeliveryReceipt = vi.fn();
vi.mock("@/lib/notifications/receiptStore", () => ({
  recordDeliveryReceipt: (...args: unknown[]) => recordDeliveryReceipt(...args),
}));

const { POST } = await import("./route");

const VALID_TOKEN = "a".repeat(64);

function request(body: unknown, { malformed = false }: { malformed?: boolean } = {}) {
  return {
    json: async () => {
      if (malformed) throw new SyntaxError("Unexpected token");
      return body;
    },
  } as unknown as Parameters<typeof POST>[0];
}

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  recordDeliveryReceipt.mockReset().mockResolvedValue(undefined);
  consoleSpies = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
    vi.spyOn(console, "debug").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("POST /internal/notifications/receipt -- happy path", () => {
  it("forwards sha256(token) -- never the token itself -- to the one narrow receipt RPC", async () => {
    const response = await POST(request({ token: VALID_TOKEN }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(recordDeliveryReceipt).toHaveBeenCalledTimes(1);
    expect(recordDeliveryReceipt).toHaveBeenCalledWith(createHash("sha256").update(VALID_TOKEN).digest("hex"));
    expect(recordDeliveryReceipt).not.toHaveBeenCalledWith(VALID_TOKEN);
  });

  it("a repeated identical ACK is harmless and indistinguishable from the first", async () => {
    const first = await POST(request({ token: VALID_TOKEN }));
    const second = await POST(request({ token: VALID_TOKEN }));

    expect(first.status).toBe(second.status);
    expect(await first.json()).toEqual(await second.json());
    expect(recordDeliveryReceipt).toHaveBeenCalledTimes(2);
    // Idempotency itself is enforced in the RPC (`received_at` is pinned
    // with `coalesce` to the FIRST receipt) -- see the migration and the
    // real-Postgres integration suite.
  });
});

describe("POST /internal/notifications/receipt -- never an oracle", () => {
  const indistinguishableCases: [string, () => Parameters<typeof POST>[0]][] = [
    ["malformed JSON", () => request(null, { malformed: true })],
    ["a null body", () => request(null)],
    ["a non-object body", () => request("token")],
    ["no token field", () => request({})],
    ["a non-string token", () => request({ token: 12345 })],
    ["a wrong-length token", () => request({ token: "a".repeat(63) })],
    ["a non-hex token", () => request({ token: "Z".repeat(64) })],
    ["an unknown but well-formed token", () => request({ token: "b".repeat(64) })],
  ];

  it.each(indistinguishableCases)("answers %s exactly like a successful receipt", async (_label, build) => {
    const response = await POST(build());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("does not even reach the database for a malformed token -- junk costs a regex, not a query", async () => {
    await POST(request({ token: "not-a-token" }));
    expect(recordDeliveryReceipt).not.toHaveBeenCalled();
  });

  it("answers identically when the database call itself fails", async () => {
    recordDeliveryReceipt.mockRejectedValue(new Error("connection reset"));
    const response = await POST(request({ token: VALID_TOKEN }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("never returns any user, device, or delivery data -- the body is a fixed constant", async () => {
    const response = await POST(request({ token: VALID_TOKEN }));
    expect(Object.keys(await response.json())).toEqual(["ok"]);
  });
});

describe("POST /internal/notifications/receipt -- the token is never logged", () => {
  it("writes nothing to any console channel, for a valid token or an invalid one", async () => {
    await POST(request({ token: VALID_TOKEN }));
    await POST(request({ token: "nope" }));
    recordDeliveryReceipt.mockRejectedValue(new Error("boom"));
    await POST(request({ token: VALID_TOKEN }));

    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("POST /internal/notifications/receipt -- it cannot be addressed by delivery id", () => {
  it("ignores a client-supplied delivery id entirely; knowing one is worth nothing here", async () => {
    await POST(request({ deliveryId: "11111111-1111-4111-8111-111111111111" }));
    expect(recordDeliveryReceipt).not.toHaveBeenCalled();
  });

  it("a delivery id alongside a bogus token still does nothing -- the token is the only authority", async () => {
    await POST(request({ deliveryId: "11111111-1111-4111-8111-111111111111", token: "short" }));
    expect(recordDeliveryReceipt).not.toHaveBeenCalled();
  });
});
