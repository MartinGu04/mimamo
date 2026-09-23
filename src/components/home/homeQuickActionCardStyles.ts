import { glassClass } from "@/components/ui/glass";

/**
 * Shared chrome for a Home "quick action" card -- the same surface
 * vocabulary `Panel`'s own `compact` variant uses (`rounded-lg
 * bg-surface-1 ring-1 ring-border`, `medium` glass -- the elevated level
 * the Report 1 action already had, see `Panel`'s own docs), plus the
 * whole-card interactive treatment every quick action needs here: the
 * ENTIRE card is the clickable target (never a nested button/link inside
 * it), same established pattern as `IssuesPanel`'s whole-card `Link`.
 * `hover:ring-border-strong` (never a background tint) is deliberate --
 * a background change would fight the glass material sitting on top of
 * it, so only the ring/outline steps up on hover, same as
 * `DischargeEveryoneOverview`'s own whole-card `Link`.
 *
 * Sizing (layout refinement pass): no `flex-1`/`flex-grow` here, and a
 * fixed `sm:w-56` at the `sm:flex-row` breakpoint `HomeQuickActions`
 * switches to -- a card that grows to fill half its (potentially wide)
 * desktop row reads as one banner cut in two, with a lot of dead space
 * around short content. A fixed width shared by BOTH cards keeps them
 * equal-sized (never content-length-dependent) and genuinely compact,
 * like a navigation tile rather than a stretched panel; the parent row
 * has no `justify-between`/`w-full` pulling them apart, so the pair packs
 * naturally at the row's start (the right edge, under this app's RTL
 * document direction) instead of spanning the full content column.
 * `h-full` is intentionally gone too -- `HomeQuickActions`' own
 * `sm:items-stretch` (flexbox's own default cross-axis behavior) already
 * equalizes card height in the row; below `sm:`, the column layout's
 * default `align-items: stretch` is what makes each card fill the
 * available mobile width, with no width class needed there at all.
 */
export const QUICK_ACTION_CARD_CLASS =
  `flex flex-col items-start gap-1 rounded-lg bg-surface-1 p-4 text-start ring-1 ring-border ${glassClass("medium")} transition-[box-shadow,transform] duration-150 hover:ring-border-strong active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-56`.trim();
