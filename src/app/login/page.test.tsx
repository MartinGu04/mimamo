import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { LOGIN_FEATURE_HIGHLIGHTS, LOGIN_HERO_EYEBROW, LOGIN_HERO_HEADLINE } from "@/lib/config/loginCopy";
import { APP_NAME } from "@/lib/config/productName";
import { PRIVACY_STORAGE_NOTICE_DISMISSED_KEY } from "@/lib/privacy/privacyStorageNotice";

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
  window.localStorage.clear();
});

beforeEach(() => {
  vi.useFakeTimers();
  // 2026-08-14T09:09:32Z is 12:09:32 in Asia/Jerusalem (UTC+3, DST).
  vi.setSystemTime(new Date("2026-08-14T09:09:32.000Z"));
  // Every existing test below predates the Phase 9D transparency notice and
  // asserts on the page's ONE steady-state footer link set -- seed the
  // notice as already-dismissed-on-this-device so its own (identically
  // worded) links never turn those singular `getByRole` queries ambiguous.
  // The notice's own first-visit/dismiss behavior is covered in its
  // dedicated describe block below, which explicitly clears this key first.
  window.localStorage.setItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY, "1");
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

describe("LoginPage — skip to main content / main landmark (Phase 3, IS 5568/WCAG 2.4.1 Bypass Blocks)", () => {
  it("renders a Hebrew skip link as the first focusable element, pointing at a real <main> landmark", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    const skipLink = screen.getByRole("link", { name: "דלג לתוכן הראשי" });
    const focusable = document.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable[0]).toBe(skipLink);

    const main = screen.getByRole("main");
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("renders exactly one skip link and one main landmark", async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.getAllByRole("link", { name: "דלג לתוכן הראשי" })).toHaveLength(1);
    expect(screen.getAllByRole("main")).toHaveLength(1);
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

describe("LoginPage — accessibility statement link (Phase 7)", () => {
  it('renders a "הצהרת נגישות" link pointing at /accessibility, reachable before sign-in', async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.getByRole("link", { name: "הצהרת נגישות" })).toHaveAttribute("href", "/accessibility");
  });
});

describe("LoginPage — privacy notice link (Phase 9C)", () => {
  it('renders a "מדיניות פרטיות" link pointing at /privacy, reachable before sign-in', async () => {
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.getByRole("link", { name: "מדיניות פרטיות" })).toHaveAttribute("href", "/privacy");
  });
});

describe("LoginPage — cookie/storage transparency notice (Phase 9D)", () => {
  it("shows the notice on first visit, before sign-in, when the dismissal key is absent", async () => {
    window.localStorage.removeItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY);
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.getByTestId("privacy-storage-notice")).toBeInTheDocument();
    expect(screen.getByText(/עוגיות ואחסון מקומי/)).toBeInTheDocument();
    // Now two links share this exact wording: the always-present footer
    // link (Phase 9C) and this notice's own link.
    expect(screen.getAllByRole("link", { name: "מדיניות פרטיות" })).toHaveLength(2);
  });

  it("renders no accept/reject/consent wording -- this is informational, not a consent banner", async () => {
    window.localStorage.removeItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY);
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    const notice = screen.getByTestId("privacy-storage-notice");
    expect(notice.textContent).not.toMatch(/אישור|קבל|דחה|הסכמה|העדפות שיווק/);
    expect(screen.queryByRole("button", { name: /אישור|קבל|דחה/ })).toBeNull();
  });

  it('clicking "הבנתי" writes the dismissal key and hides the notice, leaving the footer links untouched', async () => {
    window.localStorage.removeItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY);
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    fireEvent.click(screen.getByRole("button", { name: "הבנתי" }));

    expect(screen.queryByTestId("privacy-storage-notice")).toBeNull();
    expect(window.localStorage.getItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY)).not.toBeNull();
    expect(screen.getByRole("link", { name: "הצהרת נגישות" })).toHaveAttribute("href", "/accessibility");
    expect(screen.getByRole("link", { name: "מדיניות פרטיות" })).toHaveAttribute("href", "/privacy");
  });

  it('navigating via the notice\'s own "מדיניות פרטיות" link does not dismiss it', async () => {
    window.localStorage.removeItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY);
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    const notice = screen.getByTestId("privacy-storage-notice");
    const noticeLink = within(notice).getByRole("link", { name: "מדיניות פרטיות" });
    fireEvent.click(noticeLink);

    expect(screen.getByTestId("privacy-storage-notice")).toBeInTheDocument();
    expect(window.localStorage.getItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY)).toBeNull();
  });

  it("stays hidden once already dismissed on this device", async () => {
    window.localStorage.setItem(PRIVACY_STORAGE_NOTICE_DISMISSED_KEY, "1");
    const element = await LoginPage({ searchParams: searchParams() });
    renderWithTheme(element);

    expect(screen.queryByTestId("privacy-storage-notice")).toBeNull();
    expect(screen.getAllByRole("link", { name: "מדיניות פרטיות" })).toHaveLength(1);
  });
});
