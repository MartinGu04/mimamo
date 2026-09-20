import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { A11yPreferencesProvider } from "@/lib/a11y/A11yPreferencesProvider";
import { AppShell } from "./AppShell";

/** Opens the mobile header's profile menu, which now hides the sign-out affordance/theme action until the Avatar trigger is clicked. */
function openMobileProfileMenu() {
  fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
}

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

afterEach(() => {
  cleanup();
});

function renderWithTheme(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <A11yPreferencesProvider>{ui}</A11yPreferencesProvider>
    </ThemeProvider>,
  );
}

describe("AppShell — mobile identity/sign-out", () => {
  it("the desktop Sidebar's sign-out is immediately visible; the mobile one is reachable behind the profile menu", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>DASHBOARD_CONTENT</div>
      </AppShell>,
    );
    // Only the desktop IdentityFooter's sign-out is visible before the mobile profile menu opens.
    expect(screen.getAllByRole("button", { name: "התנתקות" })).toHaveLength(1);

    openMobileProfileMenu();

    // Once open, the mobile profile menu's own sign-out (a plain button, not a menuitem -- Phase 5 remediation) joins the desktop one.
    expect(screen.getAllByRole("button", { name: "התנתקות" })).toHaveLength(2);
  });

  it("the safe person name is reachable via the mobile profile menu, not permanently in the header", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    openMobileProfileMenu();
    expect(screen.getAllByText("דני בדיקה").length).toBeGreaterThan(0);
  });

  it("shows the manager indication when isManager is true", () => {
    renderWithTheme(
      <AppShell person={{ name: "נועה דוגמה", isManager: true, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getAllByText("מנהל/ת").length).toBeGreaterThan(0);
  });

  it("renders the global Emergency Mode banner when emergencyModeActive is true, as an assertive alert", () => {
    renderWithTheme(
      <AppShell
        person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}
        emergencyModeActive
      >
        <div>content</div>
      </AppShell>,
    );
    const banner = screen.getByTestId("emergency-mode-banner");
    expect(banner).toBeInTheDocument();
    // Phase 5 remediation: activation is important/time-sensitive enough
    // to genuinely warrant an assertive announcement, not a polite one --
    // see `EmergencyModeBanner`'s own docstring.
    expect(banner).toHaveAttribute("role", "alert");
    expect(screen.getByRole("alert")).toBe(banner);
    // No redundant explicit aria-live/aria-atomic alongside the role --
    // `role="alert"` already implies both.
    expect(banner).not.toHaveAttribute("aria-live");
    expect(banner).not.toHaveAttribute("aria-atomic");
  });

  it("does not render the Emergency Mode banner by default / when regular", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.queryByTestId("emergency-mode-banner")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the SAME banner DOM node across an ordinary rerender while emergency mode stays active -- no remount, so no repeat announcement", () => {
    const { rerender } = renderWithTheme(
      <AppShell
        person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}
        emergencyModeActive
      >
        <div>content</div>
      </AppShell>,
    );
    const before = screen.getByTestId("emergency-mode-banner");

    rerender(
      <ThemeProvider>
        <A11yPreferencesProvider>
          <AppShell
            person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}
            emergencyModeActive
          >
            <div>content</div>
          </AppShell>
        </A11yPreferencesProvider>
      </ThemeProvider>,
    );

    expect(screen.getByTestId("emergency-mode-banner")).toBe(before);
  });

  it("never renders an email anywhere in the shell", () => {
    const { container } = renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(container.textContent).not.toContain("@");
  });

  it("remains available around configuration_error content (any children), not just the real dashboard", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>לא ניתן לחשב כרגע את שעות המשמרות</div>
      </AppShell>,
    );
    expect(screen.getByText("לא ניתן לחשב כרגע את שעות המשמרות")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "התנתקות" }).length).toBeGreaterThan(0);
  });

  it("renders no identity/sign-out affordance when no person is provided", () => {
    renderWithTheme(<AppShell>{null}</AppShell>);
    expect(screen.queryByRole("button", { name: "התנתקות" })).toBeNull();
  });

  it("keeps the bottom navigation -- no hamburger drawer reappears", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getByRole("navigation", { name: "ניווט תחתון" })).toBeInTheDocument();
    expect(screen.queryByLabelText("פתיחת תפריט")).toBeNull();
  });
});

describe("AppShell — sign-out looks destructive", () => {
  it("gives every sign-out affordance a red/critical treatment in both themes", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    openMobileProfileMenu();

    const buttons = screen.getAllByRole("button", { name: "התנתקות" });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.className).toMatch(/text-critical/);
      expect(button.className).toMatch(/hover:bg-critical/);
      // Never a hardcoded dark-only red -- always the theme-aware token.
      expect(button.className).not.toMatch(/#|rgb\(/);
    }
  });
});

describe("AppShell — shell utility bar / live clock (Design Pass PR #19)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders exactly one live clock, in Asia/Jerusalem time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T07:00:00.000Z")); // 10:00:00 in Asia/Jerusalem (UTC+3, DST)

    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }} initialClockTime="00:00:00">
        <div>content</div>
      </AppShell>,
    );
    const clocks = document.querySelectorAll("time");
    expect(clocks).toHaveLength(1);
    expect(clocks[0].textContent).toBe("10:00:00");
  });

  it("never crashes with no server-derived clock time (configuration_error shell render)", () => {
    expect(() =>
      renderWithTheme(
        <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }} initialClockTime={null}>
          <div>content</div>
        </AppShell>,
      ),
    ).not.toThrow();
  });

  it("omitting initialClockTime entirely behaves the same as null -- no crash", () => {
    expect(() =>
      renderWithTheme(
        <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
          <div>content</div>
        </AppShell>,
      ),
    ).not.toThrow();
  });

  it("passes dateLabel through to the shell utility bar's clock pill", () => {
    renderWithTheme(
      <AppShell
        person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}
        initialClockTime="10:00:00"
        dateLabel="יום רביעי · 12 באוגוסט"
      >
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getByText("יום רביעי · 12 באוגוסט")).toBeInTheDocument();
  });

  it("omitting dateLabel entirely behaves the same as null -- no crash, no date line", () => {
    expect(() =>
      renderWithTheme(
        <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }} initialClockTime="10:00:00">
          <div>content</div>
        </AppShell>,
      ),
    ).not.toThrow();
  });
});

describe("AppShell — header polish (organizational logos + relocated bell)", () => {
  it("renders both organizational logos in the shell utility bar", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getByAltText('תקש"ל')).toBeInTheDocument();
    expect(screen.getByAltText("תקשורת אסטרטגית")).toBeInTheDocument();
  });

  it("exactly two notification bell instances exist -- desktop shell + mobile -- never a third left behind in the sidebar", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getAllByRole("button", { name: /התראות/ })).toHaveLength(2);
  });
});

describe("AppShell — notification bells are keyed by userId (account-switch safety)", () => {
  it("a userId change remounts both bells, closing any popover the previous user had left open", () => {
    const { rerender } = renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-a" }}>
        <div>content</div>
      </AppShell>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /התראות/ })[0]);
    expect(screen.getAllByRole("dialog", { name: "התראות" }).length).toBeGreaterThan(0);

    // A different authenticated user now renders in this same shell instance
    // (e.g. after a logout/login on a shared device) -- `key={userId}` on
    // each `NotificationBell` must force a fresh instance, never carrying
    // over the previous user's open popover or `usePushSubscription` state.
    rerender(
      <ThemeProvider>
        <A11yPreferencesProvider>
          <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-b" }}>
            <div>content</div>
          </AppShell>
        </A11yPreferencesProvider>
      </ThemeProvider>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("AppShell — theme control", () => {
  it("never renders the 3-option ThemeToggle anywhere in the shell -- neither desktop sidebar nor mobile header", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();

    openMobileProfileMenu();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("the desktop IdentityFooter offers a single binary light/dark action", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    // vitest.setup.ts's baseline matchMedia stub resolves to light -> offers to switch to dark.
    // Scoped to the desktop footer -- the mobile top bar (nav redesign pass) now offers its
    // own separate instance of the same control, so a bare screen-wide query would match both.
    const footer = screen.getByRole("button", { name: "התנתקות" }).closest("div.border-t");
    expect(footer).not.toBeNull();
    const { getByRole } = within(footer as HTMLElement);
    expect(getByRole("button", { name: "מצב כהה" })).toBeInTheDocument();
  });

  it("the mobile top bar offers its own binary light/dark action instead of the profile menu (nav redesign pass)", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    // vitest.setup.ts's baseline matchMedia stub resolves to light -> offers to switch to dark.
    // Two instances exist in the DOM (desktop footer + mobile top bar), CSS-hidden per breakpoint.
    expect(screen.getAllByRole("button", { name: "מצב כהה" })).toHaveLength(2);

    openMobileProfileMenu();
    const panel = screen.getByRole("group", { name: "תפריט פרופיל" });
    expect(within(panel).queryByRole("button", { name: /עבור למצב/ })).toBeNull();
  });
});

describe("AppShell — skip to main content (Phase 3, IS 5568/WCAG 2.4.1 Bypass Blocks)", () => {
  it("renders a Hebrew skip link, hidden until focused, as the very first focusable element", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    const skipLink = screen.getByRole("link", { name: "דלג לתוכן הראשי" });
    expect(skipLink).toBeInTheDocument();
    expect(skipLink.className).toMatch(/sr-only/);

    const focusable = document.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable[0]).toBe(skipLink);
  });

  it("points at the real main landmark, which carries a stable id and is programmatically focusable", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    const skipLink = screen.getByRole("link", { name: "דלג לתוכן הראשי" });
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main?.tagName).toBe("MAIN");
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("never renders a second skip link -- pages inside the shell must not duplicate it", () => {
    renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(screen.getAllByRole("link", { name: "דלג לתוכן הראשי" })).toHaveLength(1);
  });
});

describe("AppShell — avatarUrl (presentation-only Google account photo)", () => {
  it("passes the same avatarUrl to both the desktop IdentityFooter and the mobile profile menu's Avatar", () => {
    const { container } = renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: "https://lh3.googleusercontent.com/a/photo.jpg", userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    // Scoped to `data-testid="avatar-photo"` -- the shell also renders the
    // product's own BrandMark <img> (Sidebar + mobile header), which is a
    // brand asset, not a user avatar, and must never be confused with one
    // (see `lib/config/brandAssets.ts`).
    const images = container.querySelectorAll('[data-testid="avatar-photo"]');
    expect(images.length).toBeGreaterThanOrEqual(2); // desktop IdentityFooter + mobile header trigger
    for (const img of images) {
      expect(img).toHaveAttribute("src", "https://lh3.googleusercontent.com/a/photo.jpg");
    }
  });

  it("falls back to initials everywhere when avatarUrl is null -- no broken-image icon", () => {
    const { container } = renderWithTheme(
      <AppShell person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }}>
        <div>content</div>
      </AppShell>,
    );
    expect(container.querySelector('[data-testid="avatar-photo"]')).toBeNull();
    expect(screen.getAllByText("דב").length).toBeGreaterThan(0);
  });
});
