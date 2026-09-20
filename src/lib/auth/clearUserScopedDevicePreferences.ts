import "client-only";
import { clearPushPreference } from "@/lib/notifications/pushPreference";
import { clearInstallPromptPreference } from "@/lib/pwa/installPromptPreference";
import { clearSkippedSetupItems } from "@/lib/onboarding/setupCardPreference";

/**
 * Clears every device-local, ACCOUNT-scoped preference key this app ever
 * writes to `localStorage` for one specific authenticated user (Privacy
 * Phase 9B) -- called from the sign-out flow (`IdentityFooterSignOutButton`
 * on desktop, `MobileProfileMenu`'s sign-out button on mobile) so a
 * departed account's choices don't linger on a shared device.
 *
 * Deliberately narrow: removes ONLY the three `userId`-namespaced keys
 * below, by name, via each key's own owning module (never duplicating
 * key-prefix knowledge here) -- never `localStorage.clear()`, which would
 * also wipe `app-theme`/`hamachlava-a11y-preferences-v1`. Those two are
 * device-wide PRESENTATION preferences, not account-scoped personal
 * state, and are deliberately left untouched by sign-out (a shared
 * device's chosen theme/accessibility settings are not "whose they are").
 *
 * Each underlying clear is already independently best-effort/never-throws
 * (private browsing, quota, disabled storage) -- this function adds no
 * new failure mode of its own and must never block or delay sign-out.
 */
export function clearUserScopedDevicePreferences(userId: string): void {
  clearPushPreference(userId);
  clearInstallPromptPreference(userId);
  clearSkippedSetupItems(userId);
}
