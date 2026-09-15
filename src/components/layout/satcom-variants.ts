/**
 * How loud the SATCOM canvas (see `SatcomBackground`) is allowed to be on a
 * given route.
 *
 * The visual vocabulary is shared app-wide -- same palette, grid, orbital
 * lines, glow language and ambient motion everywhere -- but the amount of it
 * is matched to how busy the page already is, so the background never
 * competes with the content sitting on top of it:
 *
 * - `rich`     -- open, low-density pages with real empty canvas to play
 *                 with (Home, the countdown). Full composition.
 * - `standard` -- ordinary content pages: lists, forms, a few panels.
 *                 Fewer motifs, arranged differently, and dimmer.
 * - `calm`     -- dense data surfaces (a month calendar, fairness tables).
 *                 Atmosphere only: no dish, no planet, barely-there lines.
 */
export type SatcomVariant = "rich" | "standard" | "calm";

/**
 * Exact-path overrides. Anything not listed here inherits from its closest
 * listed ancestor (so `/manager/whatever` follows `/manager`), and anything
 * with no listed ancestor at all falls back to `calm` -- the deliberately
 * conservative default: a page nobody has looked at yet gets the quietest
 * treatment rather than the loudest.
 */
const VARIANT_BY_PATH: Readonly<Record<string, SatcomVariant>> = {
  "/": "rich",
  "/countdown": "rich",
  "/duties": "standard",
  "/manager": "standard",
  "/notifications": "standard",
  "/settings": "standard",
  "/shooting-ranges": "standard",
  "/schedule": "calm",
  "/fairness": "calm",
};

/** Resolves a pathname (with or without a trailing slash) to its variant. */
export function satcomVariantForPath(pathname: string): SatcomVariant {
  const normalized = pathname.replace(/\/+$/, "") || "/";

  const exact = VARIANT_BY_PATH[normalized];
  if (exact) {
    return exact;
  }

  const segments = normalized.split("/").filter(Boolean);
  for (let depth = segments.length - 1; depth > 0; depth -= 1) {
    const ancestor = VARIANT_BY_PATH[`/${segments.slice(0, depth).join("/")}`];
    if (ancestor) {
      return ancestor;
    }
  }

  return "calm";
}
