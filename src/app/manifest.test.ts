import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import manifest from "./manifest";
import { APP_NAME } from "@/lib/config/productName";

const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

describe("Web App Manifest (PR #28)", () => {
  it("identifies the app clearly as המחלבה, installable in standalone mode", () => {
    const result = manifest();
    expect(result.name).toBe(APP_NAME);
    expect(result.short_name).toBe(APP_NAME);
    expect(result.display).toBe("standalone");
    expect(result.start_url).toBe("/");
    expect(result.scope).toBe("/");
    expect(typeof result.description).toBe("string");
    expect(result.description).not.toHaveLength(0);
  });

  it("defines a background_color and a stable theme_color", () => {
    const result = manifest();
    expect(result.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(result.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("includes 192x192 and 512x512 'any' icons plus a 512x512 maskable icon", () => {
    const result = manifest();
    const icons = result.icons ?? [];

    const any192 = icons.find((icon) => icon.sizes === "192x192" && icon.purpose === "any");
    const any512 = icons.find((icon) => icon.sizes === "512x512" && icon.purpose === "any");
    const maskable512 = icons.find((icon) => icon.sizes === "512x512" && icon.purpose === "maskable");

    expect(any192).toBeDefined();
    expect(any512).toBeDefined();
    expect(maskable512).toBeDefined();
  });

  it("every referenced icon file actually exists under public/ as a real PNG", () => {
    const result = manifest();
    const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    for (const icon of result.icons ?? []) {
      const filePath = path.join(PUBLIC_DIR, icon.src);
      expect(fs.existsSync(filePath), `${icon.src} should exist`).toBe(true);
      const header = fs.readFileSync(filePath).subarray(0, 8);
      expect(header.equals(PNG_MAGIC)).toBe(true);
    }
  });
});
