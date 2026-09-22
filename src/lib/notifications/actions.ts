"use server";

import { getAuthenticatedIdentity } from "@/lib/auth/currentUser";
import { buildNotificationPayload, TEST_NOTIFICATION_PAYLOAD } from "@/lib/push/payload";
import { sendPush } from "@/lib/push/sendPush";
import { parseBrowserSubscription } from "@/lib/push/subscriptionValidation";
import { parseDeviceDescriptor, UNKNOWN_DEVICE_DESCRIPTOR } from "@/lib/push/deviceDescriptor";
import {
  findPushSubscriptionForCurrentUser,
  listActiveDevicesForCurrentUser,
  revokeDeviceForCurrentUser,
  revokeSubscriptionByEndpointForCurrentUser,
  touchPushSubscriptionForCurrentUser,
  upsertPushSubscriptionForCurrentUser,
} from "./subscriptionStore";
import type { OwnedPushDevice } from "./deviceTypes";

export type EnablePushResult = { ok: true } | { ok: false; error: string };

/**
 * Persists a browser `PushSubscription` for the authenticated user --
 * the ONLY server boundary that ever writes a `push_subscriptions` row.
 * Called after the client has already: (1) gotten explicit user consent
 * via the "הפעל התראות" click, (2) requested and received `"granted"`
 * Notification permission from THAT click, and (3) created/reused the
 * browser-level subscription. This action itself never requests
 * permission or talks to the push service -- it only validates and
 * persists.
 *
 * Fails closed: an unauthenticated caller or malformed subscription JSON
 * is rejected before ever reaching the database. Idempotent via the
 * underlying `upsert_push_subscription_v2` RPC (see
 * `subscriptionStore.ts`/the migration) -- calling this again for the
 * same device never creates a duplicate row.
 *
 * `explicit` is the reliability-critical argument and is REQUIRED. Only
 * a genuine user-initiated enable (`true`) may clear a revocation; the
 * silent auto-restore path passes `false` and is rejected outright by
 * the database against a revoked device, surfacing here as
 * `error: "revoked"`. See the migration's `p_explicit` gate for why this
 * decision lives in SQL rather than in this action.
 *
 * `rawDescriptor` is COARSE, client-computed device metadata
 * (phone/desktop, iOS/Windows, Safari/Chrome, standalone yes/no) and is
 * re-validated here against closed enums before it can reach the
 * database -- a raw User-Agent string, or anything else outside those
 * sets, is discarded rather than stored.
 */
export async function enablePushNotificationsAction(
  rawSubscription: unknown,
  explicit: boolean,
  rawDescriptor?: unknown,
): Promise<EnablePushResult> {
  const identity = await getAuthenticatedIdentity();
  if (identity.status !== "authenticated") {
    return { ok: false, error: "not_authenticated" };
  }

  const parsed = parseBrowserSubscription(rawSubscription);
  if (!parsed.ok) {
    return { ok: false, error: "invalid_subscription" };
  }

  const descriptor = rawDescriptor === undefined ? UNKNOWN_DEVICE_DESCRIPTOR : parseDeviceDescriptor(rawDescriptor);
  const result = await upsertPushSubscriptionForCurrentUser(
    parsed.subscription,
    explicit === true ? "explicit" : "passive",
    descriptor,
  );
  if (!result.ok) {
    return { ok: false, error: result.revoked ? "revoked" : "persist_failed" };
  }
  return { ok: true };
}

export interface DisablePushResult {
  ok: boolean;
}

/**
 * Deactivates the CURRENT device's subscription for the authenticated
 * user ("כבה התראות"). Best-effort/idempotent by design: whether or not
 * a row actually existed, the device ends up not subscribed either way.
 *
 * REVOKES rather than deletes, for the same reason remote removal does:
 * this device still holds a live browser `PushSubscription`, so a
 * deleted row could be silently recreated by the auto-restore path. The
 * device-local `"disabled"` preference is the first line of defense
 * against that; the server-side tombstone is the one that survives
 * cleared browser storage, a second tab that never learned about the
 * disable, and an old client still running the previous bundle.
 */
export async function disablePushNotificationsAction(endpoint: string): Promise<DisablePushResult> {
  const identity = await getAuthenticatedIdentity();
  if (identity.status !== "authenticated") return { ok: false };
  if (typeof endpoint !== "string" || endpoint.length === 0) return { ok: false };

  return { ok: await revokeSubscriptionByEndpointForCurrentUser(endpoint, "self_disabled") };
}

export interface PushSubscriptionStatus {
  subscribed: boolean;
  /**
   * This exact endpoint is known to the server but REVOKED for the
   * current user. Distinct from `subscribed: false` alone, which also
   * covers "never registered" and "belongs to another account": a
   * revoked device must not silently auto-restore, and -- when the
   * revocation came from a permanent (404/410) push failure -- its
   * browser subscription is known dead and must be recreated rather than
   * reused on the next explicit enable.
   *
   * Only ever reflects a row the CALLER owns (the lookup is RLS-scoped),
   * so this can never reveal anything about another account's device.
   */
  revoked: boolean;
  /** The revocation was the push service itself reporting this endpoint permanently gone -- the caller must unsubscribe and create a fresh browser subscription before re-enabling. */
  endpointDead: boolean;
}

const NOT_SUBSCRIBED: PushSubscriptionStatus = { subscribed: false, revoked: false, endpointDead: false };

/**
 * Whether THIS specific device (`endpoint`) has an active, server-
 * persisted subscription for the currently authenticated user --
 * deliberately NOT "does the browser have a PushSubscription object" and
 * NOT "does `Notification.permission` say granted" (see
 * `components/pwa/usePushSubscription.ts`'s docstring for why neither
 * alone is trustworthy, especially across an account switch on a shared
 * device). `endpoint === null` (no local browser subscription at all)
 * short-circuits to "not subscribed" without a network round trip.
 *
 * A REVOKED row reports `subscribed: false` -- it is not an active
 * delivery target and the UI must never claim otherwise -- plus the two
 * extra flags the client needs to decide what an explicit re-enable
 * should actually do.
 */
export async function getPushSubscriptionStatusAction(endpoint: string | null): Promise<PushSubscriptionStatus> {
  const identity = await getAuthenticatedIdentity();
  if (identity.status !== "authenticated") return NOT_SUBSCRIBED;
  if (!endpoint) return NOT_SUBSCRIBED;

  const stored = await findPushSubscriptionForCurrentUser(endpoint);
  if (stored === null) return NOT_SUBSCRIBED;
  if (stored.revokedAt !== null) {
    return {
      subscribed: false,
      revoked: true,
      endpointDead: stored.revokedReason === "permanent_push_failure",
    };
  }
  return { subscribed: true, revoked: false, endpointDead: false };
}

/**
 * The subscription HEARTBEAT ("this installation was actually opened").
 *
 * Intentionally the weakest write in this file: it can only move
 * `last_seen_at` forward on a row the authenticated caller ALREADY owns
 * and that is NOT revoked. It never creates a row, never reassigns
 * ownership, and never revives a revoked device -- all enforced inside
 * `touch_push_subscription` (see the migration), not merely by
 * convention here.
 *
 * Fails quietly by design: a heartbeat is diagnostic metadata, so an
 * unauthenticated caller, an unknown endpoint, a revoked device, and a
 * transport failure all return the same `{ ok: false }` and must never
 * surface as an error in the UI.
 *
 * It also carries this device's coarse descriptor, which backfills
 * LEGACY rows that predate device metadata -- filling ONLY the columns
 * still NULL, never overwriting one that already has a value (the
 * `coalesce` in `touch_push_subscription` is what guarantees that, not
 * this action). The descriptor is re-validated here against the same
 * closed enums as an explicit enable, so a raw User-Agent cannot reach
 * the database through the heartbeat either. It is a repair riding on a
 * call that was already happening, never a second request -- see
 * `PushDeviceProvider`, which owns the one-per-app-open deduplication.
 */
export interface PushHeartbeatResult {
  ok: boolean;
}

export async function heartbeatPushSubscriptionAction(
  endpoint: string,
  rawDescriptor?: unknown,
): Promise<PushHeartbeatResult> {
  const identity = await getAuthenticatedIdentity();
  if (identity.status !== "authenticated") return { ok: false };
  if (typeof endpoint !== "string" || endpoint.length === 0) return { ok: false };

  const descriptor = rawDescriptor === undefined ? UNKNOWN_DEVICE_DESCRIPTOR : parseDeviceDescriptor(rawDescriptor);
  try {
    return { ok: await touchPushSubscriptionForCurrentUser(endpoint, descriptor) };
  } catch {
    return { ok: false };
  }
}

export interface NotificationDevicesResult {
  devices: OwnedPushDevice[];
}

/**
 * "המכשירים שלי" -- every ACTIVE Push-capable installation owned by the
 * authenticated caller. Scoped by RLS on the database side, so it
 * structurally cannot return another account's devices.
 *
 * `currentEndpoint` never leaves the server: it is used solely to mark
 * which row is "המכשיר הזה" and is never echoed back. The returned rows
 * carry no endpoint, no encryption/auth key, no row id, and no raw
 * User-Agent -- only the opaque `deviceRef` handle plus coarse enum
 * metadata (see `lib/push/deviceDescriptor.ts`).
 */
export async function listNotificationDevicesAction(
  currentEndpoint: string | null,
): Promise<NotificationDevicesResult> {
  const identity = await getAuthenticatedIdentity();
  if (identity.status !== "authenticated") return { devices: [] };

  const normalizedEndpoint = typeof currentEndpoint === "string" && currentEndpoint.length > 0 ? currentEndpoint : null;
  try {
    return { devices: await listActiveDevicesForCurrentUser(normalizedEndpoint) };
  } catch {
    return { devices: [] };
  }
}

export interface RemoveNotificationDeviceResult {
  ok: boolean;
}

/**
 * "הסר מכשיר" -- revokes ONE of the caller's own devices by its opaque
 * `deviceRef`. Ownership is re-derived server-side inside
 * `revoke_push_subscription` (`user_id = auth.uid()`), never inferred
 * from the fact that the client knew a `deviceRef`, so a handle
 * belonging to someone else is indistinguishable from one that does not
 * exist.
 *
 * The removed device stops being an active delivery target immediately
 * and -- critically -- cannot bring itself back: neither its heartbeat
 * nor its silent auto-restore can clear the revocation, so opening it
 * later truthfully shows Push as not enabled until someone explicitly
 * presses "הפעל התראות" on that device.
 */
export async function removeNotificationDeviceAction(deviceRef: string): Promise<RemoveNotificationDeviceResult> {
  const identity = await getAuthenticatedIdentity();
  if (identity.status !== "authenticated") return { ok: false };
  if (typeof deviceRef !== "string" || deviceRef.length === 0) return { ok: false };

  try {
    return { ok: await revokeDeviceForCurrentUser(deviceRef, "user_removed") };
  } catch {
    return { ok: false };
  }
}

export type SendTestNotificationResult = { ok: true } | { ok: false; error: string };

/**
 * Sends PR #29's real end-to-end test push -- through the same
 * `lib/push` pipeline any future automated notification will use, never
 * a fake directly-constructed browser notification. `endpoint` is ALWAYS re-verified
 * server-side as belonging to the authenticated caller
 * (`findPushSubscriptionForCurrentUser`, RLS-scoped) before anything is
 * sent -- a client can never use this to push to a device it doesn't
 * own, even if it somehow knew that device's endpoint string.
 *
 * A REVOKED device is refused here exactly as an unknown one is: it is
 * not an active delivery target, and "send a test to a device you just
 * removed" has no coherent meaning.
 *
 * A permanently-invalid push response (see `sendPush`'s classification)
 * revokes the stale row here too, same as the delivery worker would --
 * this path is not a special case. It deliberately carries no receipt
 * token: the test push creates no `notification_jobs`/
 * `notification_deliveries` row to acknowledge, and inventing fake
 * delivery rows purely to exercise receipts would corrupt the very
 * counts this feature exists to make trustworthy.
 */
export async function sendTestNotificationAction(endpoint: string): Promise<SendTestNotificationResult> {
  const identity = await getAuthenticatedIdentity();
  if (identity.status !== "authenticated") return { ok: false, error: "not_authenticated" };
  if (typeof endpoint !== "string" || endpoint.length === 0) return { ok: false, error: "invalid_endpoint" };

  const stored = await findPushSubscriptionForCurrentUser(endpoint);
  if (!stored || stored.revokedAt !== null) return { ok: false, error: "not_subscribed" };

  const payload = buildNotificationPayload(TEST_NOTIFICATION_PAYLOAD);
  const result = await sendPush({ endpoint: stored.endpoint, p256dh: stored.p256dh, auth: stored.auth }, payload);

  if (!result.ok) {
    if (result.permanent) {
      await revokeSubscriptionByEndpointForCurrentUser(endpoint, "permanent_push_failure").catch(() => {});
    }
    return { ok: false, error: result.permanent ? "subscription_expired" : "send_failed" };
  }
  return { ok: true };
}
