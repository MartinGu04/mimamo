import { afterEach, describe, expect, it, vi } from "vitest";
import { markPushPreferenceEnabled, readPushPreference } from "@/lib/notifications/pushPreference";
import { markInstallPromptDismissed, readInstallPromptDismissedAt } from "@/lib/pwa/installPromptPreference";
import { markSetupItemSkipped, readSkippedSetupItems } from "@/lib/onboarding/setupCardPreference";
import { THEME_STORAGE_KEY } from "@/lib/theme/themeScript";
import { A11Y_STORAGE_KEY } from "@/lib/a11y/preferences";
import { PRIVACY_STORAGE_NOTICE_DISMISSED_KEY } from "@/lib/privacy/privacyStorageNotice";
import { clearUserScopedDevicePreferences } from "./clearUserScopedDevicePreferences";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function seedAllThreeForUser(userId: string) {
  markPushPreferenceEnabled(userId);
  markInstallPromptDismissed(userId);
  markSetupItemSkipped(userId, "install");
}

describe("clearUserScopedDevicePreferences — sign-out orchestration (Phase 9B)", () => {
  it("removes exactly the current user's three account-scoped keys", () => {
    seedAllThreeForUser("user-a");

    clearUserScopedDevicePreferences("user-a");

    expect(readPushPreference("user-a")).toBeNull();
    expect(readInstallPromptDismissedAt("user-a")).toBeNull();
    expect(readSkippedSetupItems("user-a").size).toBe(0);
  });

  it("leaves a DIFFERENT user's same-prefixed keys on the same shared device untouched", () => {
    seedAllThreeForUser("user-a");
    seedAllThreeForUser("user-b");

    clearUserScopedDevicePreferences("user-a");

    expect(readPushPreference("user-b")).toBe("enabled");
    expect(readInstallPromptDismissedAt("user-b")).not.toBeNull();
    expect(readSkippedSetupItems("user-b").has("install")).toBe(true);
  });

  it("never touches app-theme -- a device-wide presentation preference, not account-scoped", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    seedAllThreeForUser("user-a");

    clearUserScopedDevicePreferences("user-a");

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("never touches the accessibility preferences key -- a device-wide presentation preference, not account-scoped", () => {
    window.localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify({ textSize: "large" }));
    seedAllThreeForUser("user-a");

    clearUserScopedDevicePreferences("user-a");

    expect(window.localStorage.getItem(A11Y_STORAGE_KEY)).toBe(JSON.stringify({ textSize: "large" }));
  });

  it("never touches the privacy storage notice dismissal key (Phase 9D) -- device-wide, not account-scoped", () => {
    window.localStorage.setItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY, "1");
    seedAllThreeForUser("user-a");

    clearUserScopedDevicePreferences("user-a");

    expect(window.localStorage.getItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY)).toBe("1");
  });

  it("never uses localStorage.clear() -- only the three named keys are ever removed", () => {
    const clearSpy = vi.spyOn(window.localStorage, "clear");
    seedAllThreeForUser("user-a");

    clearUserScopedDevicePreferences("user-a");

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("is a harmless no-op for a user who never had any of the three preferences stored", () => {
    expect(() => clearUserScopedDevicePreferences("user-never-stored")).not.toThrow();
  });

  it("never throws even if every underlying localStorage call throws (storage disabled)", () => {
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    seedAllThreeForUser("user-a");
    expect(() => clearUserScopedDevicePreferences("user-a")).not.toThrow();
  });
});
