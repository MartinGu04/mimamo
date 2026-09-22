"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPwaCapabilities } from "@/lib/pwa/capabilities";
import { isStandaloneDisplayMode } from "@/lib/pwa/installState";
import { urlBase64ToUint8Array } from "@/lib/push/base64url";
import { getVapidPublicKey } from "@/lib/push/publicConfig";
import { readCurrentDeviceDescriptor } from "@/lib/push/deviceDescriptor";
import {
  disablePushNotificationsAction,
  enablePushNotificationsAction,
  getPushSubscriptionStatusAction,
  sendTestNotificationAction,
} from "@/lib/notifications/actions";
import {
  markPushPreferenceDisabled,
  markPushPreferenceEnabled,
  readPushPreference,
  type PushPreference,
} from "@/lib/notifications/pushPreference";

export type PushUiState =
  | "unsupported"
  | "checking"
  | "not_enabled"
  | "permission_denied"
  | "enabling"
  | "enabled"
  | "disabling";

export type TestPushStatus = "idle" | "pending" | "success" | "error";

const GENERIC_ENABLE_ERROR = "לא ניתן היה להפעיל התראות. נסו שוב מאוחר יותר.";

/**
 * Looks up the current browser-level `PushSubscription`, if any, without
 * ever waiting indefinitely -- `getRegistration()` resolves to `undefined`
 * immediately when nothing is registered yet, unlike
 * `navigator.serviceWorker.ready` (which never resolves at all with no
 * registration). Safe to call on mount for a passive status check.
 */
async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

function subscribeBrowser(registration: ServiceWorkerRegistration): Promise<PushSubscription> {
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    // `lib.dom`'s `PushSubscriptionOptionsInit.applicationServerKey` wants
    // a `BufferSource` typed over plain `ArrayBuffer`, while a freshly
    // constructed `Uint8Array`'s inferred type is generic over
    // `ArrayBufferLike` (which also covers `SharedArrayBuffer`) -- a
    // TypeScript/lib.dom strictness mismatch, not a real runtime concern
    // (this is always a genuine local `ArrayBuffer`).
    applicationServerKey: urlBase64ToUint8Array(getVapidPublicKey()) as BufferSource,
  });
}

/**
 * Gets the current browser subscription, reusing it if present -- creates
 * a new one otherwise. Used by the silent auto-restore path.
 * Never calls `Notification.requestPermission()` itself -- callers only
 * ever reach this once permission is already `"granted"`.
 */
async function getOrCreateSubscription(): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return subscribeBrowser(registration);
}

/**
 * The EXPLICIT-enable variant of the above, and the reason it exists is
 * the 404/410 resurrection loop.
 *
 * Once the push service has told the server an endpoint is permanently
 * gone (and the server has revoked it as `permanent_push_failure`), the
 * browser may STILL hand back that same dead `PushSubscription` object
 * from `getSubscription()` forever. Blindly reusing it would re-register
 * a known-dead endpoint, which would fail 404/410 on the next send, get
 * revoked again, and so on -- the user pressing "הפעל התראות" would
 * appear to succeed while nothing could ever be delivered.
 *
 * So on an explicit enable, an existing subscription is first checked
 * against the server: a device the server knows is permanently dead is
 * unsubscribed locally and replaced with a genuinely new subscription
 * before anything is persisted. Any OTHER state (active, revoked by a
 * remote removal, unknown, or simply a failed check) reuses the existing
 * subscription exactly as before -- this only ever recreates a
 * subscription we have positive evidence is dead, never speculatively.
 */
async function getOrRecreateSubscriptionForExplicitEnable(): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (!existing) return subscribeBrowser(registration);

  let endpointDead = false;
  try {
    const status = await getPushSubscriptionStatusAction(existing.endpoint);
    endpointDead = status.endpointDead;
  } catch {
    endpointDead = false;
  }
  if (!endpointDead) return existing;

  await existing.unsubscribe().catch(() => {});
  return subscribeBrowser(registration);
}

/**
 * The silent auto-restore attempt (spec point 5): reuses/recreates the
 * browser subscription and re-binds it to the current user server-side,
 * returning whether it actually succeeded -- never throws. Kept as a
 * plain module-level `try`/`catch` OUTSIDE `recheckStatus` itself
 * (rather than inlined there) so `recheckStatus`'s own body never mixes
 * `await` with a `try`/`catch` around a `setState` call -- a shape this
 * project's stricter `react-hooks/set-state-in-effect` lint rule
 * (over-)flags as a possible synchronous effect update, even though every
 * one of these calls only ever runs after multiple real `await`s.
 *
 * Passes `explicit: false`, which is what makes this path structurally
 * incapable of reviving a revoked device: the server rejects a passive
 * upsert against a revoked row outright (see the migration's
 * `p_explicit` gate), so a device removed from somewhere else -- or one
 * whose endpoint permanently failed -- stays off until someone presses
 * "הפעל התראות" on it in person.
 */
async function tryAutoRestore(): Promise<{ restored: boolean; endpoint: string | null }> {
  try {
    const subscription = await getOrCreateSubscription();
    const result = await enablePushNotificationsAction(subscription.toJSON(), false);
    return { restored: result.ok, endpoint: subscription.endpoint };
  } catch {
    return { restored: false, endpoint: null };
  }
}

/**
 * All Web Push subscription state/actions for the current device --
 * backs the app shell's single shared push-device state
 * (`PushDeviceProvider`), which is this hook's ONE intended caller.
 *
 * Deliberately does NOT equate browser
 * `Notification.permission === "granted"` with "this device is
 * subscribed to המחלבה": a device can have permission granted yet no
 * active `PushSubscription`, and -- the important shared-device case --
 * a leftover browser `PushSubscription` from a PREVIOUS account is never
 * treated as active for a newly logged-in different user. "enabled" is
 * only ever reported once BOTH the local browser subscription exists AND
 * the server confirms (`getPushSubscriptionStatusAction`, RLS-scoped to
 * whoever is authenticated right now) a matching, NON-REVOKED row for
 * the CURRENT user. See `enable()`: the permission prompt is requested
 * only inside this function, itself only ever invoked from a button's own
 * click handler -- never on mount, never automatically.
 *
 * `userId` is the authenticated Supabase user id (a sibling of `Person`
 * identity, never folded into it -- see `PersonalScheduleLoadResult`) and
 * keys the per-user, per-device "I want Push on this device" preference
 * (`lib/notifications/pushPreference.ts`). It is what lets a saved
 * `"enabled"` choice survive logout/re-login for the SAME user while
 * staying fully isolated from any other account that later signs in on
 * this same browser (see the account-switch/legacy-migration logic in
 * `recheckStatus` below). `undefined` (no authenticated identity known
 * yet) simply disables the whole preference mechanism for this render --
 * live status derivation still works exactly as before, just with no
 * persistence and no auto-restore attempt.
 *
 * Callers must render their provider with `key={userId}` (see
 * `AppShell`) -- this codebase's established "reset all internal state
 * when an identity prop changes" idiom (compare
 * `NotificationScheduleSection`'s `key={editingItem?.id ?? "new"}`), and the only
 * one compatible with this project's stricter React Hooks lint rules
 * (no synchronous `setState` in an effect, no ref reads/writes during
 * render). A fresh `key` forces a genuinely new component -- and thus a
 * fresh `usePushSubscription` call -- on every account switch, so A's
 * "enabled"/error/test-send state can never paint under B's identity even
 * for a single frame; `recheckStatus`'s own `userId` dependency below is
 * what then still re-derives the correct state independently, from
 * scratch, for whichever user this fresh instance was mounted for.
 */
export interface PushSubscriptionState {
  state: PushUiState;
  errorMessage: string | null;
  testStatus: TestPushStatus;
  /**
   * The CURRENT browser subscription's endpoint, once one is known.
   *
   * Used only to address server actions at this device (status,
   * heartbeat, test send, device-list "המכשיר הזה" marking) -- exactly
   * as it already was before this existed, just resolved once here
   * instead of re-read at each call site. It is never rendered, never
   * put in the DOM, and never handed to a component that renders device
   * information; "המכשירים שלי" receives coarse labels and an opaque
   * handle from the server instead.
   */
  endpoint: string | null;
  /** This device's remembered, per-account Push intent. `"disabled"` is an EXPLICIT opt-out and suppresses the global missing-Push banner; `null` means no confirmed intent yet. */
  preference: PushPreference | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  sendTest: () => Promise<void>;
  /** Re-derives status from scratch (browser subscription + server confirmation). Exposed so a surface that just changed device state -- e.g. removing THIS device from "המכשירים שלי" -- can reflect reality rather than assume it. */
  refresh: () => Promise<void>;
}

export function usePushSubscription(userId?: string): PushSubscriptionState {
  const [state, setState] = useState<PushUiState>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<TestPushStatus>("idle");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [preference, setPreference] = useState<PushPreference | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Passive status check AND the sole silent auto-restore path (spec
   * point 5) AND the sole legacy-migration backfill path (spec point 7).
   * Re-runs from scratch every time `userId` changes (it's a dependency
   * of this callback, which is itself the effect's only dependency below)
   * so a component instance whose `userId` prop switches from user A to
   * user B never keeps reporting A's state -- see the account-switch
   * regression tests.
   *
   * NEVER calls `Notification.requestPermission()` -- every branch below
   * either already knows permission is `"granted"` (the ONLY case that
   * ever creates/reuses a browser subscription here) or leaves the user
   * in a not-enabled/denied state for them to act on explicitly.
   */
  const recheckStatus = useCallback(async () => {
    const capabilities = getPwaCapabilities();
    if (!capabilities.serviceWorker || !capabilities.pushManager || !capabilities.notifications) {
      if (mountedRef.current) setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      if (mountedRef.current) setState("permission_denied");
      return;
    }

    const subscription = await getCurrentSubscription();
    // Read AFTER the first `await` on purpose: this is a synchronous
    // browser-storage read, and doing it before any await would make the
    // `setPreference` below a synchronous `setState` inside an effect --
    // the exact shape this project's stricter React Hooks lint rules
    // reject (see this hook's own docstring).
    const storedPreference = userId ? readPushPreference(userId) : null;
    let effectivePreference = storedPreference;
    let knownEndpoint = subscription?.endpoint ?? null;

    let confirmedForCurrentUser = false;
    let revokedForCurrentUser = false;
    if (subscription) {
      const status = await getPushSubscriptionStatusAction(subscription.endpoint);
      if (!mountedRef.current) return;
      confirmedForCurrentUser = status.subscribed;
      revokedForCurrentUser = status.revoked;
      // A browser subscription that exists but does NOT belong to (or
      // isn't recognized as belonging to) the current user -- e.g. a
      // leftover from a previously signed-in account on a shared device
      // -- falls through to the same auto-restore/not-enabled decision
      // below as "no local subscription at all"; it must never be
      // treated as confirming -- let alone backfilling -- the CURRENT
      // user's intent.
    }

    if (confirmedForCurrentUser) {
      // Legacy migration (spec point 7): a pre-existing subscription the
      // server has just confirmed belongs to THIS authenticated user is
      // the only acceptable proof to backfill an unknown/absent
      // preference -- never the mere existence of a browser subscription
      // object, which could just as easily be a leftover from a previous
      // account on a shared device.
      if (userId && storedPreference === null) {
        markPushPreferenceEnabled(userId);
        effectivePreference = "enabled";
      }
    }

    // Auto-restore (spec point 5): only ever runs for an explicit saved
    // `"enabled"` choice, and only once permission is ALREADY `"granted"`
    // -- this can rebind/recreate the device subscription for the
    // current user without ever prompting, but a `"disabled"` or unknown
    // preference (including the account-switch case just above) always
    // falls through to plain "not enabled" instead.
    //
    // `revokedForCurrentUser` short-circuits it entirely: a device the
    // user removed from another device -- or one the push service
    // reported permanently gone -- must not come back on its own, even
    // though this device's own remembered preference still says
    // "enabled". The server would reject the attempt anyway (that is
    // where the guarantee actually lives); skipping it here just avoids
    // a pointless round trip and a misleading error.
    let restoredForCurrentUser = false;
    if (
      !confirmedForCurrentUser &&
      !revokedForCurrentUser &&
      userId &&
      storedPreference === "enabled" &&
      Notification.permission === "granted"
    ) {
      const restore = await tryAutoRestore();
      if (!mountedRef.current) return;
      restoredForCurrentUser = restore.restored;
      if (restore.endpoint !== null) knownEndpoint = restore.endpoint;
    }

    const nextState: PushUiState = confirmedForCurrentUser || restoredForCurrentUser ? "enabled" : "not_enabled";
    if (mountedRef.current) {
      setEndpoint(knownEndpoint);
      setPreference(effectivePreference);
      setState(nextState);
    }
  }, [userId]);

  useEffect(() => {
    recheckStatus();
  }, [recheckStatus]);

  const enable = useCallback(async () => {
    setErrorMessage(null);
    setState("enabling");

    try {
      const capabilities = getPwaCapabilities();
      if (!capabilities.serviceWorker || !capabilities.pushManager || !capabilities.notifications) {
        setState("unsupported");
        return;
      }

      // The ONLY place this app ever calls requestPermission() -- always
      // directly from this function, itself only ever invoked by a
      // "הפעל התראות" button's own click handler.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "permission_denied" : "not_enabled");
        return;
      }

      const subscription = await getOrRecreateSubscriptionForExplicitEnable();

      // `explicit: true` -- the one intent allowed to clear a revocation,
      // and the only one that records this device's coarse descriptor.
      // The descriptor is read here, inside a user-gesture handler, so
      // there is no render-time `navigator` read to go wrong; the raw
      // User-Agent never leaves the browser (see `deviceDescriptor.ts`).
      const result = await enablePushNotificationsAction(
        subscription.toJSON(),
        true,
        readCurrentDeviceDescriptor(isStandaloneDisplayMode()),
      );
      if (!mountedRef.current) return;
      if (!result.ok) {
        // Deliberately NOT persisted -- the preference must only ever
        // reflect a genuinely completed enable (browser subscription AND
        // server persistence both succeeded).
        setErrorMessage(GENERIC_ENABLE_ERROR);
        setState("not_enabled");
        return;
      }
      if (userId) markPushPreferenceEnabled(userId);
      setEndpoint(subscription.endpoint);
      setPreference("enabled");
      setState("enabled");
    } catch {
      if (!mountedRef.current) return;
      setErrorMessage(GENERIC_ENABLE_ERROR);
      setState("not_enabled");
    }
  }, [userId]);

  const disable = useCallback(async () => {
    setState("disabling");
    // Persisted FIRST, before the (best-effort, can-fail) server/browser
    // cleanup below -- an explicit disable must survive even if either of
    // those subsequently fails, and it must never be silently overwritten
    // by legacy-migration backfill later (`recheckStatus` only backfills
    // a `null`/absent preference, never a `"disabled"` one). It is also
    // what suppresses the global missing-Push banner: an explicit opt-out
    // is a real preference, not a state to nag about.
    if (userId) markPushPreferenceDisabled(userId);
    setPreference("disabled");
    try {
      const subscription = await getCurrentSubscription();
      if (subscription) {
        await disablePushNotificationsAction(subscription.endpoint).catch(() => {});
        await subscription.unsubscribe().catch(() => {});
      }
    } finally {
      // Re-derive the TRUTHFUL state rather than assuming the above
      // succeeded -- if either side silently failed, this reflects
      // reality instead of a claimed outcome.
      await recheckStatus();
      if (mountedRef.current) setTestStatus("idle");
    }
  }, [recheckStatus, userId]);

  const sendTest = useCallback(async () => {
    setTestStatus("pending");
    try {
      const subscription = await getCurrentSubscription();
      if (!subscription) {
        if (mountedRef.current) setTestStatus("error");
        return;
      }
      const result = await sendTestNotificationAction(subscription.endpoint);
      if (!mountedRef.current) return;
      if (!result.ok) {
        setTestStatus("error");
        if (result.error === "subscription_expired" || result.error === "not_subscribed") {
          await recheckStatus();
        }
        return;
      }
      setTestStatus("success");
    } catch {
      if (mountedRef.current) setTestStatus("error");
    }
  }, [recheckStatus]);

  return { state, errorMessage, testStatus, endpoint, preference, enable, disable, sendTest, refresh: recheckStatus };
}
