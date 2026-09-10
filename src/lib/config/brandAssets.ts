/**
 * Single source of truth for the real brand imagery supplied for the
 * המחלבה rebrand (`public/brand/`), so components never hardcode an asset
 * path. Every entry is the SUPPLIED artwork, unaltered except where noted
 * (icon resizes for PWA/favicon use -- see `public/icons/` and
 * `src/app/icon.png`/`apple-icon.png`) -- never a recreated/redrawn
 * substitute.
 */

/**
 * Standalone המחלבה symbol -- the exhausted cow with the satellite dish
 * and satellite, WITHOUT any embedded lettering (the circular lockup with
 * baked-in text is `BRAND_LOGO_BADGE` below; its lettering is unreadable
 * at this element's icon-scale usage). Used for inline placement next to
 * live text on any surface color -- compact identity (Sidebar, mobile
 * header) -- and is the source for the site's favicon/app icon
 * (`src/app/icon.png`), resized only, never redrawn.
 */
export const BRAND_SYMBOL = { src: "/brand/icon.png", width: 1254, height: 1254 } as const;

/**
 * The wide banner lockup (navy/blue/purple canvas, symbol + "המחלבה" +
 * slogan, no circular frame). Not currently wired into any UI -- this app
 * has no existing large marketing/splash surface for it to sit in without
 * redesigning a screen the rebrand wasn't asked to touch (the login page
 * deliberately keeps only the small `LoginHeaderLogo` mark, by prior
 * design). Kept as the pristine source asset for any future large-format
 * placement.
 */
export const BRAND_BANNER = { src: "/brand/banner.png", width: 2172, height: 724 } as const;

/**
 * The circular badge lockup (symbol + "המחלבה" + slogan, badge-framed).
 * Intended for larger placements where the embedded lettering stays
 * readable -- NOT for navigation-icon scale (see `BRAND_SYMBOL`). Not
 * currently wired into any UI, for the same reason as `BRAND_BANNER` above
 * -- kept as the pristine source asset for any future placement.
 */
export const BRAND_LOGO_BADGE = { src: "/brand/logo-circle.png", width: 1254, height: 1254 } as const;

/** Shared shape for a supplied organizational logo asset -- `src`/`width`/`height` for `next/image`, `alt` for the real Hebrew name (never decorative/empty, unlike `BRAND_SYMBOL`, since these mark a specific real organization, not a repeated product name). */
export interface OrgLogo {
  src: string;
  width: number;
  height: number;
  alt: string;
}

/** תקש"ל organizational logo, unmodified/uncropped. */
export const ORG_LOGO_TAKSHAL: OrgLogo = {
  src: "/brand/org-logo-takshal.webp",
  width: 1024,
  height: 1536,
  alt: 'תקש"ל',
};

/** תקשורת אסטרטגית organizational logo, unmodified/uncropped. */
export const ORG_LOGO_STRATEGIC_COMMUNICATION: OrgLogo = {
  src: "/brand/org-logo-strategic-communication.webp",
  width: 1024,
  height: 1024,
  alt: "תקשורת אסטרטגית",
};
