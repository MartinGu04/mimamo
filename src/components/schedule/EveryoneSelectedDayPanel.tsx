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

function RoleDetail({ label, role }: { label: string; role: ScheduleRoleStaffingView }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-2">{label}</p>
      {role.people.length > 0 ? (
        <ul className="mt-0.5 flex flex-wrap gap-x-1.5 gap-y-1 text-sm text-foreground">
          {role.people.map((person) => (
            <li key={person.key} className="inline-flex items-center gap-1">
              {person.name}
              {person.tentative ? <Badge tone="warning">משוער</Badge> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {role.message ? (
        <p
          className={`mt-0.5 text-sm font-medium ${
            role.status === "missing" ? "text-critical" : role.status === "partial" ? "text-warning" : "text-muted"
          }`}
        >
          {role.message}
        </p>
      ) : null}
    </div>
  );
}

function ShadowLine({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-muted">
      <span className="text-muted-2">{label}:</span> {names.join(", ")}
    </p>
  );
}

/**
 * A GENERIC (period-unspecified) role assignment, e.g. a weekend cell that
 * just says `אחמ"ש` -- rendered ONCE, here, outside both the day and night
 * `PeriodDetail` sections. Internally the assignment satisfies both
 * periods' coverage (see `ScheduleEveryoneDayView.genericSupervisorNames`'s
 * own doc comment), but showing the SAME name once under "יום" and again
 * under "לילה" would misrepresent one real assignment as two independent
 * shifts -- this is the single place it's ever shown.
 */
function GenericAssignmentLine({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <p className="text-sm font-medium text-foreground">
      <span className="text-muted-2">{label}:</span> {names.join(", ")}
    </p>
  );
}

function PeriodDetail({
  title,
  emoji,
  view,
}: {
  title: string;
  emoji: string;
  view: ScheduleEveryoneDayView["day"];
}) {
  const [supervisors, technicians] = view ? inRoleDisplayOrder(view) : [null, null];
  const [shadowSupervisorNames, shadowTechnicianNames] = view
    ? inRoleDisplayOrder({ supervisors: view.shadowSupervisorNames, technicians: view.shadowTechnicianNames })
    : [[], []];

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <span aria-hidden="true">{emoji}</span>
          {title}
        </h4>
        {view ? <CoverageBadge status={view.coverageStatus} /> : null}
      </div>

      {view && supervisors && technicians ? (
        <div className="mt-2 space-y-2">
          <RoleDetail label='אחמ"שים' role={supervisors} />
          <RoleDetail label="טכנאים" role={technicians} />
          <ShadowLine label='צל אחמ"ש' names={shadowSupervisorNames} />
          <ShadowLine label="צל טכנאי" names={shadowTechnicianNames} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">אין נתוני שיבוץ לתקופה זו.</p>
      )}
    </div>
  );
}

/**
 * "כולם" mode's selected-day detail (PR #24 §22) -- the FULL readable
 * picture for one date: day + night staffing (technicians/supervisors,
 * shadow/handover kept separate, explicit role-level coverage), then
 * duties and absences, only where relevant. This is deliberately where
 * all the detail lives -- the month grid cell next to it stays compact
 * (PR #24 §21).
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
          <div className="rounded-lg bg-overlay-soft px-3 py-2">
            <GenericAssignmentLine label='אחמ"ש (כל היום)' names={genericSupervisorNames} />
            <GenericAssignmentLine label="טכנאי (כל היום)" names={genericTechnicianNames} />
          </div>
        ) : null}

        <PeriodDetail title="יום" emoji="☀️" view={dayView?.day ?? null} />
        <PeriodDetail title="לילה" emoji="🌙" view={dayView?.night ?? null} />

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
