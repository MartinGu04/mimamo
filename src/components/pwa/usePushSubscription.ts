"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPwaCapabilities } from "@/lib/pwa/capabilities";
import { urlBase64ToUint8Array } from "@/lib/push/base64url";
import { getVapidPublicKey } from "@/lib/push/publicConfig";
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

/**
 * Gets the current browser subscription, reusing it if present -- creates
 * a new one otherwise. Shared by the explicit `enable()` action and the
 * silent auto-restore path (`recheckStatus`) so both follow the exact same
 * "reuse, never duplicate" rule. Never calls `Notification.requestPermission()`
 * itself -- callers only ever reach this once permission is already
 * `"granted"`.
 */
async function getOrCreateSubscription(): Promise<PushSubscription> {
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
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
 * The silent auto-restore attempt (spec point 5): reuses/recreates the
 * browser subscription and re-binds it to the current user server-side,
 * returning whether it actually succeeded -- never throws. Kept as a
 * plain module-level `try`/`catch` OUTSIDE `recheckStatus` itself
 * (rather than inlined there) so `recheckStatus`'s own body never mixes
 * `await` with a `try`/`catch` around a `setState` call -- a shape this
 * project's stricter `react-hooks/set-state-in-effect` lint rule
 * (over-)flags as a possible synchronous effect update, even though every
 * one of these calls only ever runs after multiple real `await`s.
 */
async function tryAutoRestore(): Promise<boolean> {
  try {
    const subscription = await getOrCreateSubscription();
    const result = await enablePushNotificationsAction(subscription.toJSON());
    return result.ok;
  } catch {
    return false;
  }
}

/**
 * All Web Push subscription state/actions for the current device --
 * backs `NotificationBell`. Deliberately does NOT equate browser
 * `Notification.permission === "granted"` with "this device is
 * subscribed to המחלבה": a device can have permission granted yet no
 * active `PushSubscription`, and -- the important shared-device case --
 * a leftover browser `PushSubscription` from a PREVIOUS account is never
 * treated as active for a newly logged-in different user. "enabled" is
 * only ever reported once BOTH the local browser subscription exists AND
 * the server confirms (`getPushSubscriptionStatusAction`, RLS-scoped to
 * whoever is authenticated right now) a matching row for the CURRENT
 * user. See `enable()`: the permission prompt is requested only inside
 * this function, itself only ever invoked from the button's own click
 * handler -- never on mount, never automatically.
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
 * Callers must render their `NotificationBell` with `key={userId}` (see
 * `MobileIdentityBar`/`ShellUtilityBar`) -- this codebase's established
 * "reset all internal state when an identity prop changes" idiom (compare
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
export function usePushSubscription(userId?: string) {
  const [state, setState] = useState<PushUiState>("checking");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<TestPushStatus>("idle");
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

    const preference = userId ? readPushPreference(userId) : null;
    const subscription = await getCurrentSubscription();

    let confirmedForCurrentUser = false;
    if (subscription) {
      const status = await getPushSubscriptionStatusAction(subscription.endpoint);
      if (!mountedRef.current) return;
      confirmedForCurrentUser = status.subscribed;
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
      if (userId && preference === null) markPushPreferenceEnabled(userId);
    }

    // Auto-restore (spec point 5): only ever runs for an explicit saved
    // `"enabled"` choice, and only once permission is ALREADY `"granted"`
    // -- this can rebind/recreate the device subscription for the
    // current user without ever prompting, but a `"disabled"` or unknown
    // preference (including the account-switch case just above) always
    // falls through to plain "not enabled" instead.
    let restoredForCurrentUser = false;
    if (!confirmedForCurrentUser && userId && preference === "enabled" && Notification.permission === "granted") {
      restoredForCurrentUser = await tryAutoRestore();
    }

    const nextState: PushUiState = confirmedForCurrentUser || restoredForCurrentUser ? "enabled" : "not_enabled";
    if (mountedRef.current) setState(nextState);
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
      // directly from this function, itself only ever invoked by the
      // "הפעל התראות" button's own click handler.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "permission_denied" : "not_enabled");
        return;
      }

      const subscription = await getOrCreateSubscription();

      const result = await enablePushNotificationsAction(subscription.toJSON());
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
    // a `null`/absent preference, never a `"disabled"` one).
    if (userId) markPushPreferenceDisabled(userId);
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

  return { state, errorMessage, testStatus, enable, disable, sendTest };
}
