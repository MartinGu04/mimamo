const MAIN_CONTENT_ID = "main-content";

/**
 * IS 5568/WCAG 2.0 AA "Bypass Blocks" (2.4.1) skip link -- a plain,
 * JS-free `<a href="#main-content">`: activating it (mouse or keyboard)
 * both scrolls the real `<main id="main-content" tabIndex={-1}>` into
 * view AND moves focus there, standard native anchor behavior once the
 * target carries a `tabindex` (see `MAIN_CONTENT_ID`'s two call sites --
 * `AppShell` for every authenticated route, `/login` for the signed-out
 * entry point -- each renders exactly ONE of these, first in its own DOM,
 * so it is always the first focusable element for that page).
 *
 * Hidden visually until focused (`sr-only` / `focus:not-sr-only`, the same
 * convention this repo already uses for screen-reader-only text elsewhere)
 * -- current visual design is otherwise completely unaffected.
 */
export function SkipToMainContentLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-[var(--shadow-elevated)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      דלג לתוכן הראשי
    </a>
  );
}

export { MAIN_CONTENT_ID };
