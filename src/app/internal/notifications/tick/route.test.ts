import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ORIGINAL_SECRET = process.env.NOTIFICATION_WORKER_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.NOTIFICATION_WORKER_SECRET;
  else process.env.NOTIFICATION_WORKER_SECRET = ORIGINAL_SECRET;
  vi.clearAllMocks();
  vi.resetModules();
});

const runNotificationWorkerTick = vi.fn();

async function loadRoute(paused = false) {
  vi.doMock("@/lib/notifications/engine/pipeline", () => ({ runNotificationWorkerTick }));
  vi.doMock("@/lib/notifications/workerPause", () => ({ NOTIFICATION_WORKERS_PAUSED: paused }));
  return import("./route");
}

function request(url: string, authorization?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return new NextRequest(new URL(url, "https://example.com"), { method: "POST", headers });
}

describe("POST /internal/notifications/tick -- worker authentication", () => {
  it("rejects a request with no Authorization header before doing any work", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const { POST } = await loadRoute();

    const response = await POST(request("/internal/notifications/tick"));

    expect(response.status).toBe(401);
    expect(runNotificationWorkerTick).not.toHaveBeenCalled();
  });

  it("rejects the wrong secret before doing any work", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const { POST } = await loadRoute();

    const response = await POST(request("/internal/notifications/tick", "Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(runNotificationWorkerTick).not.toHaveBeenCalled();
  });

  it("fails closed while the emergency worker pause is active", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const { POST } = await loadRoute(true);

    const response = await POST(request("/internal/notifications/tick?mode=send", "Bearer correct-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "paused" });
    expect(runNotificationWorkerTick).not.toHaveBeenCalled();
  });

  it("accepts the correct secret and defaults to dry_run mode when no mode is specified", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    runNotificationWorkerTick.mockResolvedValue({ status: "ok", summary: { mode: "dry_run" } });
    const { POST } = await loadRoute();

    const response = await POST(request("/internal/notifications/tick", "Bearer correct-secret"));

    expect(response.status).toBe(200);
    expect(runNotificationWorkerTick).toHaveBeenCalledWith("dry_run");
  });

  it("only runs a real send when the secret is correct AND mode=send is explicit", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    runNotificationWorkerTick.mockResolvedValue({ status: "ok", summary: { mode: "send" } });
    const { POST } = await loadRoute();

    const response = await POST(request("/internal/notifications/tick?mode=send", "Bearer correct-secret"));

    expect(response.status).toBe(200);
    expect(runNotificationWorkerTick).toHaveBeenCalledWith("send");
  });

  it("an unrecognized mode value falls back to the safe dry_run default rather than sending", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    runNotificationWorkerTick.mockResolvedValue({ status: "ok", summary: { mode: "dry_run" } });
    const { POST } = await loadRoute();

    await POST(request("/internal/notifications/tick?mode=yes-please", "Bearer correct-secret"));

    expect(runNotificationWorkerTick).toHaveBeenCalledWith("dry_run");
  });

  it("never leaks internal error details in the response body", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    runNotificationWorkerTick.mockRejectedValue(new Error("some internal detail with a stack trace"));
    const { POST } = await loadRoute();

    const response = await POST(request("/internal/notifications/tick", "Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain("stack trace");
  });
});

describe("POST /internal/notifications/tick -- stage-aware diagnostic logging", () => {
  it("the HTTP response body is still the flat, generic error shape -- no stage/category/detail ever reaches the caller", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const { WorkerStageError } = await import("@/lib/notifications/engine/workerErrors");
    runNotificationWorkerTick.mockRejectedValue(
      new WorkerStageError("recipient_resolution", new Error("Supabase Admin API failed for alice@example.com")),
    );
    const { POST } = await loadRoute();

    const response = await POST(request("/internal/notifications/tick", "Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "internal_error" });
  });

  it("logs which stage failed", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const { WorkerStageError } = await import("@/lib/notifications/engine/workerErrors");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runNotificationWorkerTick.mockRejectedValue(new WorkerStageError("delivery", new Error("boom")));
    const { POST } = await loadRoute();

    await POST(request("/internal/notifications/tick", "Bearer correct-secret"));

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("stage=delivery"));
    consoleErrorSpy.mockRestore();
  });

  it("logs stage=unknown for an error that never went through a stage wrapper (still safe, still tagged)", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runNotificationWorkerTick.mockRejectedValue(new Error("untagged failure"));
    const { POST } = await loadRoute();

    await POST(request("/internal/notifications/tick", "Bearer correct-secret"));

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("stage=unknown"));
    consoleErrorSpy.mockRestore();
  });

  it("never logs an email, secret, or long opaque token embedded in the underlying error", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "super-secret-worker-value";
    const { WorkerStageError } = await import("@/lib/notifications/engine/workerErrors");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runNotificationWorkerTick.mockRejectedValue(
      new WorkerStageError(
        "recipient_resolution",
        new Error(
          "Admin API call failed for dana@example.com using token AbCdEf1234567890AbCdEf1234567890ZzYy at https://example.supabase.co/auth/v1/admin/users",
        ),
      ),
    );
    const { POST } = await loadRoute();

    await POST(request("/internal/notifications/tick", `Bearer ${process.env.NOTIFICATION_WORKER_SECRET}`));

    const loggedLines = consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedLines).not.toContain("dana@example.com");
    expect(loggedLines).not.toContain("AbCdEf1234567890AbCdEf1234567890ZzYy");
    expect(loggedLines).not.toContain("supabase.co");
    expect(loggedLines).not.toContain(process.env.NOTIFICATION_WORKER_SECRET);
    consoleErrorSpy.mockRestore();
  });

  it("distinguishes a missing SUPABASE_SERVICE_ROLE_KEY failure by category in the log", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const { WorkerStageError } = await import("@/lib/notifications/engine/workerErrors");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    class SupabaseServiceRoleConfigError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "SupabaseServiceRoleConfigError";
      }
    }
    runNotificationWorkerTick.mockRejectedValue(
      new WorkerStageError(
        "recipient_resolution",
        new SupabaseServiceRoleConfigError("Missing Supabase configuration: SUPABASE_SERVICE_ROLE_KEY."),
      ),
    );
    const { POST } = await loadRoute();

    await POST(request("/internal/notifications/tick", "Bearer correct-secret"));

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("category=missing_service_role_key"));
    consoleErrorSpy.mockRestore();
  });

  it("the existing typed configuration_error result (e.g. missing shift-start-time config) is logged with its own stage/category too", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runNotificationWorkerTick.mockResolvedValue({
      status: "configuration_error",
      message: 'Missing shift start time configuration ("תחילת משמרת יום").',
    });
    const { POST } = await loadRoute();

    const response = await POST(request("/internal/notifications/tick", "Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "configuration_error" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("stage=fresh_workbook_read"),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("category=shift_configuration_error"));
    consoleErrorSpy.mockRestore();
  });

  it("success behavior is unchanged: no error log is emitted and the summary is returned as-is", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "correct-secret";
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    runNotificationWorkerTick.mockResolvedValue({ status: "ok", summary: { mode: "dry_run", jobsCreated: 3 } });
    const { POST } = await loadRoute();

    const response = await POST(request("/internal/notifications/tick", "Bearer correct-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ mode: "dry_run", jobsCreated: 3 });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
