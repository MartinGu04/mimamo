"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, RotateCcw, X } from "lucide-react";
import { reportOnePersonHasMeaningfulTomorrowEvent, type ReportOneDraft, type ReportOnePerson } from "@/lib/domain/reportOne";
import { formatReportOneText, formatReportOneTitle } from "@/lib/presentation/reportOneFormat";
import { setReserveInclusionPreferenceAction } from "@/lib/reportOne/actions";

interface ReportOneEditorOverlayProps {
  draft: ReportOneDraft;
  /**
   * The persisted "include in Report 1" state for every מילואים person in
   * `draft`'s reserve section, already defaulted to `true` for anyone who
   * has never had a preference saved -- see `loadReportOneTomorrow`'s own
   * docs. Omitted/missing entries also default to `true` here, so an
   * older caller that doesn't pass this prop at all still renders every
   * reserve person as included, exactly like before this feature existed.
   */
  reserveInclusionByPersonId?: Readonly<Record<string, boolean>>;
  onClose: () => void;
}

/** Same SSR-safe "mounted on the client yet" primitive `FairnessDetailOverlay` uses, so `createPortal(..., document.body)` is never evaluated during the server render pass. */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function buildGeneratedStatusMap(draft: ReportOneDraft): Record<string, string> {
  const map: Record<string, string> = {};
  for (const section of draft.sections) {
    for (const person of section.people) {
      map[person.personId] = person.generatedStatus;
    }
  }
  return map;
}

/** Every reserve person's current "include in Report 1" flag, defaulted to `true` (never `false`) for any reserve person missing from `reserveInclusionByPersonId` -- the same default `loadReportOneTomorrow` already applies server-side, re-applied here so a caller omitting the prop entirely still behaves identically to before this feature existed. */
function buildReserveIncludedMap(draft: ReportOneDraft, reserveInclusionByPersonId: Readonly<Record<string, boolean>>): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  const reserveSection = draft.sections.find((section) => section.section === "reserve");
  for (const person of reserveSection?.people ?? []) {
    map[person.personId] = reserveInclusionByPersonId[person.personId] ?? true;
  }
  return map;
}

const COPIED_RESET_MS = 2000;

/**
 * The "דוח 1 למחר" editable draft -- mobile bottom sheet / desktop centered
 * modal, one responsive component (same Tailwind-breakpoint approach
 * `FairnessDetailOverlay` uses), but URL-independent local `open`/`onClose`
 * state like `CommandPalette`, since this is triggered from a Home quick
 * action rather than a navigable list row.
 *
 * Editing status TEXT is local-only: `edits` starts as a copy of every
 * person's `generatedStatus` and is never written back anywhere except
 * the clipboard. "איפוס לטיוטה האוטומטית" restores `edits` from the
 * draft's own generated values and discards manual changes -- with an
 * inline confirm (no modal dependency, matching `CalendarSyncSection`'s
 * existing `confirmTarget` pattern) whenever there's something to lose.
 *
 * The מילואים reserve-inclusion CHECKBOX is a separate, genuinely
 * persisted concern (see this repo's Report 1 reserve-inclusion spec):
 * each toggle calls `setReserveInclusionPreferenceAction` directly (same
 * "import the Server Action into the client component" convention
 * `ManagerSystemRuleEditor` uses), independent of `edits`/reset -- reset
 * never touches reserve-inclusion state, since it represents durable
 * user configuration, not a draft edit.
 */
export function ReportOneEditorOverlay({ draft, reserveInclusionByPersonId = {}, onClose }: ReportOneEditorOverlayProps) {
  const mounted = useMounted();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const generatedStatusById = useMemo(() => buildGeneratedStatusMap(draft), [draft]);
  const [edits, setEdits] = useState<Record<string, string>>(generatedStatusById);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [reserveIncluded, setReserveIncluded] = useState<Record<string, boolean>>(() =>
    buildReserveIncludedMap(draft, reserveInclusionByPersonId),
  );
  /** The reserve person currently showing the "הסר בכל זאת" removal-confirmation row, or `null`. Only ever set when unchecking someone WITH a meaningful tomorrow event (`reportOnePersonHasMeaningfulTomorrowEvent`) -- an uncheck with nothing meaningful tomorrow, or any re-check, persists immediately without ever touching this. */
  const [pendingRemovalPersonId, setPendingRemovalPersonId] = useState<string | null>(null);

  const isDirty = useMemo(
    () => Object.keys(generatedStatusById).some((personId) => edits[personId] !== generatedStatusById[personId]),
    [edits, generatedStatusById],
  );

  useEffect(() => {
    if (!mounted) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [mounted]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialogNode = dialogRef.current;
      if (!dialogNode) return;

      const focusable = getFocusableElements(dialogNode);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !dialogNode.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogNode.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const setPersonStatus = useCallback((personId: string, value: string) => {
    setEdits((current) => ({ ...current, [personId]: value }));
  }, []);

  /** Optimistically applies `included` locally, then persists it -- on failure, reverts the optimistic value rather than leaving the checkbox showing a state that was never actually saved. */
  const persistReserveInclusion = useCallback(async (personId: string, included: boolean) => {
    setReserveIncluded((current) => ({ ...current, [personId]: included }));
    const outcome = await setReserveInclusionPreferenceAction(personId, included);
    if (!outcome.ok) {
      setReserveIncluded((current) => ({ ...current, [personId]: !included }));
    }
  }, []);

  /**
   * Re-checking (`nextIncluded === true`) always persists immediately --
   * this repo's spec only requires confirmation when REMOVING someone,
   * never when re-adding them, and a previously-excluded-but-now-relevant
   * person is never silently auto-re-enabled by anything other than this
   * explicit click. Unchecking someone with no meaningful tomorrow event
   * (`reportOnePersonHasMeaningfulTomorrowEvent`) also persists
   * immediately; unchecking someone WHO DOES have one shows the inline
   * removal-confirmation row instead of persisting anything yet.
   */
  const handleReserveCheckboxChange = useCallback(
    (person: ReportOnePerson, nextIncluded: boolean) => {
      if (nextIncluded) {
        setPendingRemovalPersonId((current) => (current === person.personId ? null : current));
        void persistReserveInclusion(person.personId, true);
        return;
      }

      if (!reportOnePersonHasMeaningfulTomorrowEvent(person)) {
        void persistReserveInclusion(person.personId, false);
        return;
      }

      setPendingRemovalPersonId(person.personId);
    },
    [persistReserveInclusion],
  );

  const confirmRemoval = useCallback(
    (personId: string) => {
      setPendingRemovalPersonId(null);
      void persistReserveInclusion(personId, false);
    },
    [persistReserveInclusion],
  );

  const cancelRemoval = useCallback(() => setPendingRemovalPersonId(null), []);

  const requestReset = useCallback(() => {
    if (!isDirty) {
      setEdits(generatedStatusById);
      return;
    }
    setConfirmingReset(true);
  }, [isDirty, generatedStatusById]);

  const confirmReset = useCallback(() => {
    setEdits(generatedStatusById);
    setConfirmingReset(false);
  }, [generatedStatusById]);

  const copyReport = useCallback(async () => {
    const text = formatReportOneText(draft, edits, reserveIncluded);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Clipboard access can fail (permissions, insecure context) -- the
      // report text still exists on-screen for a manual copy, so this is
      // silent rather than surfacing a scary error for a non-critical action.
    }
  }, [draft, edits, reserveIncluded]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center">
      <div role="presentation" aria-hidden="true" className="glass-scrim absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="דוח 1 למחר"
        className="relative flex max-h-[90vh] w-full flex-col rounded-t-xl bg-surface-1 shadow-[var(--shadow-elevated)] ring-1 ring-border-strong lg:max-h-[85vh] lg:w-[560px] lg:max-w-[90vw] lg:rounded-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h2 className="truncate text-base font-semibold text-foreground">{formatReportOneTitle(draft.targetDate)}</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-overlay-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            {draft.sections.map((section) => (
              <div key={section.section}>
                <h3 className="mb-2 text-sm font-semibold text-foreground">{section.label}</h3>
                {section.people.length === 0 ? (
                  <p className="text-sm text-muted">אין אנשי צוות בקבוצה זו.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {section.people.map((person) => {
                      const isUnresolved = edits[person.personId] === "?";
                      const isReserve = section.section === "reserve";
                      const included = isReserve ? (reserveIncluded[person.personId] ?? true) : true;
                      const showsStaleExclusionWarning = isReserve && !included && reportOnePersonHasMeaningfulTomorrowEvent(person);

                      return (
                        <li key={person.personId} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            {isReserve ? (
                              <input
                                type="checkbox"
                                checked={included}
                                onChange={(event) => handleReserveCheckboxChange(person, event.target.checked)}
                                aria-label={`כלול בדוח 1: ${person.name}`}
                                className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                              />
                            ) : null}
                            <span className="text-sm font-medium text-foreground">{person.name}</span>
                          </div>

                          {showsStaleExclusionWarning ? (
                            <p className="text-xs font-medium text-warning">⚠️ יש שיבוץ מחר אך האדם לא כלול בדוח</p>
                          ) : null}

                          {pendingRemovalPersonId === person.personId ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-overlay-soft p-2">
                              <span className="text-sm text-muted">
                                יש ל{person.name} שיבוץ מחר: {person.generatedStatus}. הסרה תשמיט את {person.name} מדוח 1 המועתק.
                              </span>
                              <button
                                type="button"
                                onClick={cancelRemoval}
                                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-overlay-soft"
                              >
                                ביטול
                              </button>
                              <button
                                type="button"
                                onClick={() => confirmRemoval(person.personId)}
                                className="rounded-lg bg-critical px-3 py-1.5 text-sm font-medium text-critical-foreground transition-colors duration-150 hover:opacity-90"
                              >
                                הסר בכל זאת
                              </button>
                            </div>
                          ) : null}

                          <input
                            type="text"
                            value={edits[person.personId] ?? ""}
                            onChange={(event) => setPersonStatus(person.personId, event.target.value)}
                            className={`w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-foreground ring-1 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                              isUnresolved ? "ring-critical/60" : "ring-border"
                            }`}
                            aria-label={`סטטוס עבור ${person.name}`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-4">
          {confirmingReset ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">קיימים שינויים ידניים שיימחקו. לאפס לטיוטה האוטומטית?</span>
              <button
                type="button"
                onClick={confirmReset}
                className="rounded-lg bg-critical px-3 py-1.5 text-sm font-medium text-critical-foreground transition-colors duration-150 hover:opacity-90"
              >
                אישור
              </button>
              <button
                type="button"
                onClick={() => setConfirmingReset(false)}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-overlay-soft"
              >
                ביטול
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={requestReset}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition-colors duration-150 hover:bg-overlay-soft"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
              איפוס לטיוטה האוטומטית
            </button>
          )}

          <button
            type="button"
            onClick={copyReport}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:opacity-90"
          >
            {copied ? (
              <Check className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
            ) : (
              <Copy className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
            )}
            {copied ? "הדוח הועתק" : "העתק דוח"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
