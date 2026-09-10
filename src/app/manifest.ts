import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/config/productName";

/**
 * The Web App Manifest (PR #28) -- makes המחלבה properly installable.
 * Served automatically by Next's `app/manifest.ts` file convention at the
 * root scope. Icons reference the real supplied symbol artwork (see
 * `public/brand/icon.png` / `lib/config/brandAssets.ts`), resized only,
 * never redrawn (`public/icons/`).
 *
 * `theme_color` here is a single stable value (manifest fields cannot
 * respond to `prefers-color-scheme`) -- the app's own dark-navy sidebar
 * tone, already used as a fixed brand surface in BOTH light and dark
 * themes (see globals.css). The LIVE browser chrome color that actually
 * follows light/dark is set separately via `viewport.themeColor` in the
 * root layout, which Next resolves to per-scheme `<meta>` tags.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    lang: "he",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f8",
    theme_color: "#162331",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
