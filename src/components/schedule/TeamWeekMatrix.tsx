import { isWeekendColumn } from "@/lib/domain/calendarMonth";
import { assignmentEmoji } from "@/lib/presentation/emoji";
import { eventColorBgClassName } from "@/lib/presentation/eventColor";
import { formatCompactDate, formatHebrewWeekdayAndDate, formatShortWeekday } from "@/lib/presentation/hebrewDate";
import type { ScheduleTeamWeekCellItem, ScheduleTeamWeekPerson, ScheduleTeamWeekView } from "@/lib/readModels/scheduleTypes";
import { Panel } from "@/components/ui/Panel";

interface TeamWeekMatrixProps {
  teamWeek: ScheduleTeamWeekView;
  /** "YYYY-MM-DD" -- the server-resolved "today", for the current-day row highlight. Never computed client-side. */
  todayDate: string;
}

/** At most this many items render directly in a cell before collapsing into a "+N" overflow -- never a taller cell. */
const MAX_VISIBLE_ITEMS = 2;

const GROUP_LABEL: Record<ScheduleTeamWeekPerson["roleGroup"], string> = {
  supervisor: 'אחמ"שים',
  technician: "טכנאים",
};

/**
 * Shared by every `<th>` in `<thead>` -- deliberately carries NEITHER
 * `height`/`top-*` NOR `z-*` (each callsite below adds its own single
 * value of each), never two conflicting utility classes for the same CSS
 * property on the same element (Tailwind resolves same-specificity
 * conflicts by generated-CSS source order, not by class-string order, so
 * this file never lets that ambiguity exist -- this is also exactly why
 * the corner `<th>` below needs its OWN height rather than reusing
 * `HEADER_ROW_HEIGHT`, since it spans both rows, not one).
 */
const HEADER_CELL_BASE =
  "sticky whitespace-nowrap border-b border-border bg-surface-2 px-2 py-2 align-middle text-xs font-semibold text-foreground";

/**
 * One header row's fixed height (2.25rem/36px) -- applied to BOTH the
 * group-header row and the person-name row below it, so each row's
 * rendered height is a real, provable constant instead of "whatever the
 * text happens to need" (every header cell is also `whitespace-nowrap`,
 * so neither row can ever grow taller by wrapping onto a second line).
 */
const HEADER_ROW_HEIGHT = "h-9";
/**
 * The person-name row's sticky offset -- MUST equal `HEADER_ROW_HEIGHT`
 * exactly, or the two sticky rows either overlap (offset too small) or
 * leave a visible gap (too large) once the page scrolls past them. Both
 * reference the same Tailwind spacing token ("9") by construction, not
 * two independently-chosen numbers that could quietly drift apart --
 * keep them paired if this value is ever changed.
 */
const HEADER_ROW_2_TOP = "top-9";

/**
 * A bounded max-height for the whole scroll viewport -- see the component
 * docstring for why this is required, not optional, for sticky to do
 * anything at all. `75vh` comfortably fits the full 7-row matrix (plus
 * its two header rows) on almost every real desktop/mobile viewport
 * without ever needing internal vertical scroll in the common case, while
 * still being a real, functional bound: a short viewport (a small phone
 * in landscape, a zoomed-in browser, or a future wider roster) gets a
 * genuinely scrollable, frozen-header/frozen-column matrix instead of a
 * silently-inert one.
 */
const MATRIX_MAX_HEIGHT = "max-h-[75vh]";

function rowBgClassName(isToday: boolean, isWeekend: boolean): string {
  if (isToday) return "bg-primary/[0.06]";
  if (isWeekend) return "bg-weekend-tint";
  return "bg-surface-1";
}

/**
 * One compact chip for a single Event inside a cell -- semantic soft-color
 * background (`eventColorBgClassName`, the SAME 11-slot palette every
 * other calendar surface in the app uses) plus the event's own semantic
 * emoji, never a re-derived color/emoji mapping. `title` is rendered
 * verbatim (`Event.title`, already normalized/display-friendly) -- never
 * reworded here. Tentative/shadow each get their own small, non-color
 * visual mark AND a screen-reader-only text equivalent, so neither state
 * is ever color-only.
 */
function CellItemChip({ item }: { item: ScheduleTeamWeekCellItem }) {
  const emoji = assignmentEmoji({
    category: item.category,
    period: item.period,
    dutyFamily: item.dutyFamily,
    absenceKind: item.absenceKind,
  });
  const bgClassName =
    eventColorBgClassName({
      category: item.category,
      period: item.period,
      dutyFamily: item.dutyFamily,
      absenceKind: item.absenceKind,
    }) ?? "bg-overlay-soft";

  const stateLabel = [item.tentative ? "משוער" : null, item.shadow ? "חפיפה / צל" : null]
    .filter((part): part is string => part !== null)
    .join(", ");

  return (
    <span className={`flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-4 text-foreground ${bgClassName}`}>
      {emoji ? (
        <span aria-hidden="true" className="shrink-0">
          {emoji}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{item.title}</span>
      {item.tentative ? (
        <span aria-hidden="true" className="shrink-0 font-semibold text-warning">
          ?
        </span>
      ) : null}
      {item.shadow ? (
        <span aria-hidden="true" className="shrink-0 rounded-sm bg-primary/15 px-0.5 text-[9px] font-medium text-primary">
          צל
        </span>
      ) : null}
      {stateLabel ? <span className="sr-only">, {stateLabel}</span> : null}
    </span>
  );
}

/** A cell's content: at most two chips, then a "+N" overflow with a real, accessible count -- never a taller cell, never a dropped item (the full list is still in `items`, only the RENDER is capped). An empty cell renders nothing at all -- no dash, no placeholder text, so a genuinely free day/person reads calmly. */
function TeamWeekCell({ items }: { items: ScheduleTeamWeekCellItem[] }) {
  if (items.length === 0) return null;

  const visible = items.slice(0, MAX_VISIBLE_ITEMS);
  const overflowCount = items.length - visible.length;

  return (
    <div className="flex flex-col gap-0.5">
      {visible.map((item) => (
        <CellItemChip key={item.key} item={item} />
      ))}
      {overflowCount > 0 ? (
        <span className="text-[10px] font-medium text-muted-2">
          +{overflowCount}
          <span className="sr-only"> פריטים נוספים</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * "שבוע צוות" -- the team-week roster matrix (dates × people), a second,
 * optional presentation of the manager "כולם" perspective (never a
 * replacement for the month calendar). A real `<table>`, deliberately not
 * a div grid: `scope="row"`/`scope="col"`/`scope="colgroup"` are what let
 * a screen reader announce "row: <date>, column: <person>" while
 * navigating cell by cell, which no amount of visual-only styling can
 * substitute for.
 *
 * Sticky first column (the date) + sticky header rows (role-group, then
 * person names) via CSS `position: sticky`, inside a wrapper that is a
 * REAL, bounded scroll viewport for both axes (`overflow-auto` +
 * `MATRIX_MAX_HEIGHT` below) -- this bound is not cosmetic, it's load-
 * bearing: per the CSS Overflow spec,
 * setting `overflow-x: auto` alone (leaving `overflow-y` unset/`visible`)
 * still forces `overflow-y`'s COMPUTED value to `auto` too (the "mixed
 * visible/non-visible" rule), which already makes this element the
 * nearest scrolling ancestor `position: sticky` measures against --
 * except, with no bounded height, this element's own content never
 * actually overflows it vertically, so its internal scroll offset never
 * changes and `top: 0` never visibly engages: the header would just
 * scroll away with the rest of the page, sticking to NOTHING (confirmed
 * in a real browser -- this was the actual, deeper bug behind the
 * originally-reported header overlap: the overlap can only be observed
 * once stickiness is genuinely functional). A bounded `max-height` is
 * what turns this same element into a REAL frozen-panes viewport --
 * both its header rows and its first column then stick correctly
 * relative to ITS OWN internal scroll, the same spreadsheet-style
 * "frozen row/column" behavior a wide roster needs, and it's the only
 * configuration in which sticky can ever do anything at all here. The
 * scroll region is also given `role="region"` + `tabIndex={0}` so a
 * keyboard-only user (no mouse/touch) can still reach and scroll it with
 * arrow keys; without that, a purely visual scrollable div containing no
 * natively-focusable content is invisible to Tab-only navigation.
 *
 * TWO stacked sticky header rows is the other subtlety here: `position:
 * sticky` does NOT stack multiple sticky elements on the same axis by
 * itself -- if both rows stuck to `top: 0`, the person-name row would sit
 * ON TOP OF the group-header row once scrolled, not beneath it (verified
 * in a real browser, not just at initial scroll position). The fix is a
 * real, explicit offset: the group-header row (and the corner "תאריך"
 * cell, which spans both rows) sticks at `top-0`, while the person-name
 * row sticks at `top-9` -- exactly the group-header row's own fixed `h-9`
 * height (see `HEADER_ROW_HEIGHT`/`HEADER_ROW_2_TOP` above), so the two
 * rows stack cleanly with no overlap and no gap. The sticky date column
 * (`start-0`) is an entirely separate axis and keeps working during
 * horizontal scroll regardless.
 *
 * `teamWeek.people` is already in final display order (every supervisor,
 * roster order preserved, then every technician, roster order preserved --
 * see `buildScheduleTeamWeekView`); this component only re-groups them by
 * `roleGroup` to compute each group header's `colSpan`, it never re-sorts.
 */
export function TeamWeekMatrix({ teamWeek, todayDate }: TeamWeekMatrixProps) {
  const supervisors = teamWeek.people.filter((person) => person.roleGroup === "supervisor");
  const technicians = teamWeek.people.filter((person) => person.roleGroup === "technician");
  const groups = (
    [
      { key: "supervisor" as const, people: supervisors },
      { key: "technician" as const, people: technicians },
    ] satisfies { key: ScheduleTeamWeekPerson["roleGroup"]; people: ScheduleTeamWeekPerson[] }[]
  ).filter((group) => group.people.length > 0);
  const columns = groups.flatMap((group) => group.people);

  if (columns.length === 0) {
    return (
      <Panel variant="compact" className="text-sm text-muted">
        אין אנשי צוות עם תפקיד מבצעי להצגה בשבוע זה.
      </Panel>
    );
  }

  return (
    <div
      role="region"
      aria-label="לוח צוות שבועי, גלילה אופקית ואנכית"
      tabIndex={0}
      className={`overflow-auto rounded-xl ring-1 ring-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${MATRIX_MAX_HEIGHT}`}
    >
      <table className="w-full border-separate border-spacing-0 text-sm">
        <caption className="sr-only">
          לוח צוות שבועי, {teamWeek.people.length} אנשי צוות, {teamWeek.dates.length} ימים
        </caption>
        <thead>
          <tr>
            <th
              rowSpan={2}
              scope="col"
              className={`${HEADER_CELL_BASE} start-0 top-0 z-30 h-[4.5rem] w-16 text-start sm:w-20`}
            >
              תאריך
            </th>
            {groups.map((group) => (
              <th
                key={group.key}
                scope="colgroup"
                colSpan={group.people.length}
                className={`${HEADER_CELL_BASE} ${HEADER_ROW_HEIGHT} top-0 z-20 text-center`}
              >
                {GROUP_LABEL[group.key]}
              </th>
            ))}
          </tr>
          <tr>
            {columns.map((person) => (
              <th
                key={person.id}
                scope="col"
                className={`${HEADER_CELL_BASE} ${HEADER_ROW_HEIGHT} ${HEADER_ROW_2_TOP} z-20 min-w-[128px] text-center font-medium`}
              >
                {person.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {teamWeek.dates.map((date, rowIndex) => {
            const isToday = date === todayDate;
            const isWeekend = isWeekendColumn(rowIndex);
            const rowBg = rowBgClassName(isToday, isWeekend);
            const weekday = formatShortWeekday(date) ?? "";
            const compact = formatCompactDate(date) ?? date;
            const fullLabel = formatHebrewWeekdayAndDate(date) ?? date;

            return (
              <tr key={date}>
                <th
                  scope="row"
                  className={`sticky start-0 z-10 whitespace-nowrap border-b border-border px-2 py-2 text-start text-xs font-medium ${rowBg} ${isToday ? "text-primary" : "text-foreground"}`}
                >
                  <span aria-hidden="true" className="block">
                    {weekday}
                  </span>
                  <span aria-hidden="true" className="block text-muted-2" dir="ltr">
                    {compact}
                  </span>
                  <span className="sr-only">
                    {fullLabel}
                    {isToday ? ", היום" : ""}
                  </span>
                </th>
                {columns.map((person) => (
                  <td key={person.id} className={`border-b border-border px-1.5 py-1.5 align-top ${rowBg}`}>
                    <TeamWeekCell items={teamWeek.cells[person.id]?.[date] ?? []} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
