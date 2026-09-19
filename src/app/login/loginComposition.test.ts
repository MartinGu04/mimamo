import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression guard for the login redesign (real production reference
 * supplied directly): the route uses ONE fixed dark canvas at every
 * viewport size and regardless of the app's light/dark preference -- no
 * theme toggle, no theme-responsive `lg:` reversion anywhere on this
 * route. Checked by source, not by mocking, so a future edit that quietly
 * reintroduces a theme-responsive treatment fails this test even if no
 * render-level test happens to exercise that path (Tailwind's `lg:`
 * classes don't actually take effect in jsdom).
 */
const pageSource = fs.readFileSync(path.resolve(__dirname, "page.tsx"), "utf8");
const componentsDir = path.resolve(__dirname, "..", "..", "components", "login");
const loginComponentFiles = fs
  .readdirSync(componentsDir)
  .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
  .map((name) => path.resolve(componentsDir, name));
const googleButtonSource = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "components", "auth", "GoogleSignInButton.tsx"),
  "utf8",
);
const globalsCss = fs.readFileSync(path.resolve(__dirname, "..", "globals.css"), "utf8");

const ALL_LOGIN_SOURCE = [
  { name: "page.tsx", content: pageSource },
  ...loginComponentFiles.map((file) => ({ name: path.basename(file), content: fs.readFileSync(file, "utf8") })),
];

describe("login route: single fixed canvas, no theme switching", () => {
  it("no login-route source file imports/renders ThemeToggle", () => {
    for (const { name, content } of ALL_LOGIN_SOURCE) {
      expect(content, `${name} must not reference ThemeToggle`).not.toMatch(/ThemeToggle/);
    }
  });

  it("no login-route source file applies a theme-responsive lg: background/text/surface reversion", () => {
    const THEME_REVERSION_PATTERNS = [
      /lg:bg-surface-\d/,
      /lg:bg-primary\b/,
      /lg:text-foreground\b/,
      /lg:text-primary-foreground\b/,
      /lg:text-muted\b/,
    ];
    for (const { name, content } of ALL_LOGIN_SOURCE) {
      for (const pattern of THEME_REVERSION_PATTERNS) {
        expect(content, `${name} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("the fixed CTA tokens are actually defined in globals.css", () => {
    for (const token of [
      "--login-cta-fixed-bg",
      "--login-cta-fixed-bg-hover",
      "--login-cta-fixed-text",
      "--shadow-login-cta-fixed",
    ]) {
      expect(globalsCss).toContain(`${token}:`);
    }
  });

  it("the retired theme-responsive login glass tokens are gone from globals.css", () => {
    for (const token of ["--login-glass-bg", "--login-glass-border", "--shadow-login-glass", "--login-glass-ambient"]) {
      expect(globalsCss).not.toContain(`${token}:`);
    }
  });
});

describe("Google CTA is a single fixed treatment at every viewport size", () => {
  it("uses only the fixed light/milky treatment -- no lg: theme-responsive violet variant", () => {
    expect(googleButtonSource).toContain("bg-[var(--login-cta-fixed-bg)]");
    expect(googleButtonSource).toContain("text-[var(--login-cta-fixed-text)]");
    expect(googleButtonSource).not.toMatch(/lg:bg-primary\b/);
    expect(googleButtonSource).not.toMatch(/lg:text-primary-foreground\b/);
  });

  it('keeps the exact wording "המשך עם Google" (accessible name) and the Google glyph', () => {
    expect(googleButtonSource).toContain("המשך עם");
    expect(googleButtonSource).toContain("GoogleGlyph");
  });

  it('marks the English "Google" fragment with lang="en" for Hebrew screen reader pronunciation', () => {
    expect(googleButtonSource).toMatch(/<span lang="en">Google<\/span>/);
  });
});
