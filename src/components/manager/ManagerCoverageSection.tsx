import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import type { GlassLevel } from "@/components/ui/glass";
import { CoverageBadge } from "@/components/ui/CoverageBadge";
import type { CoverageStatus } from "@/lib/domain/shiftCoverage";
import { inRoleDisplayOrder } from "@/lib/presentation/roleCoverage";
import { scheduleEveryoneHref } from "@/lib/presentation/scheduleUrl";
import type { ManagerRoleCoverageRowView, ManagerShiftDayView, ManagerShiftGroupView } from "./types";

interface ManagerCoverageSectionProps {
  days: ManagerShiftDayView[];
}

const ROLE_TONE_CLASS: Record<ManagerRoleCoverageRowView["status"], string> = {
  full: "text-[11px] text-muted",
  partial: "text-xs font-medium text-warning",
  missing: "text-xs font-medium text-critical",
  not_evaluable: "text-[11px] text-muted",
};

/** The stronger of a day's two period statuses -- decides the card's own accent border, so a problem is visible before reading a single name. `null` when the date has no shift data for either period at all. */
function worstCoverageStatus(day: ManagerShiftGroupView | null, night: ManagerShiftGroupView | null): CoverageStatus | null {
  const statuses = [day?.coverageStatus, night?.coverageStatus].filter((status): status is CoverageStatus => status !== undefined);
  if (statuses.includes("missing")) return "missing";
  if (statuses.includes("partial")) return "partial";
  if (statuses.length === 0) return null;
  return statuses.includes("not_evaluable") ? "not_evaluable" : "full";
}

const CARD_ACCENT_CLASS: Record<CoverageStatus, string> = {
  full: "",
  not_evaluable: "",
  partial: "border-s-2 border-s-warning",
  missing: "border-s-2 border-s-critical",
};

/**
 * A day card's glass level follows its COVERAGE STATUS, not its position on
 * the page -- the one place in the app where the material is chosen from
 * data rather than from a component's role.
 *
 * A quiet, fully-covered date is just another cell in a dense grid, so it
 * takes the same restrained `subtle` the rest of the manager surfaces use.
 * A date carrying a real staffing problem drops the material entirely: its
 * accent border and its badge are the whole point of the card, and a
 * translucent surface would let whatever the SATCOM canvas is doing behind
 * it dilute exactly the signal a manager is scanning for. A warning has to
 * look equally urgent over an empty patch of sky and over the dish.
 */
const CARD_GLASS: Record<CoverageStatus, GlassLevel> = {
  full: "subtle",
  not_evaluable: "subtle",
  partial: "none",
  missing: "none",
};

function ShadowList({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="text-[11px] text-muted">
      <span className="text-muted-2">{label}:</span> {names.join(", ")}
    </p>
  );
}

/**
 * A GENERIC (period-unspecified) role assignment, e.g. a weekend cell that
 * just says `אחמ"ש` -- rendered ONCE per date card, above the day/night
 * `PeriodColumn`s. Internally the assignment satisfies both periods'
 * coverage (see `ManagerShiftDayView.genericSupervisorNames`'s own doc
 * comment), but listing the SAME name in the day column AND the night
 * column would misrepresent one real assignment as two independent
 * shifts -- this is the single place it's ever shown.
 */
function GenericAssignmentLine({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="text-xs text-muted">
      <span className="text-muted-2">{label}:</span> {names.join(", ")}
    </p>
  );
}

/**
 * One role's explicit coverage line -- "טכנאים: X, Y" when full (calm,
 * names only); "חסר טכנאי" / "כיסוי טכנאי חלקי · 05:30–07:30" / "לא ניתן
 * להעריך כיסוי טכנאי" otherwise -- NEVER inferred from an empty name list,
 * always the domain-derived `roleCoverage` diagnostic message.
 */
function RoleCoverageLine({
  roleLabel,
  names,
  coverage,
}: {
  roleLabel: string;
  names: string[];
  coverage: ManagerRoleCoverageRowView;
}) {
  if (coverage.status === "full") {
    if (names.length === 0) return null;
    return (
      <p className="text-[11px] text-muted">
        <span className="text-muted-2">{roleLabel}:</span> {names.join(", ")}
      </p>
    );
  }

  return (
    <p className={ROLE_TONE_CLASS[coverage.status]}>
      {coverage.message}
      {names.length > 0 ? <span className="text-muted-2"> · {names.join(", ")}</span> : null}
    </p>
  );
}

function PeriodColumn({ emoji, periodLabel, group }: { emoji: string; periodLabel: string; group: ManagerShiftGroupView | null }) {
  const [supervisorRole, technicianRole] = group
    ? inRoleDisplayOrder({
        supervisors: { label: "אחמ״שים", names: group.supervisorNames, coverage: group.supervisorCoverage },
        technicians: { label: "טכנאים", names: group.technicianNames, coverage: group.technicianCoverage },
      })
    : [null, null];
  const [shadowSupervisorNames, shadowTechnicianNames] = group
    ? inRoleDisplayOrder({ supervisors: group.shadowSupervisorNames, technicians: group.shadowTechnicianNames })
    : [[], []];

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[11px] font-medium text-muted-2">
          <span aria-hidden="true">{emoji}</span>
          {periodLabel}
        </p>
        {group ? <CoverageBadge status={group.coverageStatus} /> : null}
      </div>
      {group && supervisorRole && technicianRole ? (
        <div className="mt-1.5 space-y-1">
          <RoleCoverageLine roleLabel={supervisorRole.label} names={supervisorRole.names} coverage={supervisorRole.coverage} />
          <RoleCoverageLine roleLabel={technicianRole.label} names={technicianRole.names} coverage={technicianRole.coverage} />
          <ShadowList label='צל אחמ״ש' names={shadowSupervisorNames} />
          <ShadowList label="צל טכנאי" names={shadowTechnicianNames} />
        </div>
      ) : (
        <p className="mt-1.5 text-[11px] text-muted-2">אין נתוני שיבוץ</p>
      )}
    </div>
  );
}

function DayCard({ view }: { view: ManagerShiftDayView }) {
  const status = worstCoverageStatus(view.day, view.night) ?? "full";
  const accent = CARD_ACCENT_CLASS[status];

  return (
    <Panel variant="panel" glass={CARD_GLASS[status]} className={`flex flex-col gap-2.5 ${accent}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{view.dateLabel}</p>
        <Link
          href={scheduleEveryoneHref({ date: view.date })}
          className="shrink-0 text-xs font-medium text-primary hover:underline"
        >
          ללוח ←
        </Link>
      </div>
      {view.genericSupervisorNames.length > 0 || view.genericTechnicianNames.length > 0 ? (
        <div className="border-t border-border pt-2.5">
          <GenericAssignmentLine label='אחמ״ש (כל היום)' names={view.genericSupervisorNames} />
          <GenericAssignmentLine label="טכנאי (כל היום)" names={view.genericTechnicianNames} />
        </div>
      ) : null}
      <div className="flex gap-4 border-t border-border pt-2.5">
        <PeriodColumn emoji="☀️" periodLabel="יום" group={view.day} />
        <PeriodColumn emoji="🌙" periodLabel="לילה" group={view.night} />
      </div>
    </Panel>
  );
}

/**
 * "משמרות" category's coverage picture -- the selected range's shifts as a
 * compact grid of per-date cards (redesign), day+night paired side by side
 * in EACH card instead of one full-width card per date+period (which, at
 * 30d/month ranges, used to mean 40-60+ stacked full-width panels with no
 * shape to scan). Every date with shift data still appears -- this is the
 * FULL picture for the range, never filtered down to problems only (that
 * job belongs to "דורש טיפול" in Overview) -- just laid out so the manager
 * can understand the period at a glance: a problem date's card carries a
 * visible amber/critical accent border, a fully-covered date stays quiet.
 * Each card links straight into the real team calendar
 * (`/schedule?person=all&date=...`, the existing manager-only Schedule
 * perspective) for that specific date's full detail -- never a second
 * calendar implementation here.
 */
export function ManagerCoverageSection({ days }: ManagerCoverageSectionProps) {
  if (days.length === 0) {
    return (
      <Panel variant="compact" className="text-sm text-muted">
        אין משמרות בטווח שנבחר.
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {days.map((view) => (
        <DayCard key={view.key} view={view} />
      ))}
    </div>
  );
}
