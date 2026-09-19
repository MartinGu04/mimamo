"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { groupRosterHierarchy, type PersonGroupable } from "@/lib/presentation/roster";

/**
 * The one shape every person-selection UI in the app needs -- id/name plus
 * the real data fields `groupRosterHierarchy` groups by. Never a name-only
 * shape: without `personnelType`/`isSupervisor`/`isTechnician` a caller
 * can't be grouped at all, and a new person with these fields set
 * automatically lands in the right group everywhere this type is used, with
 * zero code changes.
 */
export interface PersonPickerPerson extends PersonGroupable {
  id: string;
  name: string;
}

/** A non-person option shown before the grouped roster (e.g. "כולם", "אני — X"). */
export interface PersonPickerLeadingOption {
  value: string;
  label: string;
}

interface SelectableRow {
  kind: "leading" | "person";
  value: string;
  label: string;
}

type PopupRow = SelectableRow | { kind: "header"; key: string; label: string };

interface PersonPickerProps {
  /** The full people list -- grouped internally, never pre-grouped by the caller. */
  people: readonly PersonPickerPerson[];
  /** Non-person options shown first, outside any group (e.g. "כולם"). */
  leadingOptions: readonly PersonPickerLeadingOption[];
  /** The currently selected option's value -- a leading option's `value` or a person's `id`. */
  selectedValue: string;
  onSelect: (value: string) => void;
  isPending: boolean;
  listboxId: string;
  listAriaLabel: string;
  triggerAriaLabel: (currentLabel: string) => string;
  triggerMaxWidthClassName?: string;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  /** Shown when a search narrows every group down to zero matches. */
  noMatchesLabel?: string;
}

/**
 * The one shared, data-driven person selector -- grouped קבע / סדיר
 * (אחמ״שים / טכנאים / אחרים) / מילואים / לא מסווג via `groupRosterHierarchy`,
 * the SAME function the manager roster listing uses, so a new person with
 * the right personnelType/role fields appears in the correct group here too
 * with zero code changes. Never groups by hardcoded names.
 *
 * A custom accessible listbox rather than a native `<select>` -- native
 * `<option>` popups are rendered by the browser/OS chrome and can't be
 * reliably restyled for dark mode, so every pixel here is our own
 * theme-aware surface instead. Full keyboard support: typing in the search
 * box filters live, ArrowUp/ArrowDown/Home/End move the highlight across
 * every currently-visible selectable option (leading options and people,
 * never a group header), Enter/Space selects, Escape closes and returns
 * focus to the trigger button, a pointer click outside closes it, and
 * Tab/Shift+Tab away from the popup closes it rather than leaving it
 * visually open with no keyboard path back into it.
 *
 * Searching filters people by name only -- leading options (never names)
 * always stay visible. A group/subgroup with zero matching people renders
 * no header at all, never an empty section; a person who does match stays
 * under their own group's header so they're never shown out of context.
 */
export function PersonPicker({
  people,
  leadingOptions,
  selectedValue,
  onSelect,
  isPending,
  listboxId,
  listAriaLabel,
  triggerAriaLabel,
  triggerMaxWidthClassName = "max-w-[9rem]",
  searchPlaceholder = "חיפוש לפי שם",
  searchAriaLabel = "חיפוש איש/אשת צוות",
  noMatchesLabel = "לא נמצאו התאמות",
}: PersonPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Map<string, HTMLLIElement | null>>(new Map());

  const groups = useMemo(() => groupRosterHierarchy(people), [people]);
  const normalizedQuery = query.trim().toLowerCase();

  // `leadingRows` and `groupedRows` (headers + matching people) are kept
  // separate from each other so rendering can show leading options
  // unconditionally while swapping ONLY the grouped-people area for a
  // no-matches message -- never hiding a row that `selectableRows` (used
  // for keyboard highlight/Enter/aria-activedescendant) still considers
  // selectable. `selectableRows` is always exactly the flattened set of
  // rows actually rendered, in DOM order, so a highlighted/keyboard-
  // selected option is never absent from the page.
  const { leadingRows, groupedRows, selectableRows } = useMemo(() => {
    const matches = (name: string) => normalizedQuery === "" || name.toLowerCase().includes(normalizedQuery);

    const leadingRows: SelectableRow[] = leadingOptions.map((leading) => ({
      kind: "leading",
      value: leading.value,
      label: leading.label,
    }));

    const groupedRows: PopupRow[] = [];
    const personRows: SelectableRow[] = [];

    function pushPeopleUnderHeader(headerKey: string, headerLabel: string, groupPeople: readonly PersonPickerPerson[]) {
      const matching = groupPeople.filter((person) => matches(person.name));
      if (matching.length === 0) return;
      groupedRows.push({ kind: "header", key: headerKey, label: headerLabel });
      for (const person of matching) {
        const row: SelectableRow = { kind: "person", value: person.id, label: person.name };
        groupedRows.push(row);
        personRows.push(row);
      }
    }

    for (const group of groups) {
      if (group.subgroups.length > 0) {
        for (const subgroup of group.subgroups) {
          pushPeopleUnderHeader(`${group.group}-${subgroup.group}`, `${group.label} · ${subgroup.label}`, subgroup.people);
        }
        continue;
      }
      pushPeopleUnderHeader(group.group, group.label, group.people);
    }

    return { leadingRows, groupedRows, selectableRows: [...leadingRows, ...personRows] };
  }, [groups, leadingOptions, normalizedQuery]);

  const hasNoMatches = normalizedQuery !== "" && groupedRows.length === 0;

  // Clamped at render time (never via an effect + setState) -- a search
  // query can shrink `selectableRows` between renders, and the raw
  // `highlightedIndex` state may briefly point past its new end.
  const clampedHighlightedIndex = Math.min(highlightedIndex, Math.max(selectableRows.length - 1, 0));

  // Resolved from the full, unfiltered `people`/`leadingOptions` -- never
  // from the search-filtered `selectableRows` -- so the trigger keeps
  // showing the real current selection even while a search query would
  // otherwise filter that very person out of the open popup.
  const selectedLeadingOption = leadingOptions.find((option) => option.value === selectedValue);
  const selectedPerson = selectedLeadingOption ? undefined : people.find((person) => person.id === selectedValue);
  const currentLabel = selectedLeadingOption?.label ?? selectedPerson?.name ?? leadingOptions[0]?.label ?? "";

  function openMenu() {
    const index = selectableRows.findIndex((row) => row.value === selectedValue);
    setHighlightedIndex(index === -1 ? 0 : index);
    setQuery("");
    setOpen(true);
  }

  function closeMenu(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function selectRow(row: SelectableRow) {
    closeMenu(true);
    if (row.value !== selectedValue) onSelect(row.value);
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeMenu(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const row = selectableRows[clampedHighlightedIndex];
    if (row) optionRefs.current.get(row.value)?.scrollIntoView?.({ block: "nearest" });
  }, [open, clampedHighlightedIndex, selectableRows]);

  function handleButtonKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu();
    }
  }

  /**
   * Tab/Shift+Tab away from the popup must never leave it visually open
   * with no keyboard path back into it -- same rationale as the single-
   * selector version this replaces. `relatedTarget` is the element gaining
   * focus; only close when it's leaving the popup entirely.
   */
  function handlePopupBlur(event: React.FocusEvent<HTMLInputElement>) {
    if (containerRef.current && containerRef.current.contains(event.relatedTarget as Node)) return;
    setOpen(false);
  }

  function handlePopupKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(index + 1, selectableRows.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setHighlightedIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setHighlightedIndex(selectableRows.length - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = selectableRows[clampedHighlightedIndex];
      if (row) selectRow(row);
    }
  }

  const highlightedValue = selectableRows[clampedHighlightedIndex]?.value;

  function renderOptionRow(row: SelectableRow) {
    const isSelected = row.value === selectedValue;
    const isHighlighted = row.value === highlightedValue;
    return (
      <li
        key={row.value}
        ref={(node) => {
          optionRefs.current.set(row.value, node);
        }}
        id={`${listboxId}-option-${row.value}`}
        role="option"
        aria-selected={isSelected}
        onMouseEnter={() => setHighlightedIndex(selectableRows.indexOf(row))}
        onClick={() => selectRow(row)}
        className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm transition-colors duration-150 ${
          isHighlighted ? "bg-overlay-strong text-foreground" : "text-foreground"
        }`}
      >
        <span className="truncate">{row.label}</span>
        {isSelected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" strokeWidth={2} /> : null}
      </li>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={triggerAriaLabel(currentLabel)}
        aria-busy={isPending}
        disabled={isPending}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={handleButtonKeyDown}
        className="flex items-center gap-1.5 rounded-full bg-overlay-soft px-3.5 py-1.5 text-sm font-medium text-foreground ring-1 ring-border transition-colors duration-200 hover:bg-overlay-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-70"
      >
        <span className={`${triggerMaxWidthClassName} truncate`}>{currentLabel}</span>
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted" aria-hidden="true" strokeWidth={2} />
        ) : (
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true" strokeWidth={2} />
        )}
      </button>

      {open ? (
        <div className="glass-medium absolute z-20 mt-1.5 w-64 rounded-xl bg-surface-2 p-1.5 shadow-[var(--shadow-elevated)] ring-1 ring-border-strong">
          <input
            ref={searchRef}
            type="text"
            role="searchbox"
            aria-label={searchAriaLabel}
            aria-controls={listboxId}
            aria-activedescendant={highlightedValue ? `${listboxId}-option-${highlightedValue}` : undefined}
            onKeyDown={handlePopupKeyDown}
            onBlur={handlePopupBlur}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mb-1.5 w-full rounded-xl bg-overlay-soft px-3 py-1.5 text-sm text-foreground placeholder:text-muted-2 focus:outline-none"
          />
          <ul
            id={listboxId}
            role="listbox"
            aria-label={listAriaLabel}
            // A pointerdown on a non-focusable `<li role="option">` would
            // otherwise blur the search input (the actually-focused
            // element) BEFORE the browser fires `click` -- `handlePopupBlur`
            // then closes/unmounts the popup mid-interaction, so the option
            // that was clicked is gone from the DOM by the time `click`
            // would fire and `onClick`/`selectRow` never runs. Blocking the
            // mousedown's default action keeps focus on the input for the
            // whole click, so selection can complete before anything closes.
            onMouseDown={(event) => event.preventDefault()}
            className="max-h-64 overflow-y-auto"
          >
            {leadingRows.map((row) => renderOptionRow(row))}
            {hasNoMatches ? (
              <li role="presentation" className="px-3 py-2 text-sm text-muted">
                {noMatchesLabel}
              </li>
            ) : (
              groupedRows.map((row) => {
                if (row.kind === "header") {
                  return (
                    <li key={row.key} role="presentation" className="px-3 pt-2.5 pb-1 text-[11px] font-semibold text-muted-2 first:pt-1">
                      {row.label}
                    </li>
                  );
                }
                return renderOptionRow(row);
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
