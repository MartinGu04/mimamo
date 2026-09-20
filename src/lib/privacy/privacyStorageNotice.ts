import "client-only";

/**
 * Phase 9D: a device-wide, versioned dismissal flag for the informational
 * cookie/local-storage transparency notice (`PrivacyStorageNotice`) --
 * deliberately NOT namespaced by `userId` (unlike the account-scoped keys
 * `clearUserScopedDevicePreferences` clears on sign-out): this notice
 * discloses what THIS BROWSER does, not which account is signed in, so
 * signing out and back in must never make it reappear, and this key must
 * never be added to `clearUserScopedDevicePreferences`. The `-v1` suffix
 * exists so a future materially different disclosure can bump the version
 * and show again, without needing to migrate this key.
 */
export const PRIVACY_STORAGE_NOTICE_DISMISSED_KEY = "mi-ma-mo:privacy-storage-notice-dismissed-v1";

/**
 * Whether this device has already dismissed the notice. Fails CLOSED
 * (treated as already dismissed) when `localStorage` is unavailable or
 * throws (private browsing, quota, disabled storage) -- an informational
 * notice that can't reliably read its own dismissal state is safer left
 * hidden than shown on every single page load. Never throws.
 */
export function readPrivacyStorageNoticeDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY) !== null;
  } catch {
    return true;
  }
}

/**
 * Best-effort write -- a failure (private mode, quota, disabled storage)
 * must never break the "הבנתי" click itself; the dismissal simply won't
 * survive a reload on this device. Sets ONLY this one named key, never
 * `localStorage.clear()`.
 */
export function markPrivacyStorageNoticeDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY, "1");
  } catch {
    // Intentionally ignored -- see docstring above.
  }
}
