// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { TakshalSendResult } from "./client";
import { createTakshalDispatcher } from "./dispatcher";
import type { TakshalNotification } from "./notification";

const SECRET = "synthetic-source-secret-for-tests-0123456789";

const notification = (n: number): TakshalNotification => ({
  eventId: `job:00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  recipientEmail: "tester@example.com",
  title: "כותרת",
  body: "תוכן ההתראה",
  target: "/schedule",
});

function logger() {
  const lines: string[] = [];
  return { lines, log: { info: (line: string) => lines.push(line), warn: (line: string) => lines.push(line) } };
}

/** A controllable fake hub: each call waits until the test resolves it. */
function manualHub() {
  const pending: { notification: TakshalNotification; resolve: (result: TakshalSendResult) => void }[] = [];
  let maxInFlight = 0;
  let inFlight = 0;
  const send = (item: TakshalNotification) =>
    new Promise<TakshalSendResult>((resolve) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      pending.push({
        notification: item,
        resolve: (result) => {
          inFlight--;
          resolve(result);
        },
      });
    });
  return { send, pending, maxInFlight: () => maxInFlight };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const OK: TakshalSendResult = { ok: true, delivered: 1, duplicate: false, noActiveSubscription: false };

describe("createTakshalDispatcher", () => {
  it("send() returns immediately; the request runs in the background", async () => {
    const hub = manualHub();
    const dispatcher = createTakshalDispatcher(hub.send, { log: logger().log });
    dispatcher.send(notification(1));
    expect(hub.pending).toHaveLength(1); // started, not awaited
    hub.pending[0]!.resolve(OK);
    expect(await dispatcher.settle()).toMatchObject({ requested: 1, accepted: 1, devices: 1, failed: 0, skipped: 0 });
  });

  it("caps concurrent requests", async () => {
    const hub = manualHub();
    const dispatcher = createTakshalDispatcher(hub.send, { concurrency: 2, log: logger().log });
    for (let i = 0; i < 5; i++) dispatcher.send(notification(i));
    expect(hub.pending).toHaveLength(2);
    for (let i = 0; i < 5; i++) {
      hub.pending[i]!.resolve(OK);
      await flush();
    }
    expect(hub.maxInFlight()).toBe(2);
    expect(await dispatcher.settle()).toMatchObject({ requested: 5, accepted: 5 });
  });

  it("opens the circuit after consecutive failures and skips the rest of the run", async () => {
    const { lines, log } = logger();
    const calls: TakshalNotification[] = [];
    const dispatcher = createTakshalDispatcher(
      async (item) => {
        calls.push(item);
        return { ok: false, reason: "timeout" };
      },
      { concurrency: 1, breakerThreshold: 3, log },
    );
    for (let i = 0; i < 10; i++) dispatcher.send(notification(i));
    const report = await dispatcher.settle();
    expect(calls).toHaveLength(3);
    expect(report).toMatchObject({ requested: 10, failed: 3, skipped: 7 });
    expect(lines.filter((line) => line.includes("delivery failed reason=timeout"))).toHaveLength(3);
    expect(lines.some((line) => line.includes("skipping TAKSHAL CTRL for the rest of this run"))).toBe(true);
  });

  it("a success resets the failure streak", async () => {
    const results: TakshalSendResult[] = [{ ok: false, reason: "network" }, { ok: false, reason: "network" }, OK, { ok: false, reason: "network" }, { ok: false, reason: "network" }, OK];
    const dispatcher = createTakshalDispatcher(async () => results.shift()!, { concurrency: 1, breakerThreshold: 3, log: logger().log });
    for (let i = 0; i < 6; i++) dispatcher.send(notification(i));
    expect(await dispatcher.settle()).toMatchObject({ requested: 6, accepted: 2, failed: 4, skipped: 0 });
  });

  it("settle() is bounded: it never waits on a hanging hub beyond its budget", async () => {
    const dispatcher = createTakshalDispatcher(() => new Promise<TakshalSendResult>(() => {}), { concurrency: 1, settleBudgetMs: 50, log: logger().log });
    dispatcher.send(notification(1));
    dispatcher.send(notification(2));
    const started = Date.now();
    const report = await dispatcher.settle();
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(report).toMatchObject({ requested: 2, skipped: 1 }); // the queued one never started
  });

  it("sendAndWait() resolves with the outcome and never rejects", async () => {
    const dispatcher = createTakshalDispatcher(
      async () => {
        throw new Error("unexpected");
      },
      { log: logger().log },
    );
    await expect(dispatcher.sendAndWait(notification(1))).resolves.toEqual({ ok: false, reason: "network" });
  });

  it("logs outcome labels and a short event tail only", async () => {
    const { lines, log } = logger();
    const results: TakshalSendResult[] = [{ ok: false, reason: "http_error", status: 401 }, { ok: false, reason: "invalid_response", status: 200 }, OK];
    const dispatcher = createTakshalDispatcher(async () => results.shift()!, { concurrency: 1, log });
    for (let i = 0; i < 3; i++) dispatcher.send(notification(i));
    await dispatcher.settle();

    const text = lines.join("\n");
    expect(text).toContain("reason=http_401 event=…000000");
    expect(text).toContain("reason=invalid_response");
    expect(text).toContain("[takshal] run requested=3 accepted=1");
    for (const secret of [SECRET, "tester@example.com", "כותרת", "תוכן ההתראה", notification(0).eventId]) expect(text).not.toContain(secret);
  });

  it("logs nothing for a run that sent nothing", async () => {
    const { lines, log } = logger();
    await createTakshalDispatcher(async () => OK, { log }).settle();
    expect(lines).toEqual([]);
  });
});
