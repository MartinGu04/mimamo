"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { StatusMessage } from "@/components/ui/StatusMessage";
import {
  archiveCustomWeeklyRuleAction,
  listNotificationRulesAction,
  setCustomWeeklyRuleEnabledAction,
  updateSystemRuleAction,
  type CustomWeeklyRuleView,
  type SystemRuleView,
} from "@/lib/notifications/ruleActions";
import { ManagerRecurringRuleComposer } from "./ManagerRecurringRuleComposer";
import { ManagerSystemRuleEditor } from "./ManagerSystemRuleEditor";
import type { ManagerAdoptionPersonView, ManagerPersonSummary } from "@/lib/readModels/managerTypes";

interface ManagerFixedNotificationsSectionProps {
  roster: ManagerPersonSummary[];
  adoptionPeople: ManagerAdoptionPersonView[];
}

const ERROR_LABELS: Record<string, string> = {
  forbidden: "רק מנהל/ת יכול/ה לנהל התראות קבועות.",
  unauthenticated: "יש להתחבר מחדש.",
  not_found: "הכלל לא נמצא -- ייתכן שכבר נערך/הוסר.",
  invalid_schedule: "יש לבחור שעה תקינה.",
  conflict: "ההתראה השתנתה מאז שנטענה. הרשימה נטענת מחדש.",
};

function errorLabel(error: string): string {
  return ERROR_LABELS[error] ?? "הפעולה נכשלה. נסה/י שוב.";
}

function minuteOfDayToTimeValue(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function systemAudienceLabel(rule: SystemRuleView): string {
  if (rule.audienceMode === "all_eligible") return "כל הרלוונטיים";
  return `${rule.targetPersonIds.length} נבחרים מתוך הרלוונטיים`;
}

function SystemRuleRow({
  rule,
  onChanged,
  onEdit,
  onConflict,
  isEditing,
}: {
  rule: SystemRuleView;
  onChanged: (updated: SystemRuleView) => void;
  onEdit: (rule: SystemRuleView) => void;
  /** Called when the quick toggle is rejected because someone else edited this rule since it was loaded -- triggers a reload of the whole rules list so the Manager sees the newest state, rather than silently overwriting the newer edit. */
  onConflict: () => void;
  isEditing: boolean;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleToggleEnabled() {
    setIsBusy(true);
    setError(null);
    try {
      // The update RPC always writes every configurable field together --
      // there is no partial update -- so this quick toggle re-submits the
      // rule's OWN current copy/audience/time unchanged, flipping only
      // `enabled`. `expectedRevision` is this row's own loaded revision --
      // if someone else has since edited this rule (e.g. its copy/
      // audience), the server rejects this whole request as a "conflict"
      // rather than letting a stale toggle silently overwrite their edit.
      const outcome = await updateSystemRuleAction(rule.id, {
        enabled: !rule.enabled,
        localHour: rule.localHour,
        localMinute: rule.localMinute,
        titleOverride: rule.titleOverride,
        bodyOverride: rule.bodyOverride,
        audienceMode: rule.audienceMode,
        targetPersonIds: rule.targetPersonIds,
        expectedRevision: rule.revision,
      });
      if (outcome.ok) {
        onChanged(outcome.rule);
      } else {
        setError(errorLabel(outcome.error));
        if (outcome.error === "conflict") onConflict();
      }
    } catch {
      setError(errorLabel("unknown"));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <li className={`rounded-lg p-2.5 ring-1 ring-border ${isEditing ? "bg-primary/5" : "bg-overlay-faint"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">מערכת</Badge>
            <p className="truncate text-sm font-semibold text-foreground">{rule.name}</p>
          </div>
          <p className="mt-0.5 text-xs text-muted">{rule.trigger}</p>
        </div>
        <Badge tone={rule.enabled ? "success" : "neutral"}>{rule.enabled ? "פעיל" : "כבוי"}</Badge>
      </div>

      <p className="mt-1.5 text-xs text-muted">👥 {systemAudienceLabel(rule)}</p>
      {rule.copyNote ? <p className="mt-0.5 text-[11px] text-muted-2">{rule.copyNote}</p> : null}
      {rule.titleOverride || rule.bodyOverride ? <p className="mt-0.5 text-[11px] text-primary">✏️ הכותרת/התוכן הותאמו אישית.</p> : null}

      {isEditing ? (
        <p className="mt-2 text-xs font-medium text-primary">שמור/י או בטל/י את העריכה למעלה כדי לפעול על הכלל הזה.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">🕒 {minuteOfDayToTimeValue(rule.localHour, rule.localMinute)}</span>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onEdit(rule)}
            className="rounded-full bg-overlay-soft px-3 py-1 text-xs font-medium text-foreground ring-1 ring-border hover:bg-overlay-strong disabled:opacity-50"
          >
            עריכה
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={handleToggleEnabled}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 disabled:opacity-50 ${
              rule.enabled
                ? "bg-critical/10 text-critical ring-critical/25 hover:bg-critical/20"
                : "bg-success/10 text-success ring-success/25 hover:bg-success/20"
            }`}
          >
            {isBusy ? "מעדכן/ת…" : rule.enabled ? "השבתה" : "הפעלה"}
          </button>
        </div>
      )}

      {error ? (
        <StatusMessage tone="error" className="mt-1.5 text-xs text-critical">
          {error}
        </StatusMessage>
      ) : null}
    </li>
  );
}

const WEEKDAY_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function audienceLabel(rule: CustomWeeklyRuleView): string {
  if (rule.audienceKind === "everyone") return "כולם";
  if (rule.audienceKind === "person") return "אדם אחד";
  return `${rule.targetPersonIds.length} אנשי צוות`;
}

function CustomWeeklyRuleRow({
  rule,
  onChanged,
  onEdit,
  isEditing,
}: {
  rule: CustomWeeklyRuleView;
  onChanged: () => void;
  onEdit: (rule: CustomWeeklyRuleView) => void;
  isEditing: boolean;
}) {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  async function handleToggleEnabled() {
    setIsBusy(true);
    setError(null);
    try {
      const outcome = await setCustomWeeklyRuleEnabledAction(rule.id, !rule.enabled);
      if (outcome.ok) onChanged();
      else setError(errorLabel(outcome.error));
    } catch {
      setError(errorLabel("unknown"));
    } finally {
      setIsBusy(false);
    }
  }

  async function handleArchive() {
    setIsBusy(true);
    setError(null);
    try {
      const outcome = await archiveCustomWeeklyRuleAction(rule.id);
      if (outcome.ok) onChanged();
      else setError(errorLabel(outcome.error));
    } catch {
      setError(errorLabel("unknown"));
    } finally {
      setIsBusy(false);
      setConfirmingArchive(false);
    }
  }

  return (
    <li className={`rounded-lg p-2.5 ring-1 ring-border ${isEditing ? "bg-primary/5" : "bg-overlay-faint"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="primary">מחזורי</Badge>
            <p className="truncate text-sm font-semibold text-foreground">{rule.title}</p>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">{rule.body}</p>
        </div>
        <Badge tone={rule.enabled ? "success" : "neutral"}>{rule.enabled ? "פעיל" : "כבוי"}</Badge>
      </div>

      <p className="mt-1.5 text-xs text-muted">
        📅 {rule.scheduleSummary ?? `יום ${WEEKDAY_LABELS[rule.weekday]}`} · 👥 {audienceLabel(rule)}
        {rule.createdByPersonName ? ` · נוצר ע״י ${rule.createdByPersonName}` : ""}
      </p>
      {rule.nextSendSummary ? <p className="mt-0.5 text-xs font-medium text-primary">שליחה הבאה: {rule.nextSendSummary}</p> : null}

      {isEditing ? (
        <p className="mt-2 text-xs font-medium text-primary">שמור/י או בטל/י את העריכה למעלה כדי לפעול על הכלל הזה.</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onEdit(rule)}
            className="rounded-full bg-overlay-soft px-3 py-1 text-xs font-medium text-foreground ring-1 ring-border hover:bg-overlay-strong disabled:opacity-50"
          >
            עריכה
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={handleToggleEnabled}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 disabled:opacity-50 ${
              rule.enabled
                ? "bg-critical/10 text-critical ring-critical/25 hover:bg-critical/20"
                : "bg-success/10 text-success ring-success/25 hover:bg-success/20"
            }`}
          >
            {rule.enabled ? "השבתה" : "הפעלה"}
          </button>
          {confirmingArchive ? (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-muted">להסיר את הכלל?</span>
              <button
                type="button"
                disabled={isBusy}
                onClick={handleArchive}
                className="rounded-full bg-critical/10 px-2.5 py-1 font-medium text-critical ring-1 ring-critical/25 hover:bg-critical/20 disabled:opacity-50"
              >
                כן, הסר
              </button>
              <button type="button" onClick={() => setConfirmingArchive(false)} className="rounded-full px-2.5 py-1 font-medium text-muted underline">
                לא
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setConfirmingArchive(true)}
              className="rounded-full bg-overlay-soft px-3 py-1 text-xs font-medium text-muted ring-1 ring-border hover:bg-overlay-strong disabled:opacity-50"
            >
              הסרה
            </button>
          )}
        </div>
      )}

      {error ? (
        <StatusMessage tone="error" className="mt-1.5 text-xs text-critical">
          {error}
        </StatusMessage>
      ) : null}
    </li>
  );
}

/**
 * "📌 התראות קבועות" -- the Fixed / Recurring Notifications Center. Two
 * visually separate subsections sharing one data load: "התראות מערכת"
 * (existing fixed reminder rules, now centrally managed -- enable/disable,
 * send-time, an optional title/body override, and an audience FILTER
 * over each rule's own protected domain-eligibility/trigger logic -- see
 * `ManagerSystemRuleEditor`) and "התראות מחזוריות" (manager-authored
 * weekly recurring broadcasts, V1). Deliberately a SEPARATE data source
 * from `ManagerScheduledBroadcastsSection`/`ManagerRecentBroadcastsSection`
 * -- one-time scheduled broadcasts and their delivery history are
 * untouched by this feature (spec: keep B and C semantically distinct).
 */
export function ManagerFixedNotificationsSection({ roster, adoptionPeople }: ManagerFixedNotificationsSectionProps) {
  const [systemRules, setSystemRules] = useState<SystemRuleView[] | null>(null);
  const [customWeeklyRules, setCustomWeeklyRules] = useState<CustomWeeklyRuleView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<CustomWeeklyRuleView | null>(null);
  const [editingSystemRule, setEditingSystemRule] = useState<SystemRuleView | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // A bumped token (never calling an external load function synchronously
  // from the effect body -- see `react-hooks/set-state-in-effect`) is what
  // triggers a reload after a mutation elsewhere; the effect below owns
  // the actual fetch, exactly like `ManagerScheduledBroadcastsSection`'s
  // own reload-token pattern.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await listNotificationRulesAction();
        if (cancelled) return;
        if (result.ok) {
          setSystemRules(result.systemRules);
          setCustomWeeklyRules(result.customWeeklyRules);
          setLoadError(null);
        } else {
          setLoadError(result.error);
        }
      } catch {
        if (!cancelled) setLoadError("unknown");
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  function handleSystemRuleChanged(updated: SystemRuleView) {
    setSystemRules((current) => current?.map((rule) => (rule.id === updated.id ? updated : rule)) ?? current);
  }

  function handleSystemRuleSaved(updated: SystemRuleView) {
    handleSystemRuleChanged(updated);
    setEditingSystemRule(null);
  }

  function handleCustomRuleChanged() {
    setEditingRule(null);
    setIsCreating(false);
    setReloadToken((token) => token + 1);
  }

  return (
    <Panel variant="panel" glass="subtle" data-testid="manager-fixed-notifications">
      <div>
        <h3 className="text-sm font-semibold text-foreground">📌 התראות קבועות</h3>
        <p className="mt-0.5 text-xs text-muted">תזכורות מערכת קיימות והתראות מחזוריות שהוגדרו על ידי מנהלים -- כולן במקום אחד.</p>
      </div>

      {loadError ? (
        <StatusMessage tone="error" className="mt-3 text-sm text-muted">
          לא ניתן לטעון את ההתראות הקבועות כרגע.
        </StatusMessage>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          <div>
            <h4 className="text-xs font-semibold text-muted-2">🔒 התראות מערכת</h4>
            {editingSystemRule ? (
              <div className="mt-2">
                <ManagerSystemRuleEditor
                  rule={editingSystemRule}
                  roster={roster}
                  adoptionPeople={adoptionPeople}
                  onSaved={handleSystemRuleSaved}
                  onCancel={() => setEditingSystemRule(null)}
                />
              </div>
            ) : null}
            {systemRules === null ? (
              <p className="mt-2 text-xs text-muted">טוען…</p>
            ) : systemRules.length === 0 ? (
              <p className="mt-2 text-xs text-muted">אין כללי מערכת מוגדרים.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {systemRules.map((rule) => (
                  <SystemRuleRow
                    key={rule.id}
                    rule={rule}
                    onChanged={handleSystemRuleChanged}
                    isEditing={editingSystemRule?.id === rule.id}
                    onEdit={(item) => {
                      setIsCreating(false);
                      setEditingRule(null);
                      setEditingSystemRule(item);
                    }}
                    onConflict={() => setReloadToken((token) => token + 1)}
                  />
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold text-muted-2">🔁 התראות מחזוריות</h4>
              {!isCreating && !editingRule ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingSystemRule(null);
                    setIsCreating(true);
                  }}
                  className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-primary/25 hover:bg-primary/20"
                >
                  + התראה מחזורית
                </button>
              ) : null}
            </div>

            {isCreating || editingRule ? (
              <div className="mt-2">
                <ManagerRecurringRuleComposer
                  roster={roster}
                  adoptionPeople={adoptionPeople}
                  editingRule={editingRule}
                  onSaved={handleCustomRuleChanged}
                  onCancel={() => {
                    setIsCreating(false);
                    setEditingRule(null);
                  }}
                />
              </div>
            ) : null}

            {customWeeklyRules === null ? (
              <p className="mt-2 text-xs text-muted">טוען…</p>
            ) : customWeeklyRules.length === 0 && !isCreating ? (
              <p className="mt-2 text-xs text-muted">אין עדיין התראות מחזוריות. לחצו על &ldquo;+ התראה מחזורית&rdquo; כדי ליצור אחת.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {customWeeklyRules.map((rule) => (
                  <CustomWeeklyRuleRow
                    key={rule.id}
                    rule={rule}
                    isEditing={editingRule?.id === rule.id}
                    onEdit={(item) => {
                      setEditingSystemRule(null);
                      setIsCreating(false);
                      setEditingRule(item);
                    }}
                    onChanged={() => setReloadToken((token) => token + 1)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
