import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PersonalIssue } from "@/lib/readModels/types";
import { IssuesPanel } from "./IssuesPanel";

afterEach(() => {
  cleanup();
});

function issue(overrides: Partial<PersonalIssue> = {}): PersonalIssue {
  return {
    reason: "shift_coverage_missing",
    severity: "critical",
    date: "2026-08-12",
    missingIntervals: null,
    metadata: null,
    targetEvent: null,
    ...overrides,
  };
}

describe("IssuesPanel", () => {
  it("28. renders a quiet success status when there are no issues", () => {
    render(<IssuesPanel issues={[]} />);
    expect(screen.getByText("הסידור שלך נראה תקין")).toBeInTheDocument();
  });

  it("does not render a giant permanent issues area when there is nothing wrong", () => {
    render(<IssuesPanel issues={[]} />);
    expect(screen.queryByText("לתשומת לבך")).toBeNull();
  });

  it("26. issues map to friendly Hebrew copy", () => {
    render(<IssuesPanel issues={[issue({ reason: "shift_coverage_missing" })]} />);
    expect(screen.getByText("חסר כיסוי למשמרת שלך")).toBeInTheDocument();
  });

  it("26. every machine reason maps to distinct friendly copy", () => {
    const reasons: PersonalIssue["reason"][] = [
      "blocking_absence_with_assignment",
      "shift_coverage_missing",
      "shift_coverage_partial",
      "invalid_shift_time",
      "role_capability_mismatch",
    ];
    const { container } = render(<IssuesPanel issues={reasons.map((reason) => issue({ reason }))} />);
    expect(screen.getByText("קיימת חפיפה בין היעדרות לשיבוץ שלך")).toBeInTheDocument();
    expect(screen.getByText("חסר כיסוי למשמרת שלך")).toBeInTheDocument();
    expect(screen.getByText("הכיסוי למשמרת שלך חלקי")).toBeInTheDocument();
    expect(screen.getByText("שעות המשמרת דורשות בדיקה")).toBeInTheDocument();
    expect(screen.getByText("השיבוץ שלך דורש בדיקת תפקיד")).toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(5);
  });

  it("names the missing role for a coverage issue on a known shift, instead of the generic wording", () => {
    render(
      <IssuesPanel
        issues={[
          issue({
            reason: "shift_coverage_missing",
            targetEvent: { date: "2026-08-12", category: "shift", title: "טכנאי יום", role: "technician", period: "day", dutyFamily: null },
          }),
        ]}
      />,
    );
    expect(screen.getByText('חסר אחמ"ש למשמרת שלך')).toBeInTheDocument();
    expect(screen.queryByText("חסר כיסוי למשמרת שלך")).toBeNull();
  });

  it("27. never renders a raw IssueReason machine value", () => {
    render(<IssuesPanel issues={[issue({ reason: "shift_coverage_missing" })]} />);
    expect(screen.queryByText(/shift_coverage_missing/)).toBeNull();
  });

  it("a critical issue's icon pulses, never the whole panel", () => {
    const { container } = render(<IssuesPanel issues={[issue({ severity: "critical" })]} />);
    const pulsing = container.querySelectorAll(".animate-issue-pulse");
    expect(pulsing.length).toBe(1);
    const panel = container.querySelector("li");
    expect(panel?.className).not.toContain("animate-issue-pulse");
  });

  it("a review-severity issue does not pulse", () => {
    const { container } = render(<IssuesPanel issues={[issue({ severity: "review" })]} />);
    expect(container.querySelector(".animate-issue-pulse")).toBeNull();
  });
});

describe("IssuesPanel — deep link to the issue's date", () => {
  it("wraps a dated issue's whole card in a single link to /schedule?date=<the exact issue date>", () => {
    render(<IssuesPanel issues={[issue({ date: "2026-09-23" })]} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/schedule?date=2026-09-23");
  });

  it("uses each issue's own date, not a shared/default one, across multiple issues", () => {
    render(
      <IssuesPanel
        issues={[
          issue({ date: "2026-09-23", reason: "shift_coverage_missing" }),
          issue({ date: "2026-10-05", reason: "invalid_shift_time" }),
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/schedule?date=2026-09-23",
      "/schedule?date=2026-10-05",
    ]);
  });

  it("the link's own text still shows the friendly reason label, the compact date, and a view affordance", () => {
    render(<IssuesPanel issues={[issue({ date: "2026-09-23", reason: "shift_coverage_missing" })]} />);
    const link = screen.getByRole("link");
    expect(link).toHaveTextContent("חסר כיסוי למשמרת שלך");
    expect(link).toHaveTextContent("23.9");
    expect(link).toHaveTextContent("לצפייה בלוח");
  });

  it("preserves the card's severity ring/background classes on the link itself", () => {
    render(<IssuesPanel issues={[issue({ severity: "critical" })]} />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("ring-critical/20");
    expect(link.className).toContain("bg-critical/[0.06]");
  });

  it("has a visible hover/focus-visible affordance and no nested interactive elements", () => {
    render(<IssuesPanel issues={[issue()]} />);
    const link = screen.getByRole("link");
    expect(link.className).toMatch(/hover:bg-/);
    expect(link.className).toContain("focus-visible:outline-2");
    expect(link.querySelector("a, button")).toBeNull();
  });

  it("is keyboard-focusable (real <a>, not a click handler on a non-interactive element)", () => {
    render(<IssuesPanel issues={[issue()]} />);
    const link = screen.getByRole("link");
    expect(link.tagName).toBe("A");
    link.focus();
    expect(link).toHaveFocus();
  });

  it("still renders as a plain, non-clickable card when the issue's date can't be parsed", () => {
    render(<IssuesPanel issues={[issue({ date: "not-a-real-date" })]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("חסר כיסוי למשמרת שלך")).toBeInTheDocument();
  });

  it("the quiet 'no issues' state stays untouched -- no links, no cards", () => {
    render(<IssuesPanel issues={[]} />);
    expect(screen.getByText("הסידור שלך נראה תקין")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
