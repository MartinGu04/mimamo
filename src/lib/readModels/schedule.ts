import "server-only";
import { calendarMonthOfLocalNow, formatMonthParam, parseMonthParam } from "@/lib/domain/calendarMonth";
import { resolveManagerDateRange } from "@/lib/domain/dateRange";
import { getOperationalWeek, getOperationalWeekForDate } from "@/lib/domain/operationalWeek";
import { ShiftConfigurationError, buildShiftSchedule, type ShiftSchedule } from "@/lib/domain/shiftSchedule";
import { SHEET_SOURCES, type RawWorkbookSnapshot, type SheetSourceKey } from "@/lib/google";
import { parseEvent } from "@/lib/parsers/event";
import { parsePersonnelSheet } from "@/lib/parsers/personnel";
import { parsePotentialSheet } from "@/lib/parsers/potential";
import { parseScheduleSheet } from "@/lib/parsers/schedule";
import { parseSettingsSheet } from "@/lib/parsers/settings";
import { getWorkbookSnapshot } from "@/lib/sync";
import { getJerusalemLocalNow } from "@/lib/time/jerusalemClock";
import {
  buildManagerScheduleReadModel,
  buildMappedEveryoneScheduleReadModel,
  buildSelfOnlyScheduleReadModel,
} from "./buildScheduleReadModel";
import { buildEmergencyScheduleReadModel } from "./buildEmergencyScheduleReadModel";
import { resolveOperationalRoster } from "./operationalMode";
import { getManagerWorkbookSheet, loadManagerWorkbookContext } from "./managerWorkbookContext";
import { getScheduleWorkbookSheet, loadScheduleWorkbookContext } from "./scheduleWorkbookContext";
import { getRequestPersonalSchedule } from "./getRequestPersonalSchedule";
import type { EmergencyScheduleReadModel } from "./emergencyScheduleTypes";
import type { PersonalScheduleReadModel } from "./types";
import type { ScheduleReadModel } from "./scheduleTypes";

export type ScheduleLoadResult =
  | { status: "unauthenticated" }
  | { status: "missing_email" }
  | { status: "unmapped" }
  | { status: "ambiguous_identity" }
  | { status: "configuration_error"; message: string }
  | { status: "ok"; model: ScheduleReadModel }
  /** Emergency Mode is active and its workbook is readable -- desk-based staffing, never regular role coverage (spec section 10). */
  | { status: "emergency"; model: EmergencyScheduleReadModel }
  /** Emergency Mode is active but its own workbook is unreadable -- must render a visible unavailable state, never fall back to regular schedule data. */
  | { status: "emergency_unavailable"; message: string };

/**
 * Everything a MANAGER's Schedule request needs, across all three
 * perspectives (self/person/all) -- personnel + schedule + settings +
 * potentialH1/H2, PLUS `shootingRanges` for cache-key alignment (see
 * below). Used ONLY by `loadManagerScheduleReadModel` -- the non-manager
 * "all" path (`loadMappedEveryoneScheduleReadModel`) deliberately uses a
 * DIFFERENT, narrower source set; see `scheduleWorkbookContext.ts`'s
 * `SCHEDULE_WORKBOOK_SOURCES` for why.
 *
 * `shootingRanges` itself is unused by anything in this file, kept ONLY so
 * `getWorkbookSnapshot`'s canonical (sorted+deduped) source-set cache key
 * resolves to the EXACT SAME entry `MANAGER_WORKBOOK_SOURCES` does
 * (Manager Overview, Home, Report 1 -- see `managerWorkbookContext.ts`'s
 * own constant). Before this, the Schedule page's own `getWorkbookSnapshot`
 * call was keyed on a genuinely DIFFERENT canonical string (missing
 * `shootingRanges`), so it landed in its own, independently-`unstable_cache`d
 * 30s window -- meaning this page and every `MANAGER_WORKBOOK_SOURCES`
 * caller could each be serving a DIFFERENT point-in-time read of the
 * identical "schedule" sheet (whichever one last happened to revalidate),
 * even though both requests fetch the exact same underlying Google Sheets
 * tab. A manager who just edited an assignment and immediately compared
 * this page against, say, Report 1 could see the edit on one and not (yet)
 * on the other purely from that cache-key mismatch -- never from any
 * actual parsing/classification difference between the two features (see
 * `reportOneShadowRoleRawPipelineRegression.test.ts` for the proof that
 * layer is correct). Matching the key here removes that class of
 * cross-feature staleness entirely, for a MANAGER specifically, the same
 * "deliberately over-request to land on a shared cache entry" convention
 * `reportOneTomorrow.ts` already documents for its own relationship to the
 * Home page.
 */
const SCHEDULE_MANAGER_SOURCES: SheetSourceKey[] = [
  "personnel",
  "schedule",
  "settings",
  "potentialH1",
  "potentialH2",
  "shootingRanges",
];

export interface ScheduleParams {
  /** Raw, unvalidated `?month=` value ("YYYY-MM" or anything else) -- this loader resolves the "today" fallback itself from the shared personal read model's own `localNow`, the same `calendarMonthOfLocalNow` convention the page uses for display. Never trusted without `parseMonthParam`. */
  rawMonth: string | null;
  /**
   * Raw, unvalidated `?person=` value. `"all"` resolves to the "all"
   * perspective for EVERY authenticated, uniquely-mapped viewer (manager
   * or not -- see `loadScheduleReadModel`). Any OTHER non-null value (an
   * arbitrary person id) is honored ONLY for an actual manager
   * (`buildManagerScheduleReadModel`'s own fail-closed
   * `resolveSchedulePerspective`); for a non-manager it always
   * normalizes/falls back to "self", the exact same server-side floor as
   * before -- never that other person's schedule.
   */
  personId: string | null;
  /** Raw, unvalidated `?week=` value ("YYYY-MM-DD" anchor, or anything else) -- resolved through `getOperationalWeekForDate`, falling back to the operational week containing `localNow.date` for anything unparseable. Only ever affects the "all" perspective's `teamWeek` matrix; completely inert for "self"/"person". */
  rawWeek: string | null;
}

/**
 * Server-only orchestration for `ScheduleReadModel`. Mirrors
 * `managerOverview.ts`'s split between authorization/fetch (this file) and
 * pure construction (`buildScheduleReadModel.ts`).
 *
 * Two SEPARATE authorization paths past the shared personal-schedule gate,
 * matching the two concepts `ScheduleReadModel` itself now documents:
 *
 * 1. Reuses `getRequestPersonalSchedule()` -- the SAME request-scoped
 *    result the protected layout and `/schedule` itself already compute
 *    (react `cache()` dedupes this to zero extra calls) -- as the FIRST
 *    gate for every caller, manager or not: it's how "authenticated +
 *    uniquely mapped" itself gets proven, before anything else.
 * 2. A manager (`selfModel.person.isManager === true`) always goes through
 *    `loadManagerScheduleReadModel` -- ONE additional Google request
 *    (`loadManagerWorkbookContext(SCHEDULE_MANAGER_SOURCES)`), the exact
 *    same fail-closed re-verification (fresh identity, fresh personnel
 *    parse, fresh manager check) every other manager-only feature uses,
 *    unchanged from before this split. This is what still gates
 *    `manager`/`roster`/`perspective: "person"` -- nothing here broadens
 *    manager-only behavior.
 * 3. A non-manager's `?person=` OTHER than `"all"` (missing, their own id,
 *    someone else's id, garbage) stays the existing zero-extra-fetch
 *    self-only path -- `buildSelfOnlyScheduleReadModel(selfModel)` directly
 *    from the already-fetched `selfModel`, exactly as before this change.
 * 4. A non-manager's `?person=all` is the NEW path:
 *    `loadMappedEveryoneScheduleReadModel` -- reuses
 *    `loadScheduleWorkbookContext()`'s narrower, non-manager-gated fetch
 *    (see that function's own docs), which is deliberately keyed to match
 *    `getRequestPersonalSchedule()`'s own 5-source set exactly, so it
 *    resolves to the SAME `getWorkbookSnapshot` cache entry step 1 already
 *    populated for this request -- no second Google batch introduced by
 *    this new path for the common case.
 */
export async function loadScheduleReadModel(params: ScheduleParams): Promise<ScheduleLoadResult> {
  const personalResult = await getRequestPersonalSchedule();

  if (personalResult.status === "unauthenticated") return { status: "unauthenticated" };
  if (personalResult.status === "missing_email") return { status: "missing_email" };
  if (personalResult.status === "unmapped") return { status: "unmapped" };
  if (personalResult.status === "ambiguous_identity") return { status: "ambiguous_identity" };
  if (personalResult.status === "configuration_error") {
    return { status: "configuration_error", message: personalResult.message };
  }
  if (personalResult.status === "emergency_unavailable") {
    return { status: "emergency_unavailable", message: personalResult.message };
  }
  if (personalResult.status === "emergency") {
    return loadEmergencyScheduleReadModel(personalResult.person, params);
  }

  const { model: selfModel } = personalResult;

  if (selfModel.person.isManager) {
    return loadManagerScheduleReadModel(selfModel, params);
  }

  if (params.personId !== "all") {
    return { status: "ok", model: buildSelfOnlyScheduleReadModel(selfModel) };
  }

  return loadMappedEveryoneScheduleReadModel(selfModel, params);
}

/**
 * The manager branch -- BYTE-FOR-BYTE the same authorization/fetch/parse
 * behavior this file always had, just extracted into its own function so
 * `loadScheduleReadModel` can dispatch to it explicitly instead of gating
 * everything else behind `!isManager`. Nothing about this function's own
 * behavior changed by that extraction.
 */
async function loadManagerScheduleReadModel(
  selfModel: PersonalScheduleReadModel,
  params: ScheduleParams,
): Promise<ScheduleLoadResult> {
  const currentMonthKey = calendarMonthOfLocalNow(selfModel.localNow);
  const displayMonthKey = parseMonthParam(params.rawMonth) ?? currentMonthKey;
  const monthParam = formatMonthParam(displayMonthKey);

  const contextResult = await loadManagerWorkbookContext(SCHEDULE_MANAGER_SOURCES);
  if (contextResult.status !== "ok") {
    // Fresh re-verification couldn't reconfirm manager status for THIS
    // request (e.g. personnel changed between the two fetches) -- fail
    // closed to the same self-only experience a normal user gets, rather
    // than surfacing an error for someone who is still a fully authorized
    // person, just not (right now) provably a manager.
    return { status: "ok", model: buildSelfOnlyScheduleReadModel(selfModel) };
  }

  const { manager, people, snapshot } = contextResult.context;

  const settings = parseSettingsSheet(getManagerWorkbookSheet(snapshot, "settings"));

  let shiftSchedule: ShiftSchedule;
  try {
    shiftSchedule = buildShiftSchedule(settings.shiftStartTimeDay);
  } catch (error) {
    if (error instanceof ShiftConfigurationError) {
      return { status: "configuration_error", message: error.message };
    }
    throw error;
  }

  const rawAssignments = parseScheduleSheet(getManagerWorkbookSheet(snapshot, "schedule"), people);
  const events = rawAssignments.map(parseEvent);

  const potentialAllocations = [
    ...parsePotentialSheet(getManagerWorkbookSheet(snapshot, "potentialH1"), people),
    ...parsePotentialSheet(getManagerWorkbookSheet(snapshot, "potentialH2"), people),
  ];

  const range = resolveManagerDateRange("month", monthParam, selfModel.localNow);

  // `?week=` resolves the SAME way `?month=` does above -- an explicit,
  // parseable anchor wins, anything else (missing, malformed, an
  // out-of-range date) falls back to the operational week containing
  // "today", never a crash and never a fabricated week.
  const week = (params.rawWeek ? getOperationalWeekForDate(params.rawWeek) : null) ?? getOperationalWeek(selfModel.localNow);

  const model = buildManagerScheduleReadModel({
    manager,
    people,
    events,
    shiftSchedule,
    fetchedAt: snapshot.fetchedAt,
    now: selfModel.localNow,
    monthDates: range.dates,
    week,
    requestedPersonId: params.personId,
    potentialAllocations,
  });

  return { status: "ok", model };
}

/**
 * The NEW path: a non-manager's `?person=all` -- the "all" perspective's
 * safe, read-only `everyone`/`teamWeek` projection for ANY authenticated,
 * uniquely-mapped viewer. Deliberately does NOT use
 * `loadManagerWorkbookContext`/`SCHEDULE_MANAGER_SOURCES` -- this is the
 * whole point of the split: Team Schedule visibility is never gated on
 * `person.isManager`. `manager`/`roster` are unconditionally null/empty on
 * the result (`buildMappedEveryoneScheduleReadModel` never sets them) --
 * an actual manager visiting `/schedule?person=all` never reaches this
 * function at all (see `loadScheduleReadModel`'s own dispatch), so this
 * function itself never needs to check `isManager` either.
 */
async function loadMappedEveryoneScheduleReadModel(
  selfModel: PersonalScheduleReadModel,
  params: ScheduleParams,
): Promise<ScheduleLoadResult> {
  const currentMonthKey = calendarMonthOfLocalNow(selfModel.localNow);
  const displayMonthKey = parseMonthParam(params.rawMonth) ?? currentMonthKey;
  const monthParam = formatMonthParam(displayMonthKey);

  const contextResult = await loadScheduleWorkbookContext();
  if (contextResult.status !== "ok") {
    // Fresh re-verification couldn't reconfirm this request's identity
    // (e.g. an extremely rare race where personnel changed between the two
    // fetches within the same request) -- fail closed to the same
    // self-only experience, rather than surfacing an error for someone
    // whose own personal schedule already loaded successfully moments ago.
    return { status: "ok", model: buildSelfOnlyScheduleReadModel(selfModel) };
  }

  const { people, snapshot } = contextResult.context;

  const settings = parseSettingsSheet(getScheduleWorkbookSheet(snapshot, "settings"));

  let shiftSchedule: ShiftSchedule;
  try {
    shiftSchedule = buildShiftSchedule(settings.shiftStartTimeDay);
  } catch (error) {
    if (error instanceof ShiftConfigurationError) {
      return { status: "configuration_error", message: error.message };
    }
    throw error;
  }

  const rawAssignments = parseScheduleSheet(getScheduleWorkbookSheet(snapshot, "schedule"), people);
  const events = rawAssignments.map(parseEvent);

  const potentialAllocations = [
    ...parsePotentialSheet(getScheduleWorkbookSheet(snapshot, "potentialH1"), people),
    ...parsePotentialSheet(getScheduleWorkbookSheet(snapshot, "potentialH2"), people),
  ];

  const range = resolveManagerDateRange("month", monthParam, selfModel.localNow);

  // Same `?week=` resolution as the manager path -- see
  // `loadManagerScheduleReadModel`'s identical comment.
  const week = (params.rawWeek ? getOperationalWeekForDate(params.rawWeek) : null) ?? getOperationalWeek(selfModel.localNow);

  const model = buildMappedEveryoneScheduleReadModel({
    people,
    events,
    shiftSchedule,
    fetchedAt: snapshot.fetchedAt,
    now: selfModel.localNow,
    monthDates: range.dates,
    week,
    potentialAllocations,
  });

  return { status: "ok", model };
}

/** Looks the personnel sheet up by its logical source name -- the personnel-only fetch this helper needs. */
function getPersonnelSheet(snapshot: RawWorkbookSnapshot) {
  const sheet = snapshot.sheets.find((candidate) => candidate.name === SHEET_SOURCES.personnel);
  if (!sheet) throw new Error(`Workbook snapshot is missing the "${SHEET_SOURCES.personnel}" sheet.`);
  return sheet;
}

/**
 * Emergency Mode branch of `/schedule` -- mirrors the regular flow's own
 * structure (a personnel-only re-fetch, then `resolveOperationalRoster`
 * for the emergency assignments, then pure construction) rather than
 * threading raw arrays through `PersonalScheduleLoadResult`, which stays
 * a narrow, safe read model. The underlying Google/emergency-mode reads
 * are each cheaply de-duplicated by their own request-scoped caches, so
 * this never performs a second real network fetch within the same
 * request.
 */
async function loadEmergencyScheduleReadModel(
  person: { id: string; name: string; isManager: boolean },
  params: ScheduleParams,
): Promise<ScheduleLoadResult> {
  const snapshot = await getWorkbookSnapshot(["personnel"]);
  const people = parsePersonnelSheet(getPersonnelSheet(snapshot));

  const roster = await resolveOperationalRoster(people);
  if (roster.mode === "regular") {
    // Structurally unreachable within one request: `resolveOperationalMode`
    // is request-scoped `cache()`-memoized (see `operationalMode.ts`), so
    // it cannot report "regular" here immediately after the caller already
    // observed "emergency" moments earlier in the SAME request. Guarded
    // explicitly rather than silently narrowing the type away.
    throw new Error("resolveOperationalMode reported 'regular' inconsistently within the same request.");
  }
  if (roster.mode === "emergency_unavailable") {
    return { status: "emergency_unavailable", message: roster.message };
  }

  const model = buildEmergencyScheduleReadModel({
    manager: person.isManager ? { id: person.id, name: person.name } : null,
    people,
    assignments: roster.assignments,
    period: roster.period,
    fetchedAt: roster.fetchedAt,
    now: getJerusalemLocalNow(),
    diagnostics: roster.diagnostics,
    selfPersonId: person.id,
    selfPersonName: person.name,
    requestedPersonId: params.personId,
  });

  return { status: "emergency", model };
}
