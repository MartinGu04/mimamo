"use client";

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";
import {
  A11Y_STORAGE_KEY,
  DEFAULT_A11Y_PREFERENCES,
  applyA11yDocumentAttributes,
  parseA11yPreferences,
  type A11yPreferences,
  type A11yTextSize,
} from "./preferences";

interface A11yPreferencesContextValue {
  preferences: A11yPreferences;
  setTextSize: (size: A11yTextSize) => void;
  setHighContrast: (value: boolean) => void;
  setReduceMotion: (value: boolean) => void;
  setReduceTransparency: (value: boolean) => void;
  setEmphasizeLinks: (value: boolean) => void;
  /** Resets ONLY the preferences this widget controls -- see spec section 2E. Never touches theme or any other stored preference. */
  reset: () => void;
}

const A11yPreferencesContext = createContext<A11yPreferencesContextValue | null>(null);

/** Same same-tab pub/sub shape as `ThemeProvider` -- `useSyncExternalStore` needs a subscribe function, and localStorage's own `storage` event never fires in the tab that made the change. */
let listeners: Array<() => void> = [];

function subscribe(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

/**
 * `undefined` (never a real stored value) so the very first call always
 * misses the cache and actually reads storage.
 */
let cachedRaw: string | null | undefined;
let cachedPreferences: A11yPreferences = DEFAULT_A11Y_PREFERENCES;

/**
 * `useSyncExternalStore`'s `getSnapshot` requires a REFERENTIALLY STABLE
 * result between calls when nothing has actually changed -- unlike
 * `ThemeProvider`'s `readStoredTheme` (a primitive string, stable for free),
 * this parses a stored value into a fresh object, which would otherwise be
 * a new reference on every single render and trigger React's "getSnapshot
 * should be cached" infinite-loop guard. Caching keyed on the raw string
 * (re-parsing only when it actually changes) gives the same object back
 * whenever storage hasn't moved.
 */
function readStoredPreferences(): A11yPreferences {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(A11Y_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPreferences = raw ? parseA11yPreferences(raw) : DEFAULT_A11Y_PREFERENCES;
  }
  return cachedPreferences;
}

/**
 * Same "always the default for the server render and the client's very
 * first hydration pass" contract as `ThemeProvider`'s `getServerSnapshot` --
 * the server can never know a localStorage-only preference, and
 * `useSyncExternalStore` guarantees this exact value is used for both,
 * so there is no hydration mismatch. The blocking `A11Y_INIT_SCRIPT` (see
 * `preferences.ts`) already applied the real stored value to the DOM
 * BEFORE this ever runs -- this only has to avoid disagreeing with it
 * during hydration; the resync to the real value happens immediately after.
 */
function getServerSnapshot(): A11yPreferences {
  return DEFAULT_A11Y_PREFERENCES;
}

function persist(next: A11yPreferences): void {
  try {
    window.localStorage.setItem(A11Y_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private mode, quota) -- the preference
    // still applies for this session via the DOM attributes below.
  }
  applyA11yDocumentAttributes(next);
  notifyListeners();
}

/**
 * Presentation-only accessibility PREFERENCE state (Phase 8) -- see
 * `preferences.ts`'s own docstring for the "personalization layer, not a
 * compliance fix" distinction. Mirrors `ThemeProvider` exactly (same
 * `useSyncExternalStore` pub/sub, same localStorage try/catch guards) but
 * reads/writes a completely separate storage key, so nothing here can ever
 * affect or be affected by the light/dark theme choice.
 */
export function A11yPreferencesProvider({ children }: { children: ReactNode }) {
  const preferences = useSyncExternalStore(subscribe, readStoredPreferences, getServerSnapshot);

  const update = useCallback((patch: Partial<A11yPreferences>) => {
    persist({ ...readStoredPreferences(), ...patch });
  }, []);

  const setTextSize = useCallback((textSize: A11yTextSize) => update({ textSize }), [update]);
  const setHighContrast = useCallback((value: boolean) => update({ highContrast: value }), [update]);
  const setReduceMotion = useCallback((value: boolean) => update({ reduceMotion: value }), [update]);
  const setReduceTransparency = useCallback((value: boolean) => update({ reduceTransparency: value }), [update]);
  const setEmphasizeLinks = useCallback((value: boolean) => update({ emphasizeLinks: value }), [update]);

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(A11Y_STORAGE_KEY);
    } catch {
      // See `persist`'s identical guard above.
    }
    applyA11yDocumentAttributes(DEFAULT_A11Y_PREFERENCES);
    notifyListeners();
  }, []);

  return (
    <A11yPreferencesContext.Provider
      value={{ preferences, setTextSize, setHighContrast, setReduceMotion, setReduceTransparency, setEmphasizeLinks, reset }}
    >
      {children}
    </A11yPreferencesContext.Provider>
  );
}

export function useA11yPreferences(): A11yPreferencesContextValue {
  const context = useContext(A11yPreferencesContext);
  if (!context) {
    throw new Error("useA11yPreferences must be used within an A11yPreferencesProvider");
  }
  return context;
}
