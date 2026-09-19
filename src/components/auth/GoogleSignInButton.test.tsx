import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const signInWithOAuth = vi.fn();
const createSupabaseBrowserClient = vi.fn(() => ({ auth: { signInWithOAuth } }));

vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient }));

const { GoogleSignInButton } = await import("./GoogleSignInButton");

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  signInWithOAuth.mockReset();
  signInWithOAuth.mockResolvedValue({ data: {}, error: null });
  createSupabaseBrowserClient.mockClear();
});

describe("GoogleSignInButton", () => {
  it('shows the exact CTA wording "המשך עם Google"', () => {
    render(<GoogleSignInButton />);
    expect(screen.getByRole("button", { name: "המשך עם Google" })).toBeInTheDocument();
  });

  it('marks the English "Google" fragment with lang="en" for Hebrew screen reader pronunciation, without changing the accessible name', () => {
    render(<GoogleSignInButton />);
    const button = screen.getByRole("button", { name: "המשך עם Google" });
    const englishFragment = button.querySelector('[lang="en"]');
    expect(englishFragment).toHaveTextContent("Google");
  });

  it("starts the real Google OAuth flow via Supabase on click, preserving redirect/callback behavior", () => {
    render(<GoogleSignInButton />);
    fireEvent.click(screen.getByRole("button", { name: "המשך עם Google" }));

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  });

  it('shows a polished pending state ("מתחבר...") and disables the button while the OAuth call is in flight', () => {
    let resolveSignIn: (value: { data: object; error: null }) => void = () => {};
    signInWithOAuth.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );

    render(<GoogleSignInButton />);
    fireEvent.click(screen.getByRole("button", { name: "המשך עם Google" }));

    const pendingButton = screen.getByRole("button", { name: "מתחבר..." });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");

    resolveSignIn({ data: {}, error: null });
  });

  it("never fires a second sign-in call for rapid repeat clicks (no duplicate auth submissions)", () => {
    let resolveSignIn: (value: { data: object; error: null }) => void = () => {};
    signInWithOAuth.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSignIn = resolve;
      }),
    );

    render(<GoogleSignInButton />);
    const button = screen.getByRole("button", { name: "המשך עם Google" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(signInWithOAuth).toHaveBeenCalledTimes(1);
    resolveSignIn({ data: {}, error: null });
  });
});
