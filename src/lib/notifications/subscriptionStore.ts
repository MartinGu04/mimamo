import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RawPushSubscription } from "@/lib/push/subscriptionValidation";
import { parseDeviceDescriptor, type PushDeviceDescriptor } from "@/lib/push/deviceDescriptor";
import type { OwnedPushDevice } from "./deviceTypes";

/** The persisted shape (camelCase), never the raw DB row -- callers never see Supabase's snake_case column names. */
export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime: string | null;
  /** Non-null = this installation has been revoked and is no longer an active delivery target -- see the device-management migration. */
  revokedAt: string | null;
  revokedReason: string | null;
}

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

function toStoredSubscription(row: PushSubscriptionRow): StoredPushSubscription {
  return {
    id: row.id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    expirationTime: row.expiration_time,
    revokedAt: row.revoked_at,
    revokedReason: row.revoked_reason,
  };
}

/**
 * Creates or reassigns (see the migration's own comment for why
 * reassignment is sometimes legitimate -- the shared-device/account-
 * switch case) the subscription row for `subscription.endpoint`, owned
 * by the CURRENTLY authenticated Supabase user. Always goes through the
 * `upsert_push_subscription_v2` RPC (SECURITY DEFINER, derives ownership
 * from `auth.uid()` server-side) -- never a plain `.insert()`/`.update()`
 * call, and never passes any client-supplied user id. Idempotent:
 * calling this again with the same endpoint updates the existing row
 * rather than creating a duplicate.
 *
 * `intent` is the whole reliability story of this function and is
 * REQUIRED, never defaulted:
 *
 *   "explicit"  -- the user just pressed "הפעל התראות" on this exact
 *                  device. The only intent allowed to clear a revocation
 *                  and the only one that records device metadata.
 *   "passive"   -- the silent auto-restore path re-binding an already-
 *                  granted browser subscription on load. Can never
 *                  revive a device that was removed from another device,
 *                  nor one whose endpoint the push service already
 *                  reported permanently gone; the RPC rejects it outright
 *                  and this returns `{ ok: false, revoked: true }`.
 *
 * The distinction is enforced in the database, not here -- see the
 * migration's `p_explicit` gate -- so a future caller cannot accidentally
 * opt out of it.
 */
export type PushSubscriptionUpsertIntent = "explicit" | "passive";

export type UpsertPushSubscriptionResult =
  | { ok: true; subscription: StoredPushSubscription }
  | { ok: false; revoked: boolean; reason: string };

/** The RPC's one generic revocation error, matched by message because PostgREST surfaces a `raise exception` as an opaque error rather than a typed code. Kept in lockstep with the migration's own `raise exception` text. */
const REVOKED_EXCEPTION_FRAGMENT = "revoked";

export async function upsertPushSubscriptionForCurrentUser(
  subscription: RawPushSubscription,
  intent: PushSubscriptionUpsertIntent,
  descriptor: PushDeviceDescriptor,
): Promise<UpsertPushSubscriptionResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .rpc("upsert_push_subscription_v2", {
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.p256dh,
      p_auth: subscription.auth,
      p_expiration_time:
        subscription.expirationTime === null ? null : new Date(subscription.expirationTime).toISOString(),
      p_explicit: intent === "explicit",
      p_device_type: descriptor.type,
      p_device_platform: descriptor.platform,
      p_device_browser: descriptor.browser,
      p_device_standalone: descriptor.standalone,
    })
    .single<PushSubscriptionRow>();

  if (error || !data) {
    const message = error?.message ?? "Failed to persist push subscription.";
    return { ok: false, revoked: message.includes(REVOKED_EXCEPTION_FRAGMENT), reason: message };
  }
  return { ok: true, subscription: toStoredSubscription(data) };
}

/**
 * Best-effort delete of the CURRENT user's row for one specific device
 * (`endpoint`) -- RLS (`user_id = auth.uid()`) already guarantees this
 * can only ever remove a row the caller owns, so no extra `user_id`
 * filter is needed for safety; it's added anyway for query precision.
 * Returns quietly (does not throw) whether or not a row actually existed
 * to delete -- both "already gone" and "successfully removed" are a
 * clean outcome.
 *
 * SIGN-OUT CLEANUP ONLY -- `lib/auth/actions.ts` is now the single
 * caller, and this is deliberately the one remaining path that DELETES
 * rather than revokes. Every user-initiated removal (the local
 * "כבה התראות", "הסר מכשיר" on another device) and the worker's own
 * permanent-failure cleanup revoke instead, precisely so the device
 * cannot silently re-register itself later. Sign-out is the opposite
 * case by design: the SAME user logging back in on this device is
 * expected to have their remembered "enabled" choice silently restore
 * push (see `pushPreference.ts`), and a tombstone here would break that
 * documented behavior for no safety gain -- nothing was removed or
 * disabled, the session simply ended.
 */
export async function deletePushSubscriptionForCurrentUser(endpoint: string): Promise<{ ok: boolean }> {
  const supabase = await createSupabaseServerClient();
  // `revoked_at is null` is what stops sign-out from quietly destroying a
  // TOMBSTONE. Without it, a device removed from elsewhere could be
  // resurrected by the most ordinary sequence there is: sign out on that
  // device (deleting the revoked row), sign back in, and let the still-
  // remembered "enabled" preference silently register a brand-new row
  // for an endpoint nobody ever re-authorized. A revoked device stays
  // revoked across sign-out; only an explicit enable on it changes that.
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .is("revoked_at", null);
  return { ok: !error };
}

/**
 * Looks up the CURRENT user's subscription row for one specific device
 * endpoint -- RLS-scoped, so this can never return (or even reveal the
 * existence of) another user's row for the same or a different endpoint.
 * `null` covers both "no such row" and "exists but belongs to someone
 * else" identically -- the caller never needs to (and, from an RLS-
 * scoped client, structurally cannot) distinguish the two.
 */
export async function findPushSubscriptionForCurrentUser(endpoint: string): Promise<StoredPushSubscription | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, expiration_time, revoked_at, revoked_reason")
    .eq("endpoint", endpoint)
    .maybeSingle<PushSubscriptionRow>();

  if (error || !data) return null;
  return toStoredSubscription(data);
}

/**
 * The subscription HEARTBEAT -- "this installation is currently open,
 * authenticated as this user, and still holding this exact endpoint".
 *
 * Distinct from every other function here in what it deliberately CANNOT
 * do, all enforced inside `touch_push_subscription` rather than trusted
 * to callers: it never creates a row, never reassigns ownership, never
 * clears a revocation, and never touches a row belonging to anyone but
 * `auth.uid()`. It only ever moves `last_seen_at` forward on an already-
 * active row the caller already owns.
 *
 * Returns whether a row was actually touched, purely so the caller can
 * avoid pointless retries -- `false` covers "no such endpoint",
 * "belongs to a different account", and "revoked" identically, which is
 * also why it is not an endpoint-existence oracle.
 *
 * `descriptor` additionally backfills LEGACY metadata. Every row
 * registered before device metadata existed has NULL
 * type/platform/browser/standalone, so the device list can only call it
 * "מכשיר". The RPC fills each of those columns with `coalesce(<column>,
 * <argument>)`, so a column that already holds a value keeps it and only
 * the genuinely missing ones are filled -- this is a repair path, never
 * a second way to write device metadata. Passing the descriptor here
 * rather than from a call of its own is deliberate: the heartbeat
 * already fires once per app open and already runs only after the
 * endpoint has been server-verified as this user's ACTIVE subscription,
 * which is exactly the precondition a backfill needs.
 */
export async function touchPushSubscriptionForCurrentUser(
  endpoint: string,
  descriptor: PushDeviceDescriptor,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("touch_push_subscription", {
    p_endpoint: endpoint,
    p_device_type: descriptor.type,
    p_device_platform: descriptor.platform,
    p_device_browser: descriptor.browser,
    p_device_standalone: descriptor.standalone,
  });
  if (error) return false;
  return data === true;
}

interface OwnedPushDeviceRow {
  endpoint: string;
  device_ref: string;
  device_type: string | null;
  device_platform: string | null;
  device_browser: string | null;
  device_standalone: boolean | null;
  last_seen_at: string;
  last_received_at: string | null;
  created_at: string;
}

/**
 * Every ACTIVE Push-capable installation owned by the CURRENT user,
 * newest-seen first. RLS (`user_id = auth.uid()`) scopes this on the
 * database side, so it structurally cannot return another account's
 * devices even if a bug removed every filter here.
 *
 * Revoked rows are excluded: they are tombstones that exist to block
 * silent resurrection, not devices the user still has. Showing them
 * would imply they could still receive notifications, which is precisely
 * the false impression this whole feature set exists to remove.
 *
 * `currentEndpoint` is used ONLY to mark which row is "המכשיר הזה", and
 * only ever by equality against rows the caller already owns -- it is
 * never persisted, never logged, and never returned.
 */
export async function listActiveDevicesForCurrentUser(currentEndpoint: string | null): Promise<OwnedPushDevice[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, device_ref, device_type, device_platform, device_browser, device_standalone, last_seen_at, last_received_at, created_at")
    .is("revoked_at", null)
    .order("last_seen_at", { ascending: false });

  if (error || !data) return [];

  return (data as OwnedPushDeviceRow[]).map((row) => ({
    deviceRef: row.device_ref,
    // Run back through the SAME validator the write path uses, so a
    // legacy row (all-null metadata) or a value written before a CHECK
    // constraint existed reaches the UI as a properly-typed descriptor
    // with unknown fields as `null` -- never an unchecked cast.
    descriptor: parseDeviceDescriptor({
      type: row.device_type,
      platform: row.device_platform,
      browser: row.device_browser,
      standalone: row.device_standalone,
    }),
    lastSeenAt: row.last_seen_at,
    lastReceivedAt: row.last_received_at,
    createdAt: row.created_at,
    isCurrent: currentEndpoint !== null && row.endpoint === currentEndpoint,
  }));
}

/**
 * Revokes ONE of the current user's devices by its opaque `deviceRef`.
 *
 * Revocation, never deletion, and the difference is the entire point:
 * the removed device still holds a live browser `PushSubscription` AND a
 * device-local `"enabled"` preference, so a deleted row would simply be
 * recreated by that device's own silent auto-restore the next time it
 * was opened. The tombstone is what makes removal actually stick --
 * only an explicit "הפעל התראות" on that device can undo it. It also
 * preserves the device's `notification_deliveries` history, which a
 * delete would cascade away.
 *
 * Ownership is derived server-side inside `revoke_push_subscription`
 * (`user_id = auth.uid()`), so a `deviceRef` belonging to someone else
 * is indistinguishable from one that does not exist.
 */
export type PushRevocationReason = "user_removed" | "self_disabled" | "permanent_push_failure";

export async function revokeDeviceForCurrentUser(
  deviceRef: string,
  reason: PushRevocationReason,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("revoke_push_subscription", {
    p_device_ref: deviceRef,
    p_reason: reason,
  });
  if (error) return false;
  return data === true;
}

/**
 * Revokes the current user's row for ONE endpoint (the device the caller
 * is sitting at) -- the endpoint-addressed sibling of
 * `revokeDeviceForCurrentUser`, used by the local "כבה התראות" flow,
 * which knows its own endpoint but has no reason to have fetched its own
 * `deviceRef` first.
 *
 * Resolves the endpoint to a `deviceRef` through the RLS-scoped select
 * (so an endpoint the caller does not own resolves to nothing) and then
 * goes through the exact same revocation RPC -- there is deliberately
 * only ONE way to revoke a row in this codebase.
 *
 * Returns whether the device is now DEFINITELY not an active delivery
 * target, which is the only question any caller actually has. "No such
 * row for this user" therefore reports `true` (there is nothing left to
 * deactivate); only a genuine lookup/RPC failure reports `false`.
 */
export async function revokeSubscriptionByEndpointForCurrentUser(
  endpoint: string,
  reason: PushRevocationReason,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("device_ref")
    .eq("endpoint", endpoint)
    .maybeSingle<{ device_ref: string }>();

  if (error) return false;
  if (!data) return true;
  return revokeDeviceForCurrentUser(data.device_ref, reason);
}
