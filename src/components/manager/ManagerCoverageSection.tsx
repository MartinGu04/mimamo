import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
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

type RoleName = "supervisor" | "technician";

/** Every role's own fixed emoji + Hebrew label -- ONE mapping shared by every row/badge/note below, so a role can never be labeled inconsistently within one card. */
const ROLE_EMOJI: Record<RoleName, string> = { supervisor: "🧑‍✈️", technician: "🔧" };
const ROLE_LABEL: Record<RoleName, string> = { supervisor: 'אחמ"ש', technician: "טכנאי" };

/** At most this many rows show per day/night column before the rest collapse into a "+N more details" link into the full schedule view -- the card is allowed to grow to fit a normal day, but never to the point of dwarfing its neighbors in the grid on a truly packed one. */
const MAX_VISIBLE_ROWS_PER_PERIOD = 4;

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

/**
 * One assigned person, always "<role emoji> <role label> — <name>" -- the
 * role is never shown without who holds it (Design Pass: shift-personnel
 * redesign). `allDay` marks a name that's really the date's own all-day
 * (generic, period-unspecified) assignment shown again here for this
 * specific period -- see `AllDayBanner`'s own doc comment for why a little
 * duplication beats a day/night column that looks unstaffed.
 */
function AssignmentRow({ role, name, allDay = false }: { role: RoleName; name: string; allDay?: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5 rounded-md bg-[var(--calendar-row-bg)] px-[var(--calendar-row-px-compact)] py-[var(--calendar-row-py-compact)] text-xs ring-1 ring-[var(--calendar-row-border)]">
      <span aria-hidden="true">{ROLE_EMOJI[role]}</span>
      <span className="font-medium text-muted-2">{ROLE_LABEL[role]}</span>
      <span aria-hidden="true" className="text-muted-2">
        —
      </span>
      <span className="text-foreground">{name}</span>
      {allDay ? <Badge tone="primary">כל היום</Badge> : null}
    </li>
  );
}

/**
 * A shadow/handover assignment -- deliberately its own tinted, ringed pill
 * (never a plain text row) so it can never visually blend into the regular
 * personnel rows above it.
 */
function ShadowRow({ role, name }: { role: RoleName; name: string }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5 rounded-md bg-[var(--calendar-shadow-row-bg)] px-2 py-1 text-xs ring-1 ring-[var(--calendar-shadow-row-border)]">
      <span aria-hidden="true">🌘</span>
      <Badge tone="neutral">צל</Badge>
      <span className="font-medium text-muted-2">{ROLE_LABEL[role]}</span>
      <span aria-hidden="true" className="text-muted-2">
        —
      </span>
      <span className="text-foreground">{name}</span>
    </li>
  );
}

/**
 * A role's non-"full" coverage message (missing/partial/not_evaluable) --
 * always its own headed, bordered note block, never a bare paragraph sitting
 * directly under a person's name where it could look like it belongs to
 * them instead of describing the role's remaining gap. Only the SURFACE
 * (background/ring) follows the calendar's light-mode-polish tokens -- the
 * message's own warning/critical/muted text color is untouched, so a
 * "חסר טכנאי" note reads exactly as urgent as before.
 */
function RoleNote({ role, coverage }: { role: RoleName; coverage: ManagerRoleCoverageRowView }) {
  const toneClassName =
    coverage.status === "missing" ? "text-critical" : coverage.status === "partial" ? "text-warning" : "text-muted";
  return (
    <li className="rounded-md bg-[var(--calendar-note-bg)] px-2 py-1.5 ring-1 ring-[var(--calendar-note-border)]">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-2">
        <span aria-hidden="true">📝</span>
        {ROLE_LABEL[role]} · הערה
      </p>
      <p className={`mt-0.5 text-xs font-medium ${toneClassName}`}>{coverage.message}</p>
    </li>
  );
}

/**
 * The all-day (generic, period-unspecified) role assignment gets its OWN
 * emphasized surface -- a dedicated tinted, ringed banner, never just bold
 * text -- shown once above the day/night columns. `null` when this role has
 * no all-day assignment for the date.
 */
function AllDayBanner({ role, names }: { role: RoleName; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="rounded-lg bg-primary/10 px-2.5 py-2 ring-1 ring-primary/25">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
        <span aria-hidden="true">{ROLE_EMOJI[role]}</span>
        {ROLE_LABEL[role]} (כל היום)
      </p>
      <p className="mt-0.5 text-xs font-semibold text-foreground">{names.join(", ")}</p>
    </div>
  );
}

/**
 * Every row this ONE role contributes to a period: the date's all-day
 * assignment for this role FIRST (if any, tagged "כל היום") -- it's the
 * broader assignment, so it leads rather than trailing behind a period-
 * specific person and reading as secondary -- then its real, period-native
 * people, then its coverage note (if not fully covered) -- never a bare
 * label with nothing under it.
 */
function roleRows(role: RoleName, names: string[], coverage: ManagerRoleCoverageRowView, allDayNames: string[]): ReactNode[] {
  const rows: ReactNode[] = allDayNames.map((name, index) => (
    <AssignmentRow key={`${role}-allday-${index}`} role={role} name={name} allDay />
  ));
  names.forEach((name, index) => {
    rows.push(<AssignmentRow key={`${role}-${index}`} role={role} name={name} />);
  });
  if (coverage.message) {
    rows.push(<RoleNote key={`${role}-note`} role={role} coverage={coverage} />);
  }
  return rows;
}

/** Every row one day/night column would show, in full -- before the card's own visible-row cap is applied. */
function periodRows(
  period: "day" | "night",
  group: ManagerShiftGroupView | null,
  genericSupervisorNames: string[],
  genericTechnicianNames: string[],
): ReactNode[] {
  if (!group) return [];

  const [supervisorNames, technicianNames] = inRoleDisplayOrder({
    supervisors: group.supervisorNames,
    technicians: group.technicianNames,
  });
  const [supervisorCoverage, technicianCoverage] = inRoleDisplayOrder({
    supervisors: group.supervisorCoverage,
    technicians: group.technicianCoverage,
  });
  const [shadowSupervisorNames, shadowTechnicianNames] = inRoleDisplayOrder({
    supervisors: group.shadowSupervisorNames,
    technicians: group.shadowTechnicianNames,
  });
  const [genericForSupervisor, genericForTechnician] = inRoleDisplayOrder({
    supervisors: genericSupervisorNames,
    technicians: genericTechnicianNames,
  });

  return [
    ...roleRows("supervisor", supervisorNames, supervisorCoverage, genericForSupervisor),
    ...roleRows("technician", technicianNames, technicianCoverage, genericForTechnician),
    ...shadowSupervisorNames.map((name, index) => (
      <ShadowRow key={`${period}-shadow-supervisor-${index}`} role="supervisor" name={name} />
    )),
    ...shadowTechnicianNames.map((name, index) => (
      <ShadowRow key={`${period}-shadow-technician-${index}`} role="technician" name={name} />
    )),
  ];
}

/** Caps a period's rows at `MAX_VISIBLE_ROWS_PER_PERIOD` -- the rest collapse into a "+N more details" count rather than growing the card without bound. */
function truncateRows(rows: ReactNode[]): { visible: ReactNode[]; hiddenCount: number } {
  if (rows.length <= MAX_VISIBLE_ROWS_PER_PERIOD) return { visible: rows, hiddenCount: 0 };
  return { visible: rows.slice(0, MAX_VISIBLE_ROWS_PER_PERIOD), hiddenCount: rows.length - MAX_VISIBLE_ROWS_PER_PERIOD };
}

function PeriodColumn({
  emoji,
  periodLabel,
  group,
  rows,
  hiddenCount,
  moreHref,
}: {
  emoji: string;
  periodLabel: string;
  group: ManagerShiftGroupView | null;
  rows: ReactNode[];
  hiddenCount: number;
  moreHref: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[11px] font-medium text-muted-2">
          <span aria-hidden="true">{emoji}</span>
          {periodLabel}
        </p>
        {group ? <CoverageBadge status={group.coverageStatus} /> : null}
      </div>
      {group ? (
        rows.length > 0 ? <ul className="mt-2 space-y-1.5">{rows}</ul> : null
      ) : (
        <p className="mt-2 text-[11px] text-muted-2">אין נתוני שיבוץ</p>
      )}
      {hiddenCount > 0 ? (
        <Link href={moreHref} className="mt-1.5 inline-block text-[11px] font-medium text-primary hover:underline">
          +{hiddenCount} פרטים נוספים
        </Link>
      ) : null}
    </div>
  );
}

function DayCard({ view }: { view: ManagerShiftDayView }) {
  const status = worstCoverageStatus(view.day, view.night) ?? "full";
  const accent = CARD_ACCENT_CLASS[status];
  const moreHref = scheduleEveryoneHref({ date: view.date });

  const day = truncateRows(periodRows("day", view.day, view.genericSupervisorNames, view.genericTechnicianNames));
  const night = truncateRows(periodRows("night", view.night, view.genericSupervisorNames, view.genericTechnicianNames));

  return (
    <Panel variant="panel" glass={CARD_GLASS[status]} className={`flex flex-col gap-3 ${accent}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{view.dateLabel}</p>
        <Link href={moreHref} className="shrink-0 text-xs font-medium text-primary hover:underline">
          ללוח ←
        </Link>
      </div>
      {view.genericSupervisorNames.length > 0 || view.genericTechnicianNames.length > 0 ? (
        <div className="space-y-1.5 border-t border-border pt-3">
          <AllDayBanner role="supervisor" names={view.genericSupervisorNames} />
          <AllDayBanner role="technician" names={view.genericTechnicianNames} />
        </div>
      ) : null}
      <div className="flex gap-4 border-t border-border pt-3">
        <PeriodColumn
          emoji="☀️"
          periodLabel="יום"
          group={view.day}
          rows={day.visible}
          hiddenCount={day.hiddenCount}
          moreHref={moreHref}
        />
        <PeriodColumn
          emoji="🌙"
          periodLabel="לילה"
          group={view.night}
          rows={night.visible}
          hiddenCount={night.hiddenCount}
          moreHref={moreHref}
        />
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
 *
 * Each assignment is one row -- "<emoji> <role> — <name>" -- so a role is
 * never separated from who holds it (Design Pass: shift-personnel
 * redesign), an all-day role gets its own emphasized banner PLUS a
 * badge-tagged row inside whichever day/night column it covers (a little
 * duplication beats a column that reads as unstaffed), shadow assignments
 * are their own visually distinct pill, and a role's coverage gap is its
 * own note block rather than a bare line under the names above it. A very
 * busy column collapses its overflow into a "+N more details" link rather
 * than growing the card past its neighbors in the grid -- that link, and
 * the card's own "ללוח ←", both lead into the real team calendar
 * (`/schedule?person=all&date=...`, the existing manager-only Schedule
 * perspective), which shows that date's full detail -- never a second
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
