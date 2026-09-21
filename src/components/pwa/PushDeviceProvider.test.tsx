import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { PushDeviceProvider, usePushDevice } from "./PushDeviceProvider";

const TEST_USER_ID = "user-hb-1";
const LIVE_ENDPOINT = "https://push.example/live-device";

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

function installBrowserPushEnvironment(existingSubscription: FakePushSubscription | null) {
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => existingSubscription),
      subscribe: vi.fn(async () => existingSubscription),
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
}

/**
 * Stands in for the two bells the real shell mounts simultaneously (one
 * of them merely CSS-hidden) -- the exact situation that used to run two
 * independent push state machines per page load.
 */
function PushStateProbe({ label }: { label: string }) {
  const { state, endpoint } = usePushDevice();
  return (
    <div data-testid={label}>
      {state}|{endpoint ?? "none"}
    </div>
  );
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
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
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // @ts-expect-error -- test-only cleanup.
  delete window.PushManager;
  // @ts-expect-error -- test-only cleanup.
  delete window.Notification;
  // @ts-expect-error -- test-only cleanup.
  delete window.navigator.serviceWorker;
  setVisibility("visible");
});

describe("PushDeviceProvider -- one shared state machine for the whole shell", () => {
  it("runs ONE status check no matter how many consumers are mounted", async () => {
    installBrowserPushEnvironment(new FakePushSubscription(LIVE_ENDPOINT));

    render(
      <PushDeviceProvider userId={TEST_USER_ID}>
        <PushStateProbe label="mobile-bell" />
        <PushStateProbe label="desktop-bell" />
        <PushStateProbe label="global-banner" />
      </PushDeviceProvider>,
    );
    await act(async () => {});

    await waitFor(() => expect(screen.getByTestId("mobile-bell")).toHaveTextContent(`enabled|${LIVE_ENDPOINT}`));
    // Three consumers, one round trip -- not three.
    expect(getPushSubscriptionStatusAction).toHaveBeenCalledTimes(1);
  });

  it("every consumer sees the SAME state, so a CSS-hidden bell can never disagree with a visible one", async () => {
    installBrowserPushEnvironment(new FakePushSubscription(LIVE_ENDPOINT));

    render(
      <PushDeviceProvider userId={TEST_USER_ID}>
        <PushStateProbe label="mobile-bell" />
        <PushStateProbe label="desktop-bell" />
      </PushDeviceProvider>,
    );
    await act(async () => {});

    await waitFor(() =>
      expect(screen.getByTestId("mobile-bell").textContent).toBe(screen.getByTestId("desktop-bell").textContent),
    );
  });

  it("a consumer rendered with no provider reports a truthful 'checking' and no-ops, rather than throwing", async () => {
    render(<PushStateProbe label="detached" />);
    await act(async () => {});

    expect(screen.getByTestId("detached")).toHaveTextContent("checking|none");
    expect(getPushSubscriptionStatusAction).not.toHaveBeenCalled();
  });
});

describe("PushDeviceProvider -- the subscription heartbeat", () => {
  it("checks in exactly ONCE per app open, for the confirmed endpoint, however many consumers are mounted", async () => {
    installBrowserPushEnvironment(new FakePushSubscription(LIVE_ENDPOINT));

    render(
      <PushDeviceProvider userId={TEST_USER_ID}>
        <PushStateProbe label="mobile-bell" />
        <PushStateProbe label="desktop-bell" />
      </PushDeviceProvider>,
    );
    await act(async () => {});

    await waitFor(() => expect(heartbeatPushSubscriptionAction).toHaveBeenCalledTimes(1));
    expect(heartbeatPushSubscriptionAction).toHaveBeenCalledWith(LIVE_ENDPOINT);
  });

  it("does NOT check in for a device that is not actually subscribed -- a heartbeat can never create or revive anything", async () => {
    installBrowserPushEnvironment(new FakePushSubscription(LIVE_ENDPOINT));
    getPushSubscriptionStatusAction.mockResolvedValue({ subscribed: false, revoked: true, endpointDead: false });

    render(
      <PushDeviceProvider userId={TEST_USER_ID}>
        <PushStateProbe label="probe" />
      </PushDeviceProvider>,
    );
    await act(async () => {});

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("not_enabled"));
    expect(heartbeatPushSubscriptionAction).not.toHaveBeenCalled();
  });

  it("does NOT check in with no browser subscription at all", async () => {
    installBrowserPushEnvironment(null);

    render(
      <PushDeviceProvider userId={TEST_USER_ID}>
        <PushStateProbe label="probe" />
      </PushDeviceProvider>,
    );
    await act(async () => {});

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("not_enabled"));
    expect(heartbeatPushSubscriptionAction).not.toHaveBeenCalled();
  });

  it("is throttled on foreground returns -- returning to the app repeatedly is not a reason to keep calling", async () => {
    installBrowserPushEnvironment(new FakePushSubscription(LIVE_ENDPOINT));

    render(
      <PushDeviceProvider userId={TEST_USER_ID}>
        <PushStateProbe label="probe" />
      </PushDeviceProvider>,
    );
    await act(async () => {});
    await waitFor(() => expect(heartbeatPushSubscriptionAction).toHaveBeenCalledTimes(1));

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        setVisibility("hidden");
        setVisibility("visible");
      });
    }

    expect(heartbeatPushSubscriptionAction).toHaveBeenCalledTimes(1);
  });

  it("checks in again once the throttle window has genuinely elapsed", async () => {
    installBrowserPushEnvironment(new FakePushSubscription(LIVE_ENDPOINT));
    const realNow = Date.now;

    render(
      <PushDeviceProvider userId={TEST_USER_ID}>
        <PushStateProbe label="probe" />
      </PushDeviceProvider>,
    );
    await act(async () => {});
    await waitFor(() => expect(heartbeatPushSubscriptionAction).toHaveBeenCalledTimes(1));

    const start = realNow();
    Date.now = () => start + 31 * 60 * 1000;
    try {
      await act(async () => {
        setVisibility("hidden");
        setVisibility("visible");
      });
      expect(heartbeatPushSubscriptionAction).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realNow;
    }
  });

  it("sets no recurring timer of its own -- there is no polling, only app-open and foreground events", async () => {
    installBrowserPushEnvironment(new FakePushSubscription(LIVE_ENDPOINT));
    const setInterval = vi.spyOn(globalThis, "setInterval");

    render(
      <PushDeviceProvider userId={TEST_USER_ID}>
        <PushStateProbe label="probe" />
      </PushDeviceProvider>,
    );
    // Asserted immediately after the effects commit and BEFORE any
    // `waitFor` -- testing-library's own polling uses `setInterval`, so
    // a later check would be measuring the test harness rather than the
    // provider.
    await act(async () => {});
    expect(setInterval).not.toHaveBeenCalled();
    setInterval.mockRestore();

    expect(heartbeatPushSubscriptionAction).toHaveBeenCalledTimes(1);
  });

  it("a failing heartbeat -- rejected promise or synchronous throw -- never breaks the app or the push state", async () => {
    installBrowserPushEnvironment(new FakePushSubscription(LIVE_ENDPOINT));
    heartbeatPushSubscriptionAction.mockImplementation(() => {
      throw new Error("transport exploded");
    });

    render(
      <PushDeviceProvider userId={TEST_USER_ID}>
        <PushStateProbe label="probe" />
      </PushDeviceProvider>,
    );
    await act(async () => {});

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(`enabled|${LIVE_ENDPOINT}`));
  });

  it("stops listening for foreground returns once unmounted", async () => {
    installBrowserPushEnvironment(new FakePushSubscription(LIVE_ENDPOINT));

    const { unmount } = render(
      <PushDeviceProvider userId={TEST_USER_ID}>
        <PushStateProbe label="probe" />
      </PushDeviceProvider>,
    );
    await act(async () => {});
    await waitFor(() => expect(heartbeatPushSubscriptionAction).toHaveBeenCalledTimes(1));

    unmount();
    const realNow = Date.now;
    const start = realNow();
    Date.now = () => start + 31 * 60 * 1000;
    try {
      await act(async () => {
        setVisibility("hidden");
        setVisibility("visible");
      });
      expect(heartbeatPushSubscriptionAction).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = realNow;
    }
  });
});
