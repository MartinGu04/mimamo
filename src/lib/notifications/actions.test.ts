import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_NAME } from "@/lib/config/productName";

const getAuthenticatedIdentity = vi.fn();
const upsertPushSubscriptionForCurrentUser = vi.fn();
const deletePushSubscriptionForCurrentUser = vi.fn();
const findPushSubscriptionForCurrentUser = vi.fn();
const sendPush = vi.fn();

vi.mock("@/lib/auth/currentUser", () => ({ getAuthenticatedIdentity: () => getAuthenticatedIdentity() }));
vi.mock("./subscriptionStore", () => ({
  upsertPushSubscriptionForCurrentUser: (...args: unknown[]) => upsertPushSubscriptionForCurrentUser(...args),
  deletePushSubscriptionForCurrentUser: (...args: unknown[]) => deletePushSubscriptionForCurrentUser(...args),
  findPushSubscriptionForCurrentUser: (...args: unknown[]) => findPushSubscriptionForCurrentUser(...args),
}));
vi.mock("@/lib/push/sendPush", () => ({ sendPush: (...args: unknown[]) => sendPush(...args) }));

const {
  disablePushNotificationsAction,
  enablePushNotificationsAction,
  getPushSubscriptionStatusAction,
  sendTestNotificationAction,
} = await import("./actions");

const AUTHENTICATED = { status: "authenticated" as const, userId: "u1", email: "dani@example.invalid", avatarUrl: null };
const VALID_RAW_SUBSCRIPTION = {
  endpoint: "https://push.example/e1",
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
  expirationTime: null,
};

beforeEach(() => {
  getAuthenticatedIdentity.mockReset().mockResolvedValue(AUTHENTICATED);
  upsertPushSubscriptionForCurrentUser.mockReset();
  deletePushSubscriptionForCurrentUser.mockReset().mockResolvedValue({ ok: true });
  findPushSubscriptionForCurrentUser.mockReset();
  sendPush.mockReset();
});

describe("enablePushNotificationsAction", () => {
  it("rejects an unauthenticated caller before touching validation/persistence", async () => {
    getAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    const result = await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION);
    expect(result).toEqual({ ok: false, error: "not_authenticated" });
    expect(upsertPushSubscriptionForCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects malformed subscription JSON, fails closed, never persists", async () => {
    const result = await enablePushNotificationsAction({ not: "a subscription" });
    expect(result).toEqual({ ok: false, error: "invalid_subscription" });
    expect(upsertPushSubscriptionForCurrentUser).not.toHaveBeenCalled();
  });

  it("persists a valid subscription for the authenticated user", async () => {
    upsertPushSubscriptionForCurrentUser.mockResolvedValue({
      ok: true,
      subscription: { id: "s1", endpoint: "https://push.example/e1", p256dh: "x", auth: "y", expirationTime: null },
    });

    const result = await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION);
    expect(result).toEqual({ ok: true });
    expect(upsertPushSubscriptionForCurrentUser).toHaveBeenCalledWith({
      endpoint: "https://push.example/e1",
      p256dh: "B".repeat(87),
      auth: "a".repeat(22),
      expirationTime: null,
    });
  });

  it("is idempotent -- calling it twice with the same subscription never errors, reuses the same upsert path", async () => {
    upsertPushSubscriptionForCurrentUser.mockResolvedValue({
      ok: true,
      subscription: { id: "s1", endpoint: "https://push.example/e1", p256dh: "x", auth: "y", expirationTime: null },
    });

    const first = await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION);
    const second = await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(upsertPushSubscriptionForCurrentUser).toHaveBeenCalledTimes(2);
  });

  it("surfaces a clean error when persistence fails, never throws", async () => {
    upsertPushSubscriptionForCurrentUser.mockResolvedValue({ ok: false, reason: "db error" });
    const result = await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION);
    expect(result).toEqual({ ok: false, error: "persist_failed" });
  });
});

describe("disablePushNotificationsAction", () => {
  it("rejects an unauthenticated caller", async () => {
    getAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    const result = await disablePushNotificationsAction("https://push.example/e1");
    expect(result).toEqual({ ok: false });
    expect(deletePushSubscriptionForCurrentUser).not.toHaveBeenCalled();
  });

  it("deletes the given endpoint for the authenticated user", async () => {
    const result = await disablePushNotificationsAction("https://push.example/e1");
    expect(deletePushSubscriptionForCurrentUser).toHaveBeenCalledWith("https://push.example/e1");
    expect(result).toEqual({ ok: true });
  });

  it("rejects an empty/malformed endpoint without calling the store", async () => {
    const result = await disablePushNotificationsAction("");
    expect(result).toEqual({ ok: false });
    expect(deletePushSubscriptionForCurrentUser).not.toHaveBeenCalled();
  });
});

describe("getPushSubscriptionStatusAction", () => {
  it("reports not subscribed for an unauthenticated caller", async () => {
    getAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    const result = await getPushSubscriptionStatusAction("https://push.example/e1");
    expect(result).toEqual({ subscribed: false });
  });

  it("reports not subscribed with no endpoint, without a network round trip", async () => {
    const result = await getPushSubscriptionStatusAction(null);
    expect(result).toEqual({ subscribed: false });
    expect(findPushSubscriptionForCurrentUser).not.toHaveBeenCalled();
  });

  it("reports subscribed when a matching row is found for the current user", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue({
      id: "s1",
      endpoint: "https://push.example/e1",
      p256dh: "x",
      auth: "y",
      expirationTime: null,
    });
    const result = await getPushSubscriptionStatusAction("https://push.example/e1");
    expect(result).toEqual({ subscribed: true });
  });

  it("reports not subscribed when the browser has a subscription but no row exists for this user (different account previously subscribed, or cleaned up)", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue(null);
    const result = await getPushSubscriptionStatusAction("https://push.example/e1");
    expect(result).toEqual({ subscribed: false });
  });
});

describe("sendTestNotificationAction", () => {
  it("rejects an unauthenticated caller", async () => {
    getAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    const result = await sendTestNotificationAction("https://push.example/e1");
    expect(result).toEqual({ ok: false, error: "not_authenticated" });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("refuses to send when the endpoint isn't a subscription owned by the current user -- never sends to an unverified endpoint", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue(null);
    const result = await sendTestNotificationAction("https://push.example/someone-elses");
    expect(result).toEqual({ ok: false, error: "not_subscribed" });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("sends the real test payload through lib/push once ownership is verified", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue({
      id: "s1",
      endpoint: "https://push.example/e1",
      p256dh: "p256dh-key",
      auth: "auth-key",
      expirationTime: null,
    });
    sendPush.mockResolvedValue({ ok: true });

    const result = await sendTestNotificationAction("https://push.example/e1");

    expect(result).toEqual({ ok: true });
    expect(sendPush).toHaveBeenCalledTimes(1);
    const [subscriptionArg, payloadArg] = sendPush.mock.calls[0] as [unknown, { title: string; body: string }];
    expect(subscriptionArg).toEqual({ endpoint: "https://push.example/e1", p256dh: "p256dh-key", auth: "auth-key" });
    expect(payloadArg.title).toBe(`${APP_NAME} 🐮`);
    expect(payloadArg.body).toBe("ההתראות עובדות כמו שצריך 🎉");
  });

  it("removes the subscription on a permanent send failure", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue({
      id: "s1",
      endpoint: "https://push.example/e1",
      p256dh: "p",
      auth: "a",
      expirationTime: null,
    });
    sendPush.mockResolvedValue({ ok: false, permanent: true, statusCode: 410, message: "gone" });

    const result = await sendTestNotificationAction("https://push.example/e1");

    expect(result).toEqual({ ok: false, error: "subscription_expired" });
    expect(deletePushSubscriptionForCurrentUser).toHaveBeenCalledWith("https://push.example/e1");
  });

  it("does NOT remove the subscription on a transient send failure", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue({
      id: "s1",
      endpoint: "https://push.example/e1",
      p256dh: "p",
      auth: "a",
      expirationTime: null,
    });
    sendPush.mockResolvedValue({ ok: false, permanent: false, statusCode: 503, message: "try again" });

    const result = await sendTestNotificationAction("https://push.example/e1");

    expect(result).toEqual({ ok: false, error: "send_failed" });
    expect(deletePushSubscriptionForCurrentUser).not.toHaveBeenCalled();
  });
});
