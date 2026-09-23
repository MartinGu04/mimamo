import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(__dirname, "./globals.css"), "utf8");

describe("globals.css motion system", () => {
  it("35. defines a prefers-reduced-motion media query", () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });

  it("disables every named ambient/entrance animation under reduced motion", () => {
    const reducedBlockMatch = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{([\s\S]*)}\s*$/);
    expect(reducedBlockMatch).not.toBeNull();
    const reducedBlock = reducedBlockMatch?.[1] ?? "";

    for (const className of [
      "animate-pulse-dot",
      "animate-pulse-ring",
      "animate-fade-up",
      "animate-breathe",
      "animate-issue-pulse",
      "animate-login-now-drift",
      "animate-login-clock-sweep",
    ]) {
      expect(reducedBlock).toContain(`.${className}`);
    }
  });

  it("defines the named keyframes referenced by the motion utility classes", () => {
    for (const keyframeName of [
      "pulse-dot",
      "pulse-ring",
      "fade-up",
      "breathe",
      "issue-pulse",
      "login-now-drift",
      "login-clock-sweep",
    ]) {
      expect(css).toContain(`@keyframes ${keyframeName}`);
    }
  });
});

describe("globals.css Team Week self-column pulse -- cascade-layering regression", () => {
  // This file's plain, unlayered rules (everything after `@import
  // "tailwindcss"`) sit ABOVE every `@layer`-wrapped Tailwind utility in
  // cascade priority regardless of source order. A same-specificity
  // `.team-week-self-column { position: ... }` rule here would therefore
  // silently beat the person-name header's own `.sticky` utility
  // (`position: sticky`, from `HEADER_CELL_BASE` in TeamWeekMatrix.tsx)
  // whenever a header also carries `.team-week-self-column` -- the
  // viewer's own column header would stop sticking during vertical scroll
  // while every other header keeps sticking. `box-shadow` (what this
  // selector is actually for) needs no positioning context of its own, so
  // this rule must never declare `position` at all.
  it("the plain, unscoped .team-week-self-column rule never sets its own `position` (would silently override the header's Tailwind `sticky` utility)", () => {
    const ruleMatch = css.match(/(?:^|\n)\.team-week-self-column\s*\{([^}]*)\}/);
    if (ruleMatch) {
      expect(ruleMatch[1]).not.toMatch(/position\s*:/);
    }
    // If the selector has no standalone rule at all (e.g. folded into the
    // pulse rule below), there is nothing that could override `sticky` --
    // also a pass.
  });

  it("the pulse animation itself only ever touches box-shadow, never position/top/left/transform (which could fight the header's own sticky offset)", () => {
    const pulseRuleMatch = css.match(/\.team-week-locating-self \.team-week-self-column\s*\{([^}]*)\}/);
    expect(pulseRuleMatch).not.toBeNull();
    const declarations = pulseRuleMatch?.[1] ?? "";
    expect(declarations).not.toMatch(/\b(position|top|left|right|bottom|transform)\s*:/);
  });
});
