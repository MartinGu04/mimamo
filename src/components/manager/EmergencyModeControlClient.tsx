"use client";

import { useRef, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { useRevealFocus } from "@/components/ui/useRevealFocus";
import { activateEmergencyModeAction, deactivateEmergencyModeAction } from "@/lib/emergencyMode/actions";

export type EmergencyModeControlProjection =
  | { kind: "regular" }
  | { kind: "emergency"; activatedAtDisplay: string; activatedByPersonName: string };

interface EmergencyModeControlClientProps {
  mode: EmergencyModeControlProjection;
}

const GENERIC_ERROR = "משהו השתבש. נסה/י שוב.";

/**
 * The manager-facing Emergency Mode toggle UI (spec section 2). No
 * modal/`Dialog` component exists in this codebase (see
 * `ManagerScheduledBroadcastsSection.tsx`'s "לבטל את התזמון?" inline
 * reveal) -- the confirmation step here follows that SAME established
 * idiom (local `useState` reveal, never `window.confirm`), just with the
 * fuller title+body+button copy the spec calls for. The FIRST click
 * never mutates anything; only the explicit "כן, ..." confirm button
 * calls the Server Action.
 */
export function EmergencyModeControlClient({ mode }: EmergencyModeControlClientProps) {
  const [confirmingActivate, setConfirmingActivate] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null);
  /**
   * Attached to the outermost content row of BOTH the "emergency" and
   * "regular" branches below -- always whichever one is currently mounted.
   * A successful activate/deactivate replaces the whole branch (the
   * server-refreshed `mode` prop flips `mode.kind`, swapping this
   * component's entire return value), which would otherwise leave the
   * confirm-focus restore with nothing connected to fall back to.
   */
  const rootContentRef = useRef<HTMLDivElement>(null);
  const activateTriggerRef = useRef<HTMLButtonElement>(null);
  const deactivateTriggerRef = useRef<HTMLButtonElement>(null);

  // Predictable focus for the activate/deactivate confirm reveal (Phase 2
  // audit, focus-management B): moves focus to the confirmation's own
  // heading when it appears (it's the best match for this component's
  // structure -- there's no single "primary action" button, both confirm
  // and cancel read equally), and restores it to whichever trigger opened
  // it once the confirmation is gone again -- true for both cancelling AND
  // the action completing. `restoreFocusRef` points at whichever trigger
  // opened this confirmation (each is itself hidden while its own
  // confirmation is shown, so a plain "whatever was focused before"
  // snapshot would only ever see a node that's already gone by restore
  // time). `rootContentRef` is the fallback for whenever a successful
  // action swaps the whole `mode`-driven branch, trigger included.
  useRevealFocus({
    revealed: confirmingActivate || confirmingDeactivate,
    onRevealFocusRef: confirmHeadingRef,
    restoreFocusRef: confirmingActivate ? activateTriggerRef : confirmingDeactivate ? deactivateTriggerRef : undefined,
    fallbackFocusRef: rootContentRef,
  });

  function handleActivate() {
    setError(null);
    startTransition(async () => {
      const result = await activateEmergencyModeAction();
      if (!result.ok) {
        setError(GENERIC_ERROR);
        return;
      }
      setConfirmingActivate(false);
    });
  }

  function handleDeactivate() {
    setError(null);
    startTransition(async () => {
      const result = await deactivateEmergencyModeAction();
      if (!result.ok) {
        setError(GENERIC_ERROR);
        return;
      }
      setConfirmingDeactivate(false);
    });
  }

  if (mode.kind === "emergency") {
    return (
      <Panel variant="critical" data-testid="emergency-mode-control">
        <div ref={rootContentRef} tabIndex={-1} className="flex flex-wrap items-start justify-between gap-3 outline-none">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-critical">🚨 מצב חירום פעיל</h2>
            <p className="mt-1 text-sm text-critical">המערכת פועלת לפי סידור משמרות החירום. תורנויות מושהות.</p>
            <p className="mt-2 text-xs text-critical/70">
              הופעל {mode.activatedAtDisplay}
              {mode.activatedByPersonName ? ` על ידי ${mode.activatedByPersonName}` : ""}
            </p>
          </div>
          {!confirmingDeactivate ? (
            <button
              ref={deactivateTriggerRef}
              type="button"
              onClick={() => setConfirmingDeactivate(true)}
              disabled={pending}
              className="shrink-0 rounded-full bg-critical px-4 py-2 text-sm font-medium text-white hover:bg-critical/90 disabled:opacity-50"
            >
              סיים מצב חירום
            </button>
          ) : null}
        </div>

        {confirmingDeactivate ? (
          <div className="mt-4 rounded-lg bg-surface-1 p-4 ring-1 ring-border-strong" data-testid="emergency-mode-deactivate-confirm">
            <h3 ref={confirmHeadingRef} tabIndex={-1} className="text-sm font-semibold text-foreground outline-none">
              לסיים מצב חירום?
            </h3>
            <p className="mt-1 text-sm text-muted">המערכת תחזור לסידור הרגיל ותורנויות יחזרו לפעילות.</p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={pending}
                className="rounded-full bg-critical px-4 py-2 text-sm font-medium text-white hover:bg-critical/90 disabled:opacity-50"
              >
                {pending ? "מבצע/ת…" : "כן, סיים מצב חירום"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDeactivate(false)}
                disabled={pending}
                className="rounded-full px-4 py-2 text-sm font-medium text-muted underline disabled:opacity-50"
              >
                ביטול
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <StatusMessage tone="error" className="mt-2 text-xs text-critical">
            {error}
          </StatusMessage>
        ) : null}
      </Panel>
    );
  }

  return (
    <Panel variant="panel" data-testid="emergency-mode-control">
      <div ref={rootContentRef} tabIndex={-1} className="flex flex-wrap items-start justify-between gap-3 outline-none">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">מצב חירום</h2>
          <p className="mt-1 text-sm text-muted">מעביר את המערכת לסידור משמרות חירום ומשהה תורנויות.</p>
        </div>
        {!confirmingActivate ? (
          <button
            ref={activateTriggerRef}
            type="button"
            onClick={() => setConfirmingActivate(true)}
            disabled={pending}
            className="shrink-0 rounded-full bg-critical/10 px-4 py-2 text-sm font-medium text-critical ring-1 ring-critical/25 hover:bg-critical/20 disabled:opacity-50"
          >
            הפעל מצב חירום
          </button>
        ) : null}
      </div>

      {confirmingActivate ? (
        <div className="mt-4 rounded-lg bg-surface-critical p-4 ring-1 ring-surface-critical-border" data-testid="emergency-mode-activate-confirm">
          <h3 ref={confirmHeadingRef} tabIndex={-1} className="text-sm font-semibold text-foreground outline-none">
            להפעיל מצב חירום?
          </h3>
          <p className="mt-1 text-sm text-muted">המערכת תעבור לסידור החירום. משמרות רגילות לא יוצגו ותורנויות יושהו.</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmingActivate(false)}
              disabled={pending}
              className="rounded-full px-4 py-2 text-sm font-medium text-muted underline disabled:opacity-50"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={handleActivate}
              disabled={pending}
              className="rounded-full bg-critical px-4 py-2 text-sm font-medium text-white hover:bg-critical/90 disabled:opacity-50"
            >
              {pending ? "מפעיל/ה…" : "כן, הפעל מצב חירום"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <StatusMessage tone="error" className="mt-2 text-xs text-critical">
          {error}
        </StatusMessage>
      ) : null}
    </Panel>
  );
}
