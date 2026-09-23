"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Accessibility } from "lucide-react";
import { useA11yPreferences } from "@/lib/a11y/A11yPreferencesProvider";
import type { A11yTextSize } from "@/lib/a11y/preferences";
import { useRevealFocus } from "@/components/ui/useRevealFocus";
import { EXPAND_HIT_AREA_CLASS } from "@/components/ui/hitArea";

const TEXT_SIZE_OPTIONS: ReadonlyArray<{ value: A11yTextSize; label: string }> = [
  { value: "default", label: "רגיל" },
  { value: "enlarged", label: "מוגדל" },
  { value: "xlarge", label: "מוגדל מאוד" },
];

/**
 * One text-size choice, styled as a segmented control. Deliberately plain
 * `role="group"` + `<button aria-pressed>`, NOT `role="radiogroup"`/
 * `role="radio"` (an earlier version of this used that pattern, matching
 * `ThemeToggle` -- but a real ARIA radio group promises arrow-key/Home/End
 * roving-focus keyboard behavior, which this never implemented, leaving
 * every option as a separate Tab stop). In the accessibility preferences
 * panel itself, shipping radio semantics without their interaction model
 * is worse than not claiming them: plain Tab-reachable toggle buttons with
 * `aria-pressed` are honest about what this control actually does.
 */
function TextSizeControl({ value, onChange }: { value: A11yTextSize; onChange: (size: A11yTextSize) => void }) {
  return (
    <div role="group" aria-label="גודל טקסט" className="flex items-center gap-1 rounded-full bg-overlay-soft p-1">
      {TEXT_SIZE_OPTIONS.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={`flex-1 rounded-full px-2 py-1.5 text-xs font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              isActive ? "bg-surface-1 text-primary" : "text-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One on/off preference row -- a real `role="switch"` (not a checkbox
 * pretending, not a menu item), labeled via `aria-labelledby` pointing at
 * its own visible text rather than a duplicated `aria-label`. Pure flex
 * `justify-start`/`justify-end` for the knob position (no `translateX`
 * transform) so it stays correct under `dir="rtl"` with no sign flipping to
 * get wrong.
 */
function PreferenceSwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium text-foreground">
          {label}
        </p>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={() => onChange(!checked)}
        className={`relative flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          checked ? "justify-end bg-primary" : "justify-start bg-overlay-strong"
        }`}
      >
        <span aria-hidden="true" className="h-5 w-5 rounded-full bg-white shadow-sm" />
      </button>
    </div>
  );
}

/**
 * The application's accessibility PREFERENCES button + panel (Phase 8) --
 * a personalization layer on top of the semantic/ARIA remediation shipped
 * in Phases 1-7, never a replacement for it and never described as making
 * the app "compliant" (see `/accessibility`, which this panel only LINKS
 * to, and `lib/a11y/preferences.ts`'s own docstring). Rendered once from
 * `AppShell`, so it is available, fixed in place, throughout the
 * authenticated app on every viewport.
 *
 * Deliberately reuses the SAME non-modal popover idiom `NotificationBell`
 * already established in this codebase: `role="dialog"`/`aria-modal="false"`
 * (never a real modal -- nothing behind it needs to be inert), the shared
 * `useRevealFocus` hook moves focus into the panel on open and restores it
 * to this trigger on close, and a plain Escape/outside-pointerdown pair
 * closes it -- not `useFocusTrap` (that hook is for genuinely modal
 * surfaces like `MoreSheet`/`CommandPalette`). No `role="menu"` anywhere:
 * the panel uses ordinary pressed buttons / switches / buttons / links,
 * exactly the "no incorrect ARIA menu pattern" the spec calls for.
 *
 * Fixed at the shell's own physical end/bottom corner (`end-4`/`bottom-*`,
 * i.e. physical LEFT under `dir="rtl"`) -- clear of `BottomNav` (opens
 * upward, offset above its height + `env(safe-area-inset-bottom)`),
 * `Sidebar`/`IdentityFooter` (right-side rail, never reached from the
 * left), `ShellUtilityBar`/`MobileIdentityBar`'s top bells/menus, and
 * `MAIN_CONTENT_ID`'s own content padding. Desktop drops the mobile
 * bottom-nav clearance for a plain small corner margin instead, since
 * `BottomNav` is `lg:hidden`.
 */
export function AccessibilityPreferencesButton() {
  const {
    preferences,
    setTextSize,
    setHighContrast,
    setReduceMotion,
    setReduceTransparency,
    setEmphasizeLinks,
    reset,
  } = useA11yPreferences();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const panelHeadingId = useId();

  useRevealFocus({ revealed: open, onRevealFocusRef: panelRef, fallbackFocusRef: triggerRef });

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Focus restore is `useRevealFocus`'s job, same as `NotificationBell`.
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="fixed z-30 end-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:end-6"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="אפשרויות נגישות"
        onClick={() => setOpen((prev) => !prev)}
        className={`relative flex h-11 w-11 items-center justify-center rounded-full bg-[var(--a11y-trigger-bg)] text-[var(--a11y-trigger-icon)] shadow-[var(--shadow-a11y-trigger)] ring-1 ring-[var(--a11y-trigger-ring)] transition-colors duration-150 hover:bg-[var(--a11y-trigger-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${EXPAND_HIT_AREA_CLASS}`}
      >
        <Accessibility className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={panelHeadingId}
          tabIndex={-1}
          className="glass-medium absolute bottom-full end-0 z-30 mb-2 w-72 max-w-[calc(100vw-2.5rem)] rounded-xl bg-surface-1 p-3 text-foreground shadow-[var(--shadow-elevated)] ring-1 ring-border-strong outline-none"
        >
          <p id={panelHeadingId} className="px-1 text-sm font-semibold text-foreground">
            אפשרויות נגישות
          </p>

          <div className="mt-3 px-1">
            <p className="text-xs font-semibold text-muted-2">גודל טקסט</p>
            <div className="mt-1.5">
              <TextSizeControl value={preferences.textSize} onChange={setTextSize} />
            </div>
          </div>

          <div className="mt-2 divide-y divide-border px-1">
            <PreferenceSwitchRow
              label="ניגודיות מוגברת"
              checked={preferences.highContrast}
              onChange={setHighContrast}
            />
            <PreferenceSwitchRow label="הפחתת תנועה" checked={preferences.reduceMotion} onChange={setReduceMotion} />
            <PreferenceSwitchRow
              label="הפחתת שקיפות"
              checked={preferences.reduceTransparency}
              onChange={setReduceTransparency}
            />
            <PreferenceSwitchRow label="הדגשת קישורים" checked={preferences.emphasizeLinks} onChange={setEmphasizeLinks} />
          </div>

          <button
            type="button"
            onClick={reset}
            className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-border-strong px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-overlay-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            איפוס הגדרות נגישות
          </button>

          <Link
            href="/accessibility"
            onClick={() => setOpen(false)}
            className="mt-2 block rounded px-1 text-center text-xs font-medium text-muted underline decoration-muted/40 underline-offset-2 transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            הצהרת נגישות
          </Link>
        </div>
      ) : null}
    </div>
  );
}
