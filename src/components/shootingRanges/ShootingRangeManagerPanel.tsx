"use client";

import { useMemo, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { formatReportOneDateDot, formatReportOneDateSlash } from "@/lib/presentation/reportOneFormat";
import { presentQualificationStatus } from "@/lib/presentation/shootingRangeStatus";
import type { ManagerShootingRangeRow, ManagerShootingRangeSummary, ManagerPendingSelfReportRow } from "@/lib/readModels/buildShootingRangeManagerReadModel";
import {
  approveSelfReportShootingRangeAction,
  confirmPlannedShootingRangeAction,
  createPlannedShootingRangeAction,
  rejectSelfReportShootingRangeAction,
} from "@/lib/shootingRanges/actions";

export interface ShootingRangeManagerPanelProps {
  summary: ManagerShootingRangeSummary;
  rows: ManagerShootingRangeRow[];
  pendingSelfReports: ManagerPendingSelfReportRow[];
  roster: { id: string; name: string }[];
  /** Count of "מטווחים" sheet rows that never resolved to exactly one eligible person (a name mismatch or ambiguity) -- see `buildShootingRangeManagerReadModel`'s own docs. `0` renders nothing. */
  unresolvedSheetRowCount: number;
  /** The raw `sourceName` text of each row counted in `unresolvedSheetRowCount`, verbatim -- rendered so a manager can visually compare it against כ"א themselves. */
  unresolvedSheetRowNames: string[];
}

function UnresolvedSheetRowsNotice({ count, names }: { count: number; names: string[] }) {
  if (count === 0) return null;
  return (
    <Panel variant="inline" className="flex flex-col gap-1 text-sm text-warning">
      <span>
        ⚠️ {count} {count === 1 ? "שורה בגיליון" : "שורות בגיליון"} &quot;מטווחים&quot; לא שויכ{count === 1 ? "ה" : "ו"} לאיש/אנשי
        צוות מוכר/ים -- ייתכן שהשם בגיליון שונה מהשם ברשימת כ&quot;א.
      </span>
      <ul className="list-disc pr-5 text-xs">
        {names.map((name, index) => (
          <li key={`${name}-${index}`}>&quot;{name}&quot;</li>
        ))}
      </ul>
    </Panel>
  );
}

function StatusBadge({ status }: { status: ManagerShootingRangeRow["status"] }) {
  const presentation = presentQualificationStatus(status);
  return <Badge tone={presentation.badgeTone}>{presentation.label}</Badge>;
}

function SummaryTiles({ summary }: { summary: ManagerShootingRangeSummary }) {
  return (
    <div className={`grid gap-3 ${summary.notRelevantCount > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
      <Panel variant="compact" className="text-center">
        <p className="text-2xl font-bold text-success">{summary.qualifiedCount}</p>
        <p className="text-xs text-muted">כשירים</p>
      </Panel>
      <Panel variant="compact" className="text-center">
        <p className="text-2xl font-bold text-warning">{summary.nearingExpiryCount}</p>
        <p className="text-xs text-muted">עומדים לפוג</p>
      </Panel>
      <Panel variant="compact" className="text-center">
        <p className="text-2xl font-bold text-critical">{summary.notQualifiedCount}</p>
        <p className="text-xs text-muted">לא כשירים</p>
      </Panel>
      {summary.notRelevantCount > 0 ? (
        <Panel variant="compact" className="text-center">
          <p className="text-2xl font-bold text-muted-2">{summary.notRelevantCount}</p>
          <p className="text-xs text-muted">לא רלוונטיים</p>
        </Panel>
      ) : null}
    </div>
  );
}

function SelfReportQueue({ reports }: { reports: ManagerPendingSelfReportRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (reports.length === 0) return null;

  function decide(id: string, approve: boolean) {
    setBusyId(id);
    startTransition(async () => {
      await (approve ? approveSelfReportShootingRangeAction(id) : rejectSelfReportShootingRangeAction(id));
      setBusyId(null);
    });
  }

  return (
    <Panel variant="panel" glass="subtle" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">דיווחים ממתינים לאישור</h2>
      <ul className="flex flex-col gap-2">
        {reports.map((report) => (
          <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-overlay-faint p-2 text-sm">
            <span className="text-foreground">{report.personName}</span>
            <span className="text-muted">{formatReportOneDateSlash(report.performedOn)}</span>
            {report.notes ? <span className="text-xs text-muted-2">{report.notes}</span> : null}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isPending && busyId === report.id}
                onClick={() => decide(report.id, true)}
                className="rounded-md bg-success/10 px-2.5 py-1 text-xs font-medium text-success ring-1 ring-success/25 hover:bg-success/20"
              >
                אשר
              </button>
              <button
                type="button"
                disabled={isPending && busyId === report.id}
                onClick={() => decide(report.id, false)}
                className="rounded-md bg-critical/10 px-2.5 py-1 text-xs font-medium text-critical ring-1 ring-critical/25 hover:bg-critical/20"
              >
                דחה
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PendingConfirmationPanel({ rangeDate, rows }: { rangeDate: string; rows: ManagerShootingRangeRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(rows.map((row) => row.personId)));
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <Panel variant="panel" className="text-sm text-success">
        אושר עבור {selected.size} אנשים.
      </Panel>
    );
  }

  function toggle(personId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  return (
    <Panel variant="critical" className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">
        🎯 מטווח {formatReportOneDateSlash(rangeDate) ?? rangeDate} -- {rows.length} משובצים
      </h3>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <label key={row.personId} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-overlay-soft">
            <input type="checkbox" checked={selected.has(row.personId)} onChange={() => toggle(row.personId)} className="h-4 w-4" />
            <span className="text-foreground">{row.personName}</span>
          </label>
        ))}
      </ul>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await confirmPlannedShootingRangeAction(rangeDate, [...selected]);
            setDone(true);
          })
        }
        className="self-start rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-strong disabled:opacity-50"
      >
        אשר ביצוע ל-{selected.size} אנשים
      </button>
    </Panel>
  );
}

/**
 * Mobile (below `sm`): a stacked, readable layout -- avatar+name on their
 * own first line, the status badge on its own second line, then
 * metadata/reason and any planned-range/pending-report badges each on
 * their own wrapped line below. Desktop (`sm` and up) is UNCHANGED from
 * before this responsive pass: every field becomes a flex item of the same
 * single-line, wrapping row it always was, via `sm:contents` on the
 * grouping wrappers below -- `display: contents` makes a wrapper box
 * disappear at that breakpoint so its children re-parent directly into the
 * outer `<li>`'s flex row, with no duplicated markup and no reordering.
 * Only the avatar+name pair needs a wrapper at all (the only two fields
 * that must render as one unit on mobile) -- every other field is already
 * a direct `<li>` child, so on mobile (`flex-col`) it's naturally its own
 * line with zero extra markup.
 */
function TeamMemberRow({ row }: { row: ManagerShootingRangeRow }) {
  const isNotRelevant = row.status === "not_relevant";
  return (
    <li className="flex flex-col gap-2 rounded-lg bg-overlay-faint p-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sm:p-2">
      <div className="flex items-center gap-3 sm:contents">
        <Avatar name={row.personName} size="sm" avatarUrl={row.avatarUrl} />
        <span className="min-w-0 flex-1 truncate text-foreground">{row.personName}</span>
      </div>
      <StatusBadge status={row.status} />
      {isNotRelevant ? (
        row.notRelevantReason ? <span className="text-xs text-muted-2">{row.notRelevantReason}</span> : null
      ) : (
        <div className="flex flex-col gap-0.5 sm:contents">
          <span className="text-xs text-muted-2">{row.baselineDate ? `אחרון: ${formatReportOneDateSlash(row.baselineDate)}` : "אין נתונים"}</span>
          {row.expiryDate ? <span className="text-xs text-muted-2">תוקף: {formatReportOneDateSlash(row.expiryDate)}</span> : null}
        </div>
      )}
      {row.plannedRange || row.hasPendingSelfReport ? (
        <div className="flex flex-wrap gap-2 sm:contents">
          {row.plannedRange ? (
            <Badge tone={row.plannedRange.status === "pending_confirmation" ? "critical" : "neutral"}>
              {row.plannedRange.status === "pending_confirmation" ? "ממתין לאישור" : `🎯 ${formatReportOneDateDot(row.plannedRange.rangeDate)}`}
            </Badge>
          ) : null}
          {row.hasPendingSelfReport ? <Badge tone="warning">דיווח ממתין</Badge> : null}
        </div>
      ) : null}
    </li>
  );
}

function RoleGroupSection({ title, rows }: { title: string; rows: ManagerShootingRangeRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted">{title}</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <TeamMemberRow key={row.personId} row={row} />
        ))}
      </ul>
    </div>
  );
}

function CreatePlannedRangeForm({ roster }: { roster: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [rangeDate, setRangeDate] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState<number | null>(null);

  const filteredRoster = useMemo(
    () => roster.filter((person) => person.name.includes(query.trim())),
    [roster, query],
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-strong"
      >
        שיבוץ מטווח חדש
      </button>
    );
  }

  return (
    <Panel variant="compact" className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-foreground">שיבוץ מטווח חדש</p>
      <label className="flex flex-col gap-1 text-xs text-muted">
        תאריך מטווח
        <input type="date" value={rangeDate} onChange={(e) => setRangeDate(e.target.value)} className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-foreground" />
      </label>
      <input
        type="text"
        placeholder="חיפוש שם"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-foreground"
      />
      <div className="max-h-48 overflow-y-auto rounded-lg ring-1 ring-border">
        {filteredRoster.map((person) => (
          <label key={person.id} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-overlay-soft">
            <input
              type="checkbox"
              checked={selected.has(person.id)}
              onChange={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(person.id)) next.delete(person.id);
                  else next.add(person.id);
                  return next;
                })
              }
              className="h-4 w-4"
            />
            <span className="text-foreground">{person.name}</span>
          </label>
        ))}
      </div>
      {done !== null ? <p className="text-sm text-success">שובצו {done} אנשים.</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending || !rangeDate || selected.size === 0}
          onClick={() =>
            startTransition(async () => {
              const result = await createPlannedShootingRangeAction(rangeDate, [...selected]);
              if (result.ok) setDone(result.scheduledCount ?? 0);
            })
          }
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-strong disabled:opacity-50"
        >
          שבץ {selected.size || ""}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground">
          ביטול
        </button>
      </div>
    </Panel>
  );
}

export function ShootingRangeManagerPanel({
  summary,
  rows,
  pendingSelfReports,
  roster,
  unresolvedSheetRowCount,
  unresolvedSheetRowNames,
}: ShootingRangeManagerPanelProps) {
  const [attentionOnly, setAttentionOnly] = useState(false);

  const pendingConfirmationByDate = useMemo(() => {
    const map = new Map<string, ManagerShootingRangeRow[]>();
    for (const row of rows) {
      if (row.plannedRange?.status !== "pending_confirmation") continue;
      const group = map.get(row.plannedRange.rangeDate);
      if (group) group.push(row);
      else map.set(row.plannedRange.rangeDate, [row]);
    }
    return map;
  }, [rows]);

  const visibleRows = attentionOnly ? rows.filter((row) => row.requiresAttention) : rows;
  const permanentRows = visibleRows.filter((row) => row.roleGroup === "permanent");
  const supervisorRows = visibleRows.filter((row) => row.roleGroup === "supervisor");
  const technicianRows = visibleRows.filter((row) => row.roleGroup === "technician");

  return (
    <div className="flex flex-col gap-6">
      <UnresolvedSheetRowsNotice count={unresolvedSheetRowCount} names={unresolvedSheetRowNames} />

      <SummaryTiles summary={summary} />

      <CreatePlannedRangeForm roster={roster} />

      {[...pendingConfirmationByDate.entries()].map(([rangeDate, groupRows]) => (
        <PendingConfirmationPanel key={rangeDate} rangeDate={rangeDate} rows={groupRows} />
      ))}

      <SelfReportQueue reports={pendingSelfReports} />

      <Panel variant="panel" glass="subtle" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">אנשי צוות</h2>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} className="h-4 w-4" />
            הצג רק דורשי טיפול
          </label>
        </div>

        <RoleGroupSection title="קבע" rows={permanentRows} />
        <RoleGroupSection title="אחמ״שים" rows={supervisorRows} />
        <RoleGroupSection title="טכנאים" rows={technicianRows} />

        {visibleRows.length === 0 ? <p className="text-sm text-muted">אין אנשים להצגה.</p> : null}
      </Panel>
    </div>
  );
}
