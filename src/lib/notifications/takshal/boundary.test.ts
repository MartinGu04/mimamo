import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression guard for the TAKSHAL CTRL delivery channel's secrets and
 * rollout configuration -- text-level scans, matching this codebase's
 * boundary-guard convention (`src/app/notificationServiceRoleBoundary.test.ts`):
 *
 *  1. Every module of the channel is `server-only`.
 *  2. The three `TAKSHAL_CTRL_*` variables are read in exactly ONE file
 *     (`config.ts`) -- no allowlist or secret check scattered elsewhere.
 *  3. Nothing anywhere uses a `NEXT_PUBLIC_TAKSHAL*` name (which Next.js
 *     would inline into the browser bundle).
 *  4. No "use client" component imports the channel or names its variables.
 */
function findSourceFiles(dir: string): string[] {
  let results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(findSourceFiles(fullPath));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) results.push(fullPath);
  }
  return results;
}

const srcRoot = path.resolve(__dirname, "..", "..", "..");
const sourceFiles = findSourceFiles(srcRoot);
const read = (file: string) => fs.readFileSync(file, "utf8");

const CHANNEL_MODULES = [
  ...findSourceFiles(path.resolve(__dirname)),
  path.join(srcRoot, "lib", "notifications", "deliveryChannel.ts"),
  path.join(srcRoot, "lib", "notifications", "engine", "takshalChannel.ts"),
];

describe("TAKSHAL CTRL channel boundary guard", () => {
  it("finds the channel's modules (sanity check the scan itself works)", () => {
    expect(CHANNEL_MODULES.length).toBeGreaterThanOrEqual(6);
    for (const file of CHANNEL_MODULES) expect(fs.existsSync(file)).toBe(true);
  });

  it("every channel module is server-only", () => {
    for (const file of CHANNEL_MODULES) expect(read(file).startsWith('import "server-only";'), file).toBe(true);
  });

  it("the TAKSHAL_CTRL_* variables are read in exactly one place", () => {
    const readers = sourceFiles.filter((file) => /TAKSHAL_CTRL_(HUB_URL|SOURCE_SECRET|TEST_RECIPIENTS)/.test(read(file)));
    expect(readers).toEqual([path.join(srcRoot, "lib", "notifications", "takshal", "config.ts")]);
  });

  it("no NEXT_PUBLIC_ variant exists anywhere", () => {
    for (const file of sourceFiles) expect(read(file), file).not.toMatch(/NEXT_PUBLIC_TAKSHAL/);
  });

  it("no client component imports the channel or names its variables", () => {
    const clientFiles = sourceFiles.filter((file) => read(file).startsWith('"use client"'));
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const file of clientFiles) {
      const content = read(file);
      expect(content, file).not.toMatch(/TAKSHAL_CTRL_/);
      expect(content, file).not.toMatch(/lib\/notifications\/(takshal|deliveryChannel)/);
      expect(content, file).not.toMatch(/takshalChannel/);
    }
  });
});
