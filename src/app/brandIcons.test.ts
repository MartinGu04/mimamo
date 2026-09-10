import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PR #23 -- confirms the site's favicon/app icon file-convention metadata
 * (`src/app/icon.png`, `src/app/apple-icon.png`) references the supplied
 * המחלבה symbol, not the generic default Next.js icon, and that the old
 * default `favicon.ico` was actually removed rather than left alongside it.
 */
const APP_DIR = path.join(__dirname);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("brand icons (PR #23)", () => {
  it("src/app/icon.png exists and is a real PNG (the המחלבה symbol, not a placeholder)", () => {
    const file = path.join(APP_DIR, "icon.png");
    expect(fs.existsSync(file)).toBe(true);
    const header = fs.readFileSync(file).subarray(0, 8);
    expect(header.equals(PNG_MAGIC)).toBe(true);
  });

  it("src/app/apple-icon.png exists and is a real PNG", () => {
    const file = path.join(APP_DIR, "apple-icon.png");
    expect(fs.existsSync(file)).toBe(true);
    const header = fs.readFileSync(file).subarray(0, 8);
    expect(header.equals(PNG_MAGIC)).toBe(true);
  });

  it("the old default favicon.ico was removed, not left alongside the new icon", () => {
    expect(fs.existsSync(path.join(APP_DIR, "favicon.ico"))).toBe(false);
  });

  it("the underlying public/brand/icon.png asset the icons are derived from exists", () => {
    const file = path.join(APP_DIR, "..", "..", "public", "brand", "icon.png");
    expect(fs.existsSync(file)).toBe(true);
  });
});
