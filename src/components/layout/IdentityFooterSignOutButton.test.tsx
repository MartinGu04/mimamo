import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/lib/auth/clearUserScopedDevicePreferences", () => ({ clearUserScopedDevicePreferences: vi.fn() }));
vi.mock("@/lib/push/browserSubscription", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/push/browserSubscription")>();
  return { ...actual, unsubscribeCurrentPushSubscription: vi.fn() };
});

const { signOutAction } = await import("@/lib/auth/actions");
const { clearUserScopedDevicePreferences } = await import("@/lib/auth/clearUserScopedDevicePreferences");
const { unsubscribeCurrentPushSubscription } = await import("@/lib/push/browserSubscription");
const { IdentityFooterSignOutButton } = await import("./IdentityFooterSignOutButton");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IdentityFooterSignOutButton — sign-out cleanup wiring (Phase 9B)", () => {
  it("clears this exact user's device-scoped preferences on click", async () => {
    render(
      <form action={signOutAction}>
        <IdentityFooterSignOutButton userId="user-a" />
      </form>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "התנתקות" }));
    });

    expect(clearUserScopedDevicePreferences).toHaveBeenCalledWith("user-a");
  });

  it("also still fires the browser Push unsubscribe (PR #29), unchanged by Phase 9B", async () => {
    render(
      <form action={signOutAction}>
        <IdentityFooterSignOutButton userId="user-a" />
      </form>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "התנתקות" }));
    });

    expect(unsubscribeCurrentPushSubscription).toHaveBeenCalledTimes(1);
  });

  it("never calls preventDefault -- the normal form submission still proceeds", async () => {
    render(
      <form action={signOutAction}>
        <IdentityFooterSignOutButton userId="user-a" />
      </form>,
    );

    const button = screen.getByRole("button", { name: "התנתקות" });
    const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });

    await act(async () => {
      button.dispatchEvent(clickEvent);
    });

    expect(clickEvent.defaultPrevented).toBe(false);
  });
});
