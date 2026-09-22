import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaimedNotificationJob, DeliveryRow } from "./store";

const store = {
  claimDueNotificationJobs: vi.fn<() => Promise<ClaimedNotificationJob[]>>(),
  getActiveSubscriptionsForUser: vi.fn(),
  ensureDeliveryRows: vi.fn(async () => {}),
  getDeliveriesForJob: vi.fn(),
  updateDeliveryOutcome: vi.fn(async () => {}),
  // Explicitly typed so a test can read the receipt-token-hash argument
  // back; `vi.fn(async () => {})` would infer a zero-length tuple.
  beginDeliveryAttempt: vi.fn<(deliveryId: string, attempts: number, receiptTokenHash: string | null) => Promise<void>>(
    async () => {},
  ),
  revokePushSubscriptionById: vi.fn(async () => {}),
  setJobStatus: vi.fn(async () => {}),
};

const sendPush = vi.fn();

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.NOTIFICATION_WORKER_SECRET;
});

async function loadModule() {
  vi.doMock("./store", () => store);
  vi.doMock("@/lib/push/sendPush", () => ({ sendPush }));
  return import("./delivery");
}

function job(overrides: Partial<ClaimedNotificationJob> = {}): ClaimedNotificationJob {
  return {
    id: "job-1",
    category: "shift_change",
    recipientUserId: "user-1",
    title: "t",
    body: "b",
    path: "/schedule",
    tag: null,
    attempts: 1,
    maxAttempts: 5,
    ...overrides,
  };
}

/** A delivery row exactly as `getDeliveriesForJob` returns it -- `receivedAt` included, so a test never accidentally exercises a shape the store cannot produce. */
function delivery(overrides: Partial<DeliveryRow> & Pick<DeliveryRow, "id" | "pushSubscriptionId">): DeliveryRow {
  return { status: "pending", attempts: 0, receivedAt: null, ...overrides };
}

describe("runDelivery -- multi-device fan-out", () => {
  it("sends to both of a user's active subscriptions and completes the job when both succeed", async () => {
    store.claimDueNotificationJobs.mockResolvedValue([job()]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([
      { id: "sub-1", endpoint: "e1", p256dh: "k1", auth: "a1" },
      { id: "sub-2", endpoint: "e2", p256dh: "k2", auth: "a2" },
    ]);
    store.getDeliveriesForJob
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1" }),
        delivery({ id: "d2", pushSubscriptionId: "sub-2" }),
      ])
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "sent", attempts: 1 }),
        delivery({ id: "d2", pushSubscriptionId: "sub-2", status: "sent", attempts: 1 }),
      ]);
    sendPush.mockResolvedValue({ ok: true });

    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(summary.deliveriesSucceeded).toBe(2);
    expect(summary.jobsCompleted).toBe(1);
    expect(store.setJobStatus).toHaveBeenCalledWith("job-1", "completed", undefined);
  });

  it("a device that already succeeded is never re-attempted", async () => {
    store.claimDueNotificationJobs.mockResolvedValue([job()]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([
      { id: "sub-1", endpoint: "e1", p256dh: "k1", auth: "a1" },
      { id: "sub-2", endpoint: "e2", p256dh: "k2", auth: "a2" },
    ]);
    store.getDeliveriesForJob
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "sent", attempts: 1 }),
        delivery({ id: "d2", pushSubscriptionId: "sub-2" }),
      ])
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "sent", attempts: 1 }),
        delivery({ id: "d2", pushSubscriptionId: "sub-2", status: "sent", attempts: 1 }),
      ]);
    sendPush.mockResolvedValue({ ok: true });

    const { runDelivery } = await loadModule();
    await runDelivery();

    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("a permanent failure on one device revokes only that subscription; a succeeding sibling device still completes the job", async () => {
    store.claimDueNotificationJobs.mockResolvedValue([job()]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([
      { id: "sub-1", endpoint: "e1", p256dh: "k1", auth: "a1" },
      { id: "sub-2", endpoint: "e2", p256dh: "k2", auth: "a2" },
    ]);
    store.getDeliveriesForJob
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1" }),
        delivery({ id: "d2", pushSubscriptionId: "sub-2" }),
      ])
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "failed_permanent", attempts: 1 }),
        delivery({ id: "d2", pushSubscriptionId: "sub-2", status: "sent", attempts: 1 }),
      ]);
    sendPush
      .mockResolvedValueOnce({ ok: false, permanent: true, statusCode: 410, message: "gone" })
      .mockResolvedValueOnce({ ok: true });

    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    // 404/410 still takes the device out of the active set IMMEDIATELY --
    // but as a tombstone, so the device's own local "enabled" preference
    // cannot silently recreate the same dead endpoint on its next open.
    expect(store.revokePushSubscriptionById).toHaveBeenCalledTimes(1);
    expect(store.revokePushSubscriptionById).toHaveBeenCalledWith("sub-1");
    expect(summary.subscriptionsRemoved).toBe(1);
    expect(summary.jobsCompleted).toBe(1);
    expect(store.setJobStatus).toHaveBeenCalledWith("job-1", "completed", undefined);
  });

  it("a transient failure never revokes the subscription and leaves the job pending for retry", async () => {
    store.claimDueNotificationJobs.mockResolvedValue([job({ attempts: 1, maxAttempts: 5 })]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([{ id: "sub-1", endpoint: "e1", p256dh: "k1", auth: "a1" }]);
    store.getDeliveriesForJob
      .mockResolvedValueOnce([delivery({ id: "d1", pushSubscriptionId: "sub-1" })])
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "failed_transient", attempts: 1 }),
      ]);
    sendPush.mockResolvedValue({ ok: false, permanent: false, message: "timeout" });

    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    expect(store.revokePushSubscriptionById).not.toHaveBeenCalled();
    expect(summary.jobsPending).toBe(1);
    expect(store.setJobStatus).toHaveBeenCalledWith("job-1", "pending");
  });

  it("bounds retries: once the job's own attempts reach max_attempts, a still-transiently-failing job is marked failed, not retried forever", async () => {
    store.claimDueNotificationJobs.mockResolvedValue([job({ attempts: 5, maxAttempts: 5 })]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([{ id: "sub-1", endpoint: "e1", p256dh: "k1", auth: "a1" }]);
    store.getDeliveriesForJob
      .mockResolvedValueOnce([delivery({ id: "d1", pushSubscriptionId: "sub-1", attempts: 4 })])
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "failed_transient", attempts: 5 }),
      ]);
    sendPush.mockResolvedValue({ ok: false, permanent: false, message: "timeout" });

    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    expect(store.revokePushSubscriptionById).not.toHaveBeenCalled();
    expect(summary.jobsFailed).toBe(1);
    expect(store.setJobStatus).toHaveBeenCalledWith("job-1", "failed", "Exceeded max retry attempts.");
  });

  it("a recipient with zero active subscriptions is skipped without attempting a send", async () => {
    store.claimDueNotificationJobs.mockResolvedValue([job()]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([]);

    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    expect(sendPush).not.toHaveBeenCalled();
    expect(summary.jobsSkipped).toBe(1);
    expect(store.setJobStatus).toHaveBeenCalledWith("job-1", "skipped");
  });
});

describe("runDelivery -- delivery receipts", () => {
  it("gives each device its OWN receipt token and persists only the token's hash, never the token", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "test-worker-secret";
    store.claimDueNotificationJobs.mockResolvedValue([job()]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([
      { id: "sub-1", endpoint: "e1", p256dh: "k1", auth: "a1" },
      { id: "sub-2", endpoint: "e2", p256dh: "k2", auth: "a2" },
    ]);
    store.getDeliveriesForJob
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1" }),
        delivery({ id: "d2", pushSubscriptionId: "sub-2" }),
      ])
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "sent", attempts: 1 }),
        delivery({ id: "d2", pushSubscriptionId: "sub-2", status: "sent", attempts: 1 }),
      ]);
    sendPush.mockResolvedValue({ ok: true });

    const { runDelivery } = await loadModule();
    await runDelivery();

    const [, firstPayload] = sendPush.mock.calls[0] as [unknown, { receiptToken?: string }];
    const [, secondPayload] = sendPush.mock.calls[1] as [unknown, { receiptToken?: string }];
    expect(firstPayload.receiptToken).toMatch(/^[0-9a-f]{64}$/);
    expect(secondPayload.receiptToken).toMatch(/^[0-9a-f]{64}$/);
    // One device's payload can never acknowledge another device's
    // delivery -- that is what makes "ACK for one delivery cannot mutate
    // another" structural rather than a server-side check.
    expect(firstPayload.receiptToken).not.toBe(secondPayload.receiptToken);

    const storedHashes = store.beginDeliveryAttempt.mock.calls.map((call) => call[2]);
    expect(storedHashes).toHaveLength(2);
    for (const hash of storedHashes) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // The stored verifier is the HASH -- the token itself is never
    // persisted anywhere.
    expect(storedHashes).not.toContain(firstPayload.receiptToken);
    expect(storedHashes).not.toContain(secondPayload.receiptToken);
  });

  it("derives a STABLE token per delivery, so a retry cannot invalidate an in-flight receipt from the previous attempt", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "test-worker-secret";

    async function runOnce() {
      vi.clearAllMocks();
      vi.resetModules();
      store.claimDueNotificationJobs.mockResolvedValue([job()]);
      store.getActiveSubscriptionsForUser.mockResolvedValue([
        { id: "sub-1", endpoint: "e1", p256dh: "k1", auth: "a1" },
      ]);
      store.getDeliveriesForJob
        .mockResolvedValueOnce([delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "failed_transient" })])
        .mockResolvedValueOnce([
          delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "failed_transient", attempts: 1 }),
        ]);
      sendPush.mockResolvedValue({ ok: false, permanent: false, message: "timeout" });
      const { runDelivery } = await loadModule();
      await runDelivery();
      const [, payload] = sendPush.mock.calls[0] as [unknown, { receiptToken?: string }];
      return payload.receiptToken;
    }

    expect(await runOnce()).toBe(await runOnce());
  });

  it("sends no receipt token at all when no worker secret is configured -- receipts degrade silently, delivery is unaffected", async () => {
    store.claimDueNotificationJobs.mockResolvedValue([job()]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([{ id: "sub-1", endpoint: "e1", p256dh: "k1", auth: "a1" }]);
    store.getDeliveriesForJob
      .mockResolvedValueOnce([delivery({ id: "d1", pushSubscriptionId: "sub-1" })])
      .mockResolvedValueOnce([delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "sent", attempts: 1 })]);
    sendPush.mockResolvedValue({ ok: true });

    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    const [, payload] = sendPush.mock.calls[0] as [unknown, { receiptToken?: string }];
    expect(payload.receiptToken).toBeUndefined();
    expect(store.beginDeliveryAttempt).toHaveBeenCalledWith("d1", 0, null);
    expect(summary.deliveriesSucceeded).toBe(1);
  });

  it("TRANSIENT-SEND RACE: a delivery the device acknowledged is never re-sent, even though the server only ever recorded a transient failure for it", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "test-worker-secret";
    store.claimDueNotificationJobs.mockResolvedValue([job({ attempts: 2, maxAttempts: 5 })]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([{ id: "sub-1", endpoint: "e1", p256dh: "k1", auth: "a1" }]);
    // The row the previous tick left behind: the send looked transiently
    // failed, but the device in fact received it and ACKed afterwards.
    const acknowledged = delivery({
      id: "d1",
      pushSubscriptionId: "sub-1",
      status: "failed_transient",
      attempts: 1,
      receivedAt: "2026-09-21T17:00:00.000Z",
    });
    store.getDeliveriesForJob.mockResolvedValueOnce([acknowledged]).mockResolvedValueOnce([acknowledged]);

    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    expect(sendPush).not.toHaveBeenCalled();
    expect(store.beginDeliveryAttempt).not.toHaveBeenCalled();
    // The job is finished, not left pending for yet another retry.
    expect(summary.jobsCompleted).toBe(1);
    expect(store.setJobStatus).toHaveBeenCalledWith("job-1", "completed", undefined);
  });

  it("still retries a genuinely unreceived transient failure -- receipts narrow retries, they do not disable them", async () => {
    process.env.NOTIFICATION_WORKER_SECRET = "test-worker-secret";
    store.claimDueNotificationJobs.mockResolvedValue([job({ attempts: 2, maxAttempts: 5 })]);
    store.getActiveSubscriptionsForUser.mockResolvedValue([{ id: "sub-1", endpoint: "e1", p256dh: "k1", auth: "a1" }]);
    store.getDeliveriesForJob
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "failed_transient", attempts: 1 }),
      ])
      .mockResolvedValueOnce([
        delivery({ id: "d1", pushSubscriptionId: "sub-1", status: "failed_transient", attempts: 2 }),
      ]);
    sendPush.mockResolvedValue({ ok: false, permanent: false, message: "timeout" });

    const { runDelivery } = await loadModule();
    const summary = await runDelivery();

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(summary.jobsPending).toBe(1);
  });
});
