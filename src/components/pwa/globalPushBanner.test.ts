import { describe, expect, it } from "vitest";
import { shouldShowGlobalPushBanner, type GlobalPushBannerInput } from "./globalPushBanner";

/** A freshly-added Home Screen install, signed in, notifications never turned on -- the exact real incident this banner exists for. */
function freshInstalledPwa(overrides: Partial<GlobalPushBannerInput> = {}): GlobalPushBannerInput {
  return {
    installReady: true,
    isStandalone: true,
    hasUserId: true,
    pushState: "not_enabled",
    preference: null,
    ...overrides,
  };
}

describe("shouldShowGlobalPushBanner -- the case it exists for", () => {
  it("shows on a freshly re-added installed PWA with no Push and no remembered choice", () => {
    expect(shouldShowGlobalPushBanner(freshInstalledPwa())).toBe(true);
  });

  it("stays visible while the CTA is working, so it does not vanish mid-click and reappear on failure", () => {
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ pushState: "enabling" }))).toBe(true);
  });

  it("disappears the moment the installation is genuinely subscribed -- no separate dismissal to keep in sync", () => {
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ pushState: "enabled" }))).toBe(false);
  });
});

describe("shouldShowGlobalPushBanner -- explicit opt-out is a real preference", () => {
  it("never shows once the user pressed כבה התראות on this device/account", () => {
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ preference: "disabled" }))).toBe(false);
  });

  it("stays suppressed for an opted-out device even mid-disable", () => {
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ preference: "disabled", pushState: "disabling" }))).toBe(
      false,
    );
  });

  it("still shows for a device whose remembered choice is 'enabled' but which is not actually subscribed -- e.g. one removed from another device", () => {
    // A remote revocation is NOT an opt-out on this device: nobody here
    // chose to turn notifications off, so this device should be told,
    // and coming back requires an explicit action on it.
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ preference: "enabled" }))).toBe(true);
  });
});

describe("shouldShowGlobalPushBanner -- restraint", () => {
  it("never shows in an ordinary browser tab; install onboarding owns that story", () => {
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ isStandalone: false }))).toBe(false);
  });

  it("never shows before install-state detection has settled, so it cannot flash on every load", () => {
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ installReady: false }))).toBe(false);
    // ...including the pre-hydration render, where `isStandalone` is not
    // yet knowable and reports the conservative `false`.
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ installReady: false, isStandalone: false }))).toBe(false);
  });

  it("never shows with no known account -- the opt-out it must respect is per-account", () => {
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ hasUserId: false }))).toBe(false);
  });

  it("never shows a dead 'הפעל התראות' CTA when notifications are blocked at the browser/system level", () => {
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ pushState: "permission_denied" }))).toBe(false);
  });

  it("never shows mid-check, so a normal load does not flash it before the answer is known", () => {
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ pushState: "checking" }))).toBe(false);
  });

  it("never shows where Push genuinely does not exist", () => {
    expect(shouldShowGlobalPushBanner(freshInstalledPwa({ pushState: "unsupported" }))).toBe(false);
  });
});
