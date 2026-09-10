# lib/config

- `productName.ts` — `APP_NAME` (Hebrew display name, "המחלבה"),
  `APP_NAME_ASCII` (Latin technical spelling, "hamachlava"), `APP_SLOGAN`
  (the Hebrew tagline, "החלב נגמר. המשמרת לא."), and `APP_DESCRIPTION` (the
  one-line Hebrew product description) — the single source for the
  product's brand identity. Every place that shows the name/slogan/
  description in the UI or in metadata (root `<meta name="description">`,
  the PWA manifest — see `app/manifest.ts`) imports it from here instead of
  hardcoding a string.
- `brandAssets.ts` — paths and intrinsic dimensions for the real brand
  imagery under `public/brand/` (the icon-only symbol, the wide banner
  lockup, the circular badge lockup, and the two organizational logos).
  Single source so components never hardcode an asset path.
