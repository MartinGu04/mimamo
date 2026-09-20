/**
 * User-controlled accessibility PREFERENCES (Phase 8 accessibility
 * preferences widget) -- a separate, deliberately smaller concern from the
 * semantic/ARIA remediation shipped in Phases 1-7 (Sidebar/AppShell/etc.).
 * Those fixed real accessibility defects; this is an opt-in personalization
 * layer on top of an already-accessible app, and never a substitute for it.
 *
 * Stored under its OWN localStorage key, entirely independent of
 * `THEME_STORAGE_KEY` (`lib/theme/themeScript.ts`) -- a user's text-size/
 * motion/transparency/link choices must survive a light/dark theme change
 * (and vice versa) with zero interaction between the two.
 */
export type A11yTextSize = "default" | "enlarged" | "xlarge";

export interface A11yPreferences {
  textSize: A11yTextSize;
  highContrast: boolean;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  emphasizeLinks: boolean;
}

export const DEFAULT_A11Y_PREFERENCES: A11yPreferences = {
  textSize: "default",
  highContrast: false,
  reduceMotion: false,
  reduceTransparency: false,
  emphasizeLinks: false,
};

/**
 * Versioned/specific on purpose (see spec) -- a future incompatible shape
 * change can bump this suffix rather than needing to migrate old stored
 * values.
 */
export const A11Y_STORAGE_KEY = "hamachlava-a11y-preferences-v1";

function isTextSize(value: unknown): value is A11yTextSize {
  return value === "default" || value === "enlarged" || value === "xlarge";
}

/**
 * Defensive per-field parsing (never a bare `JSON.parse` cast) -- a
 * malformed, partial, or future-shape stored value degrades field-by-field
 * to the default rather than discarding every other still-valid field, or
 * throwing and losing the whole read. This is also what makes the storage
 * format additive: an object saved before `highContrast` existed simply has
 * no such key, and `typeof undefined === "boolean"` is false, so it quietly
 * resolves to the default (`false`) here -- the rest of that user's
 * preferences are read back unchanged, never discarded for being "old
 * shape".
 */
export function parseA11yPreferences(raw: string): A11yPreferences {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_A11Y_PREFERENCES;
    const value = parsed as Record<string, unknown>;
    return {
      textSize: isTextSize(value.textSize) ? value.textSize : DEFAULT_A11Y_PREFERENCES.textSize,
      highContrast: typeof value.highContrast === "boolean" ? value.highContrast : DEFAULT_A11Y_PREFERENCES.highContrast,
      reduceMotion: typeof value.reduceMotion === "boolean" ? value.reduceMotion : DEFAULT_A11Y_PREFERENCES.reduceMotion,
      reduceTransparency:
        typeof value.reduceTransparency === "boolean" ? value.reduceTransparency : DEFAULT_A11Y_PREFERENCES.reduceTransparency,
      emphasizeLinks: typeof value.emphasizeLinks === "boolean" ? value.emphasizeLinks : DEFAULT_A11Y_PREFERENCES.emphasizeLinks,
    };
  } catch {
    return DEFAULT_A11Y_PREFERENCES;
  }
}

function setBooleanAttribute(root: HTMLElement, name: string, value: boolean): void {
  if (value) root.setAttribute(name, "true");
  else root.removeAttribute(name);
}

/**
 * The ONE place every preference here becomes a `data-a11y-*` attribute on
 * `<html>` -- every consuming CSS rule (`globals.css`) and every future
 * component reads state through these attributes, never by scattering
 * `useA11yPreferences()` conditionals across dozens of components (spec
 * section 5). `data-a11y-text` carries the actual size value ("enlarged"/
 * "xlarge") and is absent entirely for "default", the same
 * present-only-when-non-default convention `ThemeProvider`'s `data-theme`
 * already uses for "system".
 */
export function applyA11yDocumentAttributes(preferences: A11yPreferences): void {
  const root = document.documentElement;
  if (preferences.textSize === "enlarged" || preferences.textSize === "xlarge") {
    root.setAttribute("data-a11y-text", preferences.textSize);
  } else {
    root.removeAttribute("data-a11y-text");
  }
  setBooleanAttribute(root, "data-a11y-high-contrast", preferences.highContrast);
  setBooleanAttribute(root, "data-a11y-reduce-motion", preferences.reduceMotion);
  setBooleanAttribute(root, "data-a11y-reduce-transparency", preferences.reduceTransparency);
  setBooleanAttribute(root, "data-a11y-emphasize-links", preferences.emphasizeLinks);
}

/**
 * A tiny, synchronous script string, inlined as the very first thing in
 * `<body>` (same "blocking script before first paint" contract as
 * `THEME_INIT_SCRIPT`, see `lib/theme/themeScript.ts`) -- applies a
 * previously-stored preference's `data-a11y-*` attributes before the
 * browser paints anything, so returning to the app never flashes an
 * unstyled/unenlarged/unreduced frame first. Deliberately does nothing
 * (leaves every attribute unset) when nothing is stored, or the stored
 * value fails to parse -- `A11yPreferencesProvider`'s own defensive
 * `parseA11yPreferences` is the single source of truth for what a
 * malformed value degrades to; this script only needs to special-case
 * `JSON.parse` throwing, via the same outer `try/catch` every other guard
 * in this file relies on.
 */
export const A11Y_INIT_SCRIPT = `(function(){try{var raw=localStorage.getItem(${JSON.stringify(
  A11Y_STORAGE_KEY,
)});if(!raw)return;var p=JSON.parse(raw);var root=document.documentElement;if(p.textSize==="enlarged"||p.textSize==="xlarge"){root.setAttribute("data-a11y-text",p.textSize);}if(p.highContrast===true){root.setAttribute("data-a11y-high-contrast","true");}if(p.reduceMotion===true){root.setAttribute("data-a11y-reduce-motion","true");}if(p.reduceTransparency===true){root.setAttribute("data-a11y-reduce-transparency","true");}if(p.emphasizeLinks===true){root.setAttribute("data-a11y-emphasize-links","true");}}catch(e){}})();`;
