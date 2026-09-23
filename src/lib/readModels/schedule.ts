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
import { buildManagerScheduleReadModel, buildSelfOnlyScheduleReadModel } from "./buildScheduleReadModel";
import { buildEmergencyScheduleReadModel } from "./buildEmergencyScheduleReadModel";
import { resolveOperationalRoster } from "./operationalMode";
import { getManagerWorkbookSheet, loadManagerWorkbookContext } from "./managerWorkbookContext";
import { getRequestPersonalSchedule } from "./getRequestPersonalSchedule";
import type { EmergencyScheduleReadModel } from "./emergencyScheduleTypes";
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
 * Everything the Schedule feature ever needs, for a normal user OR a
 * manager in any of the three perspectives -- personnel + schedule +
 * settings + potentialH1/H2. PR #24 §25 originally kept this narrower than
 * `MANAGER_WORKBOOK_SOURCES` (no Potential at all) since only Manager
 * Overview's reconciliation section needed it; a later duty-completeness
 * pass (see `buildPersonalScheduleReadModel.ts`) reuses the SAME Potential
 * data for the "self"/"person" perspectives (never "all" -- unit-wide
 * staffing/coverage stays out of scope for this source), so it's fetched
 * here too now.
 *
 * ALSO includes `shootingRanges` -- unused by anything in this file, kept
 * ONLY so `getWorkbookSnapshot`'s canonical (sorted+deduped) source-set
 * cache key resolves to the EXACT SAME entry `MANAGER_WORKBOOK_SOURCES`
 * does (Manager Overview, Home, Report 1 -- see
 * `managerWorkbookContext.ts`'s own constant). Before this, the Schedule
 * page's own `getWorkbookSnapshot` call was keyed on a genuinely DIFFERENT
 * canonical string (missing `shootingRanges`), so it landed in its own,
 * independently-`unstable_cache`d 30s window -- meaning this page and
 * every `MANAGER_WORKBOOK_SOURCES` caller could each be serving a
 * DIFFERENT point-in-time read of the identical "schedule" sheet
 * (whichever one last happened to revalidate), even though both requests
 * fetch the exact same underlying Google Sheets tab. A manager who just
 * edited an assignment and immediately compared this page against, say,
 * Report 1 could see the edit on one and not (yet) on the other purely
 * from that cache-key mismatch -- never from any actual parsing/
 * classification difference between the two features (see
 * `reportOneShadowRoleRawPipelineRegression.test.ts` for the proof that
 * layer is correct). Matching the key here removes that class of
 * cross-feature staleness entirely, the same "deliberately over-request
 * to land on a shared cache entry" convention `reportOneTomorrow.ts`
 * already documents for its own relationship to the Home page.
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
  /** Raw, unvalidated `?person=` value. Completely ignored for a normal (non-manager) user -- see `loadScheduleReadModel`. */
  personId: string | null;
  /** Raw, unvalidated `?week=` value ("YYYY-MM-DD" anchor, or anything else) -- resolved through `getOperationalWeekForDate`, falling back to the operational week containing `localNow.date` for anything unparseable. Only ever affects the "all" perspective's `teamWeek` matrix; completely inert for a normal (non-manager) user, same as `personId`. */
  rawWeek: string | null;
}

/**
 * Server-only orchestration for `ScheduleReadModel` (PR #24). Mirrors
 * `managerOverview.ts`'s split between authorization/fetch (this file) and
 * pure construction (`buildScheduleReadModel.ts`):
 *
 * 1. Reuses `getRequestPersonalSchedule()` -- the SAME request-scoped
 *    result the protected layout and `/schedule` itself already compute
 *    (react `cache()` dedupes this to zero extra calls) -- as the FIRST
 *    authorization gate, exactly like `managerWorkbookContext.ts`.
 * 2. A normal (non-manager) user's `?person=` is never even inspected --
 *    the server-side floor is unconditional, not merely a UI choice. This
 *    is what PR #24 §3 requires: `?person=all` or `?person=<id>` must
 *    still only ever return that person's own schedule.
 * 3. Only once `person.isManager === true` does this fetch anything more
 *    -- `loadManagerWorkbookContext(SCHEDULE_MANAGER_SOURCES)`, ONE
 *    additional Google request, going through the exact same fail-closed
 *    re-verification (fresh identity, fresh personnel parse, fresh
 *    manager check) every other manager-only feature uses. If that fresh
 *    check can't be re-proven for this request (e.g. a race between the
 *    two fetches), this fails closed to the exact same self-only
 *    experience a normal user gets -- never a manager selector/data the
 *    fresh check couldn't currently verify.
 * 4. Parses schedule + settings + potentialH1/H2 from the authorized
 *    manager snapshot, resolves the displayed month's dates, and delegates
 *    all read-model construction to the pure `buildManagerScheduleReadModel`.
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

  if (!selfModel.person.isManager) {
    return { status: "ok", model: buildSelfOnlyScheduleReadModel(selfModel) };
  }

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
