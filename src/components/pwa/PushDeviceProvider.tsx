"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { heartbeatPushSubscriptionAction } from "@/lib/notifications/actions";
import { isStandaloneDisplayMode } from "@/lib/pwa/installState";
import { readCurrentDeviceDescriptor } from "@/lib/push/deviceDescriptor";
import { usePushSubscription, type PushSubscriptionState } from "./usePushSubscription";

/**
 * The authenticated shell's ONE Push-device state machine.
 *
 * Before this existed, `NotificationBell` called `usePushSubscription()`
 * itself -- and the shell renders TWO bells at all times
 * (`MobileIdentityBar` and `ShellUtilityBar`), one of which is merely
 * CSS-hidden at any given viewport. Both were mounted, so every
 * authenticated page load ran two independent status machines, two
 * `getPushSubscriptionStatusAction` round trips, and (worse) two
 * concurrent silent auto-restore attempts racing to register the same
 * endpoint. Adding a heartbeat and a global banner on top of that would
 * have tripled it.
 *
 * Hoisting the state here makes the duplication structurally impossible
 * rather than merely discouraged: `usePushSubscription` is called
 * exactly once per authenticated shell, and every consumer -- both
 * bells, the global banner, "המכשירים שלי" -- reads the same instance.
 * The `apiSurface.test.ts` guard already confines the browser
 * permission-prompt and subscribe calls to that one hook; this confines
 * the *number of callers* of the hook itself.
 *
 * Mounted with `key={userId}` by `AppShell`, which is this codebase's
 * established "reset everything when identity changes" idiom -- see
 * `usePushSubscription`'s own docstring. That is what keeps one
 * account's push state from ever painting under another's on a shared
 * browser.
 */
export type PushDeviceContextValue = PushSubscriptionState;

/**
 * The truthful, inert state for a consumer rendered outside any provider
 * -- a bare `NotificationBell` in a test, or any future surface that
 * forgets the provider. Reports "still checking" and no-ops every
 * action, rather than throwing and taking down the whole render, and
 * deliberately never claims a device is enabled or not enabled without
 * having actually checked. Same "fallback, never throw" convention
 * `PwaInstallProvider` already uses.
 */
const DETACHED_PUSH_DEVICE_STATE: PushDeviceContextValue = {
  state: "checking",
  errorMessage: null,
  testStatus: "idle",
  endpoint: null,
  preference: null,
  enable: async () => {},
  disable: async () => {},
  sendTest: async () => {},
  refresh: async () => {},
};

const PushDeviceContext = createContext<PushDeviceContextValue | null>(null);

/**
 * How long a heartbeat is considered fresh. A heartbeat is metadata for
 * "when was this installation last actually used", so minute-level
 * precision is worthless and chattiness is a real cost -- one check-in
 * per app open, and at most one more per half hour of foreground
 * activity, is all `last_seen_at` needs to be meaningful.
 */
const HEARTBEAT_THROTTLE_MS = 30 * 60 * 1000;

/**
 * Sends the subscription heartbeat for this installation -- and, riding
 * along on it, the one-time LEGACY METADATA BACKFILL.
 *
 * Deliberately NOT a timer/interval: there is no recurring poll here and
 * none is wanted. It fires once when an authenticated shell first
 * resolves to a confirmed, non-revoked subscription, and then at most
 * once per `HEARTBEAT_THROTTLE_MS` when the app returns to the
 * foreground -- which is exactly the event that means "this installation
 * is being used", the thing `last_seen_at` is supposed to record.
 *
 * The throttle key includes the endpoint, so a device whose subscription
 * is recreated checks in again immediately rather than being suppressed
 * by the previous endpoint's timestamp.
 *
 * THE BACKFILL rides on this exact call rather than getting one of its
 * own, which is the whole reason it is safe. Everything a backfill must
 * prove is already proven by the time this runs:
 *   * a local browser `PushSubscription` exists (there is an endpoint),
 *   * the server has verified that endpoint belongs to the CURRENT
 *     authenticated user and is not revoked (`state === "enabled"`, and
 *     re-derived server-side inside the RPC regardless),
 *   * and it happens once per app open, already deduplicated across
 *     every consumer by this provider.
 * A separate request would have re-introduced exactly the duplicate
 * status-machine problem this provider exists to prevent -- and would
 * have had to re-establish the same preconditions to be correct.
 *
 * The descriptor is read HERE, inside the effect (never during render),
 * so `navigator`/`matchMedia` are guaranteed present -- the same
 * placement `usePushSubscription.enable()` uses for its own read. The
 * raw User-Agent never leaves the browser; only the coarse closed-enum
 * descriptor is sent, and the server re-validates it anyway.
 *
 * Fails silently and completely: `heartbeatPushSubscriptionAction`
 * already swallows its own errors, and this adds a `catch` on top. A
 * heartbeat must never surface in the UI, never block anything, and
 * never be able to break the app -- which applies to the backfill
 * equally: a device that stays labelled "מכשיר" is a cosmetic outcome,
 * never a reason to break startup or Push.
 */
function useSubscriptionHeartbeat(enabled: boolean, endpoint: string | null, userId?: string): void {
  const lastHeartbeatRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled || endpoint === null || !userId) return;

    const activeEndpoint = endpoint;
    const key = `${userId}|${activeEndpoint}`;

    function beat() {
      const previous = lastHeartbeatRef.current;
      const now = Date.now();
      if (previous !== null && previous.key === key && now - previous.at < HEARTBEAT_THROTTLE_MS) return;
      lastHeartbeatRef.current = { key, at: now };
      // Fire-and-forget on purpose: nothing in the UI depends on the
      // result, and awaiting it would only create a way for a slow
      // network to matter. Wrapped so that neither a rejected promise
      // NOR a synchronous throw (a transport/serialization failure
      // before the action is even reached) can escape into the effect --
      // "a heartbeat must never break the app" has to hold for every
      // failure mode, not just the one that returns a promise.
      try {
        void Promise.resolve(
          // The descriptor is what backfills a legacy row's missing
          // device metadata. The RPC fills only columns that are still
          // NULL (`coalesce(<column>, <argument>)`), so sending it on
          // every heartbeat is harmless for an already-identified
          // device and never overwrites anything.
          heartbeatPushSubscriptionAction(activeEndpoint, readCurrentDeviceDescriptor(isStandaloneDisplayMode())),
        ).catch(() => {});
      } catch {
        // Intentionally ignored -- see above.
      }
    }

    beat();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") beat();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [enabled, endpoint, userId]);
}

export function PushDeviceProvider({ userId, children }: { userId?: string; children: ReactNode }) {
  const push = usePushSubscription(userId);
  // "enabled" is the only state that proves BOTH a live browser
  // subscription AND a server row owned by this exact user that is not
  // revoked -- which is precisely the row a heartbeat is allowed to
  // touch. "disabling" deliberately does not qualify.
  useSubscriptionHeartbeat(push.state === "enabled", push.endpoint, userId);

  return <PushDeviceContext.Provider value={push}>{children}</PushDeviceContext.Provider>;
}

export function usePushDevice(): PushDeviceContextValue {
  return useContext(PushDeviceContext) ?? DETACHED_PUSH_DEVICE_STATE;
}
