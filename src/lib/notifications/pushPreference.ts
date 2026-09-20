import "client-only";

export type PushPreference = "enabled" | "disabled";

const STORAGE_KEY_PREFIX = "mi-ma-mo:push-preference:";

/**
 * Keyed by the authenticated Supabase `userId` -- never email/name/Person
 * ID, and never a single global key. This is what makes the preference
 * BOTH device-local (plain `localStorage`, never synced) AND correctly
 * scoped per account on a shared device: a different `userId` on the same
 * browser reads/writes a completely different key, so logging in as a
 * different person can never see or overwrite this one's choice.
 */
function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

/**
 * Reads this device's remembered Push intent for one specific
 * authenticated user. Tri-state by design (see this module's callers):
 * `"enabled"`/`"disabled"` are both genuine past explicit choices,
 * while `null` covers every other case identically -- never subscribed
 * to this mechanism yet, a corrupted/foreign stored value, or storage
 * being unavailable entirely (SSR, private browsing, quota, disabled by
 * policy). Callers must never try to tell those apart: all of them mean
 * "no confirmed intent for this device", which is exactly the state a
 * legacy user (never migrated) also starts in -- see `usePushSubscription`'s
 * migration logic for why that distinction matters.
 */
export function readPushPreference(userId: string): PushPreference | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw === "enabled" || raw === "disabled" ? raw : null;
  } catch {
    return null;
  }
}

/** Best-effort write -- a failure (private mode, quota, disabled storage) must never break the enable/disable flow itself; the choice simply won't survive a reload on this device. */
function writePushPreference(userId: string, value: PushPreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), value);
  } catch {
    // Intentionally ignored -- see docstring above.
  }
}

/** Call ONLY after both the browser subscription and the server-side `enablePushNotificationsAction` have already succeeded -- never speculatively. */
export function markPushPreferenceEnabled(userId: string): void {
  writePushPreference(userId, "enabled");
}

/** An explicit user choice that must never be silently resurrected by legacy-migration backfill (see `readPushPreference`'s callers) -- only another explicit enable can clear it. */
export function markPushPreferenceDisabled(userId: string): void {
  writePushPreference(userId, "disabled");
}

/**
 * Best-effort removal of this device's remembered Push intent for one
 * specific user (Privacy Phase 9B) -- called on sign-out so a departed
 * account's choice does not linger in `localStorage` on a shared device.
 * Removes ONLY the one key namespaced by the given `userId`, never
 * another user's same-prefixed key. A failure here (private mode, quota,
 * disabled storage) must never break sign-out.
 */
export function clearPushPreference(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Intentionally ignored -- see docstring above.
  }
}
