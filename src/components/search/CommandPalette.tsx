"use client";

import { useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CalendarDays, Search, UserRound, Users, X } from "lucide-react";
import { assignmentEmoji } from "@/lib/presentation/emoji";
import { formatHebrewWeekdayAndDate } from "@/lib/presentation/hebrewDate";
import { periodLabel } from "@/lib/presentation/labels";
import type { SearchReadModel } from "@/lib/readModels/searchTypes";
import { parseSearchIntent } from "@/lib/search/parseSearchIntent";
import { resolveSearchIntent, type SharedShiftOverrides } from "@/lib/search/resolveSearchIntent";
import type { GlobalSearchResult, SearchShiftPeriod, SharedShiftSearchResult } from "@/lib/search/types";
import { useFocusTrap } from "@/components/ui/useFocusTrap";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  model: SearchReadModel;
}

const EXAMPLE_QUERIES = ["עילאי", "מי איתי בשבת", "19.8", "מתי יש לי משמרת עם איתי"];

const NO_SHARED_SHIFT_OVERRIDES: SharedShiftOverrides = {};

function periodEmoji(period: SearchShiftPeriod): string {
  return assignmentEmoji({ category: "shift", period, dutyFamily: null, absenceKind: null }) ?? "";
}

function resultHref(result: GlobalSearchResult): string | null {
  return result.href;
}

/**
 * The global command palette (PR #35) -- a system-level search surface
 * mounted once via `SearchPaletteProvider`. Query parsing/resolution is
 * pure and entirely local (`parseSearchIntent`/`resolveSearchIntent` over
 * the already-loaded, safe `SearchReadModel`) -- no network request per
 * keystroke, no debounce needed.
 *
 * Keyboard/ARIA follows the exact combobox+listbox pattern already
 * established by `PersonPicker`: results are `role="option"` rows
 * highlighted via `aria-activedescendant` on the search input, never
 * separately focusable -- ArrowUp/ArrowDown/Enter on the input move
 * between and activate them. The dialog's own Tab/Shift+Tab focus trap,
 * initial focus, Escape-to-close, and focus-restore-on-close are the
 * shared `useFocusTrap` hook (`components/ui/`) -- this was the original
 * implementation (PR #35); it's now extracted so `MoreSheet` and other
 * modal surfaces reuse the exact same proven behavior instead of a second,
 * possibly-inconsistent copy.
 */
export function CommandPalette({ open, onClose, model }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [syncedOpen, setSyncedOpen] = useState(open);
  // PersonIds already picked to resolve an ambiguous shared_shift name (see
  // `SharedShiftDisambiguationResult`) -- reset whenever the query text
  // itself changes or the palette re-opens, so a stale choice can never
  // silently leak into a new, unrelated question.
  const [sharedShiftOverrides, setSharedShiftOverrides] = useState<SharedShiftOverrides>(NO_SHARED_SHIFT_OVERRIDES);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Resets the query/highlight the moment `open` flips true -- React's own
  // "adjusting state when a prop changes" pattern (a setState call during
  // render, guarded by comparing against a tracked previous value) rather
  // than an effect, so there's no extra render pass and no stale query
  // flash before the reset lands. `open` is always false on every render
  // that could still be running server-side (it only ever becomes true
  // from a client interaction after mount), so this never risks a
  // hydration mismatch either.
  if (open !== syncedOpen) {
    setSyncedOpen(open);
    if (open) {
      setQuery("");
      setHighlightedIndex(0);
      setSharedShiftOverrides(NO_SHARED_SHIFT_OVERRIDES);
    }
  }

  useFocusTrap({ open, onClose, containerRef: dialogRef, initialFocusRef: inputRef });

  const resolution = useMemo(() => {
    if (!open) return null;
    const intent = parseSearchIntent(query);
    return resolveSearchIntent(intent, model, sharedShiftOverrides);
  }, [open, query, model, sharedShiftOverrides]);

  const results = resolution?.results ?? [];
  const clampedIndex = Math.min(highlightedIndex, Math.max(results.length - 1, 0));
  const highlightedResult = results[clampedIndex];

  /**
   * A split-disambiguation candidate commits to one structural reading of
   * an "<A> ו<B> יחד" sentence (which text belongs to which person) --
   * resolved BEFORE any per-name ambiguity, since it decides what those
   * texts even are. A name-disambiguation candidate refines the
   * in-progress shared_shift query in place -- it records which roster
   * person the ambiguous side resolved to and lets resolution continue
   * (possibly straight to a final result, possibly to the second side's
   * own ambiguity). Neither ever navigates or closes the palette merely
   * because the user is resolving what they meant.
   *
   * Otherwise, a result with no `href` (e.g. a person with no shared shift)
   * is purely informational -- activating it must never close the palette
   * or navigate, which would misleadingly read as an action having
   * happened.
   */
  function activate(result: GlobalSearchResult) {
    if (result.kind === "shared_shift_split_disambiguation") {
      setSharedShiftOverrides((previous) => ({
        ...previous,
        splitChoice: { personAText: result.personAText, personBText: result.personBText },
      }));
      setHighlightedIndex(0);
      return;
    }
    if (result.kind === "shared_shift_disambiguation") {
      setSharedShiftOverrides((previous) => ({
        ...previous,
        [result.side === "A" ? "personA" : "personB"]: result.personId,
      }));
      setHighlightedIndex(0);
      return;
    }
    const href = resultHref(result);
    if (!href) return;
    onClose();
    router.push(href);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (highlightedResult) activate(highlightedResult);
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center sm:pt-[10vh]">
      <div role="presentation" aria-hidden="true" className="glass-scrim absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="חיפוש"
        className="relative flex h-dvh w-full flex-col bg-surface-1 sm:h-auto sm:max-h-[70vh] sm:max-w-xl sm:rounded-xl sm:shadow-[var(--shadow-elevated)] sm:ring-1 sm:ring-border-strong"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" strokeWidth={1.75} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={highlightedResult ? `${listboxId}-option-${highlightedResult.key}` : undefined}
            aria-label="חיפוש אנשים, תאריכים ומשמרות"
            autoComplete="off"
            placeholder="חפשו איש/אשת צוות, תאריך או משמרת..."
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlightedIndex(0);
              setSharedShiftOverrides(NO_SHARED_SHIFT_OVERRIDES);
            }}
            onKeyDown={handleInputKeyDown}
            className="min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-muted-2 focus:outline-none sm:text-sm"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירת חיפוש"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-overlay-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {query.trim() === "" ? (
            <IdlePane
              onPick={(example) => {
                setQuery(example);
                setHighlightedIndex(0);
                setSharedShiftOverrides(NO_SHARED_SHIFT_OVERRIDES);
              }}
            />
          ) : results.length === 0 ? (
            <EmptyPane message={resolution?.emptyMessage ?? null} />
          ) : (
            <ul id={listboxId} role="listbox" aria-label="תוצאות חיפוש" className="flex flex-col gap-1">
              {results.map((result, index) => (
                <ResultRow
                  key={result.key}
                  result={result}
                  optionId={`${listboxId}-option-${result.key}`}
                  highlighted={index === clampedIndex}
                  onHighlight={() => setHighlightedIndex(index)}
                  onActivate={() => activate(result)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function IdlePane({ onPick }: { onPick: (query: string) => void }) {
  return (
    <div className="px-3 py-4">
      <p className="px-1 text-xs font-medium text-muted-2">לדוגמה</p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {EXAMPLE_QUERIES.map((example) => (
          <li key={example}>
            <button
              type="button"
              onClick={() => onPick(example)}
              className="w-full rounded-xl px-3 py-2 text-start text-sm text-foreground transition-colors duration-150 hover:bg-overlay-soft"
            >
              {example}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 px-1 text-xs text-muted-2">↑↓ לניווט · Enter לבחירה · Esc לסגירה</p>
    </div>
  );
}

function EmptyPane({ message }: { message: string | null }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm text-foreground">{message ?? "לא מצאנו משהו שמתאים."}</p>
      {!message ? <p className="mt-1 text-xs text-muted">נסו שם, תאריך (19.8) או יום בשבוע (חמישי).</p> : null}
    </div>
  );
}

interface ResultRowProps {
  result: GlobalSearchResult;
  optionId: string;
  highlighted: boolean;
  onHighlight: () => void;
  onActivate: () => void;
}

function ResultRow({ result, optionId, highlighted, onHighlight, onActivate }: ResultRowProps) {
  return (
    <li
      id={optionId}
      role="option"
      aria-selected={highlighted}
      onMouseEnter={onHighlight}
      onClick={onActivate}
      className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 ${
        highlighted ? "bg-overlay-strong" : ""
      }`}
    >
      <ResultIcon result={result} />
      <ResultContent result={result} />
    </li>
  );
}

function ResultIcon({ result }: { result: GlobalSearchResult }) {
  const iconClassName = "h-4 w-4 text-muted";
  const wrapperClassName = "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-overlay-soft";

  switch (result.kind) {
    case "person":
    case "shared_shift_disambiguation":
      return (
        <span className={wrapperClassName}>
          <UserRound className={iconClassName} aria-hidden="true" strokeWidth={1.75} />
        </span>
      );
    case "date":
      return (
        <span className={wrapperClassName}>
          <CalendarDays className={iconClassName} aria-hidden="true" strokeWidth={1.75} />
        </span>
      );
    case "shift":
      return (
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center text-lg">
          {periodEmoji(result.period)}
        </span>
      );
    case "shared_shift":
    case "shared_shift_split_disambiguation":
    case "with_me":
      return (
        <span className={wrapperClassName}>
          <Users className={iconClassName} aria-hidden="true" strokeWidth={1.75} />
        </span>
      );
  }
}

/** "ביחד עם X" when the searching user is one side of the pair, "X ו-Y" for an arbitrary other+other pair -- never a meaningless third-person phrasing about oneself. */
function sharedShiftTitle(result: SharedShiftSearchResult): string {
  if (result.personA.isSelf) return `ביחד עם ${result.personB.name}`;
  if (result.personB.isSelf) return `ביחד עם ${result.personA.name}`;
  return `${result.personA.name} ו${result.personB.name}`;
}

function ResultContent({ result }: { result: GlobalSearchResult }) {
  switch (result.kind) {
    case "person":
      return (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{result.name}</p>
          <p className="truncate text-xs text-muted">
            {[result.roleLabel, result.personnelTypeLabel].filter(Boolean).join(" · ")}
          </p>
          {result.currentShift ? (
            <p className="mt-0.5 truncate text-xs font-medium text-primary">
              {periodEmoji(result.currentShift.period)} כרגע במשמרת {periodLabel(result.currentShift.period)}
            </p>
          ) : null}
          {result.nextShift ? (
            <p className="mt-0.5 truncate text-xs text-muted">
              המשמרת הבאה של {result.name}: {formatHebrewWeekdayAndDate(result.nextShift.date)} ·{" "}
              {periodLabel(result.nextShift.period)}
            </p>
          ) : null}
          {result.nextSharedShift ? (
            <p className="mt-0.5 truncate text-xs font-medium text-primary">
              ביחד איתך: {formatHebrewWeekdayAndDate(result.nextSharedShift.date)} · {periodLabel(result.nextSharedShift.period)}
            </p>
          ) : result.isSelf ? null : (
            <p className="mt-0.5 truncate text-xs text-muted-2">אין משמרת משותפת קרובה</p>
          )}
        </div>
      );
    case "date":
      return (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{result.label}</p>
        </div>
      );
    case "shift":
      return (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{result.label}</p>
          <p className="truncate text-xs text-muted">
            {result.people.length > 0
              ? result.people.map((person) => person.name).join(" · ")
              : "אין מידע על אנשים במשמרת זו."}
          </p>
        </div>
      );
    case "shared_shift":
      return (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{sharedShiftTitle(result)}</p>
          <p className="truncate text-xs text-muted">
            {result.shifts
              .map((shift) => `${formatHebrewWeekdayAndDate(shift.date)} · ${periodLabel(shift.period)}`)
              .join("  ·  ")}
          </p>
        </div>
      );
    case "shared_shift_split_disambiguation":
      // "A + B", never "A ו-B" -- the ambiguity being resolved here IS
      // where the conjunction "ו" sits, so re-inserting a literal "ו"
      // between the two texts would make two genuinely different splits
      // (e.g. "רוני" + "ייס וגדעון" vs. "רוני וייס" + "גדעון") render as
      // the exact same string.
      return (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {result.personAText} + {result.personBText}
          </p>
          <p className="truncate text-xs text-muted">בחרו את הפירוש הנכון</p>
        </div>
      );
    case "shared_shift_disambiguation":
      return (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{result.name}</p>
          <p className="truncate text-xs text-muted">
            {[result.roleLabel, result.personnelTypeLabel].filter(Boolean).join(" · ")}
          </p>
        </div>
      );
    case "with_me":
      return (
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {formatHebrewWeekdayAndDate(result.date)} · {periodLabel(result.period)}
          </p>
          <p className="truncate text-xs text-muted">
            {result.people.length > 0 ? result.people.map((person) => person.name).join(" · ") : "אין מידע על אנשים נוספים במשמרת זו."}
          </p>
        </div>
      );
  }
}
