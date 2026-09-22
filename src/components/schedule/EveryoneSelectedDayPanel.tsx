import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { CoverageBadge } from "@/components/ui/CoverageBadge";
import { Panel } from "@/components/ui/Panel";
import { inRoleDisplayOrder } from "@/lib/presentation/roleCoverage";
import type { ScheduleEveryoneDayView, ScheduleRoleStaffingView } from "@/lib/presentation/scheduleEveryone";
import { SELECTED_DAY_PANEL_MIN_HEIGHT_CLASS } from "./CalendarSurface";
import type { DayMeta } from "./types";

interface EveryoneSelectedDayPanelProps {
  dayMeta: DayMeta | null;
  dayView: ScheduleEveryoneDayView | null;
}

type RoleName = "supervisor" | "technician";

/** Every role's own fixed emoji + Hebrew label -- ONE mapping shared by every row/badge/note below, so a role can never be labeled inconsistently within this panel. */
const ROLE_EMOJI: Record<RoleName, string> = { supervisor: "🧑‍✈️", technician: "🔧" };
const ROLE_LABEL: Record<RoleName, string> = { supervisor: 'אחמ"ש', technician: "טכנאי" };

/** Stand-in for a period with no `SchedulePeriodStaffingView` at all -- lets the row-building logic below treat "no data" and "data, but nobody in this particular role" identically, without a null check at every call site. */
const EMPTY_ROLE: ScheduleRoleStaffingView = { people: [], status: "not_evaluable", message: null };

/**
 * One assigned person, always "<role emoji> <role label> — <name>" -- the
 * role is never shown without who holds it, and never just an icon (Design
 * Pass: shift-personnel redesign). `allDay` marks a name that's really the
 * date's own all-day (generic, period-unspecified) assignment shown again
 * here for this specific period -- see the panel's own top-level doc
 * comment for why a little duplication beats a Day/Night section that
 * looks unstaffed. A non-all-day row instead carries `periodLabel` (e.g.
 * "לילה") -- it genuinely IS that period's own native assignment, so the
 * row can say so precisely (never on the all-day row, which is not
 * period-specific at all).
 */
function AssignmentRow({
  role,
  name,
  tentative = false,
  allDay = false,
  periodLabel,
}: {
  role: RoleName;
  name: string;
  tentative?: boolean;
  allDay?: boolean;
  periodLabel?: string;
}) {
  const label = allDay || !periodLabel ? ROLE_LABEL[role] : `${ROLE_LABEL[role]} ${periodLabel}`;
  return (
    <li className="flex flex-wrap items-center gap-1.5 text-sm">
      <span aria-hidden="true">{ROLE_EMOJI[role]}</span>
      <span className="font-medium text-muted-2">{label}</span>
      <span aria-hidden="true" className="text-muted-2">
        —
      </span>
      <span className="text-foreground">{name}</span>
      {tentative ? <Badge tone="warning">משוער</Badge> : null}
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
    <li className="flex flex-wrap items-center gap-1.5 rounded-md bg-overlay-soft px-2 py-1 text-sm ring-1 ring-border-strong">
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
 * them instead of describing the role's remaining gap.
 */
function RoleNote({
  role,
  message,
  status,
}: {
  role: RoleName;
  message: string;
  status: ScheduleRoleStaffingView["status"];
}) {
  const toneClassName = status === "missing" ? "text-critical" : status === "partial" ? "text-warning" : "text-muted";
  return (
    <li className="rounded-md bg-overlay-faint px-2.5 py-1.5 ring-1 ring-border">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-2">
        <span aria-hidden="true">📝</span>
        {ROLE_LABEL[role]} · הערה
      </p>
      <p className={`mt-0.5 text-sm font-medium ${toneClassName}`}>{message}</p>
    </li>
  );
}

/**
 * Every row this ONE role contributes to a period: the date's all-day
 * assignment for this role FIRST (if any, tagged "כל היום") -- it's the
 * broader assignment, so it leads rather than trailing behind a period-
 * specific person and reading as secondary -- then its real, period-native
 * people (each carrying this period's own label, e.g. "אחמ"ש לילה", and
 * tagged tentative if applicable), then its coverage note (if not fully
 * covered) -- never a bare label with nothing under it.
 */
function roleRows(
  role: RoleName,
  staffing: ScheduleRoleStaffingView,
  allDayNames: string[],
  periodLabel: string,
): ReactNode[] {
  const rows: ReactNode[] = allDayNames.map((name, index) => (
    <AssignmentRow key={`${role}-allday-${index}`} role={role} name={name} allDay />
  ));
  staffing.people.forEach((person) => {
    rows.push(<AssignmentRow key={person.key} role={role} name={person.name} tentative={person.tentative} periodLabel={periodLabel} />);
  });
  if (staffing.message) {
    rows.push(<RoleNote key={`${role}-note`} role={role} message={staffing.message} status={staffing.status} />);
  }
  return rows;
}

/**
 * The all-day (generic, period-unspecified) role assignment gets its OWN
 * emphasized surface -- a dedicated tinted, ringed banner, never just bold
 * text -- shown once above the Day/Night sections. `null` when this role has
 * no all-day assignment for the date.
 */
function AllDayAssignmentBanner({ role, names }: { role: RoleName; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <div className="rounded-lg bg-primary/10 px-3 py-2.5 ring-1 ring-primary/25">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
        <span aria-hidden="true">{ROLE_EMOJI[role]}</span>
        {ROLE_LABEL[role]} (כל היום)
      </p>
      <p className="mt-1 text-sm font-semibold text-foreground">{names.join(", ")}</p>
    </div>
  );
}

function PeriodDetail({
  title,
  emoji,
  view,
  genericSupervisorNames,
  genericTechnicianNames,
}: {
  title: string;
  emoji: string;
  view: ScheduleEveryoneDayView["day"];
  /** The date's all-day supervisor/technician names -- duplicated (badge-tagged) into this period's own rows, in addition to the shared banner above, so this section never reads as unstaffed just because nobody was assigned to THIS period specifically. */
  genericSupervisorNames: string[];
  genericTechnicianNames: string[];
}) {
  const [supervisors, technicians] = view ? inRoleDisplayOrder(view) : [EMPTY_ROLE, EMPTY_ROLE];
  const [shadowSupervisorNames, shadowTechnicianNames] = view
    ? inRoleDisplayOrder({ supervisors: view.shadowSupervisorNames, technicians: view.shadowTechnicianNames })
    : [[], []];
  const [genericForSupervisor, genericForTechnician] = inRoleDisplayOrder({
    supervisors: genericSupervisorNames,
    technicians: genericTechnicianNames,
  });

  const rows: ReactNode[] = [
    ...roleRows("supervisor", supervisors, genericForSupervisor, title),
    ...roleRows("technician", technicians, genericForTechnician, title),
    ...shadowSupervisorNames.map((name, index) => (
      <ShadowRow key={`shadow-supervisor-${index}`} role="supervisor" name={name} />
    )),
    ...shadowTechnicianNames.map((name, index) => (
      <ShadowRow key={`shadow-technician-${index}`} role="technician" name={name} />
    )),
  ];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <span aria-hidden="true">{emoji}</span>
          {title}
        </h4>
        {view ? <CoverageBadge status={view.coverageStatus} /> : null}
      </div>

      {view ? (
        rows.length > 0 ? <ul className="mt-2.5 space-y-2">{rows}</ul> : null
      ) : (
        <p className="mt-2.5 text-sm text-muted">אין נתוני שיבוץ לתקופה זו.</p>
      )}
    </div>
  );
}

/**
 * "כולם" mode's selected-day detail (PR #24 §22, redesigned for clearer
 * role-to-person association) -- the FULL readable picture for one date:
 * an emphasized all-day-leader banner (if any), then day + night staffing
 * as one clear row per assignment (never a role heading with nothing under
 * it), shadow/handover rows visually set apart from regular personnel, and
 * any partial/missing coverage note kept in its own block so it can never
 * be mistaken for belonging to the person listed above it. Then duties and
 * absences, only where relevant. This is deliberately where all the detail
 * lives -- the month grid cell next to it stays compact (PR #24 §21).
 */
export function EveryoneSelectedDayPanel({ dayMeta, dayView }: EveryoneSelectedDayPanelProps) {
  if (!dayMeta) return null;

  const duties = dayView?.duties ?? [];
  const absences = dayView?.absences ?? [];
  const genericSupervisorNames = dayView?.genericSupervisorNames ?? [];
  const genericTechnicianNames = dayView?.genericTechnicianNames ?? [];
  const hasGenericAssignment = genericSupervisorNames.length > 0 || genericTechnicianNames.length > 0;
  const itemCount = duties.length + absences.length;

  return (
    <section aria-label="פרטי היום הנבחר">
      {/* Same restrained sr-only day-change announcement as `SelectedDayPanel` (Phase 5 remediation) -- see its comment for the full reasoning. */}
      <p role="status" className="sr-only">
        {dayMeta.dateLabel}
        {itemCount > 0 ? `, ${itemCount} תורנויות והיעדרויות` : ""}
      </p>
      <Panel variant="panel" className={`flex flex-col gap-4 ${SELECTED_DAY_PANEL_MIN_HEIGHT_CLASS}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-base font-semibold text-foreground sm:text-lg">{dayMeta.dateLabel}</p>
          {dayMeta.holiday ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-overlay-soft px-2 py-0.5 text-xs font-medium text-foreground ring-1 ring-border">
              <span aria-hidden="true">{dayMeta.holiday.emoji}</span>
              {dayMeta.holiday.label}
            </span>
          ) : null}
        </div>

        {hasGenericAssignment ? (
          <div className="space-y-2">
            <AllDayAssignmentBanner role="supervisor" names={genericSupervisorNames} />
            <AllDayAssignmentBanner role="technician" names={genericTechnicianNames} />
          </div>
        ) : null}

        <PeriodDetail
          title="יום"
          emoji="☀️"
          view={dayView?.day ?? null}
          genericSupervisorNames={genericSupervisorNames}
          genericTechnicianNames={genericTechnicianNames}
        />
        <PeriodDetail
          title="לילה"
          emoji="🌙"
          view={dayView?.night ?? null}
          genericSupervisorNames={genericSupervisorNames}
          genericTechnicianNames={genericTechnicianNames}
        />

        {duties.length > 0 ? (
          <div>
            <h4 className="text-sm font-semibold text-foreground">תורנויות</h4>
            <ul className="mt-1 divide-y divide-border">
              {duties.map((duty) => (
                <li key={duty.key} className="flex items-center gap-2 py-1.5 text-sm">
                  {duty.emoji ? <span aria-hidden="true">{duty.emoji}</span> : null}
                  <span className="min-w-0 flex-1 truncate text-foreground">{duty.title}</span>
                  <span className="shrink-0 text-xs text-muted">{duty.personName}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {absences.length > 0 ? (
          <div>
            <h4 className="text-sm font-semibold text-foreground">היעדרויות</h4>
            <ul className="mt-1 divide-y divide-border">
              {absences.map((absence) => (
                <li key={absence.key} className="flex items-center gap-2 py-1.5 text-sm">
                  {absence.emoji ? <span aria-hidden="true">{absence.emoji}</span> : null}
                  <span className="min-w-0 flex-1 truncate text-foreground">{absence.personName}</span>
                  <span className="shrink-0 text-xs text-muted-2">{absence.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>
    </section>
  );
}
