import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { APP_NAME } from "@/lib/config/productName";
import { MobileIdentityBar } from "./MobileIdentityBar";

afterEach(() => {
  cleanup();
});

async function renderWithTheme(ui: ReactElement) {
  const result = render(<ThemeProvider>{ui}</ThemeProvider>);
  // Flushes NotificationBell's async on-mount capability/status check
  // (jsdom has no real Notification/serviceWorker, so it settles into
  // "unsupported" quickly) -- avoids an act() warning from that state
  // update landing after this render call returns.
  await act(async () => {});
  return result;
}

describe("MobileIdentityBar", () => {
  it("shows the APP_NAME identity, not the user's name, permanently in the header", async () => {
    await renderWithTheme(<MobileIdentityBar name="דני בדיקה" isManager={false} avatarUrl={null} userId="user-test-1" />);
    expect(screen.getByText(APP_NAME)).toBeInTheDocument();
    expect(screen.queryByText("דני בדיקה")).toBeNull();
  });

  it("the Avatar is the profile-menu trigger, with an accessible name mentioning the user", async () => {
    await renderWithTheme(<MobileIdentityBar name="דני בדיקה" isManager={false} avatarUrl={null} userId="user-test-1" />);
    expect(screen.getByRole("button", { name: /דני בדיקה/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a real, enabled notification Bell control (PR #29) -- no longer the disabled 'בקרוב' placeholder", async () => {
    await renderWithTheme(<MobileIdentityBar name="דני בדיקה" isManager={false} avatarUrl={null} userId="user-test-1" />);
    const bell = screen.getByRole("button", { name: "התראות" });
    expect(bell).not.toBeDisabled();
  });

  it("opens a notification popover (the inbox, by default) when the Bell is clicked", async () => {
    await renderWithTheme(<MobileIdentityBar name="דני בדיקה" isManager={false} avatarUrl={null} userId="user-test-1" />);
    fireEvent.click(screen.getByRole("button", { name: "התראות" }));
    expect(screen.getByRole("dialog", { name: "התראות" })).toBeInTheDocument();
  });

  it("never renders a 3-button theme segmented control directly in the header", async () => {
    await renderWithTheme(<MobileIdentityBar name="דני בדיקה" isManager={false} avatarUrl={null} userId="user-test-1" />);
    expect(screen.queryByRole("radiogroup", { name: "ערכת נושא" })).toBeNull();
  });

  it("never shows sign-out permanently in the closed header", async () => {
    await renderWithTheme(<MobileIdentityBar name="דני בדיקה" isManager={false} avatarUrl={null} userId="user-test-1" />);
    expect(screen.queryByRole("button", { name: "התנתקות" })).toBeNull();
  });

  it("shows the המחלבה brand symbol next to the wordmark, and never a retired brand name", async () => {
    const { container } = await renderWithTheme(
      <MobileIdentityBar name="דני בדיקה" isManager={false} avatarUrl={null} userId="user-test-1" />,
    );
    expect(container.querySelector('img[src*="icon.png"]')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/luzly/i);
    expect(container.textContent).not.toMatch(/מי-מה-מו/);
  });
});

describe("MobileIdentityBar — theme toggle (nav redesign pass)", () => {
  it("offers a dedicated light/dark icon toggle next to search", async () => {
    await renderWithTheme(<MobileIdentityBar name="דני בדיקה" isManager={false} avatarUrl={null} userId="user-test-1" />);
    // The global matchMedia stub (vitest.setup.ts) resolves to light, so the action offers to switch to dark.
    expect(screen.getByRole("button", { name: "מצב כהה" })).toBeInTheDocument();
  });

  it("toggling it flips the shared theme state (same ThemeProvider every other control uses)", async () => {
    await renderWithTheme(<MobileIdentityBar name="דני בדיקה" isManager={false} avatarUrl={null} userId="user-test-1" />);
    fireEvent.click(screen.getByRole("button", { name: "מצב כהה" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "מצב בהיר" })).toBeInTheDocument();
  });
});
