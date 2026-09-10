import { addCalendarDays, formatCalendarDate } from "./dateRange";
import { buildDutyBlocks, dayOfWeek, parseCalendarDate, type DutyBlock } from "./dutyBlocks";
import type { DutyFamily, Event } from "./event";

/**
 * "הקצאות שבוצעו" -- the canonical, business-confirmed allocation-weight
 * rules for how much real completed duty work is actually "worth", per
 * duty family. This is DELIBERATELY separate from `currentScore` (the
 * workbook's own opaque Fairness score, `lib/domain/fairnessAnalysis.ts`) --
 * that value is parsed straight off the Potential sheet's "טבלת צדק" table
 * and reflects Google Sheet formulas המחלבה never sees at runtime, while
 * this module derives a genuinely independent factual total purely from
 * real schedule `Event`s. Neither value is derived from the other, and
 * neither ever overwrites the other -- see `buildDutyFairnessReadModel.ts`'s
 * own docs for why `currentScore` stays untouched.
 *
 * Every number below was explicitly confirmed as the authoritative business
 * rule (not invented, not reverse-engineered from the workbook) -- this is
 * the ONE place they are allowed to appear as numeric literals; every other
 * layer (read model, presentation, UI) must go through this module rather
 * than hold its own copy.
 *
 * THREE genuinely different shapes of rule exist here -- confirmed by
 * business rules multiple times now. The second pass corrected an earlier
 * bug where every non-guard/reserve family, including the kitchen
 * families, was wrongly treated as day-multiplied; THIS pass corrected a
 * follow-up bug where `daily_kitchen` was left grouped with `full_kitchen`/
 * `weekend_kitchen` as a "flat per-allocation BLOCK" -- i.e. calendar-
 * adjacent `daily_kitchen` days were silently merged into one run
 * (`buildDutyBlocks` groups by consecutive date, same person/family/slot),
 * so a real, ALREADY-COMPLETED `daily_kitchen` day immediately followed by
 * a future/not-yet-happened `daily_kitchen` day for the same person got
 * merged into one block whose end extends past the cutoff -- silently
 * zeroing out credit for the day that genuinely already happened. "מטבח
 * יומי" (daily kitchen) means literally per-DAY, the same as `rasar`, not
 * "per allocation run" -- confirmed root cause of a real production report
 * (a person's recently-performed daily_kitchen duty not reflected in their
 * score).
 *
 * - DAY-BASED (`rasar`, `daily_kitchen`): each real, CONFIRMED, in-range
 *   duty Event independently contributes its family's weight -- a 3-day
 *   rasar stretch is 3 separate 0.2 contributions (`0.6` total), never one
 *   lump `0.2`; two SEPARATE calendar-adjacent daily_kitchen days are two
 *   separate 0.2 contributions, never merged into one. Never gated on
 *   "the whole run must be complete" -- each day stands on its own, so an
 *   already-completed day is never swallowed by an adjacent future day.
 * - FLAT PER-ALLOCATION BLOCKS (`full_kitchen`/`weekend_kitchen`/`oxid`/
 *   `evacuation_on_call`/`callup`): a `numberOfDays × rate` calculation is
 *   WRONG for these -- "per allocation/duty" means each real, CONFIRMED,
 *   consecutive-day run is ONE allocation, contributing its family's flat
 *   weight EXACTLY ONCE no matter how many days it spans. `weekend_kitchen`
 *   additionally only counts once the run matches the codebase's own
 *   already-established "complete weekend" shape
 *   (`DutyBlock.weekendCompleteness`, Thu-Fri-Sat -- see `dutyBlocks.ts`'s
 *   `computeWeekendCompleteness`, reused here outright, never re-derived)
 *   -- a still-in-progress or irregularly-shaped weekend_kitchen run simply
 *   hasn't happened yet, so it contributes `0` for now, same as any other
 *   incomplete allocation. `oxid`/`evacuation_on_call`/`callup` are real,
 *   confirmed duties too; they simply carry a weight of `0` -- never
 *   omitted from the table, so their "worth nothing" status is an explicit,
 *   documented fact rather than an accidental gap.
 * - BLOCK-BASED WITH SHAPE CLASSIFICATION (guard/reserve ONLY): the same
 *   "never `numberOfDays × rate`" principle as the flat-allocation
 *   families above, but with THREE distinct fixed weights depending on
 *   which of three confirmed shapes the block matches --
 *   `resolveGuardReserveBlockShape` below is the one place that decides
 *   which shape (or "unsupported") a real consecutive-day block matches.
 */
export type DayBasedDutyFamily = "rasar" | "daily_kitchen";

export type FlatAllocationDutyFamily = Exclude<DutyFamily, "guard" | "reserve" | DayBasedDutyFamily>;

/**
 * The canonical weight for every duty family EXCEPT guard/reserve (which
 * are block-based with three distinct shapes -- see
 * `GUARD_RESERVE_BLOCK_WEIGHT` below). `rasar`/`daily_kitchen` are applied
 * PER DAY; every other family here is applied ONCE PER CONSECUTIVE-DAY
 * ALLOCATION BLOCK, never multiplied by how many days that block spans --
 * see this module's own top-of-file docs for the full day-based vs
 * flat-per-allocation distinction. `oxid`/`evacuation_on_call`/`callup`
 * are listed explicitly at `0` -- confirmed business rule, not an
 * omission: "zero-value duties are still real duties, but they contribute
 * 0 to הקצאות שבוצעו."
 */
export const DUTY_ALLOCATION_WEIGHT_BY_FAMILY: Readonly<Record<Exclude<DutyFamily, "guard" | "reserve">, number>> = {
  rasar: 0.2,
  daily_kitchen: 0.2,
  full_kitchen: 0.5,
  weekend_kitchen: 1,
  oxid: 0,
  evacuation_on_call: 0,
  callup: 0,
};

/**
 * The three, and ONLY three, guard/reserve allocation-block shapes this
 * domain can classify -- confirmed business rules, never inferred from
 * `numberOfDays × rate`:
 *
 * - `single_day`: exactly 1 day.
 * - `half_week`: ANY 3 consecutive days, regardless of starting weekday --
 *   verified against the real workbook (real H2 3-day reserve/guard blocks
 *   do not all start Monday). Corrected from an earlier, too-strict
 *   "must start Monday" assumption that wrongly classified real
 *   Mon-start-only 3-day blocks as `half_week` and every OTHER real 3-day
 *   block (regardless of which weekdays it actually covers) as
 *   unsupported -- silently nulling those people's entire completed-
 *   allocation total. Never re-tighten this without a newly confirmed
 *   business rule.
 * - `weekend`: exactly 4 consecutive days, starting Thursday
 *   (Thu-Fri-Sat-Sun) -- the same real weekend allocation pattern the
 *   comparison target's own "weekend" concept refers to elsewhere in
 *   Fairness, confirmed as Thursday-Sunday for guard/reserve specifically
 *   (NOT the same 3-day Thu-Fri-Sat span `dutyBlocks.ts`'s
 *   `computeWeekendCompleteness` uses for `weekend_kitchen` -- the two
 *   families have different confirmed weekend spans, deliberately kept as
 *   two separate constants rather than one shared "weekend" shape). This
 *   weekday requirement is confirmed and, unlike half_week's, has NOT been
 *   relaxed.
 *
 * A REAL block matching none of these three (e.g. 2 days, 5 days, or a
 * 4-day span not starting Thursday) is a genuine, currently-unsupported
 * shape -- `resolveGuardReserveBlockShape` returns `null` rather than
 * guessing, and callers must surface that as an unresolved/diagnostic
 * fact, never silently drop or default it to one of the three weights.
 */
export type GuardReserveBlockShape = "single_day" | "half_week" | "weekend";

const GUARD_RESERVE_BLOCK_WEIGHT: Readonly<Record<GuardReserveBlockShape, number>> = {
  single_day: 0.25,
  half_week: 0.5,
  weekend: 1,
};

/** 0=Sunday .. 6=Saturday (`dayOfWeek`'s own convention). */
const THURSDAY = 4;

/**
 * Classifies a guard/reserve `DutyBlock`'s shape from its FULL real span
 * (`dayCount` + -- `weekend` only -- the weekday its `startDate` falls on)
 * -- never from a range-truncated partial view. This is why callers must
 * build blocks from a person's COMPLETE event history before ever
 * intersecting with an effective date range: a real Thursday-Sunday
 * weekend block that is only half over as of today must still be
 * recognized AS a weekend block (and therefore contribute nothing until
 * the whole thing is done), never misread as a 1- or 2-day allocation
 * just because only part of it has happened yet.
 *
 * `half_week` (any 3 consecutive days) never inspects the weekday at all
 * -- only `weekend` (which must start Thursday) does.
 *
 * Returns `null` for any real shape outside the three confirmed ones --
 * deliberately never a guessed/default weight.
 */
export function resolveGuardReserveBlockShape(dayCount: number, startDate: string): GuardReserveBlockShape | null {
  if (dayCount === 1) return "single_day";
  if (dayCount === 3) return "half_week";

  if (dayCount !== 4) return null;

  const start = parseCalendarDate(startDate);
  if (!start) return null;

  return dayOfWeek(start) === THURSDAY ? "weekend" : null;
}

/** Enough to identify exactly which real block couldn't be classified -- never the raw `Event[]` (see `DutyBlock`'s own privacy convention). */
export interface UnsupportedGuardReserveBlock {
  dutyFamily: "guard" | "reserve";
  slot: number | null;
  startDate: string;
  endDate: string;
  dayCount: number;
}

export interface CompletedDutyAllocationResult {
  /**
   * `null` ONLY when at least one real, CONFIRMED guard/reserve block
   * overlapping the effective range has a shape this domain cannot
   * classify (see `unsupportedBlocks`) -- in that case the true total is
   * genuinely unknown, so this is never a partial/best-effort sum that
   * silently drops the unclassifiable block's contribution. Otherwise a
   * real, non-negative number (possibly `0`).
   */
  total: number | null;
  /** Every real, confirmed guard/reserve block overlapping the effective range whose shape didn't match single-day/half-week/weekend -- empty whenever `total` is a real number. */
  unsupportedBlocks: readonly UnsupportedGuardReserveBlock[];
}

/**
 * A genuine, SETTLED duty occurrence -- `category === "duty"` (which, by
 * construction in `lib/parsers/event.ts`'s `parseEvent`, always carries a
 * non-null `dutyFamily`; checked explicitly anyway, the same genuine-duty
 * test `lib/domain/dutyBlocks.ts`'s `isBlockableDutyEvent` already
 * established) AND CONFIRMED only -- a tentative ("?"-suffixed) duty is
 * still a plan, not yet a completed fact, same convention
 * `fairnessShiftEngine.ts`'s `isConfirmedNonShadowRoleShift` already
 * established for shifts.
 */
function isSettledDutyEvent(event: Event): event is Event & { dutyFamily: DutyFamily } {
  return event.category === "duty" && event.dutyFamily !== null && event.certainty === "confirmed";
}

function isGuardOrReserve(dutyFamily: DutyFamily): dutyFamily is "guard" | "reserve" {
  return dutyFamily === "guard" || dutyFamily === "reserve";
}

function isDayBasedFamily(dutyFamily: DutyFamily): dutyFamily is DayBasedDutyFamily {
  return dutyFamily === "rasar" || dutyFamily === "daily_kitchen";
}

function isFlatAllocationFamily(dutyFamily: DutyFamily): dutyFamily is FlatAllocationDutyFamily {
  return dutyFamily !== "guard" && dutyFamily !== "reserve" && !isDayBasedFamily(dutyFamily);
}

function datesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA <= endB && endA >= startB;
}

/** A block is COMPLETELY inside `[periodStartDate, effectiveEndDate]` -- the shared "no partial credit for an in-progress/boundary-straddling block" rule every block-based family (flat-allocation and guard/reserve alike) uses. */
function isFullyWithinRange(block: Pick<DutyBlock, "startDate" | "endDate">, periodStartDate: string, effectiveEndDate: string): boolean {
  return block.startDate >= periodStartDate && block.endDate <= effectiveEndDate;
}

/**
 * The person's real "הקצאות שבוצעו" total: `rasar`/`daily_kitchen`'s
 * per-day contributions, PLUS each flat-allocation family's per-BLOCK
 * contribution, PLUS each guard/reserve block's shape-classified fixed
 * weight. `[periodStartDate, effectiveEndDate]` is the caller's
 * already-resolved effective range (period start through
 * `min(today, period end)` -- see `buildDutyFairnessReadModel.ts`); this
 * function never re-derives it and never looks at "now" itself.
 *
 * DAY-BASED families (`rasar`, `daily_kitchen`): each event independently
 * gated on `periodStartDate <= event.date <= effectiveEndDate` -- a
 * multi-day rasar stretch, or two separate calendar-adjacent daily_kitchen
 * days, still contribute for exactly the days genuinely inside the range,
 * never the whole stretch, never zero days just because part of it (or an
 * adjacent future day) falls outside. Deliberately NEVER routed through
 * `buildDutyBlocks` -- a real, already-completed day must never be
 * swallowed by a calendar-adjacent FUTURE day of the same family merging
 * into one block whose end extends past the cutoff (the confirmed root
 * cause of a real production report: a person's recently-performed
 * daily_kitchen duty not reflected in their score).
 *
 * Every other family (flat-allocation AND guard/reserve): blocks are built
 * from `personId`'s ENTIRE event history (never date-filtered first -- see
 * `resolveGuardReserveBlockShape`'s own docs for why this matters for
 * shape classification, and equally for `weekend_kitchen`'s
 * `weekendCompleteness`), then a block only contributes when it (a)
 * overlaps the effective range at all, (b) is fully CONFIRMED
 * (`DutyBlock.certainty`; a tentative/mixed block is not yet a settled
 * fact and never taints the total either), (c) -- guard/reserve only --
 * has a classifiable shape, (d) -- weekend_kitchen only -- matches the
 * established complete Thu-Fri-Sat weekend shape, and (e) is COMPLETELY
 * contained in `[periodStartDate, effectiveEndDate]` -- a block still
 * partially in the future (or straddling the period boundary) contributes
 * `0` for now, exactly like any other future/incomplete duty, never a
 * partial/prorated credit. Each qualifying block then contributes its
 * family's flat weight EXACTLY ONCE, regardless of `dayCount` -- never
 * `numberOfDays × rate`.
 */
const EMPTY_EXCLUDED_DATES: ReadonlySet<string> = new Set();

/** True when any calendar date in `[startDate, endDate]` (inclusive) is in `excludedDates` -- bounded by the block's own real length, never the whole period. */
function blockTouchesExcludedDate(startDate: string, endDate: string, excludedDates: ReadonlySet<string>): boolean {
  if (excludedDates.size === 0) return false;
  const start = parseCalendarDate(startDate);
  if (!start) return false;

  let cursor = start;
  let cursorStr = formatCalendarDate(cursor);
  for (let i = 0; cursorStr <= endDate && i < 400; i++) {
    if (excludedDates.has(cursorStr)) return true;
    cursor = addCalendarDays(cursor, 1);
    cursorStr = formatCalendarDate(cursor);
  }
  return false;
}

export function computeCompletedDutyAllocation(
  events: readonly Event[],
  personId: string,
  periodStartDate: string,
  effectiveEndDate: string,
  /**
   * Emergency Mode date exclusion (spec section 19) -- duties scheduled/
   * performed on an emergency date must not contribute to the regular
   * completed-duty score. Day-based families are excluded date-by-date;
   * a flat-allocation or guard/reserve block that touches ANY excluded
   * date anywhere in its own span is excluded in full (never split/
   * partially credited -- splitting a block would require inventing a
   * partial-block weighting rule this codebase has never had).
   */
  excludedDates: ReadonlySet<string> = EMPTY_EXCLUDED_DATES,
): CompletedDutyAllocationResult {
  const personEvents = events.filter((event) => event.personId === personId);

  let total = 0;

  // rasar/daily_kitchen -- day-based: partial credit for exactly the in-range days, never merged into a block.
  for (const event of personEvents) {
    if (!isSettledDutyEvent(event)) continue;
    if (!isDayBasedFamily(event.dutyFamily)) continue;
    if (event.date < periodStartDate || event.date > effectiveEndDate) continue;
    if (excludedDates.has(event.date)) continue;
    total += DUTY_ALLOCATION_WEIGHT_BY_FAMILY[event.dutyFamily];
  }

  const blocks = buildDutyBlocks(personEvents);
  const unsupportedBlocks: UnsupportedGuardReserveBlock[] = [];

  // Flat-allocation families -- one qualifying consecutive-day block = ONE fixed contribution, never numberOfDays x rate.
  for (const block of blocks) {
    if (!isFlatAllocationFamily(block.dutyFamily)) continue;
    if (block.certainty !== "confirmed") continue;
    if (!datesOverlap(block.startDate, block.endDate, periodStartDate, effectiveEndDate)) continue;
    if (block.dutyFamily === "weekend_kitchen" && block.weekendCompleteness !== "complete") continue;
    if (!isFullyWithinRange(block, periodStartDate, effectiveEndDate)) continue;
    if (blockTouchesExcludedDate(block.startDate, block.endDate, excludedDates)) continue;

    total += DUTY_ALLOCATION_WEIGHT_BY_FAMILY[block.dutyFamily];
  }

  // Guard/reserve -- shape-classified fixed weight, or unresolved if the real shape matches none of the three confirmed ones.
  for (const block of blocks) {
    if (!isGuardOrReserve(block.dutyFamily)) continue;
    if (block.certainty !== "confirmed") continue;
    if (!datesOverlap(block.startDate, block.endDate, periodStartDate, effectiveEndDate)) continue;

    const shape = resolveGuardReserveBlockShape(block.dayCount, block.startDate);
    if (shape === null) {
      unsupportedBlocks.push({
        dutyFamily: block.dutyFamily,
        slot: block.slot,
        startDate: block.startDate,
        endDate: block.endDate,
        dayCount: block.dayCount,
      });
      continue;
    }

    if (!isFullyWithinRange(block, periodStartDate, effectiveEndDate)) continue;
    if (blockTouchesExcludedDate(block.startDate, block.endDate, excludedDates)) continue;

    total += GUARD_RESERVE_BLOCK_WEIGHT[shape];
  }

  if (unsupportedBlocks.length > 0) return { total: null, unsupportedBlocks };
  return { total, unsupportedBlocks: [] };
}

export interface ActiveDutyBlockInfo {
  dutyFamily: DutyFamily;
  slot: number | null;
  startDate: string;
  endDate: string;
}

/**
 * Justice Table redesign -- the one real, CONFIRMED, completion-based duty
 * block (flat-allocation or guard/reserve -- day-based families are
 * deliberately excluded, see below) that is currently ACTIVE for `personId`
 * as of `today`: `today` falls within the block's own `[startDate, endDate]`
 * AND the block has not yet finished as of `today` (`endDate > today`,
 * strictly) -- exactly the case where `computeCompletedDutyAllocation`
 * still correctly contributes `0` for it (a still-in-progress block is
 * never partially/early credited), so a "LIVE, points will be added on
 * completion" indicator can explain why, instead of the block silently
 * appearing to contribute nothing.
 *
 * Day-based families (`rasar`/`daily_kitchen`) are deliberately EXCLUDED --
 * each real day already accrues its own contribution the moment it happens
 * (see this module's own top-of-file docs), so there is no "points withheld
 * until completion" state to explain for them; applying the LIVE rule to
 * them would misrepresent already-existing per-day scoring as still
 * pending.
 *
 * Blocks are built from `personId`'s ENTIRE event history (never date-range-
 * filtered first) -- the same convention `computeCompletedDutyAllocation`
 * already requires for correct guard/reserve shape classification. Returns
 * only the FIRST matching block (there is never expected to be more than
 * one truly active completion-based block for one person at once); `null`
 * when none is active. Never mutates `events` and never affects
 * `computeCompletedDutyAllocation`'s own total -- this is a purely
 * additional, presentation-facing fact.
 */
export function resolveActiveDutyBlock(
  events: readonly Event[],
  personId: string,
  today: string,
): ActiveDutyBlockInfo | null {
  const personEvents = events.filter((event) => event.personId === personId);
  const blocks = buildDutyBlocks(personEvents);

  for (const block of blocks) {
    if (block.certainty !== "confirmed") continue;
    if (isDayBasedFamily(block.dutyFamily)) continue;
    if (block.startDate > today || block.endDate <= today) continue;

    return { dutyFamily: block.dutyFamily, slot: block.slot, startDate: block.startDate, endDate: block.endDate };
  }

  return null;
}
