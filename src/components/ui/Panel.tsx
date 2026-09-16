import type { ReactNode } from "react";
import { glassClass, type GlassLevel } from "./glass";

type PanelVariant = "hero" | "panel" | "compact" | "inline" | "critical";

interface PanelProps {
  variant?: PanelVariant;
  /**
   * Overrides the variant's default glass level (see
   * `DEFAULT_GLASS_BY_VARIANT`). Set this wherever a surface's CONTEXT
   * disagrees with its variant -- a `panel` holding a month grid wants
   * `subtle`, a `compact` card that is the page's one call to action wants
   * `medium`. Passing `none` opts a surface out of the material entirely.
   */
  glass?: GlassLevel;
  className?: string;
  children: ReactNode;
  "data-testid"?: string;
}

const VARIANT_CLASSES: Record<PanelVariant, string> = {
  hero: "rounded-xl bg-surface-2 ring-1 ring-border-strong p-6 sm:p-7",
  panel: "rounded-xl bg-surface-1 ring-1 ring-border p-5",
  compact: "rounded-lg bg-surface-1 ring-1 ring-border p-4",
  inline: "rounded-lg bg-overlay-faint ring-1 ring-border p-3",
  critical: "rounded-xl bg-surface-critical ring-1 ring-surface-critical-border p-5",
};

/**
 * How much glass each variant gets when the call site doesn't say
 * otherwise. The mapping follows the variants' own existing meanings
 * rather than inventing a second hierarchy beside them:
 *
 * - `hero` leads its page and has space around it -- the one variant that
 *   can carry `strong` without competing with anything.
 * - `panel` is the ordinary standalone section -- `medium`.
 * - `compact` is denser secondary content -- `subtle`.
 * - `inline` exists specifically to sit INSIDE another surface, so it
 *   never gets its own material (the CSS glass-in-glass guard would strip
 *   the blur anyway; this keeps the intent explicit in the component).
 * - `critical` is a surface whose COLOR is the message. Tinting a warning
 *   with whatever happens to be behind it is exactly how a warning stops
 *   reading as one, so it stays fully opaque -- always, with no override
 *   offered anywhere in the app.
 *
 * A default is only ever a starting point: several call sites deliberately
 * move down a level (the calendar, manager tooling, the dashboard's denser
 * side column) and one moves up (the Report 1 action).
 */
const DEFAULT_GLASS_BY_VARIANT: Record<PanelVariant, GlassLevel> = {
  hero: "strong",
  panel: "medium",
  compact: "subtle",
  inline: "none",
  critical: "none",
};

/**
 * The app's surface vocabulary -- deliberately not one repeated rounded
 * rectangle. `hero` for the primary now/next state, `panel` for standalone
 * sections, `compact` for denser secondary content, `inline` for small
 * embedded status rows (a single counterpart, a timeline item), `critical`
 * for a section that itself IS the critical finding (not just an icon/badge
 * inside an otherwise-neutral panel).
 *
 * Every variant keeps its opaque `bg-surface-*` + `ring` classes whatever
 * the glass level is: the material is applied on top of them by an
 * `@supports`-gated rule (see `globals.css`), so a browser without
 * backdrop-filter renders the original opaque surface rather than a
 * degraded approximation of a glass one.
 */
export function Panel({
  variant = "panel",
  glass,
  className = "",
  children,
  "data-testid": dataTestId,
}: PanelProps) {
  // `critical` is never negotiable -- a passed `glass` is ignored rather
  // than trusted, so no future call site can quietly make a warning
  // translucent.
  const level = variant === "critical" ? "none" : (glass ?? DEFAULT_GLASS_BY_VARIANT[variant]);

  return (
    <div
      className={`${VARIANT_CLASSES[variant]} ${glassClass(level)} ${className}`.replace(/\s+/g, " ").trim()}
      data-testid={dataTestId}
    >
      {children}
    </div>
  );
}
