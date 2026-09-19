import type { ReactNode } from "react";
import type { PersonalDutyBlock, PersonalEventView } from "@/lib/readModels/types";
import { assignmentEmoji, dutyFamilyEmoji } from "@/lib/presentation/emoji";
import { dutyFamilyLabel, periodLabel, roleLabel } from "@/lib/presentation/labels";
import { formatShortWeekday } from "@/lib/presentation/hebrewDate";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { TimeRange } from "./TimeRange";

interface UpcomingSectionProps {
  upcomingEvents: PersonalEventView[];
  dutyBlocks: PersonalDutyBlock[];
  localNowDate: string;
  /**
   * The exact Events the Hero is already displaying (currentAssignments,
   * or nextAssignmentGroup.events) -- excluded here by an exact-Event
   * match, never by date alone. A same-date Event the Hero is NOT
   * showing (a later shift, an unrelated duty) must still appear.
   */
  representedAssignments: PersonalEventView[];
}

/**
 * A signature built only from fields already safe on `PersonalEventView`
 * -- never `sourceSheet`/`sourceCell`. Good enough to recognize "this is
 * the same Event the Hero is showing", while still letting two distinct
 * Events that happen to share every visible field be treated as
 * legitimately separate entries (multiplicity is preserved via counting,
 * not a Set -- see `excludeRepresented`).
 */
function eventSignature(event: PersonalEventView): string {
  return [
    event.date,
    event.category,
    event.role ?? "",
    event.period,
    event.slot ?? "",
    event.dutyFamily ?? "",
    event.shadow ? "1" : "0",
    event.startTimeOverride ?? "",
    event.endTimeOverride ?? "",
    event.title,
    event.rawValue,
  ].join("|");
}

/**
 * Removes exactly the Events already represented by the Hero -- one
 * upcoming Event per matching represented Event, never a blanket
 * same-signature wipe (so genuine duplicate-safe projections aren't
 * accidentally collapsed).
 */
function excludeRepresented<T extends PersonalEventView>(events: T[], represented: PersonalEventView[]): T[] {
  const remaining = new Map<string, number>();
  for (const event of represented) {
    const sig = eventSignature(event);
    remaining.set(sig, (remaining.get(sig) ?? 0) + 1);
  }

  const kept: T[] = [];
  for (const event of events) {
    const sig = eventSignature(event);
    const count = remaining.get(sig) ?? 0;
    if (count > 0) {
      remaining.set(sig, count - 1);
      continue;
    }
    kept.push(event);
  }
  return kept;
}

/**
 * A duty block is already represented by the Hero when one of the Hero's
 * own duty Events belongs to it (same family + slot, and its date is one
 * of the block's actual dates) -- not merely because the block's
 * `startDate` happens to equal the Hero's date, which fails for a
 * multi-day block that started before today/the next group's date.
 */
function isBlockRepresented(block: PersonalDutyBlock, representedAssignments: PersonalEventView[]): boolean {
  return representedAssignments.some(
    (event) =>
      event.category === "duty" &&
      event.dutyFamily === block.dutyFamily &&
      event.slot === block.slot &&
      block.dates.includes(event.date),
  );
}

interface UpcomingRow {
  key: string;
  date: string;
  endDate?: string;
  title: string;
  emoji: string | null;
  meta: string | null;
  time: ReactNode | null;
  tentative: boolean;
}

const MAX_ROWS = 6;

/**
 * "הקרובים שלי" -- a small, deliberately bounded horizon (never the whole
 * spreadsheet). Shift rows come from `upcomingEvents`; duty rows are
 * summarized from `dutyBlocks` so a multi-day duty gets one compact
 * grouped row instead of one row per day.
 */
export function UpcomingSection({
  upcomingEvents,
  dutyBlocks,
  localNowDate,
  representedAssignments,
}: UpcomingSectionProps) {
  const upcomingShiftEvents = upcomingEvents.filter((event) => event.category === "shift");
  const shiftRows: UpcomingRow[] = excludeRepresented(upcomingShiftEvents, representedAssignments).map(
    (event, index) => ({
      key: `shift-${index}`,
      date: event.date,
      title: event.title,
      emoji: assignmentEmoji(event),
      meta: [roleLabel(event.role), periodLabel(event.period)].filter(Boolean).join(" · ") || null,
      time:
        event.timing.status === "resolved" ? (
          <TimeRange start={event.timing.startLocalTime} end={event.timing.endLocalTime} />
        ) : null,
      tentative: event.certainty === "tentative",
    }),
  );

  const dutyRows: UpcomingRow[] = dutyBlocks
    .filter((block) => block.endDate >= localNowDate && !isBlockRepresented(block, representedAssignments))
    .map((block, index) => ({
      key: `duty-${index}`,
      date: block.startDate,
      endDate: block.endDate !== block.startDate ? block.endDate : undefined,
      title: dutyFamilyLabel(block.dutyFamily) + (block.slot !== null ? ` ${block.slot}` : ""),
      emoji: dutyFamilyEmoji(block.dutyFamily),
      meta: block.dayCount > 1 ? `${block.dayCount} ימים` : null,
      time: null,
      tentative: block.certainty === "tentative" || block.certainty === "mixed",
    }));

  const rows = [...shiftRows, ...dutyRows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(
    0,
    MAX_ROWS,
  );

  return (
    <Panel variant="panel" glass="subtle">
      <h3 className="text-sm font-semibold text-foreground">הקרובים שלי</h3>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted">אין פריטים נוספים באופק הקרוב.</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors duration-200 hover:bg-overlay-faint"
            >
              <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-overlay-soft py-2 text-center">
                <span className="text-[11px] font-medium text-muted-2">{formatShortWeekday(row.date)}</span>
                <span dir="ltr" className="text-sm font-semibold text-foreground">
                  {formatDateRangeCompact(row.date, row.endDate)}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                  {row.emoji ? (
                    <span aria-hidden="true" className="text-xs">
                      {row.emoji}
                    </span>
                  ) : null}
                  {row.title}
                </p>
                {row.meta ? <p className="truncate text-xs text-muted">{row.meta}</p> : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {row.time ? <span className="text-xs text-muted">{row.time}</span> : null}
                {row.tentative ? <Badge tone="warning">משוער</Badge> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function formatDateRangeCompact(date: string, endDate?: string): string {
  const [, month, day] = date.split("-");
  const start = `${Number(day)}.${Number(month)}`;
  if (!endDate) return start;
  const [, endMonth, endDay] = endDate.split("-");
  return `${start}–${Number(endDay)}.${Number(endMonth)}`;
}
