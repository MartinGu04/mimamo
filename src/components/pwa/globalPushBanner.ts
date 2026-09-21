import type { PushPreference } from "@/lib/notifications/pushPreference";
import type { PushUiState } from "./usePushSubscription";

/**
 * Whether the authenticated shell should show the GLOBAL
 * "ההתראות לא פעילות במכשיר הזה" banner.
 *
 * Pure and independently testable from the JSX, same convention as
 * `bellOnboarding.ts` -- every input is a plain value the caller already
 * derived from `usePwaInstall()`, the shared push-device state, and the
 * device-local preference. It never reaches into `localStorage`/`window`
 * itself.
 *
 * This exists because the bell's own contextual onboarding card was not
 * enough for a REAL incident: someone deleted the old Home Screen PWA,
 * re-added it after the rebrand, and never turned notifications back on
 * for the new installation. The server created and sent the 20:00
 * notification correctly; no installation displayed it. Nothing surfaced
 * that unless the bell happened to be opened, which it wasn't.
 *
 * Each condition below is a deliberate restraint, in evaluation order:
 *
 *  1. `installReady` -- `isStandalone` is not knowable during the server
 *     render or the client's first pre-hydration render (see
 *     `PwaInstallProvider`). Rendering before it settles would flash a
 *     banner at every installed user on every page load.
 *
 *  2. `isStandalone` -- this warning is for INSTALLED apps. An ordinary
 *     Safari/Chrome tab missing Push is not a problem to warn about; it
 *     is a tab, and the existing install onboarding already tells that
 *     story better. Warning there would also be actively wrong on iOS,
 *     where Push does not exist outside a standalone install at all.
 *
 *  3. `hasUserId` -- the preference (and therefore the opt-out check) is
 *     per-account. With no known account there is no opt-out to respect,
 *     so the honest thing is to say nothing.
 *
 *  4. `preference === "disabled"` -- THE opt-out rule. Someone who
 *     pressed "כבה התראות" on this device made a real choice, and a
 *     global banner that reappeared on every page would be nagging them
 *     to reverse it. A remotely-REVOKED device is deliberately NOT this
 *     case: nobody opted out on this device, so it still gets the
 *     banner, which is also exactly the "requires an explicit action on
 *     that device to come back" behavior revocation is meant to have.
 *
 *  5. The push state itself -- only a device that genuinely could turn
 *     notifications on, and hasn't. `permission_denied` in particular is
 *     excluded: a "הפעל התראות" CTA there cannot work (the browser will
 *     not re-prompt), so repeating it would be a dead button; the bell's
 *     existing blocked-permission guidance owns that recovery path.
 *     `enabling` keeps the banner visible so the CTA can show its own
 *     pending state instead of the banner vanishing mid-click and
 *     reappearing if it fails.
 */
export interface GlobalPushBannerInput {
  installReady: boolean;
  isStandalone: boolean;
  hasUserId: boolean;
  pushState: PushUiState;
  preference: PushPreference | null;
}

export function shouldShowGlobalPushBanner(input: GlobalPushBannerInput): boolean {
  if (!input.installReady) return false;
  if (!input.isStandalone) return false;
  if (!input.hasUserId) return false;
  if (input.preference === "disabled") return false;
  return input.pushState === "not_enabled" || input.pushState === "enabling";
}
