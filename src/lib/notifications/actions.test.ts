import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_NAME } from "@/lib/config/productName";

const getAuthenticatedIdentity = vi.fn();
const upsertPushSubscriptionForCurrentUser = vi.fn();
const findPushSubscriptionForCurrentUser = vi.fn();
const listActiveDevicesForCurrentUser = vi.fn();
const revokeDeviceForCurrentUser = vi.fn();
const revokeSubscriptionByEndpointForCurrentUser = vi.fn();
const touchPushSubscriptionForCurrentUser = vi.fn();
const sendPush = vi.fn();

vi.mock("@/lib/auth/currentUser", () => ({ getAuthenticatedIdentity: () => getAuthenticatedIdentity() }));
vi.mock("./subscriptionStore", () => ({
  upsertPushSubscriptionForCurrentUser: (...args: unknown[]) => upsertPushSubscriptionForCurrentUser(...args),
  findPushSubscriptionForCurrentUser: (...args: unknown[]) => findPushSubscriptionForCurrentUser(...args),
  listActiveDevicesForCurrentUser: (...args: unknown[]) => listActiveDevicesForCurrentUser(...args),
  revokeDeviceForCurrentUser: (...args: unknown[]) => revokeDeviceForCurrentUser(...args),
  revokeSubscriptionByEndpointForCurrentUser: (...args: unknown[]) =>
    revokeSubscriptionByEndpointForCurrentUser(...args),
  touchPushSubscriptionForCurrentUser: (...args: unknown[]) => touchPushSubscriptionForCurrentUser(...args),
}));
vi.mock("@/lib/push/sendPush", () => ({ sendPush: (...args: unknown[]) => sendPush(...args) }));

const {
  disablePushNotificationsAction,
  enablePushNotificationsAction,
  getPushSubscriptionStatusAction,
  heartbeatPushSubscriptionAction,
  listNotificationDevicesAction,
  removeNotificationDeviceAction,
  sendTestNotificationAction,
} = await import("./actions");

const AUTHENTICATED = { status: "authenticated" as const, userId: "u1", email: "dani@example.invalid", avatarUrl: null };
const VALID_RAW_SUBSCRIPTION = {
  endpoint: "https://push.example/e1",
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
  expirationTime: null,
};

/** An ACTIVE stored row, as `findPushSubscriptionForCurrentUser` now returns it. */
const ACTIVE_ROW = {
  id: "s1",
  endpoint: "https://push.example/e1",
  p256dh: "p256dh-key",
  auth: "auth-key",
  expirationTime: null,
  revokedAt: null,
  revokedReason: null,
};

beforeEach(() => {
  getAuthenticatedIdentity.mockReset().mockResolvedValue(AUTHENTICATED);
  upsertPushSubscriptionForCurrentUser.mockReset();
  findPushSubscriptionForCurrentUser.mockReset();
  listActiveDevicesForCurrentUser.mockReset().mockResolvedValue([]);
  revokeDeviceForCurrentUser.mockReset().mockResolvedValue(true);
  revokeSubscriptionByEndpointForCurrentUser.mockReset().mockResolvedValue(true);
  touchPushSubscriptionForCurrentUser.mockReset().mockResolvedValue(true);
  sendPush.mockReset();
});

describe("enablePushNotificationsAction", () => {
  it("rejects an unauthenticated caller before touching validation/persistence", async () => {
    getAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    const result = await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION, true);
    expect(result).toEqual({ ok: false, error: "not_authenticated" });
    expect(upsertPushSubscriptionForCurrentUser).not.toHaveBeenCalled();
  });

  it("rejects malformed subscription JSON, fails closed, never persists", async () => {
    const result = await enablePushNotificationsAction({ not: "a subscription" }, true);
    expect(result).toEqual({ ok: false, error: "invalid_subscription" });
    expect(upsertPushSubscriptionForCurrentUser).not.toHaveBeenCalled();
  });

  it("persists a valid subscription for the authenticated user with the explicit intent", async () => {
    upsertPushSubscriptionForCurrentUser.mockResolvedValue({ ok: true, subscription: ACTIVE_ROW });

    const result = await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION, true);
    expect(result).toEqual({ ok: true });
    expect(upsertPushSubscriptionForCurrentUser).toHaveBeenCalledWith(
      {
        endpoint: "https://push.example/e1",
        p256dh: "B".repeat(87),
        auth: "a".repeat(22),
        expirationTime: null,
      },
      "explicit",
      { type: null, platform: null, browser: null, standalone: null },
    );
  });

  it("forwards the silent auto-restore path as 'passive' -- the intent the database uses to refuse reviving a revoked device", async () => {
    upsertPushSubscriptionForCurrentUser.mockResolvedValue({ ok: true, subscription: ACTIVE_ROW });

    await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION, false);

    expect(upsertPushSubscriptionForCurrentUser.mock.calls[0][1]).toBe("passive");
  });

  it("only ever treats a literal `true` as explicit -- a truthy-but-not-true value can never upgrade the intent", async () => {
    upsertPushSubscriptionForCurrentUser.mockResolvedValue({ ok: true, subscription: ACTIVE_ROW });

    await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION, "yes" as unknown as boolean);

    expect(upsertPushSubscriptionForCurrentUser.mock.calls[0][1]).toBe("passive");
  });

  it("validates the client-supplied device descriptor against closed enums, discarding anything else (a raw User-Agent can never be stored)", async () => {
    upsertPushSubscriptionForCurrentUser.mockResolvedValue({ ok: true, subscription: ACTIVE_ROW });

    await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION, true, {
      type: "phone",
      platform: "ios",
      browser: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      standalone: true,
    });

    expect(upsertPushSubscriptionForCurrentUser.mock.calls[0][2]).toEqual({
      type: "phone",
      platform: "ios",
      browser: null,
      standalone: true,
    });
  });

  it("is idempotent -- calling it twice with the same subscription never errors, reuses the same upsert path", async () => {
    upsertPushSubscriptionForCurrentUser.mockResolvedValue({ ok: true, subscription: ACTIVE_ROW });

    const first = await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION, true);
    const second = await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION, true);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(upsertPushSubscriptionForCurrentUser).toHaveBeenCalledTimes(2);
  });

  it("surfaces a clean error when persistence fails, never throws", async () => {
    upsertPushSubscriptionForCurrentUser.mockResolvedValue({ ok: false, revoked: false, reason: "db error" });
    const result = await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION, true);
    expect(result).toEqual({ ok: false, error: "persist_failed" });
  });

  it("distinguishes a revoked device from an ordinary persistence failure", async () => {
    upsertPushSubscriptionForCurrentUser.mockResolvedValue({ ok: false, revoked: true, reason: "revoked" });
    const result = await enablePushNotificationsAction(VALID_RAW_SUBSCRIPTION, false);
    expect(result).toEqual({ ok: false, error: "revoked" });
  });
});

describe("disablePushNotificationsAction", () => {
  it("rejects an unauthenticated caller", async () => {
    getAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    const result = await disablePushNotificationsAction("https://push.example/e1");
    expect(result).toEqual({ ok: false });
    expect(revokeSubscriptionByEndpointForCurrentUser).not.toHaveBeenCalled();
  });

  it("REVOKES the given endpoint (never deletes it) so the device cannot silently re-register itself", async () => {
    const result = await disablePushNotificationsAction("https://push.example/e1");
    expect(revokeSubscriptionByEndpointForCurrentUser).toHaveBeenCalledWith(
      "https://push.example/e1",
      "self_disabled",
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects an empty/malformed endpoint without calling the store", async () => {
    const result = await disablePushNotificationsAction("");
    expect(result).toEqual({ ok: false });
    expect(revokeSubscriptionByEndpointForCurrentUser).not.toHaveBeenCalled();
  });
});

describe("getPushSubscriptionStatusAction", () => {
  const NOT_SUBSCRIBED = { subscribed: false, revoked: false, endpointDead: false };

  it("reports not subscribed for an unauthenticated caller", async () => {
    getAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    expect(await getPushSubscriptionStatusAction("https://push.example/e1")).toEqual(NOT_SUBSCRIBED);
  });

  it("reports not subscribed with no endpoint, without a network round trip", async () => {
    expect(await getPushSubscriptionStatusAction(null)).toEqual(NOT_SUBSCRIBED);
    expect(findPushSubscriptionForCurrentUser).not.toHaveBeenCalled();
  });

  it("reports subscribed when a matching ACTIVE row is found for the current user", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue(ACTIVE_ROW);
    expect(await getPushSubscriptionStatusAction("https://push.example/e1")).toEqual({
      subscribed: true,
      revoked: false,
      endpointDead: false,
    });
  });

  it("reports not subscribed when the browser has a subscription but no row exists for this user (different account previously subscribed, or cleaned up)", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue(null);
    expect(await getPushSubscriptionStatusAction("https://push.example/e1")).toEqual(NOT_SUBSCRIBED);
  });

  it("reports a remotely-removed device as NOT subscribed but revoked -- never as active", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue({
      ...ACTIVE_ROW,
      revokedAt: "2026-09-01T00:00:00.000Z",
      revokedReason: "user_removed",
    });
    expect(await getPushSubscriptionStatusAction("https://push.example/e1")).toEqual({
      subscribed: false,
      revoked: true,
      endpointDead: false,
    });
  });

  it("flags a 404/410-revoked endpoint as dead, so an explicit re-enable recreates the browser subscription instead of reusing it", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue({
      ...ACTIVE_ROW,
      revokedAt: "2026-09-01T00:00:00.000Z",
      revokedReason: "permanent_push_failure",
    });
    expect(await getPushSubscriptionStatusAction("https://push.example/e1")).toEqual({
      subscribed: false,
      revoked: true,
      endpointDead: true,
    });
  });
});

describe("heartbeatPushSubscriptionAction", () => {
  it("rejects an unauthenticated caller without touching the store", async () => {
    getAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    expect(await heartbeatPushSubscriptionAction("https://push.example/e1")).toEqual({ ok: false });
    expect(touchPushSubscriptionForCurrentUser).not.toHaveBeenCalled();
  });

  it("touches only the given endpoint, never passing any user id of its own", async () => {
    expect(await heartbeatPushSubscriptionAction("https://push.example/e1")).toEqual({ ok: true });
    expect(touchPushSubscriptionForCurrentUser).toHaveBeenCalledWith("https://push.example/e1", {
      type: null,
      platform: null,
      browser: null,
      standalone: null,
    });
  });

  it("forwards this device's coarse descriptor so a legacy row's missing metadata can be backfilled", async () => {
    await heartbeatPushSubscriptionAction("https://push.example/e1", {
      type: "desktop",
      platform: "windows",
      browser: "chrome",
      standalone: false,
    });

    expect(touchPushSubscriptionForCurrentUser.mock.calls[0][1]).toEqual({
      type: "desktop",
      platform: "windows",
      browser: "chrome",
      standalone: false,
    });
  });

  it("re-validates the descriptor against the same closed enums as an explicit enable -- a raw User-Agent can never reach the database through the heartbeat either", async () => {
    await heartbeatPushSubscriptionAction("https://push.example/e1", {
      type: "desktop",
      platform: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0",
      browser: "chrome",
      standalone: false,
    });

    expect(touchPushSubscriptionForCurrentUser.mock.calls[0][1]).toEqual({
      type: "desktop",
      platform: null,
      browser: "chrome",
      standalone: false,
    });
  });

  it("degrades to an all-null descriptor when none is supplied -- an omitted descriptor must never clear stored metadata", async () => {
    await heartbeatPushSubscriptionAction("https://push.example/e1");

    expect(touchPushSubscriptionForCurrentUser.mock.calls[0][1]).toEqual({
      type: null,
      platform: null,
      browser: null,
      standalone: null,
    });
  });

  it("reports ok:false rather than throwing when the store fails -- a heartbeat must never break the app", async () => {
    touchPushSubscriptionForCurrentUser.mockRejectedValue(new Error("boom"));
    expect(await heartbeatPushSubscriptionAction("https://push.example/e1")).toEqual({ ok: false });
  });

  it("reports ok:false for a revoked/unknown endpoint -- a heartbeat can never revive anything", async () => {
    touchPushSubscriptionForCurrentUser.mockResolvedValue(false);
    expect(await heartbeatPushSubscriptionAction("https://push.example/revoked")).toEqual({ ok: false });
  });
});

describe("listNotificationDevicesAction", () => {
  it("returns no devices for an unauthenticated caller, without querying", async () => {
    getAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    expect(await listNotificationDevicesAction("https://push.example/e1")).toEqual({ devices: [] });
    expect(listActiveDevicesForCurrentUser).not.toHaveBeenCalled();
  });

  it("passes the caller's own endpoint through only for current-device marking, normalizing an empty string to null", async () => {
    await listNotificationDevicesAction("");
    expect(listActiveDevicesForCurrentUser).toHaveBeenCalledWith(null);
  });

  it("degrades to an empty list rather than throwing", async () => {
    listActiveDevicesForCurrentUser.mockRejectedValue(new Error("boom"));
    expect(await listNotificationDevicesAction(null)).toEqual({ devices: [] });
  });
});

describe("removeNotificationDeviceAction", () => {
  it("rejects an unauthenticated caller without touching the store", async () => {
    getAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    expect(await removeNotificationDeviceAction("ref-1")).toEqual({ ok: false });
    expect(revokeDeviceForCurrentUser).not.toHaveBeenCalled();
  });

  it("revokes by device_ref with the user_removed reason -- a client can never choose the reason itself", async () => {
    expect(await removeNotificationDeviceAction("ref-1")).toEqual({ ok: true });
    expect(revokeDeviceForCurrentUser).toHaveBeenCalledWith("ref-1", "user_removed");
  });

  it("reports ok:false for a device_ref the caller does not own -- indistinguishable from one that does not exist", async () => {
    revokeDeviceForCurrentUser.mockResolvedValue(false);
    expect(await removeNotificationDeviceAction("someone-elses-ref")).toEqual({ ok: false });
  });

  it("rejects an empty device_ref without touching the store", async () => {
    expect(await removeNotificationDeviceAction("")).toEqual({ ok: false });
    expect(revokeDeviceForCurrentUser).not.toHaveBeenCalled();
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

  it("refuses to send to a REVOKED device -- it is not an active delivery target", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue({
      ...ACTIVE_ROW,
      revokedAt: "2026-09-01T00:00:00.000Z",
      revokedReason: "user_removed",
    });
    const result = await sendTestNotificationAction("https://push.example/e1");
    expect(result).toEqual({ ok: false, error: "not_subscribed" });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("sends the real test payload through lib/push once ownership is verified, carrying NO receipt token (it creates no delivery row to acknowledge)", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue(ACTIVE_ROW);
    sendPush.mockResolvedValue({ ok: true });

    const result = await sendTestNotificationAction("https://push.example/e1");

    expect(result).toEqual({ ok: true });
    expect(sendPush).toHaveBeenCalledTimes(1);
    const [subscriptionArg, payloadArg] = sendPush.mock.calls[0] as [
      unknown,
      { title: string; body: string; receiptToken?: string },
    ];
    expect(subscriptionArg).toEqual({ endpoint: "https://push.example/e1", p256dh: "p256dh-key", auth: "auth-key" });
    expect(payloadArg.title).toBe(`${APP_NAME} 🐮`);
    expect(payloadArg.body).toBe("ההתראות עובדות כמו שצריך 🎉");
    expect(payloadArg.receiptToken).toBeUndefined();
  });

  it("revokes the subscription as permanently dead on a permanent send failure", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue(ACTIVE_ROW);
    sendPush.mockResolvedValue({ ok: false, permanent: true, statusCode: 410, message: "gone" });

    const result = await sendTestNotificationAction("https://push.example/e1");

    expect(result).toEqual({ ok: false, error: "subscription_expired" });
    expect(revokeSubscriptionByEndpointForCurrentUser).toHaveBeenCalledWith(
      "https://push.example/e1",
      "permanent_push_failure",
    );
  });

  it("does NOT revoke the subscription on a transient send failure", async () => {
    findPushSubscriptionForCurrentUser.mockResolvedValue(ACTIVE_ROW);
    sendPush.mockResolvedValue({ ok: false, permanent: false, statusCode: 503, message: "try again" });

    const result = await sendTestNotificationAction("https://push.example/e1");

    expect(result).toEqual({ ok: false, error: "send_failed" });
    expect(revokeSubscriptionByEndpointForCurrentUser).not.toHaveBeenCalled();
  });
});
