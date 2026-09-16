/**
 * The app's glass vocabulary -- three intensities of ONE material, plus an
 * explicit "no glass at all".
 *
 * The material itself (blur, saturation, tint, edges, depth, the
 * glass-in-glass guard, the small-viewport and reduced-transparency
 * behavior) lives entirely in `app/globals.css`. This module is only the
 * typed vocabulary components use to pick a level, so that "how much glass
 * does this surface get" is a design decision made in one readable place
 * per component -- never a pile of one-off blur/alpha values scattered
 * across feature code.
 *
 * Choosing a level:
 *
 * - `strong`  -- a focal, genuinely floating surface with room around it:
 *                the Hero ("what is happening to me now"), the shell's
 *                clock. Few of these per screen, by definition. More
 *                transparency, more blur, and the only level that carries
 *                the environmental accent tint.
 * - `medium`  -- ordinary standalone sections and primary cards. The
 *                default for a normal panel.
 * - `subtle`  -- dense information: lists, calendars, tables, secondary
 *                panels, manager tooling. Close to opaque; the glass is a
 *                material hint, never something the eye has to read past.
 * - `none`    -- surfaces where transparency would cost meaning or
 *                legibility: anything whose COLOR is the message (critical
 *                /warning/destructive states), inputs, and rows nested
 *                inside another surface.
 *
 * The bias throughout is restraint: a surface only moves UP a level when it
 * has real space around it and little text density. Everything else stays
 * where it reads best.
 */
export type GlassLevel = "strong" | "medium" | "subtle" | "none";

const GLASS_CLASS: Record<GlassLevel, string> = {
  strong: "glass-strong",
  medium: "glass-medium",
  subtle: "glass-subtle",
  none: "",
};

/**
 * The utility class for a level -- `""` for `none`, so callers can
 * interpolate the result unconditionally without emitting a stray class.
 */
export function glassClass(level: GlassLevel): string {
  return GLASS_CLASS[level];
}
