import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(__dirname, "./globals.css"), "utf8");

/**
 * The glass material's architectural guarantees, asserted against the
 * stylesheet itself -- the same convention `globalsMotion.test.ts` uses for
 * the motion system, and for the same reason: these are properties of the
 * DESIGN SYSTEM that no single component test would notice being lost.
 */
const GLASS_LEVELS = ["glass-strong", "glass-medium", "glass-subtle"] as const;

/**
 * The body of the brace-balanced block starting at `marker` -- so a block
 * containing nested `@media`/rules ends exactly where it really ends,
 * rather than at the first `}` (or at end of file).
 */
function blockAt(marker: string): string {
  const start = css.indexOf(marker);
  expect(start, `missing block: ${marker}`).toBeGreaterThan(-1);

  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated block: ${marker}`);
}

/** The `@supports` block that gates every glass rule. */
function glassSupportsBlock(): string {
  return blockAt("@supports ((backdrop-filter");
}

describe("globals.css glass materials", () => {
  it("gates every glass rule behind @supports, so a browser without backdrop-filter keeps the opaque surfaces", () => {
    const block = glassSupportsBlock();
    for (const level of GLASS_LEVELS) {
      expect(block).toContain(`.${level}`);
      // ...and nowhere else in the stylesheet.
      const outside = css.replace(block, "");
      expect(outside).not.toContain(`.${level} {`);
    }
  });

  it("pairs every backdrop-filter with its -webkit- prefix (Safari, including iOS PWA)", () => {
    const standard = (css.match(/[^-]\bbackdrop-filter:/g) ?? []).length;
    const prefixed = (css.match(/-webkit-backdrop-filter:/g) ?? []).length;
    expect(prefixed).toBe(standard);
  });

  it("prevents glass inside glass with a rule that out-specifies the single-class levels", () => {
    const block = glassSupportsBlock();
    // `:is(...) :is(...)` -- a descendant pair of class-specificity
    // selectors (0,2,0), which beats the levels' own (0,1,0). `:where()`
    // would be zero-specificity and silently lose.
    expect(block).toMatch(
      /:is\(\.glass-strong, \.glass-medium, \.glass-subtle\)\s+:is\(\.glass-strong, \.glass-medium, \.glass-subtle\)\s*{[^}]*backdrop-filter:\s*none/,
    );
  });

  it("drops blur on the densest level and softens the rest on small viewports", () => {
    const block = glassSupportsBlock();
    const mobile = block.match(/@media\s*\(max-width:\s*640px\)\s*{([\s\S]*?)\n  }/);
    expect(mobile).not.toBeNull();
    const mobileBlock = mobile?.[1] ?? "";

    // Less blur, more opacity -- the canvas is barely visible at this size.
    expect(mobileBlock).toMatch(/--glass-blur-strong:\s*\d+px/);
    expect(mobileBlock).toMatch(/--glass-alpha-bump:\s*0\.\d+/);
    expect(mobileBlock).toMatch(/\.glass-subtle\s*{[^}]*backdrop-filter:\s*none/);
  });

  it("collapses the whole system to opaque under prefers-reduced-transparency", () => {
    const block = glassSupportsBlock();
    const reduced = block.match(/@media\s*\(prefers-reduced-transparency:\s*reduce\)([\s\S]*?)\n  }\n/);
    expect(reduced).not.toBeNull();
    const reducedBlock = reduced?.[1] ?? "";

    expect(reducedBlock).toMatch(/--glass-alpha-bump:\s*1/);
    for (const level of [...GLASS_LEVELS, "glass-scrim"]) {
      expect(reducedBlock).toContain(`.${level}`);
    }
  });

  it("defines the palette half of the token set in BOTH dark blocks, never only one", () => {
    // Same invariant every other token in this file has: an explicit
    // `data-theme="dark"` must not depend on the system preference.
    const occurrences = (css.match(/--glass-base:\s*18 25 34/g) ?? []).length;
    expect(occurrences).toBe(2);
  });

  it("keeps the shape half OUT of the per-theme blocks, so the viewport overrides can win at matching specificity", () => {
    // A per-theme redefinition of a shape token would out-specify the
    // `:root`-level viewport/accessibility overrides and silently disable
    // them, so neither dark block may carry one.
    const explicitDark = blockAt(':root[data-theme="dark"]');
    const systemDark = blockAt(':root:not([data-theme="light"])');

    for (const token of ["--glass-blur-strong", "--glass-saturate-strong", "--glass-alpha-bump", "--glass-scrim-blur"]) {
      expect(explicitDark, `${token} must not be redefined per theme`).not.toContain(`${token}:`);
      expect(systemDark, `${token} must not be redefined per theme`).not.toContain(`${token}:`);
    }
  });

  it("derives the environmental tint from the palette's own accent, never a hardcoded hex", () => {
    for (const level of ["strong", "medium", "subtle"]) {
      expect(css).toMatch(new RegExp(`--glass-env-tint-${level}:\\s*color-mix\\(in srgb, var\\(--accent\\)`));
    }
  });

  it("steps the alpha evenly between levels, so each one is perceptibly different from its neighbour", () => {
    // The whole point of the level ladder: `subtle` that sits at the same
    // alpha as an opaque surface is not a level, it is a no-op.
    const darkBlock = blockAt(':root[data-theme="dark"]');
    const read = (name: string) => {
      const m = darkBlock.match(new RegExp(`--glass-alpha-${name}:\\s*([\\d.]+)`));
      expect(m, `missing --glass-alpha-${name}`).not.toBeNull();
      return Number(m?.[1]);
    };

    const strong = read("strong");
    const medium = read("medium");
    const subtle = read("subtle");

    expect(strong).toBeLessThan(medium);
    expect(medium).toBeLessThan(subtle);
    // Every step big enough to actually read as a different material, and
    // `subtle` still transparent enough to show the canvas at all.
    expect(medium - strong).toBeGreaterThanOrEqual(0.1);
    expect(subtle - medium).toBeGreaterThanOrEqual(0.1);
    expect(subtle).toBeLessThanOrEqual(0.8);
  });

  it("parameterises the ring so a glass surface can keep an accent edge, or none at all", () => {
    const block = glassSupportsBlock();
    // The levels set `box-shadow` wholesale, which silently erases a
    // Tailwind `ring-2 ring-primary` in the same class list -- these two
    // utilities are what keep a selection state (or an existing real
    // `border`) intact through the material.
    expect(block).toMatch(/0 0 0 var\(--glass-ring-width, 1px\) var\(--glass-ring-color, var\(--glass-line\)\)/);
    expect(block).toMatch(/\.glass-ring-primary\s*{[^}]*--glass-ring-color:\s*var\(--primary\)/);
    expect(block).toMatch(/\.glass-ring-none\s*{[^}]*--glass-ring-width:\s*0px/);
  });
});

/**
 * `--glass-line-*`/`--glass-nested-bg`/`--glass-base` draw a `.glass-*`
 * card's own visible edge/nested-surface/opaque-base -- NOT `--border`/
 * `--surface-*` directly. A high-contrast fix that only strengthens
 * `--border` leaves this material's real rendered boundary at its
 * ordinary, low-contrast value. These tests guard the actual override,
 * plus a real WCAG computation of the resulting edge (not just an
 * assumption that `--border`'s own already-checked ratio carries over).
 */
describe("globals.css glass materials -- high contrast", () => {
  function srgbToLinear(c: number): number {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }

  function luminance(hex: string): number {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.substring(i, i + 2), 16));
    const [R, G, B] = [r, g, b].map(srgbToLinear);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }

  /** The WCAG 2.x contrast-ratio formula -- same as the one this project
   * used to validate every other high-contrast token pair. */
  function contrastRatio(hex1: string, hex2: string): number {
    const L1 = luminance(hex1);
    const L2 = luminance(hex2);
    const lighter = Math.max(L1, L2);
    const darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function readHexVar(name: string): string {
    const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
    expect(m, `missing ${name}`).not.toBeNull();
    return (m?.[1] as string).toLowerCase();
  }

  const GLASS_OVERRIDE_LINES = [
    "--glass-line-strong: var(--border-strong);",
    "--glass-line-medium: var(--border);",
    "--glass-line-subtle: var(--border);",
    "--glass-nested-bg: var(--surface-1);",
  ];

  it("overrides the glass edge/nested-surface/base tokens in the manual light high-contrast block", () => {
    for (const line of GLASS_OVERRIDE_LINES) {
      expect(css).toContain(line);
    }
    const lightGlassBaseOccurrences = (css.match(/--glass-base:\s*var\(--hc-light-glass-base\)/g) ?? []).length;
    // manual light + prefers-contrast:more light.
    expect(lightGlassBaseOccurrences).toBe(2);
  });

  it("overrides the glass edge/nested-surface tokens in every dark high-contrast block (manual system + manual explicit + both OS prefers-contrast blocks)", () => {
    const darkGlassBaseOccurrences = (css.match(/--glass-base:\s*var\(--hc-dark-glass-base\)/g) ?? []).length;
    // system-dark manual, explicit-dark manual, prefers-contrast:more
    // explicit-dark, prefers-color-scheme+prefers-contrast:more system-dark.
    expect(darkGlassBaseOccurrences).toBe(4);

    for (const line of GLASS_OVERRIDE_LINES) {
      const occurrences = (css.match(new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
      // light manual + system-dark manual + explicit-dark manual +
      // prefers-contrast:more light + prefers-contrast:more explicit-dark +
      // prefers-color-scheme+prefers-contrast:more system-dark.
      expect(occurrences, `expected 6 occurrences of "${line}"`).toBe(6);
    }
  });

  it("pins --glass-base to the SAME hex as the high-contrast background, not the theme's ordinary (lower-contrast) glass tint", () => {
    const hcLightBackground = readHexVar("--hc-light-background");
    const hcDarkBackground = readHexVar("--hc-dark-background");

    const lightGlassBase = css.match(/--hc-light-glass-base:\s*([\d\s]+);/)?.[1]?.trim();
    const darkGlassBase = css.match(/--hc-dark-glass-base:\s*([\d\s]+);/)?.[1]?.trim();
    expect(lightGlassBase).toBe("255 255 255");
    expect(darkGlassBase).toBe("0 0 0");

    // Sanity: those triplets really do decode to the same hex as background.
    expect(hcLightBackground).toBe("#ffffff");
    expect(hcDarkBackground).toBe("#000000");
  });

  it("computes the ACTUAL glass edge contrast (border tokens against the opaque glass base), not just --border against --background in isolation", () => {
    const hcLightBorder = readHexVar("--hc-light-border");
    const hcLightBorderStrong = readHexVar("--hc-light-border-strong");
    const hcLightBackground = readHexVar("--hc-light-background");
    const hcDarkBorder = readHexVar("--hc-dark-border");
    const hcDarkBorderStrong = readHexVar("--hc-dark-border-strong");
    const hcDarkBackground = readHexVar("--hc-dark-background");

    // --glass-line-medium/-subtle resolve to var(--border); --glass-line-strong
    // to var(--border-strong); --glass-base is pinned to --background above --
    // so these ARE the real rendered glass edge ratios, comfortably above the
    // 3:1 WCAG non-text/UI-boundary minimum in both themes.
    expect(contrastRatio(hcLightBorder, hcLightBackground)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(hcLightBorderStrong, hcLightBackground)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(hcDarkBorder, hcDarkBackground)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(hcDarkBorderStrong, hcDarkBackground)).toBeGreaterThanOrEqual(3);
  });

  it("gives prefers-contrast: more the same opaque, no-blur glass treatment as the manual toggle", () => {
    const block = glassSupportsBlock();
    const match = block.match(/@media \(prefers-contrast: more\) {([\s\S]*?)\n  }/);
    expect(match, "missing the @supports-nested prefers-contrast: more rule").not.toBeNull();
    const inner = match?.[1] ?? "";

    expect(inner).toMatch(/--glass-alpha-bump:\s*1/);
    for (const level of [...GLASS_LEVELS, "glass-scrim"]) {
      expect(inner).toContain(`.${level}`);
    }
    expect(inner).toMatch(/backdrop-filter:\s*none/);
  });

  it("never sets forced-color-adjust as an actual declaration (comment mentions of the term are fine)", () => {
    expect(css).not.toMatch(/forced-color-adjust\s*:/);
  });
});
