import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { LOGIN_FEATURE_HIGHLIGHTS, LOGIN_HERO_EYEBROW, LOGIN_HERO_HEADLINE } from "@/lib/config/loginCopy";
import { APP_NAME } from "@/lib/config/productName";

const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({ auth: { signInWithOAuth } }),
}));

const { default: LoginPage } = await import("./page");

function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function searchParams(error?: string) {
  return Promise.resolve(error ? { error } : {});
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  // 2026-08-14T09:09:32Z is 12:09:32 in Asia/Jerusalem (UTC+3, DST).
  vi.setSystemTime(new Date("2026-08-14T09:09:32.000Z"));
});

describe("LoginPage", () => {
  it('renders the hero headline exactly: "כל המשמרות שלך. במקום אחד."', async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.getByRole("heading", { level: 1, name: LOGIN_HERO_HEADLINE })).toBeInTheDocument();
  });

  it("renders the eyebrow label above the headline", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.getByText(LOGIN_HERO_EYEBROW)).toBeInTheDocument();
  });

  it('renders the Google CTA with the exact wording "המשך עם Google", still wired to the real OAuth action', async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.getByRole("button", { name: "המשך עם Google" })).toBeInTheDocument();
  });

  it("introduces no email/password/registration UI", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    const { container } = renderWithTheme(element);

    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(screen.queryByText(/הרשמה/)).toBeNull();
    expect(screen.queryByText(/שכחת סיסמה/)).toBeNull();
  });

  it("shows a live clock reading Asia/Jerusalem time, not the runtime's local/UTC time", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    const { container } = renderWithTheme(element);

    const timeEls = container.querySelectorAll("time");
    expect(timeEls.length).toBeGreaterThan(0);
    for (const timeEl of timeEls) {
      expect(timeEl.getAttribute("dateTime")).toBe("12:09:32");
    }
  });

  it("renders no Sidebar/BottomNav app chrome", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.queryByRole("navigation", { name: "ניווט ראשי" })).toBeNull();
    expect(screen.queryByRole("link", { name: /^סקירה$/ })).toBeNull();
  });

  it("renders no theme toggle -- the login canvas is fixed regardless of the app's light/dark preference", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.queryByRole("button", { name: /ערכת נושא|מצב כהה|מצב בהיר|theme/i })).toBeNull();
  });

  it("shows no error notice when there is no ?error param", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a safe, generic error notice for ?error=auth -- no raw provider/Supabase error text", async () => {
    const element = await LoginPage({ searchParams: searchParams("auth") });
    renderWithTheme(element);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).not.toMatch(/supabase|invalid_grant|exception|stack/i);
    expect(alert.textContent?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("LoginPage — brand identity", () => {
  it("renders the product name in the header mark", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.getAllByText(APP_NAME).length).toBeGreaterThan(0);
  });

  it("renders the real supplied symbol artwork in the header mark", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    const { container } = renderWithTheme(element);

    expect(container.querySelector('img[src*="icon.png"]')).toBeInTheDocument();
  });

  it("renders the final hero headline exactly once", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.getAllByText(LOGIN_HERO_HEADLINE).length).toBe(1);
  });

  it("never renders the retired 'Luzly' name anywhere on the page", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    const { container } = renderWithTheme(element);

    expect(container.textContent).not.toMatch(/luzly/i);
    expect(container.innerHTML).not.toMatch(/luzly/i);
  });

  it("no longer renders the retired organizational logo badges", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    const { container } = renderWithTheme(element);

    expect(container.querySelector('img[src*="org-logo-takshal"]')).toBeNull();
    expect(container.querySelector('img[src*="org-logo-strategic-communication"]')).toBeNull();
  });
});

describe("LoginPage — feature highlights strip", () => {
  it("renders every feature highlight's title and subtitle", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    for (const feature of LOGIN_FEATURE_HIGHLIGHTS) {
      expect(screen.getByText(feature.title)).toBeInTheDocument();
      expect(screen.getByText(feature.subtitle)).toBeInTheDocument();
    }
  });
});
