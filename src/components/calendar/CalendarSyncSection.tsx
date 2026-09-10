"use client";

import { useCallback, useRef, useState } from "react";
import { CalendarPlus, Check, Copy, Loader2, RefreshCw, Trash2 } from "lucide-react";
import {
  disableCalendarSyncAction,
  enableCalendarSyncAction,
  resetCalendarSyncAction,
} from "@/lib/calendar/actions";
import type { CalendarFeedLinks } from "@/lib/calendar/feedUrl";
import { Panel } from "@/components/ui/Panel";
import { APP_NAME } from "@/lib/config/productName";

interface CalendarSyncSectionProps {
  initialEnabled: boolean;
  /** Already-built links for the CURRENT feed, server-rendered -- `null` whenever `initialEnabled` is `false`. */
  initialLinks: CalendarFeedLinks | null;
}

type ConfirmTarget = "reset" | "disable" | null;

const GENERIC_ERROR = "משהו השתבש. נסו שוב מאוחר יותר.";
const COPIED_RESET_MS = 2000;

/**
 * "סנכרון ליומן" -- enable/reset/disable UI for the personal ICS feed
 * (PR: personal calendar subscription). Deliberately never re-displays
 * the raw token as on-screen text (PR spec §4): "Copy Link" writes
 * `links.url` straight to the clipboard, and the Google/Apple buttons are
 * plain links built server-side -- the token only ever reaches the DOM
 * inside those two `href`s and the clipboard write, never as a
 * paragraph/input value a bystander could read over someone's shoulder.
 *
 * Reset/disable both require an explicit second tap (`confirmTarget`,
 * inline confirm -- no modal dependency, this codebase has none) before
 * anything happens, since both are effectively irreversible from the
 * calendar app's point of view: the previous URL stops working the
 * instant either commits.
 */
export function CalendarSyncSection({ initialEnabled, initialLinks }: CalendarSyncSectionProps) {
  const [links, setLinks] = useState<CalendarFeedLinks | null>(initialEnabled ? initialLinks : null);
  const [enabling, setEnabling] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enable = useCallback(async () => {
    setError(null);
    setEnabling(true);
    const result = await enableCalendarSyncAction();
    setEnabling(false);
    if (!result.ok) {
      setError(GENERIC_ERROR);
      return;
    }
    setLinks(result.links);
  }, []);

  const confirmReset = useCallback(async () => {
    setError(null);
    setBusy(true);
    setCopied(false);
    const result = await resetCalendarSyncAction();
    setBusy(false);
    setConfirmTarget(null);
    if (!result.ok) {
      setError(GENERIC_ERROR);
      return;
    }
    setLinks(result.links);
  }, []);

  const confirmDisable = useCallback(async () => {
    setError(null);
    setBusy(true);
    const result = await disableCalendarSyncAction();
    setBusy(false);
    setConfirmTarget(null);
    if (!result.ok) {
      setError(GENERIC_ERROR);
      return;
    }
    setLinks(null);
    setCopied(false);
  }, []);

  const copyLink = useCallback(async () => {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.url);
      setCopied(true);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      setError("לא ניתן היה להעתיק את הקישור.");
    }
  }, [links]);

  return (
    <Panel variant="panel" className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">סנכרון ליומן</h2>
        <p className="mt-1 text-sm text-muted">
          קבלו את המשמרות והתורנויות שלכם אוטומטית ביומן Google, Apple, או כל אפליקציית יומן שתומכת במנוי ICS.
          העדכון חד-כיווני בלבד: {APP_NAME} לעולם לא קורא או משנה את היומן האישי שלכם.
        </p>
      </div>

      {error ? <p className="text-sm text-critical">{error}</p> : null}

      {!links ? (
        <button
          type="button"
          onClick={enable}
          disabled={enabling}
          className="flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {enabling ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={1.75} />
          ) : (
            <CalendarPlus className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          )}
          הפעלת סנכרון ליומן
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-success">
            <Check className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
            סנכרון ליומן פעיל
          </p>

          <div className="flex flex-wrap gap-2">
            <a
              href={links.googleUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-foreground ring-1 ring-border transition-colors duration-150 hover:bg-overlay-soft"
            >
              הוספה ליומן Google
            </a>
            <a
              href={links.appleUrl}
              className="rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-foreground ring-1 ring-border transition-colors duration-150 hover:bg-overlay-soft"
            >
              הוספה ליומן Apple
            </a>
            <button
              type="button"
              onClick={copyLink}
              className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-foreground ring-1 ring-border transition-colors duration-150 hover:bg-overlay-soft"
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
              )}
              {copied ? "הקישור הועתק" : "העתקת קישור"}
            </button>
          </div>

          <div className="my-1 h-px bg-border" />

          <div className="flex flex-wrap items-center gap-2">
            {confirmTarget === "reset" ? (
              <>
                <span className="text-sm text-muted">הקישור הקיים יפסיק לעבוד. ליצור קישור חדש?</span>
                <button
                  type="button"
                  onClick={confirmReset}
                  disabled={busy}
                  className="rounded-lg bg-critical px-3 py-1.5 text-sm font-medium text-critical-foreground transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {busy ? "יוצר..." : "אישור"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmTarget(null)}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-overlay-soft"
                >
                  ביטול
                </button>
              </>
            ) : confirmTarget === "disable" ? (
              <>
                <span className="text-sm text-muted">הקישור הקיים יפסיק לעבוד לגמרי. לבטל את הסנכרון?</span>
                <button
                  type="button"
                  onClick={confirmDisable}
                  disabled={busy}
                  className="rounded-lg bg-critical px-3 py-1.5 text-sm font-medium text-critical-foreground transition-colors duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {busy ? "מבטל..." : "אישור"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmTarget(null)}
                  disabled={busy}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-overlay-soft"
                >
                  ביטול
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmTarget("reset")}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-overlay-soft"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
                  יצירת קישור חדש
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmTarget("disable")}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-critical transition-colors duration-150 hover:bg-critical/10"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
                  ביטול סנכרון
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
