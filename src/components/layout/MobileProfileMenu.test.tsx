import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { MobileProfileMenu } from "./MobileProfileMenu";

function mockMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(event: Partial<MediaQueryListEvent>) => void>();
  const mql = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_type: string, listener: (event: Partial<MediaQueryListEvent>) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: Partial<MediaQueryListEvent>) => void) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => mql),
  );
  return mql;
}

function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mockMatchMedia(false); // system defaults to light unless a test says otherwise
});

describe("MobileProfileMenu — trigger", () => {
  it("the Avatar is a real button with an accessible name and expanded/controls semantics, closed by default", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    const trigger = screen.getByRole("button", { name: "תפריט פרופיל של דני בדיקה" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "תפריט פרופיל" })).toBeNull();
  });

  it("gets a vertical-only expanded hit area, never sideways (Phase 6) -- it sits in a tight top-bar icon row", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    const trigger = screen.getByRole("button", { name: "תפריט פרופיל של דני בדיקה" });
    expect(trigger.className).toContain("after:-top-2");
    expect(trigger.className).toContain("after:-bottom-2");
    expect(trigger.className).not.toMatch(/after:-(start|end|left|right|inset-x)-/);
  });

  it("never claims menu popup semantics -- this popover implements no real menu keyboard behavior", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    const trigger = screen.getByRole("button", { name: "תפריט פרופיל של דני בדיקה" });
    expect(trigger).not.toHaveAttribute("aria-haspopup");

    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("opens the panel on click, and toggles aria-expanded", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    const trigger = screen.getByRole("button", { name: "תפריט פרופיל של דני בדיקה" });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "תפריט פרופיל" })).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group", { name: "תפריט פרופיל" })).toBeNull();
  });
});

describe("MobileProfileMenu — identity block", () => {
  it("shows the user's name inside the open panel", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
    expect(screen.getByText("דני בדיקה")).toBeInTheDocument();
  });

  it("never renders an email anywhere in the panel", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
    const panel = screen.getByRole("group", { name: "תפריט פרופיל" });
    expect(panel.textContent).not.toContain("@");
  });
});

describe("MobileProfileMenu — no app navigation (nav redesign pass)", () => {
  it("a manager sees no אזור מנהל / מרכז התראות entries here -- those live in BottomNav's עוד sheet instead", () => {
    renderWithTheme(<MobileProfileMenu name="נועה מנהלת" isManager={true} avatarUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
    expect(screen.queryByRole("link", { name: "אזור מנהל" })).toBeNull();
    expect(screen.queryByRole("link", { name: "מרכז התראות" })).toBeNull();
    expect(screen.getByText("מנהל/ת")).toBeInTheDocument();
  });

  it("never shows מטווחים -- that lives in BottomNav's עוד sheet instead", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
    expect(screen.queryByRole("link", { name: "מטווחים" })).toBeNull();
  });

  it("a non-manager never sees the manager identity/entries either", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
    expect(screen.queryByRole("link", { name: "אזור מנהל" })).toBeNull();
    expect(screen.queryByRole("link", { name: "מרכז התראות" })).toBeNull();
    expect(screen.queryByText("מנהל/ת")).toBeNull();
  });
});

describe("MobileProfileMenu — no theme control (nav redesign pass)", () => {
  it("never renders a theme toggle of any kind -- it moved to the mobile top bar", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
    expect(screen.queryByText("עבור למצב בהיר")).toBeNull();
    expect(screen.queryByText("עבור למצב כהה")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("מערכת")).toBeNull();
  });
});

describe("MobileProfileMenu — סנכרון יומן link", () => {
  it('every user sees "סנכרון יומן", linking to /settings, as a plain link (not a menuitem)', () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
    const link = screen.getByRole("link", { name: "סנכרון יומן" });
    expect(link).toHaveAttribute("href", "/settings");
  });

  it('no longer shows the old "הגדרות" label', () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
    expect(screen.queryByRole("link", { name: "הגדרות" })).toBeNull();
  });
});

describe("MobileProfileMenu — logout", () => {
  it("logout remains reachable inside the panel, as a plain button (not a menuitem)", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
    expect(screen.getByRole("button", { name: "התנתקות" })).toBeInTheDocument();
  });
});

describe("MobileProfileMenu — dismiss behavior", () => {
  it("Escape closes the panel and returns focus to the trigger", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    const trigger = screen.getByRole("button", { name: /תפריט פרופיל/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("group", { name: "תפריט פרופיל" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("group", { name: "תפריט פרופיל" })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("a pointerdown outside the panel closes it", () => {
    renderWithTheme(
      <div>
        <MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />
        <button type="button">outside</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
    expect(screen.getByRole("group", { name: "תפריט פרופיל" })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));

    expect(screen.queryByRole("group", { name: "תפריט פרופיל" })).toBeNull();
  });

  it("a pointerdown inside the panel does not close it", () => {
    renderWithTheme(<MobileProfileMenu name="דני בדיקה" isManager={false} avatarUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: /תפריט פרופיל/ }));
    const panel = screen.getByRole("group", { name: "תפריט פרופיל" });

    fireEvent.pointerDown(panel);

    expect(screen.getByRole("group", { name: "תפריט פרופיל" })).toBeInTheDocument();
  });
});
