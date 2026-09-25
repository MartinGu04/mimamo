// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedNotificationJob, DeliveryRow } from "./store";

/**
 * `runDelivery()` with the optional TAKSHAL CTRL channel. Same store/push
 * mocking as `delivery.test.ts`; TAKSHAL CTRL itself is only ever reached
 * through a stubbed `fetch` -- never a real hub.
 */

const SECRET = "synthetic-source-secret-for-tests-0123456789";
const HUB = "https://hub.example";
const ENDPOINT = `${HUB}/api/source/machlava/notify`;

const store = {
  claimDueNotificationJobs: vi.fn<() => Promise<ClaimedNotificationJob[]>>(),
  getActiveSubscriptionsForUser: vi.fn(),
  ensureDeliveryRows: vi.fn(async () => {}),
  getDeliveriesForJob: vi.fn(),
  updateDeliveryOutcome: vi.fn(async () => {}),
  beginDeliveryAttempt: vi.fn<(deliveryId: string, attempts: number, receiptTokenHash: string | null) => Promise<void>>(async () => {}),
  revokePushSubscriptionById: vi.fn(async () => {}),
  setJobStatus: vi.fn(async () => {}),
};
const sendPush = vi.fn();
const fetchVerifiedEmailsByUserId = vi.fn<() => Promise<Map<string, string>>>();
const fetchMock = vi.fn<typeof fetch>();
let consoleLines: string[] = [];

const DIRECTORY = new Map([
  ["user-tester", "tester@example.com"],
  ["user-colleague", "colleague@example.com"],
]);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  consoleLines = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleLines.push(args.map(String).join(" "));
    });
  }
  fetchVerifiedEmailsByUserId.mockResolvedValue(DIRECTORY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  store.getDeliveriesForJob.mockReset();
  store.claimDueNotificationJobs.mockReset();
  sendPush.mockReset();
  fetchMock.mockReset();
});

function configureTakshal(testRecipients = "tester@example.com") {
  vi.stubEnv("TAKSHAL_CTRL_HUB_URL", HUB);
  vi.stubEnv("TAKSHAL_CTRL_SOURCE_SECRET", SECRET);
  vi.stubEnv("TAKSHAL_CTRL_TEST_RECIPIENTS", testRecipients);
}

async function loadModule() {
  vi.doMock("./store", () => store);
  vi.doMock("@/lib/push/sendPush", () => ({ sendPush }));
  vi.doMock("./recipients", async (importOriginal) => ({ ...(await importOriginal<typeof import("./recipients")>()), fetchVerifiedEmailsByUserId }));
  return import("./delivery");
}

function job(overrides: Partial<ClaimedNotificationJob> = {}): ClaimedNotificationJob {
  return {
    id: "3f7a0c52-1d7e-4c1b-9a53-0d6b2f1e8c11",
    category: "shift_change",
    recipientUserId: "user-colleague",
    title: "שינוי במשמרת",
    body: "המשמרת שלך עודכנה.",
    path: "/schedule",
    tag: null,
    attempts: 1,
    maxAttempts: 5,
    ...overrides,
  };
}

function delivery(overrides: Partial<DeliveryRow> & Pick<DeliveryRow, "id" | "pushSubscriptionId">): DeliveryRow {
  return { status: "pending", attempts: 0, receivedAt: null, ...overrides };
}

/** One job, one direct device, the direct push succeeds. */
function directSuccess(jobOverrides: Partial<ClaimedNotificationJob> = {}) {
  store.claimDueNotificationJobs.mockResolvedValue([job(jobOverrides)]);
  store.getActiveSubscriptionsForUser.mockResolvedValue([{ id: "sub-1", endpoint: "https://push.example/device-1", p256dh: "k1", auth: "a1" }]);
  store.getDeliveriesForJob
    .mockResolvedValueOnce([delivery({ id: "d1", pushSubscriptionId: "sub-1" })])
    .mockResolvedValueOnce([delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "sent", attempts: 1 })]);
  sendPush.mockResolvedValue({ ok: true });
}

const hubReply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const DELIVERED = { accepted: true, delivered: 1, failed: 0, removed: 0 };

/** Everything the direct pipeline did, in order -- to prove it is identical with and without the channel. */
function directTrace() {
  return JSON.stringify({
    store: Object.fromEntries(Object.entries(store).map(([name, fn]) => [name, fn.mock.calls])),
    sendPush: sendPush.mock.calls,
  });
}

async function directBaseline(jobOverrides: Partial<ClaimedNotificationJob> = {}) {
  directSuccess(jobOverrides);
  const { runDelivery } = await loadModule();
  const summary = await runDelivery();
  const trace = directTrace();
  vi.clearAllMocks();
  vi.resetModules();
  store.getDeliveriesForJob.mockReset();
  return { summary, trace };
}

function sentRequests() {
  return fetchMock.mock.calls.map(([url, init]) => ({ url, headers: init?.headers, body: JSON.parse(init?.body as string) }));
}

describe("runDelivery + TAKSHAL CTRL -- channel off", () => {
  it("no configuration: existing direct behavior unchanged, no hub call, no identity lookup", async () => {
    directSuccess();
    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(store.setJobStatus).toHaveBeenCalledWith(job().id, "completed", undefined);
    expect(summary).toMatchObject({ jobsClaimed: 1, jobsCompleted: 1, deliveriesSucceeded: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchVerifiedEmailsByUserId).not.toHaveBeenCalled();
  });

  it("secret without a hub URL: channel off, direct unchanged", async () => {
    vi.stubEnv("TAKSHAL_CTRL_SOURCE_SECRET", SECRET);
    vi.stubEnv("TAKSHAL_CTRL_TEST_RECIPIENTS", "tester@example.com");
    directSuccess({ recipientUserId: "user-tester" });
    const { runDelivery } = await loadModule();
    await runDelivery();

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleLines.join("\n")).toContain("[takshal] channel off: TAKSHAL_CTRL_HUB_URL is not set");
  });

  it("empty allowlist: no hub call and no identity lookup, even for everyone", async () => {
    configureTakshal("");
    directSuccess({ recipientUserId: "user-tester" });
    const { runDelivery } = await loadModule();
    await runDelivery();

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchVerifiedEmailsByUserId).not.toHaveBeenCalled();
  });

  it("no claimed jobs: nothing at all happens", async () => {
    configureTakshal();
    store.claimDueNotificationJobs.mockResolvedValue([]);
    const { runDelivery } = await loadModule();
    await runDelivery();
    expect(fetchVerifiedEmailsByUserId).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("runDelivery + TAKSHAL CTRL -- rollout allowlist", () => {
  it("a non-allowlisted recipient gets exactly the existing direct delivery, and no hub call", async () => {
    const baseline = await directBaseline();

    configureTakshal();
    directSuccess();
    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    expect(directTrace()).toBe(baseline.trace);
    expect(summary).toEqual(baseline.summary);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an allowlisted recipient gets direct + TAKSHAL CTRL: the direct path is identical, and one hub request is added", async () => {
    const baseline = await directBaseline({ recipientUserId: "user-tester" });

    configureTakshal(" TESTER@example.com ");
    directSuccess({ recipientUserId: "user-tester" });
    fetchMock.mockResolvedValue(hubReply(200, DELIVERED));
    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    expect(directTrace()).toBe(baseline.trace);
    expect(summary).toEqual(baseline.summary);
    expect(sentRequests()).toEqual([
      {
        url: ENDPOINT,
        headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
        body: {
          version: 1,
          eventId: `job:${job().id}`,
          recipientEmail: "tester@example.com",
          title: "שינוי במשמרת",
          body: "המשמרת שלך עודכנה.",
          target: "/schedule",
        },
      },
    ]);
    expect(consoleLines.join("\n")).toContain("[takshal] run requested=1 accepted=1 devices=1");
  });

  it("the hub request is started alongside the direct fan-out, not after it", async () => {
    configureTakshal();
    directSuccess({ recipientUserId: "user-tester" });
    fetchMock.mockResolvedValue(hubReply(200, DELIVERED));
    const { runDelivery } = await loadModule();
    await runDelivery();
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(sendPush.mock.invocationCallOrder[0]!);
  });

  it("looks up verified identities once per run, not once per job", async () => {
    configureTakshal();
    const jobs = [job({ id: "job-a", recipientUserId: "user-tester" }), job({ id: "job-b", recipientUserId: "user-colleague" }), job({ id: "job-c", recipientUserId: "user-tester" })];
    store.claimDueNotificationJobs.mockResolvedValue(jobs);
    store.getActiveSubscriptionsForUser.mockResolvedValue([]);
    fetchMock.mockImplementation(async () => hubReply(200, DELIVERED));
    const { runDelivery } = await loadModule();
    await runDelivery();

    expect(fetchVerifiedEmailsByUserId).toHaveBeenCalledTimes(1);
    expect(sentRequests().map((request) => request.body.eventId)).toEqual(["job:job-a", "job:job-c"]);
  });

  it("a recipient with no direct device: the job is skipped exactly as before, and TAKSHAL CTRL is still offered it", async () => {
    configureTakshal();
    store.claimDueNotificationJobs.mockResolvedValue([job({ recipientUserId: "user-tester" })]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([]);
    fetchMock.mockResolvedValue(hubReply(200, DELIVERED));
    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    expect(store.setJobStatus).toHaveBeenCalledWith(job().id, "skipped");
    expect(summary).toMatchObject({ jobsSkipped: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("runDelivery + TAKSHAL CTRL -- the hub failing never affects direct delivery", () => {
  async function runWithHub(respond: typeof fetch) {
    const baseline = await directBaseline({ recipientUserId: "user-tester" });
    configureTakshal();
    directSuccess({ recipientUserId: "user-tester" });
    fetchMock.mockImplementation(respond);
    const { runDelivery } = await loadModule();
    return { baseline, run: runDelivery };
  }

  it("hub timeout: direct delivery still succeeds, and the run stays bounded", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { baseline, run } = await runWithHub(
      (_url, init) => new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    const running = run();
    await vi.advanceTimersByTimeAsync(10_000);
    const summary = await running;

    expect(summary).toEqual(baseline.summary);
    expect(directTrace()).toBe(baseline.trace);
    expect(consoleLines.join("\n")).toContain("[takshal] delivery failed reason=timeout");
  });

  it.each([
    ["HTTP 503", async () => hubReply(503, { error: "not-configured" }), "reason=http_503"],
    ["HTTP 401 (secret mismatch)", async () => hubReply(401, { error: "unauthorized" }), "reason=http_401"],
    ["a malformed response", async () => new Response("<html>502</html>", { status: 200 }), "reason=invalid_response"],
    ["an unexpected JSON shape", async () => hubReply(200, { ok: 1 }), "reason=invalid_response"],
    [
      "a network error",
      async () => {
        throw new TypeError("fetch failed");
      },
      "reason=network",
    ],
  ])("%s: direct delivery still succeeds", async (_name, respond, logged) => {
    const { baseline, run } = await runWithHub(respond as typeof fetch);
    const summary = await run();

    expect(summary).toEqual(baseline.summary);
    expect(directTrace()).toBe(baseline.trace);
    expect(consoleLines.join("\n")).toContain(logged);
  });

  it("identity lookup failure: this run is direct-only, nothing breaks", async () => {
    const baseline = await directBaseline({ recipientUserId: "user-tester" });
    configureTakshal();
    directSuccess({ recipientUserId: "user-tester" });
    fetchVerifiedEmailsByUserId.mockRejectedValue(Object.assign(new Error("admin api down for tester@example.com"), { name: "AuthApiError", status: 500 }));
    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    expect(summary).toEqual(baseline.summary);
    expect(fetchMock).not.toHaveBeenCalled();
    const logs = consoleLines.join("\n");
    expect(logs).toContain("[takshal] verified-email directory unavailable; direct delivery only this run error=AuthApiError");
    expect(logs).not.toContain("tester@example.com");
  });

  it("identity lookup hanging: bounded, then direct-only", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    configureTakshal();
    directSuccess({ recipientUserId: "user-tester" });
    fetchVerifiedEmailsByUserId.mockReturnValue(new Promise(() => {}));
    const { runDelivery } = await loadModule();
    const running = runDelivery();
    await vi.advanceTimersByTimeAsync(5_000);
    const summary = await running;

    expect(summary).toMatchObject({ jobsCompleted: 1, deliveriesSucceeded: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleLines.join("\n")).toContain("error=TakshalDirectoryTimeoutError");
  });

  it("never logs the secret, the recipient, a push endpoint, the job id or notification text", async () => {
    const { run } = await runWithHub(async () => hubReply(500, { error: `echo ${SECRET}` }));
    await run();
    const logs = consoleLines.join("\n");
    expect(logs).toContain("[takshal]");
    for (const secret of [SECRET, "tester@example.com", "https://push.example/device-1", job().id, "שינוי במשמרת", "המשמרת שלך עודכנה."]) {
      expect(logs).not.toContain(secret);
    }
  });
});

describe("runDelivery + TAKSHAL CTRL -- identity and event id", () => {
  it("the event id is stable across retries of the same job", async () => {
    configureTakshal();
    fetchMock.mockImplementation(async () => hubReply(200, DELIVERED));
    for (const attempts of [1, 2]) {
      store.claimDueNotificationJobs.mockResolvedValue([job({ recipientUserId: "user-tester", attempts })]);
      store.getActiveSubscriptionsForUser.mockResolvedValue([]);
      const { runDelivery } = await loadModule();
      await runDelivery();
      vi.resetModules();
    }
    expect(sentRequests().map((request) => request.body.eventId)).toEqual([`job:${job().id}`, `job:${job().id}`]);
  });

  it("the recipient email is the job recipient's own verified address -- nothing else", async () => {
    configureTakshal("tester@example.com,colleague@example.com");
    // `user-unverified` has no confirmed address in Supabase Auth, so is absent from the directory.
    store.claimDueNotificationJobs.mockResolvedValue([job({ id: "job-a", recipientUserId: "user-colleague" }), job({ id: "job-b", recipientUserId: "user-unverified" })]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([]);
    fetchMock.mockImplementation(async () => hubReply(200, DELIVERED));
    const { runDelivery } = await loadModule();
    await runDelivery();

    expect(sentRequests().map((request) => [request.body.eventId, request.body.recipientEmail])).toEqual([["job:job-a", "colleague@example.com"]]);
  });

  it("maps the job's path to a safe relative target, never a URL", async () => {
    configureTakshal();
    fetchMock.mockImplementation(async () => hubReply(200, DELIVERED));
    store.claimDueNotificationJobs.mockResolvedValue([
      job({ id: "job-a", recipientUserId: "user-tester", path: "/duties" }),
      job({ id: "job-b", recipientUserId: "user-tester", path: "https://evil.example/x" }),
      job({ id: "job-c", recipientUserId: "user-tester", path: "" }),
    ]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([]);
    const { runDelivery } = await loadModule();
    await runDelivery();

    expect(sentRequests().map((request) => request.body.target)).toEqual(["/duties", "/", "/"]);
  });
});

describe("runDelivery + TAKSHAL CTRL -- channel `takshal` (future preference; not produced by the rollout policy)", () => {
  async function loadWithTakshalOnlyPolicy() {
    vi.doMock("@/lib/notifications/deliveryChannel", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/lib/notifications/deliveryChannel")>()),
      testRecipientAllowlistPolicy: () => ({ channelFor: () => "takshal" as const }),
    }));
    configureTakshal();
    return loadModule();
  }

  it.each([
    [DELIVERED, "completed"],
    [{ accepted: true, duplicate: true, delivered: 0 }, "completed"],
    [{ accepted: true, delivered: 0, reason: "no_active_subscription" }, "skipped"],
  ])("hub answers %j -> job %s, and no direct push is attempted", async (reply, status) => {
    store.claimDueNotificationJobs.mockResolvedValue([job({ recipientUserId: "user-tester" })]);
    fetchMock.mockResolvedValue(hubReply(200, reply));
    const { runDelivery } = await loadWithTakshalOnlyPolicy();
    await runDelivery();

    expect(sendPush).not.toHaveBeenCalled();
    expect(store.getActiveSubscriptionsForUser).not.toHaveBeenCalled();
    expect(store.setJobStatus).toHaveBeenCalledWith(job().id, status);
  });

  it("a hub failure leaves the job pending for the existing bounded job-level retry, then failed", async () => {
    fetchMock.mockImplementation(async () => hubReply(503, { error: "x" }));
    store.claimDueNotificationJobs.mockResolvedValue([job({ recipientUserId: "user-tester", attempts: 1, maxAttempts: 5 })]);
    let { runDelivery } = await loadWithTakshalOnlyPolicy();
    expect(await runDelivery()).toMatchObject({ jobsPending: 1 });
    expect(store.setJobStatus).toHaveBeenLastCalledWith(job().id, "pending");

    vi.resetModules();
    store.claimDueNotificationJobs.mockResolvedValue([job({ recipientUserId: "user-tester", attempts: 5, maxAttempts: 5 })]);
    ({ runDelivery } = await loadWithTakshalOnlyPolicy());
    expect(await runDelivery()).toMatchObject({ jobsFailed: 1 });
    expect(store.setJobStatus).toHaveBeenLastCalledWith(job().id, "failed", "TAKSHAL CTRL delivery failed.");
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("a recipient without a verified email is never dropped: direct delivery instead", async () => {
    directSuccess({ recipientUserId: "user-unverified" });
    const { runDelivery } = await loadWithTakshalOnlyPolicy();
    await runDelivery();
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
