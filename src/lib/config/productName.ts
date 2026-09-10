/**
 * The product's brand identity (rebrand: מי-מה-מו -> המחלבה). Every place
 * that shows the name/slogan in the UI imports it from here instead of
 * hardcoding the string, so a future change is a one-line edit and never a
 * find/replace across components.
 *
 * Four distinct forms, never competing sources of truth for the same thing:
 * - `APP_NAME` -- the Hebrew display name shown throughout the product UI.
 * - `APP_NAME_ASCII` -- the Latin-script technical spelling, used only
 *   where a non-Hebrew identifier is genuinely required (package/metadata
 *   identifiers, technical brand slugs). Never rendered as a second,
 *   competing product name alongside the Hebrew one in the UI.
 * - `APP_SLOGAN` -- the one-line Hebrew tagline shown under the name in
 *   the expanded desktop sidebar and other larger brand placements.
 * - `APP_DESCRIPTION` -- the one-line Hebrew description used everywhere a
 *   short product summary is needed (root `<meta name="description">`, the
 *   PWA manifest) so both stay in sync automatically instead of drifting
 *   apart as two separately hand-typed strings.
 *
 * Treat this as plain text/identifier only -- logos and brand imagery live
 * under `public/brand/` (see `brandAssets.ts`), not here. Technical
 * identifiers that must stay stable across the rebrand (the npm package
 * name, storage-key prefixes, the calendar UID domain, PWA scope, routes)
 * intentionally do NOT read from here -- see each of those call sites for
 * why they keep their own retired-brand-era literal.
 */
export const APP_NAME = "המחלבה";

export const APP_NAME_ASCII = "hamachlava";

export const APP_SLOGAN = "החלב נגמר. המשמרת לא.";

export const APP_DESCRIPTION = "מלווה תזמון מבוסס Google Sheets";
