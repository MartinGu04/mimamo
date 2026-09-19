/**
 * Invisible tap/click-area expansion for small icon-only controls (Phase 6
 * touch-target hardening) -- grows the ACTUAL hit-testable region past the
 * control's rendered box via an absolutely-positioned `::after` with no
 * background, so the visible size, spacing and hierarchy of the control
 * never change. This is mobile-usability hardening, not a compliance fix:
 * IS 5568 stays anchored to WCAG 2.0 AA, which has no minimum target-size
 * success criterion (that arrives only in WCAG 2.1 AAA / 2.2 AA) -- these
 * classes exist because small controls are genuinely hard to tap on a
 * phone, not because a specific px threshold is a legal requirement here.
 *
 * Two variants, chosen per control by how much room its neighbors leave:
 *
 * - `EXPAND_HIT_AREA_CLASS` grows every side and is for a control with
 *   clear space around it (a dialog's close button, a lone popover
 *   trigger) -- using it next to another interactive control less than
 *   ~12px away would make their hit areas overlap.
 * - `EXPAND_HIT_AREA_VERTICAL_CLASS` grows only up/down, for a control
 *   packed into a tight horizontal row (e.g. a mobile top bar's icon
 *   cluster) where side neighbors sit only a few px away -- vertical space
 *   is usually free even there.
 *
 * The host element needs `position: relative` (already true of every
 * control these are applied to) for the pseudo-element's `absolute`
 * positioning to anchor correctly, and no `overflow-hidden` ancestor
 * between it and the control, or the expansion is clipped away.
 */
export const EXPAND_HIT_AREA_CLASS = "after:absolute after:-inset-1.5 after:content-['']";

export const EXPAND_HIT_AREA_VERTICAL_CLASS = "after:absolute after:inset-x-0 after:-top-2 after:-bottom-2 after:content-['']";
