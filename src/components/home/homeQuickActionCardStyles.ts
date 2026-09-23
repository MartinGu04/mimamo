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
 */
export const QUICK_ACTION_CARD_CLASS =
  `flex h-full flex-1 flex-col items-start gap-1 rounded-lg bg-surface-1 p-4 text-start ring-1 ring-border ${glassClass("medium")} transition-[box-shadow,transform] duration-150 hover:ring-border-strong active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`.trim();
