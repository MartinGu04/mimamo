import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/lib/theme/ThemeProvider";
import { A11yPreferencesProvider } from "@/lib/a11y/A11yPreferencesProvider";
import { A11Y_STORAGE_KEY } from "@/lib/a11y/preferences";
import { THEME_STORAGE_KEY } from "@/lib/theme/themeScript";
import { AccessibilityPreferencesButton } from "./AccessibilityPreferencesButton";

function mockMatchMedia(prefersDark: boolean) {
  const mql = {
    matches: prefersDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => mql),
  );
  return mql;
}

function renderWidget(ui: ReactElement = <AccessibilityPreferencesButton />) {
  return render(
    <ThemeProvider>
      <A11yPreferencesProvider>{ui}</A11yPreferencesProvider>
    </ThemeProvider>,
  );
}

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: "אפשרויות נגישות" }));
}

beforeEach(() => {
  mockMatchMedia(false);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-a11y-text");
  document.documentElement.removeAttribute("data-a11y-high-contrast");
  document.documentElement.removeAttribute("data-a11y-reduce-motion");
  document.documentElement.removeAttribute("data-a11y-reduce-transparency");
  document.documentElement.removeAttribute("data-a11y-emphasize-links");
  vi.unstubAllGlobals();
});

describe("AccessibilityPreferencesButton — trigger", () => {
  it("exposes the Hebrew accessible name and starts closed", () => {
    renderWidget();
    const trigger = screen.getByRole("button", { name: "אפשרויות נגישות" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("exposes aria-expanded/aria-controls that track the panel's real id", () => {
    renderWidget();
    const trigger = screen.getByRole("button", { name: "אפשרויות נגישות" });

    openPanel();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("dialog", { name: "אפשרויות נגישות" });
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
  });

  it("opens and closes on repeated clicks", () => {
    renderWidget();
    const trigger = screen.getByRole("button", { name: "אפשרויות נגישות" });

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "אפשרויות נגישות" })).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never claims menu semantics -- every control inside is a plain button/switch/link", () => {
    renderWidget();
    openPanel();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});

describe("AccessibilityPreferencesButton — trigger appearance", () => {
  it("renders as a solid saturated-blue action button with a white icon, not the muted glass surface", () => {
    renderWidget();
    const trigger = screen.getByRole("button", { name: "אפשרויות נגישות" });

    expect(trigger.className).toContain("bg-[var(--a11y-trigger-bg)]");
    expect(trigger.className).toContain("text-[var(--a11y-trigger-icon)]");
    expect(trigger.className).toContain("hover:bg-[var(--a11y-trigger-bg-hover)]");
    expect(trigger.className).toContain("ring-[var(--a11y-trigger-ring)]");
    expect(trigger.className).toContain("shadow-[var(--shadow-a11y-trigger)]");
    expect(trigger.className).not.toContain("glass-medium");
    expect(trigger.className).not.toContain("bg-surface-1");
  });

  it("never ties its own fill to the theme-dependent --primary token used elsewhere", () => {
    renderWidget();
    const trigger = screen.getByRole("button", { name: "אפשרויות נגישות" });
    expect(trigger.className).not.toMatch(/bg-primary\b/);
    expect(trigger.className).not.toContain("hover:text-primary");
  });
});

describe("AccessibilityPreferencesButton — dismiss behavior", () => {
  it("Escape closes the panel and returns focus to the trigger", () => {
    renderWidget();
    const trigger = screen.getByRole("button", { name: "אפשרויות נגישות" });
    openPanel();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("a pointerdown outside the panel closes it", () => {
    renderWidget(
      <div>
        <AccessibilityPreferencesButton />
        <button type="button">outside</button>
      </div>,
    );
    openPanel();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "outside" }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a pointerdown inside the panel does not close it", () => {
    renderWidget();
    openPanel();
    const panel = screen.getByRole("dialog");

    fireEvent.pointerDown(panel);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("moves focus into the panel on open", () => {
    renderWidget();
    openPanel();
    expect(screen.getByRole("dialog")).toHaveFocus();
  });
});

describe("AccessibilityPreferencesButton — text size", () => {
  it("defaults to רגיל pressed and no root attribute set", () => {
    renderWidget();
    openPanel();
    expect(screen.getByRole("button", { name: "רגיל" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.hasAttribute("data-a11y-text")).toBe(false);
  });

  it("choosing מוגדל sets data-a11y-text=enlarged and updates aria-pressed on both options", () => {
    renderWidget();
    openPanel();

    fireEvent.click(screen.getByRole("button", { name: "מוגדל" }));

    expect(document.documentElement.getAttribute("data-a11y-text")).toBe("enlarged");
    expect(screen.getByRole("button", { name: "מוגדל" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "רגיל" })).toHaveAttribute("aria-pressed", "false");
  });

  it("choosing מוגדל מאוד sets data-a11y-text=xlarge", () => {
    renderWidget();
    openPanel();

    fireEvent.click(screen.getByRole("button", { name: "מוגדל מאוד" }));

    expect(document.documentElement.getAttribute("data-a11y-text")).toBe("xlarge");
  });

  it("never claims radiogroup/radio semantics -- no interaction model backs them", () => {
    renderWidget();
    openPanel();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("group", { name: "גודל טקסט" })).toBeInTheDocument();
  });
});

describe("AccessibilityPreferencesButton — high contrast", () => {
  it("defaults to unchecked with no root attribute set", () => {
    renderWidget();
    openPanel();
    const toggle = screen.getByRole("switch", { name: "ניגודיות מוגברת" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.hasAttribute("data-a11y-high-contrast")).toBe(false);
  });

  it("enabling sets data-a11y-high-contrast and disabling removes it", () => {
    renderWidget();
    openPanel();
    const toggle = screen.getByRole("switch", { name: "ניגודיות מוגברת" });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.getAttribute("data-a11y-high-contrast")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.hasAttribute("data-a11y-high-contrast")).toBe(false);
  });

  it("persists the choice to localStorage", () => {
    renderWidget();
    openPanel();
    fireEvent.click(screen.getByRole("switch", { name: "ניגודיות מוגברת" }));

    expect(JSON.parse(window.localStorage.getItem(A11Y_STORAGE_KEY) ?? "{}").highContrast).toBe(true);
  });

  it("initializes checked from a previously-stored preference", () => {
    window.localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify({ highContrast: true }));
    renderWidget();
    openPanel();
    expect(screen.getByRole("switch", { name: "ניגודיות מוגברת" })).toHaveAttribute("aria-checked", "true");
  });

  it("safely defaults to unchecked for an old stored object saved before this field existed", () => {
    window.localStorage.setItem(
      A11Y_STORAGE_KEY,
      JSON.stringify({ textSize: "xlarge", reduceMotion: true, reduceTransparency: false, emphasizeLinks: true }),
    );
    renderWidget();
    openPanel();
    expect(screen.getByRole("switch", { name: "ניגודיות מוגברת" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("button", { name: "מוגדל מאוד" })).toHaveAttribute("aria-pressed", "true");
  });

  it("is independent of the reduce-transparency preference -- both can be enabled at once", () => {
    renderWidget();
    openPanel();

    fireEvent.click(screen.getByRole("switch", { name: "ניגודיות מוגברת" }));
    fireEvent.click(screen.getByRole("switch", { name: "הפחתת שקיפות" }));

    expect(document.documentElement.getAttribute("data-a11y-high-contrast")).toBe("true");
    expect(document.documentElement.getAttribute("data-a11y-reduce-transparency")).toBe("true");
  });

  it("changing the theme never touches data-a11y-high-contrast or its stored value", () => {
    renderWidget(
      <div>
        <ThemeToggleButtons />
        <AccessibilityPreferencesButton />
      </div>,
    );
    openPanel();
    fireEvent.click(screen.getByRole("switch", { name: "ניגודיות מוגברת" }));
    expect(document.documentElement.getAttribute("data-a11y-high-contrast")).toBe("true");

    act(() => {
      screen.getByText("set-dark-theme").click();
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-a11y-high-contrast")).toBe("true");
    expect(JSON.parse(window.localStorage.getItem(A11Y_STORAGE_KEY) ?? "{}").highContrast).toBe(true);
  });
});

describe("AccessibilityPreferencesButton — reduce motion", () => {
  it("toggles data-a11y-reduce-motion and its own aria-checked state", () => {
    renderWidget();
    openPanel();
    const toggle = screen.getByRole("switch", { name: "הפחתת תנועה" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.getAttribute("data-a11y-reduce-motion")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.hasAttribute("data-a11y-reduce-motion")).toBe(false);
  });
});

describe("AccessibilityPreferencesButton — reduce transparency", () => {
  it("toggles data-a11y-reduce-transparency", () => {
    renderWidget();
    openPanel();
    const toggle = screen.getByRole("switch", { name: "הפחתת שקיפות" });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.getAttribute("data-a11y-reduce-transparency")).toBe("true");
  });
});

describe("AccessibilityPreferencesButton — emphasize links", () => {
  it("toggles data-a11y-emphasize-links", () => {
    renderWidget();
    openPanel();
    const toggle = screen.getByRole("switch", { name: "הדגשת קישורים" });

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.getAttribute("data-a11y-emphasize-links")).toBe("true");
  });
});

describe("AccessibilityPreferencesButton — reset", () => {
  it("resets every controlled preference and clears storage, without touching theme", () => {
    renderWidget();
    openPanel();

    fireEvent.click(screen.getByRole("button", { name: "מוגדל" }));
    fireEvent.click(screen.getByRole("switch", { name: "ניגודיות מוגברת" }));
    fireEvent.click(screen.getByRole("switch", { name: "הפחתת תנועה" }));
    fireEvent.click(screen.getByRole("switch", { name: "הפחתת שקיפות" }));
    fireEvent.click(screen.getByRole("switch", { name: "הדגשת קישורים" }));
    expect(window.localStorage.getItem(A11Y_STORAGE_KEY)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "איפוס הגדרות נגישות" }));

    expect(screen.getByRole("button", { name: "רגיל" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("switch", { name: "ניגודיות מוגברת" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "הפחתת תנועה" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "הפחתת שקיפות" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "הדגשת קישורים" })).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.hasAttribute("data-a11y-text")).toBe(false);
    expect(document.documentElement.hasAttribute("data-a11y-high-contrast")).toBe(false);
    expect(document.documentElement.hasAttribute("data-a11y-reduce-motion")).toBe(false);
    expect(window.localStorage.getItem(A11Y_STORAGE_KEY)).toBeNull();
  });

  it("reset does not touch the stored theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.setAttribute("data-theme", "dark");
    renderWidget();
    openPanel();

    fireEvent.click(screen.getByRole("switch", { name: "ניגודיות מוגברת" }));
    fireEvent.click(screen.getByRole("button", { name: "איפוס הגדרות נגישות" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});

describe("AccessibilityPreferencesButton — persistence across reload", () => {
  it("initializes from a previously-stored preference on a fresh render", () => {
    window.localStorage.setItem(
      A11Y_STORAGE_KEY,
      JSON.stringify({
        textSize: "xlarge",
        highContrast: true,
        reduceMotion: true,
        reduceTransparency: false,
        emphasizeLinks: true,
      }),
    );

    renderWidget();
    openPanel();

    expect(screen.getByRole("button", { name: "מוגדל מאוד" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("switch", { name: "ניגודיות מוגברת" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "הפחתת תנועה" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "הפחתת שקיפות" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "הדגשת קישורים" })).toHaveAttribute("aria-checked", "true");
  });
});

function ThemeToggleButtons() {
  const { setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme("dark")}>
      set-dark-theme
    </button>
  );
}

describe("AccessibilityPreferencesButton — independence from light/dark theme", () => {
  it("changing the theme never touches any data-a11y-* attribute or its storage key", () => {
    renderWidget(
      <div>
        <ThemeToggleButtons />
        <AccessibilityPreferencesButton />
      </div>,
    );
    openPanel();
    fireEvent.click(screen.getByRole("switch", { name: "הפחתת תנועה" }));
    expect(document.documentElement.getAttribute("data-a11y-reduce-motion")).toBe("true");

    act(() => {
      screen.getByText("set-dark-theme").click();
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-a11y-reduce-motion")).toBe("true");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(JSON.parse(window.localStorage.getItem(A11Y_STORAGE_KEY) ?? "{}").reduceMotion).toBe(true);
  });

  it("changing an accessibility preference never touches the stored theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    document.documentElement.setAttribute("data-theme", "dark");
    renderWidget();
    openPanel();

    fireEvent.click(screen.getByRole("switch", { name: "הדגשת קישורים" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});

describe("AccessibilityPreferencesButton — accessibility statement link", () => {
  it('renders a "הצהרת נגישות" link pointing at /accessibility inside the open panel', () => {
    renderWidget();
    openPanel();
    expect(screen.getByRole("link", { name: "הצהרת נגישות" })).toHaveAttribute("href", "/accessibility");
  });
});
