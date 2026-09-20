import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRIVACY_STORAGE_NOTICE_DISMISSED_KEY,
  markPrivacyStorageNoticeDismissed,
  readPrivacyStorageNoticeDismissed,
} from "./privacyStorageNotice";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("privacyStorageNotice — dismissal storage (Phase 9D)", () => {
  it("is not dismissed when the key is absent", () => {
    expect(readPrivacyStorageNoticeDismissed()).toBe(false);
  });

  it("is dismissed once the key has been written", () => {
    markPrivacyStorageNoticeDismissed();
    expect(readPrivacyStorageNoticeDismissed()).toBe(true);
    expect(window.localStorage.getItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY)).not.toBeNull();
  });

  it("fails closed (treated as dismissed) when reading throws", () => {
    // `vi.spyOn(window.localStorage, "getItem")` does NOT actually
    // intercept calls in jsdom (its Storage instance always resolves
    // methods from the prototype, ignoring an own-property override) --
    // spying on `Storage.prototype` itself is what real jsdom Storage
    // calls dispatch through.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => readPrivacyStorageNoticeDismissed()).not.toThrow();
    expect(readPrivacyStorageNoticeDismissed()).toBe(true);
  });

  it("never throws when writing fails (storage disabled/quota)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => markPrivacyStorageNoticeDismissed()).not.toThrow();
  });

  it("never uses localStorage.clear()", () => {
    const clearSpy = vi.spyOn(Storage.prototype, "clear");
    markPrivacyStorageNoticeDismissed();
    readPrivacyStorageNoticeDismissed();
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("writes ONLY its own key, never touching other device-wide preference keys", () => {
    window.localStorage.setItem("app-theme", "dark");
    markPrivacyStorageNoticeDismissed();
    expect(window.localStorage.getItem("app-theme")).toBe("dark");
  });
});
