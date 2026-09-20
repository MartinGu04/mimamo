import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPushPreference, markPushPreferenceDisabled, markPushPreferenceEnabled, readPushPreference } from "./pushPreference";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("pushPreference — storage isolation (per userId, never global)", () => {
  it("returns null for a userId that has never been written", () => {
    expect(readPushPreference("user-a")).toBeNull();
  });

  it("A enabled, B unknown -- each userId reads back only its own value", () => {
    markPushPreferenceEnabled("user-a");
    expect(readPushPreference("user-a")).toBe("enabled");
    expect(readPushPreference("user-b")).toBeNull();
  });

  it("A and B can independently store different values without clobbering each other", () => {
    markPushPreferenceEnabled("user-a");
    markPushPreferenceDisabled("user-b");
    expect(readPushPreference("user-a")).toBe("enabled");
    expect(readPushPreference("user-b")).toBe("disabled");
  });

  it("stores under a key namespaced by userId, never a bare/global key", () => {
    markPushPreferenceEnabled("user-a");
    expect(window.localStorage.getItem("mi-ma-mo:push-preference:user-a")).toBe("enabled");
    expect(window.localStorage.getItem("mi-ma-mo:push-preference:user-b")).toBeNull();
  });

  it("re-enabling overwrites a previous disable for the SAME user only", () => {
    markPushPreferenceDisabled("user-a");
    markPushPreferenceEnabled("user-a");
    expect(readPushPreference("user-a")).toBe("enabled");
  });
});

describe("pushPreference — fails safe on corrupt/unavailable storage", () => {
  it("a corrupt/garbage stored value reads back as null, never crashes, never mistaken for a real preference", () => {
    window.localStorage.setItem("mi-ma-mo:push-preference:user-a", "yes-please");
    expect(readPushPreference("user-a")).toBeNull();
  });

  it("localStorage.getItem throwing (private browsing, disabled storage) reads back as null, never throws", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => readPushPreference("user-a")).not.toThrow();
    expect(readPushPreference("user-a")).toBeNull();
  });

  it("localStorage.setItem throwing (quota, private browsing) never throws out of markPushPreferenceEnabled/Disabled", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => markPushPreferenceEnabled("user-a")).not.toThrow();
    expect(() => markPushPreferenceDisabled("user-a")).not.toThrow();
  });
});

describe("clearPushPreference — sign-out cleanup (Phase 9B)", () => {
  it("removes the current user's own stored preference", () => {
    markPushPreferenceEnabled("user-a");
    clearPushPreference("user-a");
    expect(readPushPreference("user-a")).toBeNull();
    expect(window.localStorage.getItem("mi-ma-mo:push-preference:user-a")).toBeNull();
  });

  it("never removes a DIFFERENT user's preference on the same shared device", () => {
    markPushPreferenceEnabled("user-a");
    markPushPreferenceEnabled("user-b");
    clearPushPreference("user-a");
    expect(readPushPreference("user-a")).toBeNull();
    expect(readPushPreference("user-b")).toBe("enabled");
  });

  it("is a harmless no-op when the user never had a stored preference", () => {
    expect(() => clearPushPreference("user-never-stored")).not.toThrow();
  });

  it("localStorage.removeItem throwing never throws out of clearPushPreference", () => {
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => clearPushPreference("user-a")).not.toThrow();
  });
});
