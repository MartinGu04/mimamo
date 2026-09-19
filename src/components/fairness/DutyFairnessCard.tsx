import Link from "next/link";
import type { DutyStatusState } from "@/lib/presentation/fairness";
import type { DutyFairnessCardView } from "@/lib/presentation/fairnessCards";
import { Avatar } from "@/components/ui/Avatar";
import { DutyProgressBar } from "./DutyProgressBar";
import { FairnessMetric } from "./FairnessMetric";

/**
 * `"not_started"` gets a CALM NEUTRAL treatment (the same neutral tone
 * `FairnessStatusBadge` uses for its own "unavailable" state), deliberately
 * NOT the "below" warning tint -- "0 completed, nothing done yet" is a
 * plain fact, never a verdict that this person is already behind.
 * `"target_reached"`/`"target_exceeded"` share the same positive "above"
 * tint as `"ahead_of_pace"` -- reaching or exceeding a target is never
 * framed as a problem.
 */
const DUTY_STATUS_TINT_CLASSES: Record<DutyStatusState, string> = {
  not_started: "bg-overlay-soft text-muted ring-border-strong",
  below_pace: "bg-status-below-soft text-status-below ring-status-below-border",
  on_pace: "bg-status-balanced-soft text-status-balanced ring-status-balanced-border",
  ahead_of_pace: "bg-status-above-soft text-status-above ring-status-above-border",
  // Same calm neutral treatment as "not_started" -- suspended is a factual
  // state (Emergency Mode is active, pace judgment does not apply right
  // now), never a warning tint.
  suspended: "bg-overlay-soft text-muted ring-border-strong",
  target_reached: "bg-status-above-soft text-status-above ring-status-above-border",
  target_exceeded: "bg-status-above-soft text-status-above ring-status-above-border",
};

/**
 * A restrained status pill, DELIBERATELY separate from the shared
 * `FairnessStatusBadge` -- this "how are they doing" state
 * (`resolveDutyStatusState`, `lib/presentation/fairness.ts`) is its own
 * vocabulary, not the below/balanced/above target-exceedance one, so
 * reusing that badge's own Hebrew labels here would show the wrong words
 * for the right color. Deliberately no icon -- this is secondary context,
 * not a headline verdict.
 */
function DutyStatusBadge({ status, label }: { status: DutyStatusState; label: string }) {
  return (
    <span
      data-testid="metric-duty-pace"
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${DUTY_STATUS_TINT_CLASSES[status]}`}
    >
      {label}
    </span>
  );
}

/**
 * Duty Fairness's own three-question hierarchy -- what has this person
 * done, what were they expected to do, where do they stand -- rebuilt
 * around the redesign's core rule: "the workbook's own personal target =
 * planned target, actual validated schedule = actual completed work".
 * `completedAllocationTotal` (real, weighted completed duty work) vs.
 * `personalTargetTotal` (the workbook's own "ניקוד לפוטנציאל הנוכחי" value
 * for this person) is now the PRIMARY comparison this card shows --
 * progress bar, remaining points, and pace -- rather than the workbook's
 * role-based `comparisonTarget`/below-balanced-above status, which moves to
 * the detail overlay (`DutyFairnessDetail`) alongside the previous-period
 * delta. Neither `currentScore` nor the delta is deleted -- they're one
 * interaction deeper, per the redesign's "two information layers" rule
 * (note `currentScore` and `personalTargetTotal` are the SAME workbook
 * number -- see `DutyFairnessDetail`'s own docs).
 *
 * `hasTarget === false` (e.g. a `'ר"צ'`/"הסמכה" row with no deterministic
 * target) never renders a misleading 0%/empty progress bar -- it shows the
 * real completed-work total (which may itself be a real `0`) plus
 * `noTargetNoteLabel`, a calm explanation, never framed as a failure.
 *
 * A currently in-progress completion-based duty (`liveDutyLabel`) gets a
 * small, calm LIVE strip explaining why it isn't reflected in the total
 * yet -- never silently invisible.
 *
 * A row with no resolved `href` (unresolved source name) still renders in
 * full, just as a plain (non-clickable) card -- same convention as the
 * former `ManagerFairnessRow`.
 */
export function DutyFairnessCard({ view }: { view: DutyFairnessCardView }) {
  const content = (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={view.personName} size="xs" avatarUrl={view.avatarUrl} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{view.personName}</p>
            <p className="text-xs text-muted">{view.allocationLabel || "—"}</p>
          </div>
        </div>
        {view.dutyStatusLabel && view.dutyStatusState ? <DutyStatusBadge status={view.dutyStatusState} label={view.dutyStatusLabel} /> : null}
      </div>

      {view.liveDutyLabel ? (
        <div className="mt-2 flex flex-col gap-0.5 rounded-lg bg-status-above-soft px-2.5 py-2" data-testid="metric-duty-live">
          <span className="text-xs font-medium text-status-above">● LIVE · {view.liveDutyLabel}</span>
          <span className="text-[11px] text-muted-2">{view.liveDutySubLabel}</span>
        </div>
      ) : null}

      {view.hasTarget ? (
        <div className="mt-2 flex flex-col gap-1.5 rounded-lg bg-overlay-faint px-2.5 py-2">
          <div className="flex items-baseline justify-between gap-2">
            {/* `completed / target` is a bidi-neutral numeric expression (digits +
                "/"): inside this RTL page it has no strong character of its own to
                anchor its logical order, so the browser's bidi algorithm can visually
                reverse it to "target / completed". `dir="ltr"` isolates just this
                span (per the HTML spec's own `[dir] { unicode-bidi: isolate }` UA
                rule) so it always renders completed-before-target, while "נקודות"
                stays in the normal RTL flow around it. */}
            <span className="text-sm font-semibold text-foreground" data-testid="metric-duty-points">
              <span dir="ltr">
                {view.completedAllocationLabel} / {view.personalTargetLabel}
              </span>{" "}
              נקודות
            </span>
            <span className="text-xs font-medium text-muted-2" data-testid="metric-duty-progress-percent">
              {view.progressPercentLabel}
            </span>
          </div>
          <DutyProgressBar ratio={view.progressRatio ?? 0} />
          <span className="text-xs text-muted-2" data-testid="metric-duty-remaining">
            {view.beyondTargetLabel ? `${view.beyondTargetLabel} נקודות מעבר לפוטנציאל` : `${view.remainingLabel} נקודות נותרו`}
          </span>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-0.5 rounded-lg bg-overlay-faint px-2.5 py-2">
          <FairnessMetric testId="metric-duty-allocation" label="הקצאות שבוצעו" value={view.completedAllocationLabel} />
          {view.noTargetNoteLabel ? <span className="text-xs text-muted-2">{view.noTargetNoteLabel}</span> : null}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-1.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-2">
          <span data-testid="metric-duty-weekend" title={view.weekendSuspendedNote ?? undefined}>
            סופ&quot;שים <span className="font-medium text-muted">{view.weekendLabel}</span>
          </span>
        </div>
        {view.exemptionBadges.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1">
            {view.exemptionBadges.map((badge) => (
              <span
                key={badge}
                className="inline-flex items-center rounded-full bg-overlay-soft px-2 py-0.5 text-[11px] font-medium text-muted"
              >
                {badge}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );

  const className =
    "glass-subtle block rounded-xl bg-surface-1 p-3 ring-1 ring-border transition-colors duration-200" +
    (view.href ? " hover:bg-overlay-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" : "");

  if (view.href) {
    return (
      <li>
        <Link href={view.href} className={className}>
          {content}
        </Link>
      </li>
    );
  }

  return (
    <li>
      <div className={className}>{content}</div>
    </li>
  );
}
