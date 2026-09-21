import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readPushPreference } from "@/lib/notifications/pushPreference";
import { GlobalPushBanner } from "./GlobalPushBanner";
import { PushDeviceProvider } from "./PushDeviceProvider";
import { PwaInstallProvider } from "./PwaInstallProvider";

const TEST_USER_ID = "user-banner-1";

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

const BANNER_HEADLINE = "ההתראות לא פעילות במכשיר הזה";

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

function installBrowserPushEnvironment({
  existingSubscription = null as FakePushSubscription | null,
  permission = "default" as NotificationPermission,
} = {}) {
  let currentSubscription = existingSubscription;
  const subscribe = vi.fn(async () => {
    currentSubscription = new FakePushSubscription("https://push.example/fresh-install");
    return currentSubscription;
  });
  const registration = { pushManager: { getSubscription: vi.fn(async () => currentSubscription), subscribe } };
  const requestPermission = vi.fn().mockResolvedValue("granted");

  // @ts-expect-error -- test-only global stubs simulating a supporting browser.
  window.PushManager = function PushManager() {};
  // @ts-expect-error -- test-only global stubs simulating a supporting browser.
  window.Notification = { permission, requestPermission };

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

  return { subscribe, requestPermission };
}

/** `display-mode: standalone` is the real signal `PwaInstallProvider` reads -- never a prop we can simply assert into place. */
function stubStandalone(standalone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: standalone,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** `userId` is passed through an options object rather than a defaulted positional parameter -- `renderBanner(undefined)` would otherwise silently fall back to the default and quietly stop testing the no-account case. */
async function renderBanner({ userId }: { userId?: string } = { userId: TEST_USER_ID }) {
  render(
    <PwaInstallProvider>
      <PushDeviceProvider userId={userId}>
        <GlobalPushBanner userId={userId} />
      </PushDeviceProvider>
    </PwaInstallProvider>,
  );
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  enablePushNotificationsAction.mockResolvedValue({ ok: true });
  disablePushNotificationsAction.mockResolvedValue({ ok: true });
  getPushSubscriptionStatusAction.mockResolvedValue({ subscribed: false, revoked: false, endpointDead: false });
  sendTestNotificationAction.mockResolvedValue({ ok: true });
  heartbeatPushSubscriptionAction.mockResolvedValue({ ok: true });
  listNotificationDevicesAction.mockResolvedValue({ devices: [] });
  removeNotificationDeviceAction.mockResolvedValue({ ok: true });
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

describe("GlobalPushBanner -- fresh installed PWA (the real incident)", () => {
  it("appears for a standalone install with no remembered choice and no active subscription", async () => {
    stubStandalone(true);
    installBrowserPushEnvironment();

    await renderBanner();

    await waitFor(() => expect(screen.getByText(BANNER_HEADLINE)).toBeInTheDocument());
    expect(screen.getByText("כדי שלא תפספס משמרות ותורנויות, הפעל אותן במכשיר הזה.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הפעל התראות" })).toBeInTheDocument();
  });

  it("is an inline strip, never a modal/pop-up -- no dialog role, nothing to dismiss before using the app", async () => {
    stubStandalone(true);
    installBrowserPushEnvironment();

    await renderBanner();

    await waitFor(() => expect(screen.getByText(BANNER_HEADLINE)).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("global-push-banner")).toHaveAttribute("role", "status");
  });

  it("the CTA runs the EXISTING enable flow -- real permission request, real subscribe, real persistence -- and the banner then disappears", async () => {
    stubStandalone(true);
    const { subscribe, requestPermission } = installBrowserPushEnvironment();

    await renderBanner();
    await waitFor(() => expect(screen.getByText(BANNER_HEADLINE)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "הפעל התראות" }));

    await waitFor(() => expect(screen.queryByText(BANNER_HEADLINE)).toBeNull());
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    // Persisted as an EXPLICIT enable -- the one intent allowed to clear
    // a revocation.
    expect(enablePushNotificationsAction).toHaveBeenCalledWith(expect.any(Object), true, expect.any(Object));
    expect(readPushPreference(TEST_USER_ID)).toBe("enabled");
  });

  it("never requests permission on its own -- only the CTA click does", async () => {
    stubStandalone(true);
    const { requestPermission } = installBrowserPushEnvironment();

    await renderBanner();
    await waitFor(() => expect(screen.getByText(BANNER_HEADLINE)).toBeInTheDocument());

    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe("GlobalPushBanner -- explicit opt-out is respected", () => {
  it("does NOT appear after the user chose כבה התראות on this device/account, even across a fresh mount", async () => {
    stubStandalone(true);
    installBrowserPushEnvironment();
    window.localStorage.setItem(`mi-ma-mo:push-preference:${TEST_USER_ID}`, "disabled");

    await renderBanner();

    await act(async () => {});
    expect(screen.queryByText(BANNER_HEADLINE)).toBeNull();
  });

  it("another account's opt-out on the same shared browser does NOT suppress this account's banner", async () => {
    stubStandalone(true);
    installBrowserPushEnvironment();
    window.localStorage.setItem("mi-ma-mo:push-preference:someone-else", "disabled");

    await renderBanner();

    await waitFor(() => expect(screen.getByText(BANNER_HEADLINE)).toBeInTheDocument());
  });
});

describe("GlobalPushBanner -- restraint", () => {
  it("does NOT appear in an ordinary browser tab, even with Push missing", async () => {
    stubStandalone(false);
    installBrowserPushEnvironment();

    await renderBanner();
    await act(async () => {});

    expect(screen.queryByText(BANNER_HEADLINE)).toBeNull();
  });

  it("does NOT appear when an active subscription is already confirmed for this user", async () => {
    stubStandalone(true);
    installBrowserPushEnvironment({ existingSubscription: new FakePushSubscription("https://push.example/live") });
    getPushSubscriptionStatusAction.mockResolvedValue({ subscribed: true, revoked: false, endpointDead: false });

    await renderBanner();
    await act(async () => {});

    expect(screen.queryByText(BANNER_HEADLINE)).toBeNull();
  });

  it("does NOT show an unusable CTA when notifications are blocked in the browser/system", async () => {
    stubStandalone(true);
    installBrowserPushEnvironment({ permission: "denied" });

    await renderBanner();
    await act(async () => {});

    expect(screen.queryByText(BANNER_HEADLINE)).toBeNull();
  });

  it("does NOT appear with no authenticated user id", async () => {
    stubStandalone(true);
    installBrowserPushEnvironment();

    await renderBanner({});
    await act(async () => {});

    expect(screen.queryByText(BANNER_HEADLINE)).toBeNull();
  });

  it("DOES appear for a device removed from another device, since that is not an opt-out on THIS device", async () => {
    stubStandalone(true);
    installBrowserPushEnvironment({
      existingSubscription: new FakePushSubscription("https://push.example/removed-elsewhere"),
      permission: "granted",
    });
    window.localStorage.setItem(`mi-ma-mo:push-preference:${TEST_USER_ID}`, "enabled");
    getPushSubscriptionStatusAction.mockResolvedValue({ subscribed: false, revoked: true, endpointDead: false });

    await renderBanner();

    await waitFor(() => expect(screen.getByText(BANNER_HEADLINE)).toBeInTheDocument());
    // And it did NOT silently bring itself back.
    expect(enablePushNotificationsAction).not.toHaveBeenCalled();
  });
});
