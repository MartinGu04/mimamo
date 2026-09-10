/**
 * Regenerates every resized PWA/favicon icon from the single supplied
 * source artwork (`public/brand/icon.png` -- the cow/dish/satellite symbol,
 * no embedded lettering) using `sharp` (already a transitive dependency of
 * this project's toolchain; see `package.json`'s devDependencies). Resizes
 * only -- never redraws/recreates the artwork.
 *
 * Run from the REPOSITORY ROOT (paths resolve against `process.cwd()`,
 * same convention as `scripts/debug-*.ts`):
 *
 *   npx tsx scripts/generate-brand-icons.ts
 *
 * Regenerate whenever `public/brand/icon.png` changes, so every derived
 * icon file (`src/app/icon.png`, `src/app/apple-icon.png`,
 * `public/icons/icon-*.png`) always matches the current supplied artwork
 * instead of silently drifting from it.
 */
import sharp from "sharp";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "public", "brand", "icon.png");

/** Sampled from the source artwork's own corner background -- used to pad the maskable icon's safe zone with a matching solid fill, never a guessed color. */
const BACKGROUND = "#080f29";

interface Target {
  path: string;
  size: number;
  /** Maskable icons need real padding: OS launchers crop to their own shape (circle, squircle, ...), so content must stay inside a centered ~80%-diameter safe zone. */
  maskableSafeZone?: boolean;
  /** Non-transparent output (matches this repo's existing maskable/apple-icon files, which ship without an alpha channel). */
  flatten?: boolean;
}

const TARGETS: Target[] = [
  { path: "src/app/icon.png", size: 512 },
  { path: "src/app/apple-icon.png", size: 180, flatten: true },
  { path: "public/icons/icon-192.png", size: 192 },
  { path: "public/icons/icon-512.png", size: 512 },
  { path: "public/icons/icon-maskable-512.png", size: 512, maskableSafeZone: true, flatten: true },
];

async function generate(target: Target): Promise<void> {
  const outPath = path.join(ROOT, target.path);

  let pipeline = sharp(SOURCE);

  if (target.maskableSafeZone) {
    // Shrink to ~70% of the canvas, centered on a solid background fill --
    // the resulting content sits well inside the ~80% safe-zone every
    // maskable-icon spec requires, even after an aggressive circular crop.
    const contentSize = Math.round(target.size * 0.7);
    const resizedContent = await sharp(SOURCE).resize(contentSize, contentSize).toBuffer();
    pipeline = sharp({
      create: { width: target.size, height: target.size, channels: 3, background: BACKGROUND },
    }).composite([{ input: resizedContent, gravity: "center" }]);
  } else {
    pipeline = pipeline.resize(target.size, target.size);
  }

  if (target.flatten) {
    pipeline = pipeline.flatten({ background: BACKGROUND });
  }

  await pipeline.png().toFile(outPath);
  console.log(`wrote ${target.path} (${target.size}x${target.size})`);
}

async function main(): Promise<void> {
  for (const target of TARGETS) {
    await generate(target);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
