import Link from "next/link";
import type { ShiftFairnessCardView } from "@/lib/presentation/fairnessCards";
import { Avatar } from "@/components/ui/Avatar";
import { FairnessMetric } from "./FairnessMetric";
import { FairnessStatusBadge, fairnessStatusTintTextClass } from "./FairnessStatusBadge";
import { ShiftFairnessCardInfo } from "./ShiftFairnessCardInfo";

/**
 * One Shift Fairness person card (PR #4 §11, redesigned PR #51 follow-up,
 * badge/explanation clarity pass, whole-shift fair-range pass) -- name +
 * status + ONE card-level info control, then a compact self-explanatory
 * metric grid (משמרות שביצעת / צפי הוגן / מצב, the gap tinted with the same
 * restrained status color as the badge), then a smaller secondary
 * weekend-context row, in that hierarchy. A `null` target/status never
 * renders as "0"/"מאוזן" -- `unavailableNote` replaces the whole metric
 * grid with a calm, honest sentence instead, while `actualLabel` (always a
 * real, confirmed number) stays visible regardless. No generic "partial
 * data" badge -- the note IS the only incompleteness signal, shown only
 * when it materially matters.
 *
 * A person cannot actually work half a shift, so this card never shows the
 * engine's raw fractional target ("5.5") or a fractional gap ("+2.5
 * shifts") as a primary figure -- `view.targetLabel` is a whole-shift
 * RANGE ("5–6"), and `view.statusLabel`/`view.statusStateLabel` reason
 * about that range (`lib/presentation/shiftFairRange.ts`), never a raw
 * signed number. `צפי` ("expected") stays the deliberate word choice
 * everywhere on this card, including the top badge -- it is this person's
 * ADJUSTED EXPECTATION UP TO TODAY (opportunity-share of the group's real
 * work, shaped by their own recorded availability/absences), never a
 * fixed monthly "יעד"/target. `statusExplanationLabel` adds one further
 * plain sentence under the status row spelling out what the range status
 * means in terms of availability, never effort ("worked harder").
 *
 * `ShiftFairnessCardInfo` is the single explanatory affordance for every
 * metric on this card -- deliberately not one info icon per metric.
 *
 * STRUCTURE (PR #51 follow-up): the visible card content sits in a plain
 * `<div>`, with the navigable `<Link>` as an absolutely-positioned overlay
 * spanning the whole card -- NOT a wrapper around the content -- so
 * `ShiftFairnessCardInfo`'s real `<button>` is a SIBLING of the Link,
 * never a descendant. A `<button>` nested inside an `<a>` is invalid,
 * inaccessible interactive-in-interactive markup; this "stretched link"
 * shape keeps the whole card clickable/tappable exactly as before while
 * the info control's own higher z-index lets it (and its popover) receive
 * clicks instead of the Link underneath, at the same spot it's always
 * visually been.
 */
export function ShiftFairnessCard({ view }: { view: ShiftFairnessCardView }) {
  return (
    <li className="relative">
      <div className="glass-subtle rounded-xl bg-surface-1 p-4 ring-1 ring-border">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar name={view.personName} size="xs" avatarUrl={view.avatarUrl} />
            <p className="min-w-0 truncate text-sm font-semibold text-foreground">{view.personName}</p>
            <ShiftFairnessCardInfo />
          </div>
          <FairnessStatusBadge status={view.status} label={view.statusLabel} />
        </div>

        {view.unavailableNote ? (
          <p className="mt-3 text-xs leading-relaxed text-muted">
            <span className="font-medium text-foreground">משמרות שביצעת: {view.actualLabel}</span> · {view.unavailableNote}
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2 rounded-lg bg-overlay-faint px-3 py-2.5">
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              <FairnessMetric testId="metric-shift-actual" label="משמרות שביצעת" value={view.actualLabel} />
              <div className="flex min-w-0 flex-col gap-0.5" data-testid="metric-shift-target">
                <span className="text-xs leading-tight text-muted-2">{view.targetPeriodLabel}</span>
                <span className="truncate text-sm font-semibold text-foreground">
                  {view.targetLabel !== null ? `${view.targetLabel} משמרות` : "—"}
                </span>
                {view.expectationFactorLabel ? (
                  <span className="truncate text-[11px] leading-tight text-muted-2">{view.expectationFactorLabel}</span>
                ) : null}
              </div>
            </div>
            {/* Full-width status row -- a human-readable phrase (e.g. "מעט מעל הצפי") needs more room than a compact grid cell can reliably give it, especially on narrow mobile widths, so it gets its own row rather than truncating. */}
            <div className="flex min-w-0 flex-col gap-0.5 border-t border-border pt-1.5" data-testid="metric-shift-status-state">
              <span className="text-xs leading-tight text-muted-2">מצב</span>
              <span className={`text-sm font-semibold ${fairnessStatusTintTextClass(view.status)}`}>{view.statusStateLabel}</span>
              {view.statusExplanationLabel ? (
                <span className="text-[11px] leading-relaxed text-muted-2" data-testid="metric-shift-status-explanation">
                  {view.statusExplanationLabel}
                </span>
              ) : null}
            </div>
          </div>
        )}

        <div className="mt-2 flex items-center gap-4 border-t border-border pt-2 text-xs text-muted-2">
          <span data-testid="metric-shift-weekend-actual">
            סופ&quot;שים <span className="font-medium text-muted">{view.weekendActualLabel}</span>
          </span>
        </div>
      </div>

      {/* Stretched-link overlay: covers the whole card (z-10), so clicking/
          tapping anywhere except the elevated info control (z-20) navigates
          to the person detail. Transparent, with its own hover/focus tint
          since it -- not the content div above -- is the top layer. */}
      <Link
        href={view.href}
        aria-label={view.personName}
        className="absolute inset-0 z-10 rounded-xl transition-colors duration-200 hover:bg-overlay-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      />
    </li>
  );
}
