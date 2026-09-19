import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ManagerCategoryNav } from "./ManagerCategoryNav";

const linkStatus = { pending: false };
vi.mock("next/link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/link")>();
  return { ...actual, useLinkStatus: () => linkStatus };
});

afterEach(() => {
  cleanup();
  linkStatus.pending = false;
});

const BASE = { range: "7d" as const, month: null };

describe("ManagerCategoryNav", () => {
  it("renders all five categories", () => {
    render(<ManagerCategoryNav active="overview" current={BASE} />);
    expect(screen.getByRole("link", { name: "סקירה" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "משמרות" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "כוח אדם" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "תורנויות והיעדרויות" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "התחברויות" })).toBeInTheDocument();
  });

  it("overview is the omitted default -- its href is the bare /manager", () => {
    render(<ManagerCategoryNav active="overview" current={BASE} />);
    expect(screen.getByRole("link", { name: "סקירה" })).toHaveAttribute("href", "/manager");
  });

  it("every other category links with an explicit ?category=", () => {
    render(<ManagerCategoryNav active="overview" current={BASE} />);
    expect(screen.getByRole("link", { name: "משמרות" })).toHaveAttribute("href", "/manager?category=shifts");
    expect(screen.getByRole("link", { name: "כוח אדם" })).toHaveAttribute("href", "/manager?category=personnel");
    expect(screen.getByRole("link", { name: "תורנויות והיעדרויות" })).toHaveAttribute(
      "href",
      "/manager?category=duties",
    );
    expect(screen.getByRole("link", { name: "התחברויות" })).toHaveAttribute(
      "href",
      "/manager?category=logins",
    );
  });

  it("marks only the active category as current, via aria-current -- never role=tab/aria-selected", () => {
    render(<ManagerCategoryNav active="shifts" current={BASE} />);
    expect(screen.getByRole("link", { name: "משמרות" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "סקירה" })).not.toHaveAttribute("aria-current");
  });

  it("preserves the selected range/month, but never a person, when switching category", () => {
    render(<ManagerCategoryNav active="overview" current={{ range: "month", month: "2026-08" }} />);
    expect(screen.getByRole("link", { name: "משמרות" })).toHaveAttribute(
      "href",
      "/manager?range=month&month=2026-08&category=shifts",
    );
  });

  it("every tab never wraps its own label onto a second line -- whitespace-nowrap, so a long two-word label can never read as a detached row", () => {
    render(<ManagerCategoryNav active="overview" current={BASE} />);
    for (const name of ["סקירה", "משמרות", "כוח אדם", "תורנויות והיעדרויות", "התחברויות"]) {
      expect(screen.getByRole("link", { name })).toHaveClass("whitespace-nowrap");
    }
  });

  it("the strip itself never wraps onto multiple flex lines -- no shrinking, no wrap, so it scrolls as one strip instead", () => {
    render(<ManagerCategoryNav active="overview" current={BASE} />);
    const strip = screen.getByRole("navigation", { name: "קטגוריות אזור מנהל" }).firstElementChild as HTMLElement;
    expect(strip).toHaveClass("inline-flex");
    expect(strip.className).not.toMatch(/\bflex-wrap\b/);
    for (const name of ["סקירה", "משמרות", "כוח אדם", "תורנויות והיעדרויות", "התחברויות"]) {
      expect(screen.getByRole("link", { name })).toHaveClass("shrink-0");
    }
  });

  it("the nav wrapper allows horizontal scrolling when the strip overflows", () => {
    render(<ManagerCategoryNav active="overview" current={BASE} />);
    expect(screen.getByRole("navigation", { name: "קטגוריות אזור מנהל" })).toHaveClass("overflow-x-auto");
  });
});

describe("ManagerCategoryNav -- pending navigation feedback", () => {
  it("a non-pending item is not aria-busy and shows no spinner", () => {
    const { container } = render(<ManagerCategoryNav active="overview" current={BASE} />);
    expect(screen.getByRole("link", { name: "משמרות" })).toHaveAttribute("aria-busy", "false");
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("a click immediately enters pending state: the clicked destination becomes aria-busy and shows a spinner", () => {
    linkStatus.pending = true;
    const { container } = render(<ManagerCategoryNav active="overview" current={BASE} />);
    const shiftsLink = screen.getByRole("link", { name: "משמרות" });
    expect(shiftsLink).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("the item's own label stays visible while pending -- the destination never disappears behind a spinner-only state", () => {
    linkStatus.pending = true;
    render(<ManagerCategoryNav active="overview" current={BASE} />);
    expect(screen.getByRole("link", { name: "משמרות" })).toHaveTextContent("משמרות");
  });

  it("clicking an already-pending item does not fire a second, redundant navigation", () => {
    linkStatus.pending = true;
    render(<ManagerCategoryNav active="overview" current={BASE} />);
    const shiftsLink = screen.getByRole("link", { name: "משמרות" });
    const notPrevented = fireEvent.click(shiftsLink);
    expect(notPrevented).toBe(false);
  });

  it("active/aria-current styling is unaffected by pending state", () => {
    linkStatus.pending = true;
    render(<ManagerCategoryNav active="shifts" current={BASE} />);
    expect(screen.getByRole("link", { name: "משמרות" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "סקירה" })).not.toHaveAttribute("aria-current");
  });

  it("href/URL semantics are unaffected by pending state", () => {
    linkStatus.pending = true;
    render(<ManagerCategoryNav active="overview" current={BASE} />);
    expect(screen.getByRole("link", { name: "משמרות" })).toHaveAttribute("href", "/manager?category=shifts");
  });
});
