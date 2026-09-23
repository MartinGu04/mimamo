import type { AbsenceKind, DutyFamily, EventCategory, EventPeriod } from "@/lib/domain/event";
import type { LocalNow } from "@/lib/domain/localNow";
import type { ManagerAbsenceEntry, ManagerDutyEntry, ManagerShiftOverviewEntry } from "./managerTypes";
import type { PersonalScheduleReadModel } from "./types";

/**
 * Which question `/schedule` is currently answering (PR #24):
 * - "self" -- "what does MY schedule look like?" (every normal user, always;
 *   a manager's own default).
 * - "person" -- "what does THIS person's schedule look like?" (manager only).
 * - "all" -- "what does the whole team's staffing look like?" (manager only).
 */
export type SchedulePerspective = "self" | "all" | "person";

/**
 * The only shape the manager perspective selector ever receives -- never a
 * full `Person`, never email. Carries `personnelType`/`isSupervisor`/
 * `isTechnician` (never more) so the shared `PersonPicker` can group people
 * into קבע/סדיר(אחמ״שים/טכנאים)/מילואים the same way the manager roster
 * does, purely data-driven -- no separate grouping source of truth.
 */
export interface ScheduleRosterOption {
  id: string;
  name: string;
  personnelType: string | null;
  isSupervisor: boolean;
  isTechnician: boolean;
}

/**
 * Everyone-mode's team staffing projection for the displayed calendar
 * month -- deliberately typed, not `PersonalEventView[]` dumped into a
 * grid (PR #24 §14). Reuses the EXACT same `ManagerShiftOverviewEntry`/
 * `ManagerDutyEntry`/`ManagerAbsenceEntry` shapes (and the coverage/duty/
 * absence semantics behind them) Manager Overview already renders --
 * scoped here to the displayed month instead of an arbitrary manager date
 * range, and built from the SAME in-memory manager snapshot (never a
 * second Google fetch, never per-date/per-person reimplementation).
 */
export interface ScheduleEveryoneReadModel {
  staffing: ManagerShiftOverviewEntry[];
  duties: ManagerDutyEntry[];
  absences: ManagerAbsenceEntry[];
}

/**
 * One shift-capable roster member for the "שבוע צוות" team-week matrix
 * (person × date, PR follow-up to PR #24's "all" perspective). `roleGroup`
 * is the same canonical `classifyRoleGroup()` capability-flag grouping the
 * rest of the app already uses for אחמ״שים/טכנאים sectioning (never a
 * title-string match) -- someone who is neither is never a member of this
 * list at all (see `isShiftCapable`), so "other" is structurally
 * impossible here and deliberately not part of this union.
 */
export interface ScheduleTeamWeekPerson {
  id: string;
  name: string;
  roleGroup: "supervisor" | "technician";
}

/**
 * One typed Event rendered inside a team-week matrix cell -- never raw
 * `rawValue`/`sourceSheet`/`sourceCell`. `title` is the SAME normalized,
 * display-friendly `Event.title` the rest of the app already renders
 * (e.g. `אחמ"ש יום`) -- this never reinvents its own wording. `period`/
 * `dutyFamily`/`absenceKind` are carried through only so the presentation
 * layer can derive the same semantic emoji/color every other surface uses
 * (`lib/presentation/emoji.ts`/`eventColor.ts`), never a second mapping.
 * `key` is a synthesized, purely positional identifier (never a raw
 * sheet/cell reference) -- stable enough for a React list key within one
 * render, nothing more.
 */
export interface ScheduleTeamWeekCellItem {
  key: string;
  title: string;
  category: EventCategory;
  period: EventPeriod;
  dutyFamily: DutyFamily | null;
  absenceKind: AbsenceKind | null;
  tentative: boolean;
  shadow: boolean;
}

/**
 * The "שבוע צוות" matrix projection: an explicit person × date identity
 * grid, built directly from the manager's already-authorized, UNSCOPED
 * `Event[]`/`Person[]` snapshot (never reverse-engineered from the
 * aggregated `ScheduleEveryoneReadModel` staffing/duties/absences lists
 * above, which lose individual person identity by design). `weekStart`/
 * `weekEnd`/`dates` may span two different Gregorian months (or even two
 * years) -- deliberately independent of whatever calendar MONTH the
 * "חודש" presentation happens to be showing, since a Sunday-Saturday
 * operational week is its own date range (see
 * `lib/domain/operationalWeek.ts`).
 */
export interface ScheduleTeamWeekView {
  weekStart: string;
  weekEnd: string;
  /** All seven dates in the week, ascending (Sunday first). */
  dates: string[];
  /** Already in final display order: every supervisor (roster order preserved), then every technician (roster order preserved) -- never re-sorted by the UI. */
  people: ScheduleTeamWeekPerson[];
  /**
   * `cells[personId][date]` -- densely populated for EVERY entry in
   * `people` × EVERY entry in `dates` (an empty array for "nothing that
   * day", never a missing/optional key), so a consumer never needs a
   * defensive fallback lookup. Keyed by person ID, never by name --
   * two roster members sharing a display name still get their own,
   * independently correct column.
   */
  cells: Record<string, Record<string, ScheduleTeamWeekCellItem[]>>;
}

/**
 * The full server-computed `/schedule` read model -- safe to serialize to
 * the authenticated user's own browser session. For a normal user,
 * `manager`/`roster` are always null/empty and `perspective` is always
 * "self" -- the exact same shape a manager's own default self view uses,
 * so a normal user's rendered page is byte-for-byte the pre-PR-24
 * personal Schedule experience. Never carries `sourceSheet`/`sourceCell`,
 * raw workbook objects, colleague email, or any `Person` beyond the safe
 * `PersonalProfile`/`ScheduleRosterOption` projections already used
 * elsewhere in this layer.
 */
export interface ScheduleReadModel {
  fetchedAt: string;
  localNow: LocalNow;

  /** Null for a normal (non-manager) user -- the manager selector must never render. */
  manager: { id: string; name: string } | null;
  /** The manager-visible roster for the selector, EXCLUDING the manager's own entry (they already have the explicit "אני" option). Always empty for a normal user. */
  roster: ScheduleRosterOption[];

  perspective: SchedulePerspective;
  /** Set only when `perspective === "person"`. */
  selectedPersonId: string | null;
  selectedPersonName: string | null;

  /**
   * Set for `perspective` "self" or "person" -- the exact same
   * `PersonalScheduleReadModel` shape `/schedule` already renders for the
   * authenticated user, reused outright for a selected person too (see
   * `buildScheduleReadModel.ts`). Null in "all" scope.
   */
  personal: PersonalScheduleReadModel | null;

  /** Set only for `perspective === "all"`. Null otherwise. */
  everyone: ScheduleEveryoneReadModel | null;

  /**
   * The "שבוע צוות" team-week matrix, set only for `perspective === "all"`
   * (same manager-only gate as `everyone` -- both are populated by the
   * exact same authorized branch of `buildManagerScheduleReadModel`, so
   * there is no separate authorization path to keep in sync). Always
   * populated for that perspective regardless of which presentation the
   * page is currently showing ("חודש" vs "שבוע צוות") -- computing it is
   * pure, in-memory work over data already fetched for `everyone`, never
   * a second Google request, so there's no cost to always having it ready
   * for an instant client-side-free toggle. Null otherwise.
   */
  teamWeek: ScheduleTeamWeekView | null;
}
