import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { APP_REVALIDATE_EVENT } from "@/components/layout/AppRevalidator";
import { APP_NAME } from "@/lib/config/productName";
import { readPushPreference } from "@/lib/notifications/pushPreference";
import { INSTALL_PROMPT_COOLDOWN_MS } from "@/lib/pwa/installPromptPreference";
import { NotificationBell } from "./NotificationBell";
import { PwaInstallProvider } from "./PwaInstallProvider";

const TEST_USER_ID = "user-test-1";

const enablePushNotificationsAction = vi.fn();
const disablePushNotificationsAction = vi.fn();
const getPushSubscriptionStatusAction = vi.fn();
const sendTestNotificationAction = vi.fn();

vi.mock("@/lib/notifications/actions", () => ({
  enablePushNotificationsAction: (...args: unknown[]) => enablePushNotificationsAction(...args),
  disablePushNotificationsAction: (...args: unknown[]) => disablePushNotificationsAction(...args),
  getPushSubscriptionStatusAction: (...args: unknown[]) => getPushSubscriptionStatusAction(...args),
  sendTestNotificationAction: (...args: unknown[]) => sendTestNotificationAction(...args),
}));

vi.mock("@/lib/push/publicConfig", () => ({ getVapidPublicKey: () => "test-public-key" }));

const getNotificationInboxAction = vi.fn();
const markNotificationReadAction = vi.fn();
const markAllNotificationsReadAction = vi.fn();
const clearNotificationInboxAction = vi.fn();

vi.mock("@/lib/notifications/inboxActions", () => ({
  getNotificationInboxAction: (...args: unknown[]) => getNotificationInboxAction(...args),
  markNotificationReadAction: (...args: unknown[]) => markNotificationReadAction(...args),
  markAllNotificationsReadAction: (...args: unknown[]) => markAllNotificationsReadAction(...args),
  clearNotificationInboxAction: (...args: unknown[]) => clearNotificationInboxAction(...args),
}));

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
  subscribeImpl,
}: {
  existingSubscription?: FakePushSubscription | null;
  subscribeImpl?: () => Promise<FakePushSubscription>;
} = {}) {
  let currentSubscription = existingSubscription;
  const subscribe = vi.fn(async () => {
    if (subscribeImpl) {
      currentSubscription = await subscribeImpl();
      return currentSubscription;
    }
    currentSubscription = new FakePushSubscription("https://push.example/new-endpoint");
    return currentSubscription;
  });
  const pushManager = {
    getSubscription: vi.fn(async () => currentSubscription),
    subscribe,
  };
  const registration = { pushManager };

  const requestPermission = vi.fn().mockResolvedValue("granted");

  // @ts-expect-error -- test-only global stubs simulating a supporting browser.
  window.PushManager = function PushManager() {};
  // @ts-expect-error -- test-only global stubs simulating a supporting browser.
  window.Notification = { permission: "default", requestPermission };

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

  return { pushManager, requestPermission, registration, setCurrentSubscription: (s: FakePushSubscription | null) => (currentSubscription = s) };
}

function removeBrowserPushEnvironment() {
  // @ts-expect-error -- test-only cleanup.
  delete window.PushManager;
  // @ts-expect-error -- test-only cleanup.
  delete window.Notification;
  // @ts-expect-error -- test-only cleanup.
  delete window.navigator.serviceWorker;
}

async function openPanel(variant: "sidebar" | "mobile" | "shell" = "mobile") {
  render(<NotificationBell variant={variant} userId={TEST_USER_ID} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
}

/** Opens the popover (inbox view, the default) then clicks the gear to reach the push-settings view -- every push-control test now lives behind this. */
async function openSettings() {
  await openPanel();
  fireEvent.click(await screen.findByRole("button", { name: "הגדרות התראות" }));
}

function inboxItem(overrides: Partial<{ id: string; category: string; title: string; body: string; path: string; happenedAt: string; isRead: boolean }> = {}) {
  return {
    id: "job_1",
    category: "tomorrow_shift",
    title: "⏰ המשמרת שלך מחר",
    body: "מחר ב־07:30 מתחילה משמרת יום שלך",
    path: "/",
    happenedAt: new Date().toISOString(),
    isRead: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  enablePushNotificationsAction.mockResolvedValue({ ok: true });
  disablePushNotificationsAction.mockResolvedValue({ ok: true });
  getPushSubscriptionStatusAction.mockResolvedValue({ subscribed: false });
  sendTestNotificationAction.mockResolvedValue({ ok: true });
  getNotificationInboxAction.mockResolvedValue({ items: [], unreadCount: 0 });
  markNotificationReadAction.mockResolvedValue({ ok: true });
  markAllNotificationsReadAction.mockResolvedValue({ ok: true });
  clearNotificationInboxAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  removeBrowserPushEnvironment();
  window.localStorage.clear();
});

describe("NotificationBell — inbox is the primary view", () => {
  it("opening the bell shows the inbox, not the push-settings panel", async () => {
    await openPanel();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "התראות" })).toBeInTheDocument());
    expect(screen.queryByText("סטטוס: כבוי")).toBeNull();
    expect(screen.queryByText("סטטוס: פעיל")).toBeNull();
  });

  it("shows the calm empty state when there are no items", async () => {
    await openPanel();
    await waitFor(() => expect(screen.getByText("אין התראות חדשות")).toBeInTheDocument());
  });

  it("shows a loading state before the first fetch resolves", async () => {
    let resolveInbox: (value: { items: unknown[]; unreadCount: number }) => void = () => {};
    getNotificationInboxAction.mockReturnValue(new Promise((resolve) => (resolveInbox = resolve)));

    await openPanel();
    expect(screen.getByText("טוען התראות...")).toBeInTheDocument();

    await act(async () => resolveInbox({ items: [], unreadCount: 0 }));
    await waitFor(() => expect(screen.getByText("אין התראות חדשות")).toBeInTheDocument());
  });

  it("shows a neutral error state when the fetch fails, never crashes", async () => {
    getNotificationInboxAction.mockRejectedValue(new Error("network down"));
    await openPanel();
    await waitFor(() => expect(screen.getByText("לא ניתן לטעון כרגע את ההתראות")).toBeInTheDocument());
  });

  it("renders items newest first with title and body", async () => {
    getNotificationInboxAction.mockResolvedValue({
      items: [inboxItem({ id: "a", title: "⚠️ שינוי בשיבוץ", body: "השיבוץ שלך השתנה" })],
      unreadCount: 1,
    });
    await openPanel();
    await waitFor(() => expect(screen.getByText("⚠️ שינוי בשיבוץ")).toBeInTheDocument());
    expect(screen.getByText("השיבוץ שלך השתנה")).toBeInTheDocument();
  });
});

describe("NotificationBell — unread badge", () => {
  it("shows no badge when unreadCount is 0", async () => {
    getNotificationInboxAction.mockResolvedValue({ items: [inboxItem({ isRead: true })], unreadCount: 0 });
    render(<NotificationBell variant="mobile" userId={TEST_USER_ID} />);
    await waitFor(() => expect(getNotificationInboxAction).toHaveBeenCalled());
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByRole("button", { name: "התראות" })).toBeInTheDocument();
  });

  it("shows the unread count on the trigger", async () => {
    getNotificationInboxAction.mockResolvedValue({
      items: [inboxItem({ id: "a" }), inboxItem({ id: "b" })],
      unreadCount: 2,
    });
    render(<NotificationBell variant="mobile" userId={TEST_USER_ID} />);
    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "התראות, 2 שלא נקראו" })).toBeInTheDocument();
  });

  it("caps the displayed badge at 9+", async () => {
    getNotificationInboxAction.mockResolvedValue({
      items: Array.from({ length: 12 }, (_, i) => inboxItem({ id: `j${i}` })),
      unreadCount: 12,
    });
    render(<NotificationBell variant="mobile" userId={TEST_USER_ID} />);
    await waitFor(() => expect(screen.getByText("9+")).toBeInTheDocument());
  });
});

describe("NotificationBell — badge freshness while the shell stays mounted (never requires opening the bell first)", () => {
  it("re-fetches and updates the badge when AppRevalidator's revalidate event fires, with the popover still closed", async () => {
    getNotificationInboxAction.mockResolvedValue({ items: [], unreadCount: 0 });
    render(<NotificationBell variant="mobile" userId={TEST_USER_ID} />);
    await waitFor(() => expect(getNotificationInboxAction).toHaveBeenCalled());
    expect(screen.queryByText("3")).toBeNull();

    getNotificationInboxAction.mockResolvedValue({
      items: [inboxItem({ id: "a" }), inboxItem({ id: "b" }), inboxItem({ id: "c" })],
      unreadCount: 3,
    });
    await act(async () => {
      window.dispatchEvent(new Event(APP_REVALIDATE_EVENT));
    });

    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stops listening once unmounted -- no further fetch after the revalidate event", async () => {
    getNotificationInboxAction.mockResolvedValue({ items: [], unreadCount: 0 });
    const { unmount } = render(<NotificationBell variant="mobile" userId={TEST_USER_ID} />);
    await waitFor(() => expect(getNotificationInboxAction).toHaveBeenCalled());
    const callsBeforeUnmount = getNotificationInboxAction.mock.calls.length;

    unmount();
    await act(async () => {
      window.dispatchEvent(new Event(APP_REVALIDATE_EVENT));
    });

    expect(getNotificationInboxAction.mock.calls.length).toBe(callsBeforeUnmount);
  });
});

describe("NotificationBell — unread/read visual distinction", () => {
  it("an unread item shows a dot indicator and bold title; a read item does not", async () => {
    getNotificationInboxAction.mockResolvedValue({
      items: [inboxItem({ id: "unread", title: "⚠️ לא נקרא", isRead: false }), inboxItem({ id: "read", title: "🔄 נקרא", isRead: true })],
      unreadCount: 1,
    });
    await openPanel();
    await waitFor(() => expect(screen.getByText("⚠️ לא נקרא")).toBeInTheDocument());

    const unreadTitle = screen.getByText("⚠️ לא נקרא");
    const readTitle = screen.getByText("🔄 נקרא");
    expect(unreadTitle.className).toMatch(/font-medium/);
    expect(readTitle.className).not.toMatch(/font-medium/);
  });
});

describe("NotificationBell — click an item", () => {
  it("marks it read and links to its safe existing destination", async () => {
    getNotificationInboxAction.mockResolvedValue({
      items: [inboxItem({ id: "job_x", path: "/schedule", isRead: false })],
      unreadCount: 1,
    });
    await openPanel();
    const link = await screen.findByRole("link");
    expect(link).toHaveAttribute("href", "/schedule");

    fireEvent.click(link);
    expect(markNotificationReadAction).toHaveBeenCalledWith("job_x");
  });

  it("clicking an already-read item never re-marks it read", async () => {
    getNotificationInboxAction.mockResolvedValue({
      items: [inboxItem({ id: "job_x", isRead: true })],
      unreadCount: 0,
    });
    await openPanel();
    const link = await screen.findByRole("link");

    fireEvent.click(link);
    expect(markNotificationReadAction).not.toHaveBeenCalled();
  });

  it("closes the popover after clicking an item", async () => {
    getNotificationInboxAction.mockResolvedValue({ items: [inboxItem()], unreadCount: 1 });
    await openPanel();
    const link = await screen.findByRole("link");

    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("NotificationBell — סמן הכל כנקרא / נקה התראות", () => {
  it("סמן הכל כנקרא is disabled when nothing is unread", async () => {
    getNotificationInboxAction.mockResolvedValue({ items: [inboxItem({ isRead: true })], unreadCount: 0 });
    await openPanel();
    await waitFor(() => expect(screen.getByRole("button", { name: "סמן הכל כנקרא" })).toBeDisabled());
  });

  it("clicking סמן הכל כנקרא calls the mark-all action", async () => {
    getNotificationInboxAction.mockResolvedValue({
      items: [inboxItem({ id: "a" }), inboxItem({ id: "b" })],
      unreadCount: 2,
    });
    await openPanel();
    const button = await screen.findByRole("button", { name: "סמן הכל כנקרא" });

    await act(async () => {
      fireEvent.click(button);
    });
    expect(markAllNotificationsReadAction).toHaveBeenCalledTimes(1);
  });

  it("clicking נקה התראות calls the clear action and empties the list", async () => {
    getNotificationInboxAction.mockResolvedValue({ items: [inboxItem()], unreadCount: 1 });
    await openPanel();
    const button = await screen.findByRole("button", { name: "נקה התראות" });

    await act(async () => {
      fireEvent.click(button);
    });
    expect(clearNotificationInboxAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText("אין התראות חדשות")).toBeInTheDocument());
  });

  it("action row never renders on an empty inbox", async () => {
    getNotificationInboxAction.mockResolvedValue({ items: [], unreadCount: 0 });
    await openPanel();
    await waitFor(() => expect(screen.getByText("אין התראות חדשות")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "סמן הכל כנקרא" })).toBeNull();
    expect(screen.queryByRole("button", { name: "נקה התראות" })).toBeNull();
  });
});

describe("NotificationBell — gear opens push settings", () => {
  it("clicking the gear switches to the settings view", async () => {
    removeBrowserPushEnvironment();
    await openPanel();
    fireEvent.click(await screen.findByRole("button", { name: "הגדרות התראות" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "הגדרות התראות" })).toBeInTheDocument());
  });

  it("the back button returns to the inbox view", async () => {
    removeBrowserPushEnvironment();
    await openPanel();
    fireEvent.click(await screen.findByRole("button", { name: "הגדרות התראות" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "הגדרות התראות" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "חזרה להתראות" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "התראות" })).toBeInTheDocument());
  });

  it("closing and reopening the popover resets back to the inbox view", async () => {
    removeBrowserPushEnvironment();
    await openPanel();
    fireEvent.click(await screen.findByRole("button", { name: "הגדרות התראות" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "הגדרות התראות" })).toBeInTheDocument());

    // Escape closes the popover.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "התראות" })).toBeInTheDocument());
  });
});

describe("NotificationBell — unsupported environment (settings view)", () => {
  it("never throws and shows a calm 'unsupported' message, with no enable button", async () => {
    removeBrowserPushEnvironment();
    await openSettings();
    await waitFor(() => expect(screen.getByText(/אינן נתמכות/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "הפעל התראות" })).toBeNull();
  });
});

describe("NotificationBell — no automatic permission prompt", () => {
  it("never calls Notification.requestPermission on mount, or merely by opening the panel", async () => {
    const { requestPermission } = installBrowserPushEnvironment();
    await openSettings();
    await waitFor(() => expect(screen.getByRole("button", { name: "הפעל התראות" })).toBeInTheDocument());
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("requests permission ONLY after the user explicitly clicks 'הפעל התראות'", async () => {
    const { requestPermission } = installBrowserPushEnvironment();
    await openSettings();
    const enableButton = await screen.findByRole("button", { name: "הפעל התראות" });

    expect(requestPermission).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(enableButton);
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe("NotificationBell — permission denied", () => {
  it("shows a calm explanation instead of an enable button, and never calls requestPermission again", async () => {
    installBrowserPushEnvironment();
    // @ts-expect-error -- simulate a browser that already denied permission.
    window.Notification.permission = "denied";

    await openSettings();

    await waitFor(() => expect(screen.getByText("התראות חסומות")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "הפעל התראות" })).toBeNull();
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it("a user who denies at the prompt sees the calm explanation, not a repeated prompt", async () => {
    const { requestPermission } = installBrowserPushEnvironment();
    requestPermission.mockResolvedValue("denied");

    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "הפעל התראות" }));

    await waitFor(() => expect(screen.getByText("התראות חסומות")).toBeInTheDocument());
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe("NotificationBell — enabling", () => {
  it("does not claim 'enabled' until both the browser subscription AND server persistence succeed", async () => {
    installBrowserPushEnvironment();
    enablePushNotificationsAction.mockResolvedValue({ ok: false, error: "persist_failed" });

    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "הפעל התראות" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "הפעל התראות" })).toBeInTheDocument());
    expect(screen.queryByText("סטטוס: פעיל")).toBeNull();
  });

  it("shows 'סטטוס: פעיל' with test/disable actions once the whole pipeline succeeds", async () => {
    installBrowserPushEnvironment();
    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "הפעל התראות" }));

    await waitFor(() => expect(screen.getByText("סטטוס: פעיל")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "שלח התראת בדיקה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "כבה התראות" })).toBeInTheDocument();
  });

  it("reuses an existing browser subscription instead of creating a duplicate (idempotent)", async () => {
    const existing = new FakePushSubscription("https://push.example/already-subscribed");
    const { pushManager } = installBrowserPushEnvironment({ existingSubscription: existing });

    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "הפעל התראות" }));

    await waitFor(() => expect(screen.getByText("סטטוס: פעיל")).toBeInTheDocument());
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(enablePushNotificationsAction).toHaveBeenCalledWith(existing.toJSON());
  });

  it("pressing enable twice in a row never creates two server rows or two browser subscriptions", async () => {
    installBrowserPushEnvironment();
    await openSettings();
    const enableButton = await screen.findByRole("button", { name: "הפעל התראות" });

    await act(async () => {
      fireEvent.click(enableButton);
    });
    await waitFor(() => expect(screen.getByText("סטטוס: פעיל")).toBeInTheDocument());

    // Re-open and simulate pressing enable again is a no-op (already enabled, no enable button rendered at all).
    expect(screen.queryByRole("button", { name: "הפעל התראות" })).toBeNull();
    expect(enablePushNotificationsAction).toHaveBeenCalledTimes(1);
  });
});

describe("NotificationBell — status derivation (shared-device safety)", () => {
  it("a browser subscription that exists locally but has no matching server row for the current user is treated as NOT enabled", async () => {
    const leftover = new FakePushSubscription("https://push.example/previous-user");
    installBrowserPushEnvironment({ existingSubscription: leftover });
    getPushSubscriptionStatusAction.mockResolvedValue({ subscribed: false });

    await openSettings();

    await waitFor(() => expect(screen.getByRole("button", { name: "הפעל התראות" })).toBeInTheDocument());
    expect(screen.queryByText("סטטוס: פעיל")).toBeNull();
  });

  it("shows enabled immediately when the server confirms a matching subscription for the current user", async () => {
    const existing = new FakePushSubscription("https://push.example/mine");
    installBrowserPushEnvironment({ existingSubscription: existing });
    getPushSubscriptionStatusAction.mockResolvedValue({ subscribed: true });

    await openSettings();

    await waitFor(() => expect(screen.getByText("סטטוס: פעיל")).toBeInTheDocument());
  });
});

describe("NotificationBell — disable", () => {
  async function enableFirst() {
    installBrowserPushEnvironment();
    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "הפעל התראות" }));
    await waitFor(() => expect(screen.getByText("סטטוס: פעיל")).toBeInTheDocument());
  }

  it("removes both the server record and the browser subscription, and ends in a truthful disabled state", async () => {
    await enableFirst();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "כבה התראות" }));
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "הפעל התראות" })).toBeInTheDocument());
    expect(disablePushNotificationsAction).toHaveBeenCalledTimes(1);
  });

  it("still ends in a disabled state locally even if the server-side delete fails (best-effort, never blocks)", async () => {
    await enableFirst();
    disablePushNotificationsAction.mockResolvedValue({ ok: false });
    getPushSubscriptionStatusAction.mockResolvedValue({ subscribed: false });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "כבה התראות" }));
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "הפעל התראות" })).toBeInTheDocument());
  });
});

describe("NotificationBell — per-user/per-device Push preference persistence (through the real UI)", () => {
  it("clicking הפעל התראות persists the preference as enabled for this userId", async () => {
    installBrowserPushEnvironment();
    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "הפעל התראות" }));
    await waitFor(() => expect(screen.getByText("סטטוס: פעיל")).toBeInTheDocument());

    expect(readPushPreference(TEST_USER_ID)).toBe("enabled");
  });

  it("clicking כבה התראות persists the preference as disabled for this userId", async () => {
    installBrowserPushEnvironment();
    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "הפעל התראות" }));
    await waitFor(() => expect(screen.getByText("סטטוס: פעיל")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "כבה התראות" }));
    });
    await waitFor(() => expect(readPushPreference(TEST_USER_ID)).toBe("disabled"));
  });

  it("a different userId never sees another user's persisted preference (account switch on the same device)", async () => {
    installBrowserPushEnvironment();
    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "הפעל התראות" }));
    await waitFor(() => expect(screen.getByText("סטטוס: פעיל")).toBeInTheDocument());
    cleanup();

    // A different authenticated user renders on this same device/browser --
    // this leftover subscription is not theirs, so the server reports
    // not-subscribed for them.
    getPushSubscriptionStatusAction.mockResolvedValue({ subscribed: false });
    render(<NotificationBell variant="mobile" userId="a-different-user" />);
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    fireEvent.click(await screen.findByRole("button", { name: "הגדרות התראות" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "הפעל התראות" })).toBeInTheDocument());
    expect(readPushPreference("a-different-user")).toBeNull();
    expect(readPushPreference(TEST_USER_ID)).toBe("enabled");
  });
});

describe("NotificationBell — real test notification, never a fake browser Notification", () => {
  it("clicking 'שלח התראת בדיקה' calls the server test-push action, never `new Notification()` directly, and never creates an inbox item", async () => {
    installBrowserPushEnvironment();
    const notificationConstructorSpy = vi.fn();
    // @ts-expect-error -- if NotificationBell ever constructed a real Notification, this spy would catch it.
    window.Notification = Object.assign(notificationConstructorSpy, { permission: "default", requestPermission: vi.fn().mockResolvedValue("granted") });

    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "הפעל התראות" }));
    await waitFor(() => expect(screen.getByText("סטטוס: פעיל")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "שלח התראת בדיקה" }));
    });

    expect(sendTestNotificationAction).toHaveBeenCalledTimes(1);
    expect(notificationConstructorSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/נשלחה בהצלחה/)).toBeInTheDocument());

    // The test notification is diagnostic only -- it must never write to the inbox.
    expect(markNotificationReadAction).not.toHaveBeenCalled();
    expect(markAllNotificationsReadAction).not.toHaveBeenCalled();
    expect(clearNotificationInboxAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "חזרה להתראות" }));
    await waitFor(() => expect(screen.getByText("אין התראות חדשות")).toBeInTheDocument());
  });

  it("shows an error state when the test send fails, without crashing", async () => {
    installBrowserPushEnvironment();
    sendTestNotificationAction.mockResolvedValue({ ok: false, error: "send_failed" });

    await openSettings();
    fireEvent.click(await screen.findByRole("button", { name: "הפעל התראות" }));
    await waitFor(() => expect(screen.getByText("סטטוס: פעיל")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "שלח התראת בדיקה" }));
    });

    await waitFor(() => expect(screen.getByText(/נכשלה/)).toBeInTheDocument());
  });
});

describe("NotificationBell — inbox works with push disabled", () => {
  it("shows real inbox items even when push is unsupported/never enabled on this device", async () => {
    removeBrowserPushEnvironment();
    getNotificationInboxAction.mockResolvedValue({
      items: [inboxItem({ id: "a", title: "🪖 תורנות מתקרבת", body: "מחר אתה תורן" })],
      unreadCount: 1,
    });

    await openPanel();

    await waitFor(() => expect(screen.getByText("🪖 תורנות מתקרבת")).toBeInTheDocument());
    expect(screen.getByText("מחר אתה תורן")).toBeInTheDocument();
  });
});

describe("NotificationBell — popover anchor side (header polish follow-up)", () => {
  it.each(["sidebar", "mobile", "shell"] as const)(
    "the %s variant's open panel is anchored with end-0 (RTL: pins the panel's physical LEFT edge, growing rightward/inward) -- never start-0, which grows further left and off-screen for a trigger near the physical left edge",
    async (variant) => {
      render(<NotificationBell variant={variant} userId={TEST_USER_ID} />);
      await act(async () => {});
      fireEvent.click(screen.getByRole("button", { name: /התראות/ }));

      const panel = await screen.findByRole("dialog", { name: "התראות" });
      expect(panel.className).toMatch(/\bend-0\b/);
      expect(panel.className).not.toMatch(/\bstart-0\b/);
    },
  );
});

// ---------------------------------------------------------------------------
// PWA install onboarding (contextual install -> Push onboarding flow) --
// exercised through a REAL `PwaInstallProvider`, same as `usePushSubscription`
// is exercised through a real (browser-stubbed) environment above, rather
// than a mocked hook -- this catches real wiring bugs between the provider,
// `bellOnboarding.ts`'s derivation, and the bell's own JSX.
// ---------------------------------------------------------------------------

class FakeBeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  readonly promptSpy = vi.fn();

  constructor(outcome: "accepted" | "dismissed" = "accepted") {
    super("beforeinstallprompt", { cancelable: true });
    this.userChoice = Promise.resolve({ outcome, platform: "web" });
  }

  prompt(): Promise<void> {
    this.promptSpy();
    return Promise.resolve();
  }
}

function stubMatchMedia(standalone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: standalone,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function stubIosDevice() {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  );
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue("iPhone");
}

async function renderBellWithInstall(userId = TEST_USER_ID) {
  render(
    <PwaInstallProvider>
      <NotificationBell variant="mobile" userId={userId} />
    </PwaInstallProvider>,
  );
  await act(async () => {});
}

async function openInstallBellPanel(userId = TEST_USER_ID) {
  await renderBellWithInstall(userId);
  fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
}

afterEach(() => {
  // `stubIosDevice` spies on `navigator.userAgent`/`platform` -- restored
  // here so it can never leak into a later, unrelated test in this same
  // file (`vi.clearAllMocks()` in the top-level `beforeEach` above clears
  // call history, but does NOT restore a spy's overridden implementation).
  vi.restoreAllMocks();
  // @ts-expect-error -- test-only cleanup of a stubbed global.
  delete window.matchMedia;
  delete (window.navigator as { standalone?: boolean }).standalone;
});

describe("NotificationBell — onboarding card (D): non-iOS browser with a native deferred prompt", () => {
  it("shows the install pitch with a real Install CTA, not the low-key fallback note", async () => {
    stubMatchMedia(false);
    removeBrowserPushEnvironment();
    await renderBellWithInstall();
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    await act(async () => window.dispatchEvent(new FakeBeforeInstallPromptEvent()));

    await waitFor(() => expect(screen.getByText(`📲 התקינו את ${APP_NAME}`)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /התקנה/ })).toBeInTheDocument();
    expect(screen.queryByText(/דרך תפריט הדפדפן/)).toBeNull();
  });

  it("clicking התקנה calls the deferred event's prompt() exactly once", async () => {
    stubMatchMedia(false);
    removeBrowserPushEnvironment();
    await renderBellWithInstall();
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    const event = new FakeBeforeInstallPromptEvent("accepted");
    await act(async () => window.dispatchEvent(event));
    const installButton = await screen.findByRole("button", { name: /התקנה/ });

    await act(async () => fireEvent.click(installButton));

    expect(event.promptSpy).toHaveBeenCalledTimes(1);
  });

  it("dismissing via 'לא עכשיו' hides the card immediately", async () => {
    stubMatchMedia(false);
    removeBrowserPushEnvironment();
    await renderBellWithInstall();
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    await act(async () => window.dispatchEvent(new FakeBeforeInstallPromptEvent()));
    await waitFor(() => expect(screen.getByText(`📲 התקינו את ${APP_NAME}`)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "לא עכשיו" }));

    expect(screen.queryByText(`📲 התקינו את ${APP_NAME}`)).toBeNull();
  });
});

describe("NotificationBell — onboarding card (G): non-iOS, no deferred prompt", () => {
  it("shows only the truthful low-key fallback note, never a dead Install button", async () => {
    stubMatchMedia(false);
    removeBrowserPushEnvironment();
    await openInstallBellPanel();

    await waitFor(() => expect(screen.getByText(`אפשר להוסיף את ${APP_NAME} למסך הבית דרך תפריט הדפדפן.`)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /התקנה/ })).toBeNull();
    // The inbox itself is still perfectly usable alongside the fallback note.
    await waitFor(() => expect(screen.getByText("אין התראות חדשות")).toBeInTheDocument());
  });
});

describe("NotificationBell — onboarding card (E): iPhone/iPad, not standalone", () => {
  it("gets Add to Home Screen instructions, collapsed by default with correct aria wiring", async () => {
    stubMatchMedia(false);
    stubIosDevice();
    removeBrowserPushEnvironment();
    await openInstallBellPanel();

    await waitFor(() => expect(screen.getByText(`הוסיפו את ${APP_NAME} למסך הבית`)).toBeInTheDocument());
    const trigger = screen.getByRole("button", { name: "איך מוסיפים למסך הבית?" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("לחצו על כפתור השיתוף")).toBeNull();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const stepsId = trigger.getAttribute("aria-controls");
    expect(stepsId).toBeTruthy();
    expect(screen.getByText("לחצו על כפתור השיתוף").closest(`#${stepsId}`)).not.toBeNull();
  });

  it("never renders a fake native install button (no install API exists on iOS)", async () => {
    stubMatchMedia(false);
    stubIosDevice();
    removeBrowserPushEnvironment();
    await openInstallBellPanel();

    await waitFor(() => expect(screen.getByText(`הוסיפו את ${APP_NAME} למסך הבית`)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^התקנה$/ })).toBeNull();
  });
});

describe("NotificationBell — onboarding card (E): iPhone/iPad, standalone", () => {
  it("does NOT show install instructions", async () => {
    stubMatchMedia(true);
    stubIosDevice();
    removeBrowserPushEnvironment();
    await openInstallBellPanel();

    await waitFor(() => expect(screen.getByText("אין התראות חדשות")).toBeInTheDocument());
    expect(screen.queryByText(`הוסיפו את ${APP_NAME} למסך הבית`)).toBeNull();
  });
});

describe("NotificationBell — onboarding card (F): install completed this session, tab still not standalone", () => {
  it("shows the truthful next-step message, not another install pitch", async () => {
    stubMatchMedia(false);
    removeBrowserPushEnvironment();
    await renderBellWithInstall();
    await act(async () => window.dispatchEvent(new Event("appinstalled")));
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));

    await waitFor(() => expect(screen.getByText("ההתקנה הושלמה")).toBeInTheDocument());
    expect(screen.getByText(new RegExp(`פתח/י את ${APP_NAME} מהסמל במסך הבית`))).toBeInTheDocument();
    expect(screen.queryByText(`📲 התקינו את ${APP_NAME}`)).toBeNull();
  });
});

describe("NotificationBell — onboarding card (B): standalone + Push not enabled", () => {
  it("shows the Enable Notifications card", async () => {
    stubMatchMedia(true);
    installBrowserPushEnvironment();
    await openInstallBellPanel();

    await waitFor(() => expect(screen.getByText("🔔 הפעילו התראות")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "הפעל התראות" })).toBeInTheDocument();
  });

  it("clicking the card's CTA calls the EXISTING enable() -- real permission request, real subscribe, real server persistence", async () => {
    stubMatchMedia(true);
    const env = installBrowserPushEnvironment();
    await openInstallBellPanel();
    const enableButton = await screen.findByRole("button", { name: "הפעל התראות" });

    await act(async () => fireEvent.click(enableButton));

    expect(env.requestPermission).toHaveBeenCalledTimes(1);
    expect(env.pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(enablePushNotificationsAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("🔔 הפעילו התראות")).toBeNull());
  });

  it("the card disappears once Push becomes enabled (spec A: standalone + enabled -> no card)", async () => {
    stubMatchMedia(true);
    installBrowserPushEnvironment();
    await openInstallBellPanel();
    fireEvent.click(await screen.findByRole("button", { name: "הפעל התראות" }));

    await waitFor(() => expect(screen.queryByText("🔔 הפעילו התראות")).toBeNull());
    // The inbox stays right there underneath, unaffected.
    expect(screen.getByText("אין התראות חדשות")).toBeInTheDocument();
  });
});

describe("NotificationBell — onboarding card (C): standalone + permission denied", () => {
  it("shows blocked guidance, never re-requesting permission", async () => {
    stubMatchMedia(true);
    const env = installBrowserPushEnvironment();
    // @ts-expect-error -- simulate a browser that already denied permission.
    window.Notification.permission = "denied";
    await openInstallBellPanel();

    await waitFor(() => expect(screen.getByText("התראות חסומות")).toBeInTheDocument());
    expect(env.requestPermission).not.toHaveBeenCalled();
  });

  it("its 'לפרטים' link opens the full Settings explanation", async () => {
    stubMatchMedia(true);
    installBrowserPushEnvironment();
    // @ts-expect-error -- simulate a browser that already denied permission.
    window.Notification.permission = "denied";
    await openInstallBellPanel();
    fireEvent.click(await screen.findByRole("button", { name: "לפרטים" }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "הגדרות התראות" })).toBeInTheDocument());
    expect(screen.getByText(/ההתראות חסומות בהגדרות הדפדפן או המערכת/)).toBeInTheDocument();
  });
});

describe("NotificationBell — dismissal cooldown", () => {
  it("respects the cooldown -- once dismissed, a fresh mount does not auto-show the install card again", async () => {
    stubMatchMedia(false);
    removeBrowserPushEnvironment();
    await renderBellWithInstall();
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    await act(async () => window.dispatchEvent(new FakeBeforeInstallPromptEvent()));
    await waitFor(() => expect(screen.getByText(`📲 התקינו את ${APP_NAME}`)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "לא עכשיו" }));
    cleanup();

    // A fresh mount/open on the SAME device/user shortly after -- e.g. the
    // next time this same person taps the bell -- must not re-pitch install.
    await renderBellWithInstall();
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    await act(async () => window.dispatchEvent(new FakeBeforeInstallPromptEvent()));

    await waitFor(() => expect(screen.getByText("אין התראות חדשות")).toBeInTheDocument());
    expect(screen.queryByText(`📲 התקינו את ${APP_NAME}`)).toBeNull();
  });

  it("is scoped by userId -- a different account on the same device still gets the automatic card", async () => {
    stubMatchMedia(false);
    removeBrowserPushEnvironment();
    await renderBellWithInstall(TEST_USER_ID);
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    await act(async () => window.dispatchEvent(new FakeBeforeInstallPromptEvent()));
    await waitFor(() => expect(screen.getByText(`📲 התקינו את ${APP_NAME}`)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "לא עכשיו" }));
    cleanup();

    await renderBellWithInstall("a-different-user");
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    await act(async () => window.dispatchEvent(new FakeBeforeInstallPromptEvent()));

    await waitFor(() => expect(screen.getByText(`📲 התקינו את ${APP_NAME}`)).toBeInTheDocument());
  });

  it("expires after the cooldown window, letting the card appear again", async () => {
    stubMatchMedia(false);
    removeBrowserPushEnvironment();
    const key = `mi-ma-mo:install-prompt-dismissed:${TEST_USER_ID}`;
    window.localStorage.setItem(key, String(Date.now() - INSTALL_PROMPT_COOLDOWN_MS - 1000));

    await renderBellWithInstall();
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    await act(async () => window.dispatchEvent(new FakeBeforeInstallPromptEvent()));

    await waitFor(() => expect(screen.getByText(`📲 התקינו את ${APP_NAME}`)).toBeInTheDocument());
  });
});

describe("NotificationBell — Settings manual install entry point (spec point 8)", () => {
  it("always reachable from the gear when not standalone, even mid-cooldown", async () => {
    stubMatchMedia(false);
    removeBrowserPushEnvironment();
    const key = `mi-ma-mo:install-prompt-dismissed:${TEST_USER_ID}`;
    window.localStorage.setItem(key, String(Date.now()));

    await renderBellWithInstall();
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    await act(async () => window.dispatchEvent(new FakeBeforeInstallPromptEvent()));
    // The automatic card is suppressed by the fresh dismissal...
    await waitFor(() => expect(screen.getByText("אין התראות חדשות")).toBeInTheDocument());
    expect(screen.queryByText(`📲 התקינו את ${APP_NAME}`)).toBeNull();

    // ...but Settings still offers it, unconditionally.
    fireEvent.click(await screen.findByRole("button", { name: "הגדרות התראות" }));

    await waitFor(() => expect(screen.getByText("התקנת האפליקציה")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /התקנה/ })).toBeInTheDocument();
  });

  it("is never shown once the app is standalone", async () => {
    stubMatchMedia(true);
    installBrowserPushEnvironment();
    await renderBellWithInstall();
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    fireEvent.click(await screen.findByRole("button", { name: "הגדרות התראות" }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "הגדרות התראות" })).toBeInTheDocument());
    expect(screen.queryByText("התקנת האפליקציה")).toBeNull();
  });
});

describe("NotificationBell — Settings replaces the misleading unsupported message on iOS non-standalone (spec point 6)", () => {
  it("iOS + not standalone + Push reporting unsupported -> install guidance instead of the blunt 'not supported' message", async () => {
    stubMatchMedia(false);
    stubIosDevice();
    removeBrowserPushEnvironment();
    await renderBellWithInstall();
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    fireEvent.click(await screen.findByRole("button", { name: "הגדרות התראות" }));

    await waitFor(() => expect(screen.getByText("התקנת האפליקציה")).toBeInTheDocument());
    expect(screen.getByText(`הוסיפו את ${APP_NAME} למסך הבית`)).toBeInTheDocument();
    expect(screen.queryByText("התראות אינן נתמכות בדפדפן או במכשיר הזה.")).toBeNull();
  });

  it("a non-iOS browser that is genuinely unsupported still keeps the truthful unsupported message", async () => {
    stubMatchMedia(false);
    removeBrowserPushEnvironment();
    await renderBellWithInstall();
    fireEvent.click(screen.getByRole("button", { name: /התראות/ }));
    fireEvent.click(await screen.findByRole("button", { name: "הגדרות התראות" }));

    await waitFor(() => expect(screen.getByText("התראות אינן נתמכות בדפדפן או במכשיר הזה.")).toBeInTheDocument());
  });
});

describe("NotificationBell — install onboarding never triggers an automatic permission prompt", () => {
  it("simply opening the bell with the Enable Notifications card visible never calls requestPermission", async () => {
    stubMatchMedia(true);
    const env = installBrowserPushEnvironment();
    await openInstallBellPanel();

    await waitFor(() => expect(screen.getByText("🔔 הפעילו התראות")).toBeInTheDocument());
    expect(env.requestPermission).not.toHaveBeenCalled();
  });

  it("a native appinstalled completion never calls requestPermission automatically", async () => {
    stubMatchMedia(false);
    const env = installBrowserPushEnvironment();
    await renderBellWithInstall();

    await act(async () => window.dispatchEvent(new Event("appinstalled")));

    expect(env.requestPermission).not.toHaveBeenCalled();
  });

  it("mounting standalone (as if freshly launched from the installed icon) never requests permission on its own", async () => {
    stubMatchMedia(true);
    const env = installBrowserPushEnvironment();

    await renderBellWithInstall();

    expect(env.requestPermission).not.toHaveBeenCalled();
  });
});

describe("NotificationBell — unread badge stays independent of install/Push state", () => {
  it("still shows the unread count even while the install fallback note is displayed", async () => {
    stubMatchMedia(false);
    removeBrowserPushEnvironment();
    getNotificationInboxAction.mockResolvedValue({
      items: [inboxItem({ id: "a" }), inboxItem({ id: "b" })],
      unreadCount: 2,
    });

    await renderBellWithInstall();

    await waitFor(() => expect(screen.getByText("2")).toBeInTheDocument());
  });
});
