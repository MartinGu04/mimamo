import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ORIGINAL_SECRET = process.env.NOTIFICATION_WORKER_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.NOTIFICATION_WORKER_SECRET;
  else process.env.NOTIFICATION_WORKER_SECRET = ORIGINAL_SECRET;
  vi.clearAllMocks();
  vi.resetModules();
});

const runScheduledBroadcastWorkerTick = vi.fn();

async function loadRoute(paused = false) {
  vi.doMock("@/lib/notifications/engine/scheduledWorker", () => ({ runScheduledBroadcastWorkerTick }));
  vi.doMock("@/lib/notifications/workerPause", () => ({ NOTIFICATION_WORKERS_PAUSED: paused }));
  return import("./route");
}

function request(authorization?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new NextRequest(new URL("/internal/notifications/scheduled", "https://example.com"), {
    method: "POST",
    headers,
  });
}

describe("POST /internal/notifications/scheduled -- worker authentication", () => {
  it("rejects a request with no Authorization header before doing any work", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const { POST } = await loadRoute();

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(runScheduledBroadcastWorkerTick).not.toHaveBeenCalled();
  });

  it("rejects the wrong secret before doing any work", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const { POST } = await loadRoute();

    const response = await POST(request("Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(runScheduledBroadcastWorkerTick).not.toHaveBeenCalled();
  });

  it("fails closed while the emergency worker pause is active", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const { POST } = await loadRoute(true);

    const response = await POST(request("Bearer correct-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "paused" });
    expect(runScheduledBroadcastWorkerTick).not.toHaveBeenCalled();
  });

  it("reuses the EXACT SAME NOTIFICATION_WORKER_SECRET as /internal/notifications/tick -- no second secret", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "the-shared-worker-secret";
    runScheduledBroadcastWorkerTick.mockResolvedValue({ skipped: true, scheduledBroadcastsDue: 0 });
    const { POST } = await loadRoute();

    const response = await POST(request("Bearer the-shared-worker-secret"));

    expect(response.status).toBe(200);
    expect(runScheduledBroadcastWorkerTick).toHaveBeenCalledTimes(1);
  });

  it("accepts the correct secret and runs the tick", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    runScheduledBroadcastWorkerTick.mockResolvedValue({
      skipped: false,
      scheduledBroadcastsDue: 1,
      scheduledBroadcastsDispatched: 1,
      scheduledBroadcastsFailed: 0,
      jobsClaimed: 1,
      durationMs: 12,
    });
    const { POST } = await loadRoute();

    const response = await POST(request("Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      skipped: false,
      scheduledBroadcastsDue: 1,
      scheduledBroadcastsDispatched: 1,
      scheduledBroadcastsFailed: 0,
      jobsClaimed: 1,
      durationMs: 12,
    });
  });

  it("never leaks internal error details in the response body", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    runScheduledBroadcastWorkerTick.mockRejectedValue(new Error("some internal detail with a stack trace"));
    const { POST } = await loadRoute();

    const response = await POST(request("Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "internal_error" });
    expect(JSON.stringify(body)).not.toContain("stack trace");
  });
});

describe("POST /internal/notifications/scheduled -- stage-aware diagnostic logging", () => {
  it("logs which stage failed, PII-safely, same convention as the main tick route", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const { WorkerStageError } = await import("@/lib/notifications/engine/workerErrors");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runScheduledBroadcastWorkerTick.mockRejectedValue(
      new WorkerStageError("fresh_personnel_read", new Error("Google Sheets auth failed for alice@example.com")),
    );
    const { POST } = await loadRoute();

    const response = await POST(request("Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "internal_error" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("stage=fresh_personnel_read"));
    const loggedLines = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedLines).not.toContain("alice@example.com");
    consoleErrorSpy.mockRestore();
  });

  it("success behavior emits no error log", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runScheduledBroadcastWorkerTick.mockResolvedValue({ skipped: true, scheduledBroadcastsDue: 0 });
    const { POST } = await loadRoute();

    await POST(request("Bearer correct-secret"));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
