import "client-only";

/**
 * The three, and only three, actions the Overview page's "השלמת הגדרה"
 * setup card ever offers (spec point 7) -- never grows a fourth without an
 * explicit product decision.
 */
export type SetupItemKey = "install" | "notifications" | "calendar_sync";

const ALL_SETUP_ITEM_KEYS: readonly SetupItemKey[] = ["install", "notifications", "calendar_sync"];

const STORAGE_KEY_PREFIX = "mi-ma-mo:setup-card-skipped:";

/**
 * Device-local, per-user explicit skip state for the setup card -- the same
 * `localStorage`-keyed-by-`userId` pattern `pushPreference.ts`/
 * `installPromptPreference.ts` already establish (this codebase has no
 * server-side per-user preference mechanism to prefer instead; see those
 * modules' own docstrings for the same reasoning). This module only ever
 * tracks an explicit "דלג" (skip) choice -- it never records completion:
 * completion is always derived live from the real PWA install state, push
 * subscription state, and calendar-feed state (spec point 8), never
 * invented or cached here, so a veteran user who already finished
 * everything is never treated as having "skipped" anything either.
 */
function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

function readSkippedItemsList(userId: string): SetupItemKey[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is SetupItemKey => (ALL_SETUP_ITEM_KEYS as string[]).includes(value));
  } catch {
    return [];
  }
}

/** Every setup item this device has explicitly skipped for this user -- never throws, never `undefined`/`null`. */
export function readSkippedSetupItems(userId: string): ReadonlySet<SetupItemKey> {
  return new Set(readSkippedItemsList(userId));
}

/** Best-effort write -- a failure (private mode, quota, disabled storage) must never break the "דלג" click itself; the skip simply won't survive a reload on this device. */
export function markSetupItemSkipped(userId: string, item: SetupItemKey): void {
  if (typeof window === "undefined") return;
  try {
    const current = readSkippedItemsList(userId);
    if (current.includes(item)) return;
    window.localStorage.setItem(storageKey(userId), JSON.stringify([...current, item]));
  } catch {
    // Intentionally ignored -- see docstring above.
  }
}

/**
 * Best-effort removal of this device's skipped-setup-item state for one
 * specific user (Privacy Phase 9B) -- called on sign-out so a departed
 * account's skip choices do not linger in `localStorage` on a shared
 * device. Removes ONLY the one key namespaced by the given `userId`,
 * never another user's same-prefixed key. A failure here (private mode,
 * quota, disabled storage) must never break sign-out.
 */
export function clearSkippedSetupItems(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Intentionally ignored -- see docstring above.
  }
}
