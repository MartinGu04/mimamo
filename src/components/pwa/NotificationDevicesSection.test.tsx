import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { APP_NAME } from "@/lib/config/productName";
import { readPushPreference } from "@/lib/notifications/pushPreference";
import type { OwnedPushDevice } from "@/lib/notifications/deviceTypes";
import { NotificationDevicesSection } from "./NotificationDevicesSection";
import { PushDeviceProvider } from "./PushDeviceProvider";

const TEST_USER_ID = "user-devices-1";
const CURRENT_ENDPOINT = "https://push.example/this-device";

const enablePushNotificationsAction = vi.fn();
const disablePushNotificationsAction = vi.fn();
const getPushSubscriptionStatusAction = vi.fn();
const sendTestNotificationAction = vi.fn();
const heartbeatPushSubscriptionAction = vi.fn();
const listNotificationDevicesAction = vi.fn();
const removeNotificationDeviceAction = vi.fn();

vi.mock("@/lib/notifications/actions", () => ({
  enablePushNotificationsAction: (...args: unknown[]) => enablePushNotificationsAction(...args),
  disablePushNotificationsAction: (...args: unknown[]) => disablePushNotificationsAction(...args),
  getPushSubscriptionStatusAction: (...args: unknown[]) => getPushSubscriptionStatusAction(...args),
  sendTestNotificationAction: (...args: unknown[]) => sendTestNotificationAction(...args),
  heartbeatPushSubscriptionAction: (...args: unknown[]) => heartbeatPushSubscriptionAction(...args),
  listNotificationDevicesAction: (...args: unknown[]) => listNotificationDevicesAction(...args),
  removeNotificationDeviceAction: (...args: unknown[]) => removeNotificationDeviceAction(...args),
}));

vi.mock("@/lib/push/publicConfig", () => ({ getVapidPublicKey: () => "test-public-key" }));

class FakePushSubscription {
  endpoint: string;
  unsubscribe = vi.fn().mockResolvedValue(true);
  constructor(endpoint: string) {
    this.endpoint = endpoint;
  }
  toJSON() {
    return { endpoint: this.endpoint, keys: { p256dh: "p", auth: "a" }, expirationTime: null };
  }
}

function installBrowserPushEnvironment(existing: FakePushSubscription | null) {
  let current = existing;
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => current),
      subscribe: vi.fn(async () => current),
    },
  };
  // @ts-expect-error -- test-only global stubs simulating a supporting browser.
  window.PushManager = function PushManager() {};
  // @ts-expect-error -- test-only global stubs simulating a supporting browser.
  window.Notification = { permission: "granted", requestPermission: vi.fn().mockResolvedValue("granted") };
  Object.defineProperty(window.navigator, "serviceWorker", {
    value: {
      getRegistration: vi.fn().mockResolvedValue(registration),
      get ready() {
        return Promise.resolve(registration);
      },
    },
    configurable: true,
    writable: true,
  });
  return { clear: () => (current = null) };
}

const IPHONE_PWA: OwnedPushDevice = {
  deviceRef: "ref-iphone",
  descriptor: { type: "phone", platform: "ios", browser: "safari", standalone: true },
  lastSeenAt: new Date().toISOString(),
  lastReceivedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  isCurrent: true,
};

const WINDOWS_PC: OwnedPushDevice = {
  deviceRef: "ref-windows",
  descriptor: { type: "desktop", platform: "windows", browser: "chrome", standalone: false },
  lastSeenAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  lastReceivedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  isCurrent: false,
};

const OTHER_PC: OwnedPushDevice = {
  deviceRef: "ref-other-pc",
  descriptor: { type: "desktop", platform: "macos", browser: "firefox", standalone: false },
  lastSeenAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  lastReceivedAt: null,
  createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  isCurrent: false,
};

/** A row registered before device metadata existed, whose owner has not opened that installation again since -- so nothing about it can be named. */
function legacyDevice(ref: string, daysSinceSeen = 28): OwnedPushDevice {
  return {
    deviceRef: ref,
    descriptor: { type: null, platform: null, browser: null, standalone: null },
    lastSeenAt: new Date(Date.now() - daysSinceSeen * 24 * 60 * 60 * 1000).toISOString(),
    lastReceivedAt: null,
    createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    isCurrent: false,
  };
}

async function renderSection() {
  render(
    <PushDeviceProvider userId={TEST_USER_ID}>
      <NotificationDevicesSection />
    </PushDeviceProvider>,
  );
  await act(async () => {});
}

async function openSection() {
  await renderSection();
  fireEvent.click(await screen.findByRole("button", { name: /המכשירים שלי/ }));
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  enablePushNotificationsAction.mockResolvedValue({ ok: true });
  disablePushNotificationsAction.mockResolvedValue({ ok: true });
  getPushSubscriptionStatusAction.mockResolvedValue({ subscribed: true, revoked: false, endpointDead: false });
  sendTestNotificationAction.mockResolvedValue({ ok: true });
  heartbeatPushSubscriptionAction.mockResolvedValue({ ok: true });
  listNotificationDevicesAction.mockResolvedValue({ devices: [] });
  removeNotificationDeviceAction.mockResolvedValue({ ok: true });
  installBrowserPushEnvironment(new FakePushSubscription(CURRENT_ENDPOINT));
});

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only cleanup.
  delete window.PushManager;
  // @ts-expect-error -- test-only cleanup.
  delete window.Notification;
  // @ts-expect-error -- test-only cleanup.
  delete window.navigator.serviceWorker;
  window.localStorage.clear();
});

describe("NotificationDevicesSection -- listing", () => {
  it("is collapsed by default and loads nothing until opened", async () => {
    await renderSection();
    expect(listNotificationDevicesAction).not.toHaveBeenCalled();
  });

  it("lists every device independently once opened, with the real labels", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [IPHONE_PWA, WINDOWS_PC, OTHER_PC] });

    await openSection();

    await waitFor(() => expect(screen.getByText("iPhone")).toBeInTheDocument());
    expect(screen.getByText(`· ${APP_NAME}`)).toBeInTheDocument();
    expect(screen.getByText("Chrome")).toBeInTheDocument();
    expect(screen.getByText("· Windows")).toBeInTheDocument();
    expect(screen.getByText("Firefox")).toBeInTheDocument();
    // Three devices, three rows -- none collapsed or hidden for being old.
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("badges only the current device", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [IPHONE_PWA, WINDOWS_PC] });

    await openSection();

    await waitFor(() => expect(screen.getAllByText("המכשיר הזה")).toHaveLength(1));
  });

  it("passes this device's own endpoint to the server for current-device marking", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [IPHONE_PWA] });

    await openSection();

    await waitFor(() => expect(listNotificationDevicesAction).toHaveBeenCalledWith(CURRENT_ENDPOINT));
  });

  it("shows when each device was last seen and when it last actually RECEIVED a push -- never 'read'", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [WINDOWS_PC] });

    await openSection();

    await waitFor(() => expect(screen.getByText(/נראה לאחרונה: לפני 3 ימים/)).toBeInTheDocument());
    expect(screen.getByText(/התראה התקבלה לאחרונה: לפני 7 ימים/)).toBeInTheDocument();
    expect(screen.queryByText(/נקרא/)).toBeNull();
  });

  it("says 'טרם' for a device that has never acknowledged a push, rather than inventing a time", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [OTHER_PC] });

    await openSection();

    await waitFor(() => expect(screen.getByText("התראה התקבלה לאחרונה: טרם")).toBeInTheDocument());
  });

  it("renders no endpoint, no encryption/auth key, and no raw User-Agent anywhere in the DOM", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [IPHONE_PWA, WINDOWS_PC, OTHER_PC] });

    await openSection();
    await waitFor(() => expect(screen.getByText("iPhone")).toBeInTheDocument());

    const markup = document.body.innerHTML;
    expect(markup).not.toContain(CURRENT_ENDPOINT);
    expect(markup).not.toContain("push.example");
    expect(markup).not.toContain("Mozilla");
    expect(markup).not.toContain("p256dh");
    // The opaque device handle is used as a React key, never printed.
    expect(markup).not.toContain("ref-iphone");
  });

  it("degrades to a truthful message rather than crashing when the list cannot be loaded", async () => {
    listNotificationDevicesAction.mockRejectedValue(new Error("boom"));

    await openSection();

    await waitFor(() => expect(screen.getByText("לא ניתן לטעון כרגע את רשימת המכשירים")).toBeInTheDocument());
  });

  it("says so plainly when there are no active devices", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [] });

    await openSection();

    await waitFor(() => expect(screen.getByText("אין מכשירים פעילים להתראות")).toBeInTheDocument());
  });
});

describe("NotificationDevicesSection -- removing another device", () => {
  it("revokes it by its opaque handle and refreshes the list", async () => {
    listNotificationDevicesAction
      .mockResolvedValueOnce({ devices: [IPHONE_PWA, WINDOWS_PC] })
      .mockResolvedValue({ devices: [IPHONE_PWA] });

    await openSection();
    await waitFor(() => expect(screen.getByText("Chrome")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "הסר מכשיר" }));

    await waitFor(() => expect(removeNotificationDeviceAction).toHaveBeenCalledWith("ref-windows"));
    await waitFor(() => expect(screen.queryByText("Chrome")).toBeNull());
    // Removing another device must NOT touch this device's own local
    // disable flow or preference.
    expect(disablePushNotificationsAction).not.toHaveBeenCalled();
    expect(readPushPreference(TEST_USER_ID)).not.toBe("disabled");
  });
});

describe("NotificationDevicesSection -- turning the CURRENT device off", () => {
  it("reuses the existing local disable flow: local preference, server deactivation, and a best-effort browser unsubscribe", async () => {
    listNotificationDevicesAction
      .mockResolvedValueOnce({ devices: [IPHONE_PWA, WINDOWS_PC] })
      .mockResolvedValue({ devices: [WINDOWS_PC] });

    await openSection();
    await waitFor(() => expect(screen.getByText("iPhone")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "כבה במכשיר הזה" }));

    await waitFor(() => expect(disablePushNotificationsAction).toHaveBeenCalledWith(CURRENT_ENDPOINT));
    // The remote-removal path must NOT be used for the current device --
    // that would revoke the row while leaving this browser subscribed
    // and still remembering "enabled".
    expect(removeNotificationDeviceAction).not.toHaveBeenCalled();
    await waitFor(() => expect(readPushPreference(TEST_USER_ID)).toBe("disabled"));
  });
});

describe("NotificationDevicesSection -- unidentified legacy devices", () => {
  it("groups them behind a collapsed section with an accurate count, instead of letting them bury the named devices", async () => {
    listNotificationDevicesAction.mockResolvedValue({
      devices: [IPHONE_PWA, WINDOWS_PC, ...Array.from({ length: 8 }, (_, i) => legacyDevice(`ref-legacy-${i}`))],
    });

    await openSection();

    await waitFor(() => expect(screen.getByText("iPhone")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /מכשירים ישנים \(8\)/ })).toBeInTheDocument();
    // Collapsed by default: only the two identified devices are listed.
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("מכשיר ישן")).toBeNull();
  });

  it("identified devices keep rendering normally alongside the group", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [IPHONE_PWA, WINDOWS_PC, legacyDevice("ref-legacy")] });

    await openSection();

    await waitFor(() => expect(screen.getByText("iPhone")).toBeInTheDocument());
    expect(screen.getByText(`· ${APP_NAME}`)).toBeInTheDocument();
    expect(screen.getByText("Chrome")).toBeInTheDocument();
    expect(screen.getByText("· Windows")).toBeInTheDocument();
  });

  it("expanding the group exposes each legacy entry with the truthful information we DO have, and its own removal control", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [IPHONE_PWA, legacyDevice("ref-legacy", 28)] });

    await openSection();
    await waitFor(() => expect(screen.getByText("iPhone")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /מכשירים ישנים/ }));

    await waitFor(() => expect(screen.getByText("מכשיר ישן")).toBeInTheDocument());
    expect(screen.getByText(/נראה לאחרונה: לפני 28 ימים/)).toBeInTheDocument();
    expect(screen.getByText("התראה התקבלה לאחרונה: טרם")).toBeInTheDocument();
    // Removal stays available per device -- an unidentifiable device is
    // exactly the kind a user may most want to remove.
    expect(screen.getAllByRole("button", { name: "הסר מכשיר" })).toHaveLength(1);
  });

  it("invents no browser/platform/device name for a legacy row", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [legacyDevice("ref-legacy")] });

    await openSection();
    fireEvent.click(await screen.findByRole("button", { name: /מכשירים ישנים/ }));
    await waitFor(() => expect(screen.getByText("מכשיר ישן")).toBeInTheDocument());

    const markup = document.body.innerHTML;
    for (const invented of ["Chrome", "Safari", "Firefox", "Edge", "Windows", "iPhone", "iPad", "Mac", "Android"]) {
      expect(markup).not.toContain(invented);
    }
  });

  it("removing ONE legacy device revokes only that device", async () => {
    listNotificationDevicesAction
      .mockResolvedValueOnce({ devices: [IPHONE_PWA, legacyDevice("ref-legacy-1"), legacyDevice("ref-legacy-2")] })
      .mockResolvedValue({ devices: [IPHONE_PWA, legacyDevice("ref-legacy-2")] });

    await openSection();
    fireEvent.click(await screen.findByRole("button", { name: /מכשירים ישנים \(2\)/ }));
    await waitFor(() => expect(screen.getAllByText("מכשיר ישן")).toHaveLength(2));

    fireEvent.click(screen.getAllByRole("button", { name: "הסר מכשיר" })[0]);

    await waitFor(() => expect(removeNotificationDeviceAction).toHaveBeenCalledWith("ref-legacy-1"));
    expect(removeNotificationDeviceAction).toHaveBeenCalledTimes(1);
    expect(disablePushNotificationsAction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: /מכשירים ישנים \(1\)/ })).toBeInTheDocument());
  });

  it("NEVER hides the current device in the group, even before its own metadata backfill has landed", async () => {
    const currentLegacy: OwnedPushDevice = { ...legacyDevice("ref-current", 0), isCurrent: true };
    listNotificationDevicesAction.mockResolvedValue({ devices: [currentLegacy, legacyDevice("ref-legacy")] });

    await openSection();

    // The current device is listed directly, badged, and NOT called "old".
    await waitFor(() => expect(screen.getByText("המכשיר הזה")).toBeInTheDocument());
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("מכשיר")).toBeInTheDocument();
    expect(screen.queryByText("מכשיר ישן")).toBeNull();
    expect(screen.getByRole("button", { name: /מכשירים ישנים \(1\)/ })).toBeInTheDocument();
  });

  it("renders no group at all when every device is identified", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [IPHONE_PWA, WINDOWS_PC] });

    await openSection();

    await waitFor(() => expect(screen.getByText("iPhone")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /מכשירים ישנים/ })).toBeNull();
  });

  it("groups even a single legacy device -- one unnamed row among named ones reads as a broken entry", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [IPHONE_PWA, legacyDevice("ref-legacy")] });

    await openSection();

    await waitFor(() => expect(screen.getByRole("button", { name: /מכשירים ישנים \(1\)/ })).toBeInTheDocument());
  });

  it("leaks no endpoint, key, or raw User-Agent for legacy rows either -- expanded or collapsed", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [legacyDevice("ref-legacy-a"), legacyDevice("ref-legacy-b")] });

    await openSection();
    fireEvent.click(await screen.findByRole("button", { name: /מכשירים ישנים/ }));
    await waitFor(() => expect(screen.getAllByText("מכשיר ישן")).toHaveLength(2));

    const markup = document.body.innerHTML;
    expect(markup).not.toContain(CURRENT_ENDPOINT);
    expect(markup).not.toContain("push.example");
    expect(markup).not.toContain("Mozilla");
    expect(markup).not.toContain("p256dh");
    expect(markup).not.toContain("ref-legacy-a");
  });

  it("never prunes by age -- a device untouched for a year is still listed and still removable", async () => {
    listNotificationDevicesAction.mockResolvedValue({ devices: [legacyDevice("ref-ancient", 365)] });

    await openSection();
    fireEvent.click(await screen.findByRole("button", { name: /מכשירים ישנים \(1\)/ }));

    await waitFor(() => expect(screen.getByText("מכשיר ישן")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "הסר מכשיר" })).toBeInTheDocument();
  });
});
