import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearInstallPromptPreference,
  INSTALL_PROMPT_COOLDOWN_MS,
  isInstallPromptDismissalActive,
  markInstallPromptDismissed,
  readInstallPromptDismissedAt,
} from "./installPromptPreference";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("installPromptPreference — storage isolation (per userId, never global)", () => {
  it("returns null for a userId that has never dismissed", () => {
    expect(readInstallPromptDismissedAt("user-a")).toBeNull();
  });

  it("stores under a key namespaced by userId, never a bare/global key", () => {
    markInstallPromptDismissed("user-a");
    expect(window.localStorage.getItem("mi-ma-mo:install-prompt-dismissed:user-a")).not.toBeNull();
    expect(window.localStorage.getItem("mi-ma-mo:install-prompt-dismissed:user-b")).toBeNull();
  });

  it("A dismissing never affects B's own dismissal state", () => {
    markInstallPromptDismissed("user-a");
    expect(readInstallPromptDismissedAt("user-a")).not.toBeNull();
    expect(readInstallPromptDismissedAt("user-b")).toBeNull();
  });

  it("uses a completely separate key from the Push preference (lib/notifications/pushPreference.ts)", () => {
    markInstallPromptDismissed("user-a");
    expect(window.localStorage.getItem("mi-ma-mo:push-preference:user-a")).toBeNull();
  });
});

describe("installPromptPreference — fails safe on corrupt/unavailable storage", () => {
  it("a corrupt/garbage stored value reads back as null, never crashes", () => {
    window.localStorage.setItem("mi-ma-mo:install-prompt-dismissed:user-a", "not-a-number");
    expect(readInstallPromptDismissedAt("user-a")).toBeNull();
  });

  it("localStorage.getItem throwing reads back as null, never throws", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => readInstallPromptDismissedAt("user-a")).not.toThrow();
    expect(readInstallPromptDismissedAt("user-a")).toBeNull();
  });

  it("localStorage.setItem throwing never throws out of markInstallPromptDismissed", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => markInstallPromptDismissed("user-a")).not.toThrow();
  });
});

describe("clearInstallPromptPreference — sign-out cleanup (Phase 9B)", () => {
  it("removes the current user's own stored dismissal", () => {
    markInstallPromptDismissed("user-a");
    clearInstallPromptPreference("user-a");
    expect(readInstallPromptDismissedAt("user-a")).toBeNull();
    expect(window.localStorage.getItem("mi-ma-mo:install-prompt-dismissed:user-a")).toBeNull();
  });

  it("never removes a DIFFERENT user's dismissal on the same shared device", () => {
    markInstallPromptDismissed("user-a");
    markInstallPromptDismissed("user-b");
    clearInstallPromptPreference("user-a");
    expect(readInstallPromptDismissedAt("user-a")).toBeNull();
    expect(readInstallPromptDismissedAt("user-b")).not.toBeNull();
  });

  it("is a harmless no-op when the user never dismissed anything", () => {
    expect(() => clearInstallPromptPreference("user-never-stored")).not.toThrow();
  });

  it("localStorage.removeItem throwing never throws out of clearInstallPromptPreference", () => {
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => clearInstallPromptPreference("user-a")).not.toThrow();
  });
});

describe("isInstallPromptDismissalActive — 7-day cooldown", () => {
  it("is never active when never dismissed", () => {
    expect(isInstallPromptDismissalActive(null)).toBe(false);
  });

  it("is active immediately after a dismissal", () => {
    const now = Date.now();
    expect(isInstallPromptDismissalActive(now, now)).toBe(true);
  });

  it("is still active just before the cooldown elapses", () => {
    const dismissedAt = 1_000_000;
    expect(isInstallPromptDismissalActive(dismissedAt, dismissedAt + INSTALL_PROMPT_COOLDOWN_MS - 1)).toBe(true);
  });

  it("expires once the cooldown has fully elapsed", () => {
    const dismissedAt = 1_000_000;
    expect(isInstallPromptDismissalActive(dismissedAt, dismissedAt + INSTALL_PROMPT_COOLDOWN_MS)).toBe(false);
  });

  it("stays expired well after the cooldown", () => {
    const dismissedAt = 1_000_000;
    expect(isInstallPromptDismissalActive(dismissedAt, dismissedAt + INSTALL_PROMPT_COOLDOWN_MS * 3)).toBe(false);
  });
});

describe("isInstallPromptDismissalActive — fails open on a future-dated timestamp (corrupt/tampered data)", () => {
  it("a dismissedAt one second in the future is never treated as active", () => {
    const now = 1_000_000;
    expect(isInstallPromptDismissalActive(now + 1_000, now)).toBe(false);
  });

  it("a dismissedAt many years in the future never creates an indefinitely long cooldown", () => {
    const now = 1_000_000;
    const farFuture = now + INSTALL_PROMPT_COOLDOWN_MS * 1000;
    expect(isInstallPromptDismissalActive(farFuture, now)).toBe(false);
  });

  it("a dismissedAt exactly equal to now is still an ordinary, valid, active dismissal -- not treated as corrupt", () => {
    const now = 1_000_000;
    expect(isInstallPromptDismissalActive(now, now)).toBe(true);
  });
});
