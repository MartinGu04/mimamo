import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { APP_NAME } from "@/lib/config/productName";
import { Sidebar } from "./Sidebar";
import { navItems } from "./nav-items";

const usePathname = vi.fn(() => "/");
const linkStatus = { pending: false };
vi.mock("next/navigation", () => ({ usePathname: () => usePathname() }));
vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();
  return { ...actual, useLinkStatus: () => linkStatus };
});

afterEach(() => {
  cleanup();
  usePathname.mockReturnValue("/");
  linkStatus.pending = false;
});

function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("Sidebar", () => {
  it("renders /duties, /schedule, and / as real enabled links", () => {
    renderWithTheme(<Sidebar />);
    expect(screen.getByRole("link", { name: /תורנויות/ })).toHaveAttribute("href", "/duties");
    expect(screen.getByRole("link", { name: /הלוח שלי/ })).toHaveAttribute("href", "/schedule");
    expect(screen.getByRole("link", { name: /^סקירה$/ })).toHaveAttribute("href", "/");
  });

  it("renders the standalone Fairness destination for a viewer with no person prop (not manager-only)", () => {
    renderWithTheme(<Sidebar />);
    expect(screen.getByRole("link", { name: /טבלת צדק/ })).toHaveAttribute("href", "/fairness");
  });

  it("renders the standalone Fairness destination for a non-manager", () => {
    renderWithTheme(<Sidebar person={{ name: "דני עובד", isManager: false, avatarUrl: null, userId: "user-test-1" }} />);
    expect(screen.getByRole("link", { name: /טבלת צדק/ })).toHaveAttribute("href", "/fairness");
  });

  it("renders the standalone Fairness destination for a manager too", () => {
    renderWithTheme(<Sidebar person={{ name: "דני מנהל", isManager: true, avatarUrl: null, userId: "user-test-1" }} />);
    expect(screen.getByRole("link", { name: /טבלת צדק/ })).toHaveAttribute("href", "/fairness");
  });

  it('renders the "מטווחים" placeholder destination for any viewer (not manager-only)', () => {
    renderWithTheme(<Sidebar />);
    expect(screen.getByRole("link", { name: /מטווחים/ })).toHaveAttribute("href", "/shooting-ranges");
  });

  it("no longer renders מי איתי or התנגשויות as standalone destinations (nav/people-selector consolidation pass)", () => {
    renderWithTheme(<Sidebar />);
    expect(screen.queryByRole("link", { name: /מי איתי/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /התנגשויות/ })).toBeNull();
  });

  it("marks /duties as the active route with aria-current", () => {
    usePathname.mockReturnValue("/duties");
    renderWithTheme(<Sidebar />);
    expect(screen.getByRole("link", { name: /תורנויות/ })).toHaveAttribute("aria-current", "page");
  });

  it("does not mark /duties as active when viewing a different route", () => {
    usePathname.mockReturnValue("/schedule");
    renderWithTheme(<Sidebar />);
    expect(screen.getByRole("link", { name: /תורנויות/ })).not.toHaveAttribute("aria-current");
  });

  it("no navItems entry is disabled anymore -- every rendered item is a real link (sidebar/mobile-nav refinement pass)", () => {
    renderWithTheme(<Sidebar />);
    expect(navItems.every((item) => item.enabled)).toBe(true);
    expect(screen.queryByText("בקרוב")).toBeNull();
  });

  describe("manager-only navigation", () => {
    it("a non-manager sees no /manager link at all -- not even disabled", () => {
      renderWithTheme(<Sidebar person={{ name: "דני עובד", isManager: false, avatarUrl: null, userId: "user-test-1" }} />);
      expect(screen.queryByRole("link", { name: /אזור מנהל/ })).toBeNull();
      expect(screen.queryByText("אזור מנהל")).toBeNull();
    });

    it("no person prop at all (defensive default) also hides /manager", () => {
      renderWithTheme(<Sidebar />);
      expect(screen.queryByText("אזור מנהל")).toBeNull();
    });

    it("a manager sees /manager as a real enabled link", () => {
      renderWithTheme(<Sidebar person={{ name: "דני מנהל", isManager: true, avatarUrl: null, userId: "user-test-1" }} />);
      const link = screen.getByRole("link", { name: /אזור מנהל/ });
      expect(link).toHaveAttribute("href", "/manager");
    });

    it("marks /manager as the active route with aria-current for a manager", () => {
      usePathname.mockReturnValue("/manager");
      renderWithTheme(<Sidebar person={{ name: "דני מנהל", isManager: true, avatarUrl: null, userId: "user-test-1" }} />);
      expect(screen.getByRole("link", { name: /אזור מנהל/ })).toHaveAttribute("aria-current", "page");
    });

    it("a non-manager sees no /notifications link at all -- not even disabled", () => {
      renderWithTheme(<Sidebar person={{ name: "דני עובד", isManager: false, avatarUrl: null, userId: "user-test-1" }} />);
      expect(screen.queryByRole("link", { name: /מרכז התראות/ })).toBeNull();
      expect(screen.queryByText("מרכז התראות")).toBeNull();
    });

    it("no person prop at all (defensive default) also hides /notifications", () => {
      renderWithTheme(<Sidebar />);
      expect(screen.queryByText("מרכז התראות")).toBeNull();
    });

    it("a manager sees BOTH אזור מנהל and מרכז התראות as real enabled links", () => {
      renderWithTheme(<Sidebar person={{ name: "דני מנהל", isManager: true, avatarUrl: null, userId: "user-test-1" }} />);
      expect(screen.getByRole("link", { name: /אזור מנהל/ })).toHaveAttribute("href", "/manager");
      expect(screen.getByRole("link", { name: /מרכז התראות/ })).toHaveAttribute("href", "/notifications");
    });

    it("marks /notifications as the active route with aria-current for a manager", () => {
      usePathname.mockReturnValue("/notifications");
      renderWithTheme(<Sidebar person={{ name: "דני מנהל", isManager: true, avatarUrl: null, userId: "user-test-1" }} />);
      expect(screen.getByRole("link", { name: /מרכז התראות/ })).toHaveAttribute("aria-current", "page");
    });

    it("existing enabled routes remain visible for a manager too", () => {
      renderWithTheme(<Sidebar person={{ name: "דני מנהל", isManager: true, avatarUrl: null, userId: "user-test-1" }} />);
      expect(screen.getByRole("link", { name: /תורנויות/ })).toHaveAttribute("href", "/duties");
      expect(screen.getByRole("link", { name: /הלוח שלי/ })).toHaveAttribute("href", "/schedule");
    });

    it("neither the removed reminders item nor the removed sync item ever renders, for a manager either", () => {
      renderWithTheme(<Sidebar person={{ name: "דני מנהל", isManager: true, avatarUrl: null, userId: "user-test-1" }} />);
      expect(screen.queryByRole("link", { name: "תזכורות" })).toBeNull();
      expect(screen.queryByText("תזכורות")).toBeNull();
      expect(screen.queryByRole("link", { name: "סנכרון" })).toBeNull();
      expect(screen.queryByText("סנכרון")).toBeNull();
    });
  });
});

describe("Sidebar — brand identity (rebrand: מי-מה-מו -> המחלבה)", () => {
  it("shows the המחלבה symbol next to the wordmark, and never a retired brand name", () => {
    const { container } = renderWithTheme(<Sidebar />);
    expect(screen.getByText(APP_NAME)).toBeInTheDocument();
    expect(container.querySelector('img[src*="icon.png"]')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/luzly/i);
    expect(container.textContent).not.toMatch(/מי-מה-מו/);
  });
});

describe("Sidebar — notification bell relocated (header polish pass)", () => {
  it("no longer renders its own notification bell -- it now lives in ShellUtilityBar", () => {
    renderWithTheme(<Sidebar />);
    expect(screen.queryByRole("button", { name: /התראות/ })).toBeNull();
  });
});

describe("Sidebar — pending navigation feedback (PR #38 desktop nav performance)", () => {
  it("a non-pending link is not aria-busy and shows its normal icon, never a spinner", () => {
    const { container } = renderWithTheme(<Sidebar />);
    const scheduleLink = screen.getByRole("link", { name: /הלוח שלי/ });
    expect(scheduleLink).toHaveAttribute("aria-busy", "false");
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("a link whose navigation is pending is aria-busy and shows a spinner immediately, giving instant click feedback", () => {
    linkStatus.pending = true;
    const { container } = renderWithTheme(<Sidebar />);
    const scheduleLink = screen.getByRole("link", { name: /הלוח שלי/ });
    expect(scheduleLink).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("clicking an already-pending link does not fire a second, redundant navigation", () => {
    linkStatus.pending = true;
    renderWithTheme(<Sidebar />);
    const scheduleLink = screen.getByRole("link", { name: /הלוח שלי/ });
    const notPrevented = fireEvent.click(scheduleLink);
    expect(notPrevented).toBe(false);
  });

});

describe("Sidebar — main nav / work tools grouping (nav redesign pass)", () => {
  it("renders a visual separator between the main nav group and the work-tools group", () => {
    const { container } = renderWithTheme(<Sidebar />);
    expect(container.querySelector('[role="separator"]')).toBeInTheDocument();
  });

  it("main nav items appear before the separator, work-tools items after it", () => {
    const { container } = renderWithTheme(<Sidebar person={{ name: "דני מנהל", isManager: true, avatarUrl: null, userId: "user-test-1" }} />);
    const nav = screen.getByRole("navigation", { name: "ניווט ראשי" });
    const separator = container.querySelector('[role="separator"]');
    expect(separator).toBeInTheDocument();

    const fairnessLink = screen.getByRole("link", { name: /טבלת צדק/ });
    const shootingRangesLink = screen.getByRole("link", { name: /מטווחים/ });
    expect(nav.compareDocumentPosition(fairnessLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(separator!.compareDocumentPosition(fairnessLink) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(separator!.compareDocumentPosition(shootingRangesLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("Sidebar — width and layout", () => {
  it("uses the widened 320px rail (sidebar/mobile-nav refinement pass)", () => {
    const { container } = renderWithTheme(<Sidebar />);
    const aside = container.querySelector("aside");
    expect(aside?.className).toMatch(/\bw-\[320px\]/);
  });
});

describe("Sidebar — theme control placement (sidebar/mobile-nav refinement pass)", () => {
  it("never renders the 3-option ThemeToggle anywhere, with or without a person", () => {
    renderWithTheme(<Sidebar />);
    expect(screen.queryByRole("radiogroup")).toBeNull();

    renderWithTheme(<Sidebar person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("renders no theme control at all when no person is provided (it lives in the footer, which needs a person)", () => {
    renderWithTheme(<Sidebar />);
    expect(screen.queryByRole("button", { name: "מצב כהה" })).toBeNull();
    expect(screen.queryByRole("button", { name: "מצב בהיר" })).toBeNull();
  });

  it("renders exactly one single-action theme control, in the bottom identity/footer area, when a person is provided", () => {
    renderWithTheme(<Sidebar person={{ name: "דני בדיקה", isManager: false, avatarUrl: null, userId: "user-test-1" }} />);
    // The global matchMedia stub (vitest.setup.ts) resolves to light, so the action offers to switch to dark.
    const toggle = screen.getByRole("button", { name: "מצב כהה" });

    // Confirm it lives inside the footer, alongside the sign-out button and version text -- not up near the logo/bell.
    const footer = screen.getByRole("button", { name: "התנתקות" }).closest("div.border-t");
    expect(footer?.contains(toggle)).toBe(true);
  });
});
