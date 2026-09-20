import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { APP_NAME } from "@/lib/config/productName";
import AccessibilityStatementPage, { metadata } from "./page";

afterEach(() => {
  cleanup();
});

/**
 * This module deliberately imports NO auth/read-model helper (no
 * `getRequestPersonalSchedule`, no `redirect`) -- unlike every page under
 * `(app)/`, which all need at least one mocked module to render in a test.
 * Rendering it here with zero mocks IS the "renders publicly, without
 * authentication" proof: if the component depended on a protected loader,
 * this render would throw (missing Supabase/Google env config) rather than
 * produce the statement.
 */
describe("AccessibilityStatementPage — public, unauthenticated", () => {
  it("renders the statement with no auth/read-model mocking whatsoever", () => {
    render(<AccessibilityStatementPage />);
    expect(screen.getByRole("heading", { level: 1, name: "הצהרת נגישות" })).toBeInTheDocument();
  });

  it("exposes a real <main> landmark and a Hebrew skip link, same pattern as /login", () => {
    render(<AccessibilityStatementPage />);
    const skipLink = screen.getByRole("link", { name: "דלג לתוכן הראשי" });
    const main = screen.getByRole("main");
    expect(skipLink).toHaveAttribute("href", "#main-content");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});

describe("AccessibilityStatementPage — heading structure", () => {
  it("has exactly one page-level h1: הצהרת נגישות", () => {
    render(<AccessibilityStatementPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("הצהרת נגישות");
  });

  it("has an h2 for every required section", () => {
    render(<AccessibilityStatementPage />);
    const expectedSections = [
      "מבוא",
      "תקן ורמת נגישות",
      "התאמות הנגישות שבוצעו",
      "שימוש במקלדת",
      "תאימות לטכנולוגיות מסייעות",
      "מגבלות ותהליך שיפור מתמשך",
      "פנייה בנושא נגישות",
    ];
    for (const section of expectedSections) {
      expect(screen.getByRole("heading", { level: 2, name: section })).toBeInTheDocument();
    }
  });
});

describe("AccessibilityStatementPage — careful compliance wording", () => {
  it('never claims full/100% compliance -- only that the app was built "with these requirements in mind"', () => {
    const { container } = render(<AccessibilityStatementPage />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/100%/);
    expect(text).not.toMatch(/נגיש(ה)? באופן מלא/);
    expect(text).not.toMatch(/תואמ(ת|ים) (באופן מלא|במלואה)/);
    expect(text).not.toMatch(/עומדת בתאימות מלאה/);
  });

  it('explicitly states final compliance is NOT yet declared, pending the manual verification phase', () => {
    render(<AccessibilityStatementPage />);
    expect(screen.getByText(/איננו מצהירים כי האפליקציה עומדת בהתאמה מלאה/)).toBeInTheDocument();
  });

  it("never claims AT testing (NVDA/JAWS/VoiceOver) that hasn't actually happened", () => {
    const { container } = render(<AccessibilityStatementPage />);
    expect(container.textContent).not.toMatch(/NVDA|JAWS|VoiceOver/);
  });

  it('does not claim "no accessibility issues" -- the limitations section stays honest about ongoing work', () => {
    render(<AccessibilityStatementPage />);
    expect(screen.queryByText(/אין (בעיות|ליקויי) נגישות/)).toBeNull();
    expect(screen.getByText(/תחזוקת הנגישות של האפליקציה היא תהליך מתמשך/)).toBeInTheDocument();
  });

  it("references the real legal/standard basis: the 2013 regulations, IS 5568, and WCAG 2.0 AA", () => {
    render(<AccessibilityStatementPage />);
    expect(screen.getByText(/תשע״ג-2013/)).toBeInTheDocument();
    expect(screen.getByText(/ת״י 5568/)).toBeInTheDocument();
    expect(screen.getByText(/WCAG 2\.0/)).toBeInTheDocument();
  });
});

describe("AccessibilityStatementPage — no arrow-key or global keyboard overclaim", () => {
  it("the keyboard section lists only Tab/Shift+Tab/Enter/Space/Escape/skip-link -- no arrow-key claim", () => {
    const { container } = render(<AccessibilityStatementPage />);
    expect(container.textContent).not.toMatch(/מקש(י)? חצים|arrow key/i);
  });

  it('softens the keyboard-navigation feature bullet to "תמיכה בניווט", not a blanket "ניווט מלא" claim, pending final verification', () => {
    render(<AccessibilityStatementPage />);
    expect(screen.getByText("תמיכה בניווט באמצעות מקלדת")).toBeInTheDocument();
    expect(screen.queryByText("ניווט מלא באמצעות מקלדת")).toBeNull();
  });
});

describe("AccessibilityStatementPage — real contact email, no invented title/phone", () => {
  it("renders the real accessibility contact as a mailto: link, visible text = full address", () => {
    render(<AccessibilityStatementPage />);
    const link = screen.getByRole("link", { name: "martin.gusin0205@gmail.com" });
    expect(link).toHaveAttribute("href", "mailto:martin.gusin0205@gmail.com");
    expect(link).toHaveTextContent("martin.gusin0205@gmail.com");
  });

  it("keeps visible keyboard focus styling on the contact link", () => {
    render(<AccessibilityStatementPage />);
    const link = screen.getByRole("link", { name: "martin.gusin0205@gmail.com" });
    expect(link.className).toMatch(/focus-visible:outline/);
  });

  it('never labels the contact a "רכז/ת נגישות" or any other invented formal role', () => {
    const { container } = render(<AccessibilityStatementPage />);
    expect(container.textContent).not.toMatch(/רכז(ת)? נגישות/);
  });

  it("never renders a phone number -- email only, per the owner's instruction", () => {
    const { container } = render(<AccessibilityStatementPage />);
    expect(container.textContent).not.toMatch(/05\d[-\s]?\d{7}|\+972/);
  });

  it('no longer claims that no accessibility contact channel is published', () => {
    render(<AccessibilityStatementPage />);
    expect(screen.queryByText(/טרם הוקם ופורסם ערוץ פנייה ייעודי/)).toBeNull();
  });
});

describe("AccessibilityStatementPage — update date", () => {
  it('shows the fixed statement-content-revision date (2026-09-20), formatted with the Hebrew date helper -- not the current render/request date', () => {
    render(<AccessibilityStatementPage />);
    expect(screen.getByText("עודכן לאחרונה: 20 בספטמבר 2026")).toBeInTheDocument();
  });
});

describe("AccessibilityStatementPage — named features match real app implementation", () => {
  const globalsCss = fs.readFileSync(path.resolve(__dirname, "..", "globals.css"), "utf8");

  it("prefers-reduced-motion and prefers-reduced-transparency are backed by real globals.css rules, not invented", () => {
    expect(globalsCss).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(globalsCss).toMatch(/prefers-reduced-transparency:\s*reduce/);
  });

  it("the aria-invalid/aria-describedby claim matches a real form in the app", () => {
    const formSource = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "components", "shootingRanges", "SelfReportForm.tsx"),
      "utf8",
    );
    expect(formSource).toMatch(/aria-invalid|aria-describedby/);

    render(<AccessibilityStatementPage />);
    expect(screen.getByText(/aria-invalid/)).toBeInTheDocument();
    expect(screen.getByText(/aria-describedby/)).toBeInTheDocument();
  });
});

describe("AccessibilityStatementPage — metadata", () => {
  it(`sets the exact title "הצהרת נגישות | ${APP_NAME}"`, () => {
    expect(metadata.title).toBe(`הצהרת נגישות | ${APP_NAME}`);
  });

  it("sets a non-empty Hebrew description", () => {
    expect(typeof metadata.description).toBe("string");
    expect((metadata.description as string).length).toBeGreaterThan(0);
  });

  it("does not mark the page noindex", () => {
    expect(metadata.robots).toBeUndefined();
  });
});
