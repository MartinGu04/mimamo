"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { StatusMessage } from "@/components/ui/StatusMessage";
import {
  cancelScheduledBroadcastAction,
  listActiveScheduledBroadcastsAction,
  sendScheduledBroadcastNowAction,
  type ScheduledBroadcastView,
} from "@/lib/notifications/scheduledBroadcastActions";
import { formatScheduledBroadcastMoment } from "@/lib/presentation/scheduledBroadcast";

interface ManagerScheduledBroadcastsSectionProps {
  /** Bumped by the parent whenever a create/edit/cancel/send-now elsewhere should be reflected here. */
  reloadToken: number;
  onEdit: (item: ScheduledBroadcastView) => void;
  /** Fired after a successful send-now/cancel -- the parent also refreshes "נשלחו לאחרונה" on send-now. */
  onChanged: () => void;
  editingId: string | null;
  /**
   * Fired after every load (initial, reload-token-triggered, or a
   * background poll tick) with whether this section currently has any
   * active (not-yet-dispatched) item. Lets the parent gate
   * `ManagerRecentBroadcastsSection`'s own polling on "the communication
   * area has active scheduled broadcasts" (spec §7) without that section
   * needing its own copy of this list.
   */
  onActiveChange?: (active: boolean) => void;
}

/**
 * A background worker can dispatch a due schedule at any moment -- without
 * this, the manager would only ever see the move from "🕒 התראות מתוזמנות"
 * to "נשלחו לאחרונה" after a manual page refresh (spec §7). ~15-20s per
 * the spec's own preferred UX; deliberately lightweight polling, never a
 * Realtime/WebSocket subscription.
 */
const POLL_INTERVAL_MS = 17_000;

function audienceLabel(item: ScheduledBroadcastView): string {
  if (item.audienceKind === "everyone") return "כולם";
  if (item.audienceKind === "person") return "אדם אחד";
  return `${item.targetPersonIds.length} אנשי צוות`;
}

const STATUS_LABELS: Record<ScheduledBroadcastView["status"], string> = {
  scheduled: "ממתין לשליחה",
  claimed: "בשליחה כעת…",
  dispatched: "נשלח",
  cancelled: "בוטל",
};

const ERROR_LABELS: Record<string, string> = {
  not_found: "התזמון לא נמצא -- ייתכן שכבר בוטל.",
  already_started: "השליחה כבר התחילה, ולא ניתן עוד לפעול על התזמון הזה.",
  already_cancelled: "התזמון הזה כבר בוטל.",
  forbidden: "רק מנהל/ת יכול/ה לפעול על תזמון.",
};

function errorLabel(error: string): string {
  return ERROR_LABELS[error] ?? "הפעולה נכשלה. נסה/י שוב.";
}

/**
 * "🕒 התראות מתוזמנות" -- every not-yet-dispatched scheduled broadcast
 * (including one currently `'claimed'` mid-dispatch, a normally brief
 * transient state where actions are disabled). "עריכה" hands the item up
 * to the composer (`NotificationScheduleSection`, `components/notifications/`);
 * "שלח עכשיו"/"ביטול" call their
 * own server actions directly and refresh this list (and, for "שלח עכשיו",
 * the "נשלחו לאחרונה" list) via `onChanged`.
 */
export function ManagerScheduledBroadcastsSection({
  reloadToken,
  onEdit,
  onChanged,
  editingId,
  onActiveChange,
}: ManagerScheduledBroadcastsSectionProps) {
  const [items, setItems] = useState<ScheduledBroadcastView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);

  // A chained setTimeout (never setInterval) -- the next poll is only ever
  // scheduled once the CURRENT fetch has fully settled, which is what
  // makes overlapping polling requests structurally impossible here
  // (spec §7). Stops re-scheduling itself the moment there are no active
  // items left, resuming automatically once `reloadToken` bumps for any
  // other reason (a create/edit/cancel/send-now elsewhere). This never
  // touches `editingId`/the composer's own state -- a background refresh
  // can only ever change which items are LISTED here, never what the
  // manager currently has open for editing.
  //
  // A THROWN failure (network hiccup, transient 5xx, ...) is deliberately
  // NOT treated the same as `result.ok === false`. This action is backed
  // by `loadManagerPersonnelContext` (the lightweight polling-auth
  // boundary -- see its own docstring), whose error union is exactly
  // `unauthenticated | missing_email | unmapped | ambiguous_identity |
  // forbidden` -- every one of those is a genuinely PERMANENT, structural
  // state (lost session, misconfigured/unmapped identity, not a manager)
  // that no amount of retrying fixes, and critically it can NEVER be
  // `configuration_error` (that status only exists on the heavier
  // `loadManagerWorkbookContext` path, which builds a `ShiftSchedule` --
  // something this lightweight path never touches). So a typed
  // `result.ok === false` is safe to treat as a deliberate stop, exactly
  // as before. A THROW, by contrast, means we simply don't know the
  // current state -- "unknown" is not "empty" -- so it must never report
  // `onActiveChange(false)` (which would incorrectly shut down the
  // recent-sends section's own polling too), and must still retry on the
  // next tick rather than dying silently. This is what lets the manager
  // recover live status automatically after a transient failure,
  // including one on the very first load, without a page refresh.
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const result = await listActiveScheduledBroadcastsAction();
        if (cancelled) return;
        if (result.ok) {
          setItems(result.items);
          setLoadError(null);
          onActiveChange?.(result.items.length > 0);
          if (result.items.length > 0) {
            timeoutId = setTimeout(load, POLL_INTERVAL_MS);
          }
        } else {
          setLoadError(result.error);
          onActiveChange?.(false);
        }
      } catch {
        if (!cancelled) {
          setLoadError("unknown");
          // Deliberately no onActiveChange(false) here -- a transient
          // failure tells us nothing about whether active schedules
          // exist, so the last known active state (and therefore the
          // recent-sends section's own polling) is left untouched.
          timeoutId = setTimeout(load, POLL_INTERVAL_MS);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [reloadToken, onActiveChange]);

  async function handleSendNow(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      const outcome = await sendScheduledBroadcastNowAction(id);
      if (outcome.ok) onChanged();
      else setActionError({ id, message: errorLabel(outcome.error) });
    } catch {
      setActionError({ id, message: errorLabel("unknown") });
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmCancel(id: string) {
    setBusyId(id);
    setActionError(null);
    try {
      const outcome = await cancelScheduledBroadcastAction(id);
      if (outcome.ok) onChanged();
      else setActionError({ id, message: errorLabel(outcome.error) });
    } catch {
      setActionError({ id, message: errorLabel("unknown") });
    } finally {
      setBusyId(null);
      setConfirmingCancelId(null);
    }
  }

  if (loadError) {
    return (
      <Panel variant="compact" data-testid="manager-scheduled-broadcasts">
        <StatusMessage tone="error" className="text-sm text-muted">
          לא ניתן לטעון את ההתראות המתוזמנות כרגע.
        </StatusMessage>
      </Panel>
    );
  }

  if (items === null) return null;
  if (items.length === 0) return null;

  return (
    <Panel variant="compact" data-testid="manager-scheduled-broadcasts">
      <h3 className="text-sm font-semibold text-foreground">🕒 התראות מתוזמנות</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {items.map((item) => {
          const isBusy = busyId === item.id;
          const isEditing = editingId === item.id;
          // While this exact item is open in the composer's editor, its
          // on-screen title/body/audience/time may differ from what's
          // still stored -- "שלח עכשיו"/"ביטול" here would silently act on
          // the STORED version while the manager may reasonably believe
          // the visible edited draft is what's being acted on. So this
          // card's actions are unavailable until the manager saves or
          // leaves edit mode; starting a second edit of the SAME item is
          // blocked the same way (the "עריכה" button simply isn't shown).
          const editable = item.status === "scheduled" && !isEditing;
          const moment = formatScheduledBroadcastMoment(item.scheduledLocalDate, item.scheduledLocalMinuteOfDay);

          return (
            <li key={item.id} className={`rounded-lg p-2.5 ring-1 ring-border ${isEditing ? "bg-primary/5" : "bg-overlay-faint"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{item.title}</p>
                <div className="flex items-center gap-1.5">
                  {isEditing ? <Badge tone="primary">✏️ בעריכה כעת</Badge> : null}
                  <Badge tone={item.status === "claimed" ? "warning" : "neutral"}>{STATUS_LABELS[item.status]}</Badge>
                </div>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {moment ?? item.scheduledFor} · {audienceLabel(item)}
                {item.createdByPersonName ? ` · נוצר ע״י ${item.createdByPersonName}` : ""}
              </p>

              {isEditing ? (
                <p className="mt-2 text-xs font-medium text-primary">
                  שמור/י או בטל/י את העריכה למעלה כדי לשלוח עכשיו או לבטל את התזמון הזה.
                </p>
              ) : editable ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => onEdit(item)}
                    className="rounded-full bg-overlay-soft px-3 py-1 text-xs font-medium text-foreground ring-1 ring-border hover:bg-overlay-strong disabled:opacity-50"
                  >
                    עריכה
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleSendNow(item.id)}
                    className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary ring-1 ring-primary/25 hover:bg-primary/20 disabled:opacity-50"
                  >
                    {isBusy ? "שולח/ת…" : "שלח עכשיו"}
                  </button>
                  {confirmingCancelId === item.id ? (
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="text-muted">לבטל את התזמון?</span>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleConfirmCancel(item.id)}
                        className="rounded-full bg-critical/10 px-2.5 py-1 font-medium text-critical ring-1 ring-critical/25 hover:bg-critical/20 disabled:opacity-50"
                      >
                        כן, בטל
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingCancelId(null)}
                        className="rounded-full px-2.5 py-1 font-medium text-muted underline"
                      >
                        לא
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setConfirmingCancelId(item.id)}
                      className="rounded-full bg-critical/10 px-3 py-1 text-xs font-medium text-critical ring-1 ring-critical/25 hover:bg-critical/20 disabled:opacity-50"
                    >
                      ביטול
                    </button>
                  )}
                </div>
              ) : null}

              {actionError?.id === item.id ? (
                <StatusMessage tone="error" className="mt-1.5 text-xs text-critical">
                  {actionError.message}
                </StatusMessage>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
