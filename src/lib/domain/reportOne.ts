import { nextCalendarDateString } from "./operationalWeek";
import { classifyPersonnelType, classifyRoleGroup } from "./personnelType";
import type { AbsenceKind, DutyFamily, Event } from "./event";
import { BLOCKING_ABSENCE_KINDS } from "./operationalIssues";
import type { LocalNow } from "./localNow";
import type { Person } from "./types";

/**
 * "דוח 1 למחר" -- a manager-editable draft summarizing tomorrow's personnel
 * status, grouped into the four fixed sections the report always uses (see
 * `SECTION_ORDER` below). Consumes the SAME typed `Event[]` every other
 * schedule-aware feature in this app consumes (never a second, independent
 * parse of raw schedule cells) -- see this module's own doc comments on
 * `resolveRegularOrReserveStatus` for exactly which existing domain
 * concepts it reuses.
 */
export type ReportOneSection = "permanent" | "reserve" | "regular_manager" | "regular_technician";

export interface ReportOnePerson {
  personId: string;
  name: string;
  section: ReportOneSection;
  generatedStatus: string;
}

export interface ReportOneSectionGroup {
  section: ReportOneSection;
  /** The exact Hebrew section header text, emoji + trailing colon included. */
  label: string;
  people: ReportOnePerson[];
}

export interface ReportOneDraft {
  /** "YYYY-MM-DD" -- always tomorrow in Asia/Jerusalem (see `resolveReportOneTargetDate`). */
  targetDate: string;
  sections: ReportOneSectionGroup[];
}

export const REPORT_ONE_SECTION_ORDER: readonly ReportOneSection[] = [
  "permanent",
  "reserve",
  "regular_manager",
  "regular_technician",
];

const SECTION_LABELS: Record<ReportOneSection, string> = {
  permanent: "אנשי קבע💛:",
  reserve: "מילואים😍:",
  regular_manager: 'סדיר - אחמשים🧑🏻‍💻:',
  regular_technician: 'סדיר - טכנאים🧑🏻‍🔧:',
};

export const UNKNOWN_REPORT_ONE_STATUS = "?";

/**
 * Personnel permanently excluded from Report 1 regardless of section,
 * schedule, or personnel status (product decision, not a data-quality
 * filter). Matched on a normalized display name -- the SAME whitespace
 * normalization `stableIdFromName` (`lib/parsers/personnel.ts`) applies
 * before hashing a `Person.id`, so this is equivalent to an id-based match
 * without this domain module reaching into `lib/parsers` (layers stay
 * separated per this repo's engineering rules).
 */
const EXCLUDED_REPORT_ONE_NAMES: ReadonlySet<string> = new Set(
  ["דימה מירו", "מרטין בדיקות", "נדב וקנין"].map(normalizePersonName),
);

function normalizePersonName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function isExcludedFromReportOne(person: Person): boolean {
  return EXCLUDED_REPORT_ONE_NAMES.has(normalizePersonName(person.name));
}

/**
 * Which Report 1 section (if any) a person belongs to, from the SAME
 * `classifyPersonnelType`/`classifyRoleGroup` domain functions the roster
 * hierarchy (`lib/presentation/roster.ts`) and fairness grouping already
 * use -- never a parallel classification. A רגיל/סדיר person who is
 * neither אחמ"ש nor טכנאי (`classifyRoleGroup` -> "other") has no Report 1
 * section and is not included -- the report only ever has these four fixed
 * sections, never a fifth "other" bucket.
 */
export function classifyReportOneSection(person: Person): ReportOneSection | null {
  const category = classifyPersonnelType(person.personnelType);

  if (category === "permanent") return "permanent";
  if (category === "reserve") return "reserve";
  if (category === "regular") {
    const roleGroup = classifyRoleGroup(person);
    if (roleGroup === "supervisor") return "regular_manager";
    if (roleGroup === "technician") return "regular_technician";
    return null;
  }
  return null;
}

/** "YYYY-MM-DD" for tomorrow, given today's Asia/Jerusalem `LocalNow` -- pure string arithmetic, never `Date`/UTC (see `nextCalendarDateString`). `now.date` is trusted to already be valid (it comes from `getJerusalemLocalNow()`), matching the same trust convention `resolveCurrentShiftPeriod` uses. */
export function resolveReportOneTargetDate(now: LocalNow): string {
  const target = nextCalendarDateString(now.date);
  if (!target) {
    throw new Error(`Invalid local date: "${now.date}".`);
  }
  return target;
}

function isAssignmentEvent(event: Event): boolean {
  return event.category === "shift" || event.category === "duty";
}

function isBlockingAbsence(event: Event): event is Event & { absenceKind: AbsenceKind } {
  return event.category === "absence" && event.absenceKind !== null && BLOCKING_ABSENCE_KINDS.has(event.absenceKind);
}

const BLOCKING_ABSENCE_WORDING: Partial<Record<AbsenceKind, string>> = {
  vacation: "חופש",
  day_off: "יום סידורים",
  abroad: 'חו"ל',
  medical: "גימלים",
};

function shiftStatusWording(role: "supervisor" | "technician", period: "day" | "night"): string {
  if (role === "supervisor") return period === "day" ? 'נוכח, אחמ"ש יום' : 'נוכח, אחמ"ש לילה';
  return period === "day" ? "נוכח, טכנאי יום" : "נוכח, טכנאי לילה";
}

const AFTER_NIGHT_STATUS = "נוכח, אחרי לילה";
const PRESENT_STATUS = "נוכח";

/**
 * Audit of every `EventCategory`/`AbsenceKind`/`DutyFamily` value this app's
 * parser (`lib/parsers/event.ts`) can produce, classified for Report 1
 * purposes into PRIMARY (mutually exclusive -- determines the day's main
 * state) vs ADDITIVE (layered on top of whichever primary state was
 * resolved, never replacing it) vs neither (not an attendance/operational
 * fact about the person's day, so Report 1 never surfaces it):
 *
 * PRIMARY:
 * - category "shift" (role + day/night period)
 * - category "absence", kind "vacation"/"abroad"/"medical"/"day_off"
 *   (`BLOCKING_ABSENCE_KINDS` -- a whole-day state that structurally
 *   conflicts with any real assignment, exactly per
 *   `detectBlockingAbsenceIssues`)
 * - category "absence", kind "referral" (a whole-day state, but -- unlike
 *   the blocking kinds above -- the domain's own `isBlockingAbsence` never
 *   flags it as conflicting with an assignment; only a same-day SHIFT is
 *   treated as a second, contradictory primary signal here)
 * - category "absence", kind "after" (a structural marker read together
 *   with a night-period shift dated the day before -- contributes to the
 *   SAME `AFTER_NIGHT_STATUS` primary, never a separate item)
 *
 * ADDITIVE:
 * - category "duty" (every `DutyFamily`: guard/reserve/evacuation_on_call/
 *   full_kitchen/daily_kitchen/weekend_kitchen/rasar/oxid/callup) -- a
 *   rotating extra responsibility layered on top of the day's primary
 *   state (e.g. "נוכח, אחרי לילה" + "כונן פינויים"), never a replacement
 *   for it. The ONE exception, still matching existing domain semantics
 *   rather than inventing a new one: `isAssignmentEvent` (shift OR duty)
 *   is exactly what `detectBlockingAbsenceIssues` treats as conflicting
 *   with a BLOCKING absence -- so a duty coexisting with vacation/abroad/
 *   medical/day_off is still a genuine unresolved conflict ("?", no duty
 *   text appended), not silently combined.
 *
 *   A SECOND exception (see `PRESENCE_IMPLYING_DUTY_FAMILIES` below): when
 *   the primary itself is the bare unresolved "?" -- and ONLY the
 *   genuinely-no-data flavor of "?" (no shift event at all today; the
 *   blocking-absence-conflict and ambiguous-shift-wording flavors of "?"
 *   are structurally excluded, see `resolveRegularOrReserveStatus`'s own
 *   docs) -- a duty whose family INHERENTLY requires physically being on
 *   site synthesizes `PRESENT_STATUS` ("נוכח") as the primary, since a
 *   bare "?" next to e.g. "שמירה 1" was actively misleading: the duty
 *   itself already proves the person is physically present. A duty that
 *   does NOT inherently prove on-site presence (e.g. `evacuation_on_call`/
 *   `reserve` -- both genuinely on-call/standby concepts, reachable but
 *   not necessarily on site) leaves the bare "?" exactly as before.
 *
 * - category "other", ONLY the two specific keyword-matched activities
 *   `isLogisticsWithdrawalEvent` (משיכות/משיכות מהלוגיסטיקה) already
 *   detects for the notifications engine
 *   (`lib/notifications/engine/logisticsWithdrawal.ts`) and its own
 *   sibling `isCertificationEvent` (הסמכה) detect below. Neither activity
 *   has a dedicated `DutyFamily`/column in the source Sheet (confirmed for
 *   `משיכות` by that module's own docs, PR #30) -- both are ordinary
 *   schedule-cell text that `classify()` has nothing more specific for, so
 *   they fall through to `category: "other"` exactly like any other
 *   unrecognized text. Both are ALSO physically on-site work (logistics
 *   withdrawals happen in a fixed 13:00-14:00 on-site window, see
 *   `logisticsCoordination.ts`; a certification session is likewise
 *   attended in person), so both are additionally treated as
 *   presence-implying (see `resolveRegularOrReserveStatus`'s bare-"?"
 *   synthesis) -- the SAME treatment `PRESENCE_IMPLYING_DUTY_FAMILIES`
 *   already gives guard/kitchen/rasar duties, just reached via keyword
 *   match instead of a typed `DutyFamily` since none exists for these.
 *   Every OTHER "other"-category text still stays neither-primary-nor-
 *   additive, per the general rule below -- these two keywords are a
 *   narrow, explicit exception, never a blanket "surface all 'other'
 *   text" change.
 *
 * NEITHER (Report 1 never surfaces these -- not a person's own operational
 * presence fact):
 * - category "constraint" (אילוץ -- a scheduling preference, not an actual
 *   event)
 * - category "status" (סוגר / ריווח -- planning/administrative markers)
 * - category "context" (מלחמה -- an org-wide context flag, not personal)
 * - category "change_note" -- its own docstring is explicit: "a note about
 *   a swap, not an active duty"
 * - category "other"/"unknown" -- unrecognized text; never guessed, except
 *   the two narrow keyword exceptions documented above
 */
function isAdditiveDutyEvent(event: Event): event is Event & { dutyFamily: DutyFamily } {
  return event.category === "duty" && event.dutyFamily !== null;
}

/**
 * "משיכות" / "משיכות מהלוגיסטיקה" -- logistics withdrawals. Deliberately
 * duplicated here (never imported from `lib/notifications/engine`) for the
 * same layering reason `dutyAddendumText` below already duplicates from
 * `lib/presentation`: this domain module never reaches into a feature layer
 * built ON TOP of domain (see this repo's engineering rules on layer
 * separation) -- `lib/notifications/engine/logisticsWithdrawal.ts` is the
 * canonical source of this exact keyword and matching rule
 * (`isLogisticsWithdrawalEvent`), kept in sync by inspection, not import.
 */
const WITHDRAWAL_KEYWORD = "משיכות";
/** "הסמכה" -- a certification activity. Same "other"-category situation as `WITHDRAWAL_KEYWORD` above: no dedicated `DutyFamily`/column exists for it either, so it's ordinary schedule-cell text `classify()` has nothing more specific for. */
const CERTIFICATION_KEYWORD = "הסמכה";

/** Mirrors `lib/notifications/engine/logisticsWithdrawal.ts`'s `isLogisticsWithdrawalEvent` exactly -- see `WITHDRAWAL_KEYWORD`'s own doc comment for why this is duplicated rather than imported. */
function isWithdrawalEvent(event: Event): boolean {
  return event.category === "other" && event.title.includes(WITHDRAWAL_KEYWORD);
}

/** Same shape/rule as `isWithdrawalEvent`, for the sibling `הסמכה` keyword. */
function isCertificationEvent(event: Event): boolean {
  return event.category === "other" && event.title.includes(CERTIFICATION_KEYWORD);
}

const DUTY_FAMILY_WORDING: Record<DutyFamily, string> = {
  guard: "שמירה",
  reserve: "עתודה",
  evacuation_on_call: "כונן פינויים",
  full_kitchen: "מטבח מלא",
  daily_kitchen: "מטבח יומי",
  weekend_kitchen: 'מטבח סופ"ש',
  rasar: 'רס"ר',
  oxid: "אוקסיד",
  callup: "הקפצה",
};

/** Mirrors the canonical declaration order of `DutyFamily` in `lib/domain/event.ts`, so several additive duties on the same day always print in the same stable order regardless of the source Event array's own order. */
const DUTY_FAMILY_ORDER: readonly DutyFamily[] = [
  "guard",
  "reserve",
  "evacuation_on_call",
  "full_kitchen",
  "daily_kitchen",
  "weekend_kitchen",
  "rasar",
  "oxid",
  "callup",
];

/**
 * Audit of every `DutyFamily` for whether it INHERENTLY requires being
 * physically on site -- deliberately NOT "every duty implies presence"
 * (see `resolveRegularOrReserveStatus`'s own docs on why a bare "?" is
 * synthesized into `PRESENT_STATUS` only for these):
 *
 * PRESENCE-IMPLYING (structurally cannot be performed off site):
 * - `guard` (שמירה) -- a physical post.
 * - `full_kitchen`/`daily_kitchen`/`weekend_kitchen` (מטבח) -- kitchen
 *   duty is on-site food service work by definition.
 * - `rasar` (רס"ר) -- an on-base equipment/quartermaster role.
 *
 * NOT presence-implying (on-call/standby concepts, or too ambiguous to
 * assert on-site presence from the family alone -- left as bare "?" next
 * to the duty text unless another authoritative primary already applies):
 * - `evacuation_on_call` (כונן פינויים) -- "כונן" is Hebrew for on-call/
 *   standby: reachable, not necessarily on site. This is also the exact
 *   existing "נוכח, אחרי לילה" + "כונן פינויים" example this module's own
 *   docs already use -- that combination works today because the primary
 *   there comes from after-night carryover, never from this duty itself.
 * - `reserve` (עתודה) -- a backup/standby pool duty, same on-call
 *   reasoning as `evacuation_on_call`.
 * - `oxid`/`callup` (אוקסיד/הקפצה) -- no clear, unambiguous on-site
 *   signal from the family alone; never guessed.
 */
const PRESENCE_IMPLYING_DUTY_FAMILIES: ReadonlySet<DutyFamily> = new Set([
  "guard",
  "full_kitchen",
  "daily_kitchen",
  "weekend_kitchen",
  "rasar",
]);

function isPresenceImplyingDuty(dutyFamily: DutyFamily): boolean {
  return PRESENCE_IMPLYING_DUTY_FAMILIES.has(dutyFamily);
}

/**
 * The `משיכות`/`הסמכה` additive text for the day, deduplicated exactly like
 * `resolveAdditiveDutyTexts` (a duplicate same-keyword event never doubles
 * the text) -- ONE combined array entry, never two separate ones, when both
 * are present the same day: "הסמכה + משיכות" (a fixed, deterministic
 * ordering regardless of the source events' own order), matching the
 * product's expected combined wording rather than the generic
 * comma-joined list `resolveAdditiveDutyTexts` uses for distinct
 * `DutyFamily` values. Either keyword alone still just returns its own
 * bare text ("משיכות" / "הסמכה").
 */
function resolveWithdrawalAndCertificationTexts(eventsToday: readonly Event[]): string[] {
  const hasCertification = eventsToday.some(isCertificationEvent);
  const hasWithdrawal = eventsToday.some(isWithdrawalEvent);

  if (hasCertification && hasWithdrawal) return [`${CERTIFICATION_KEYWORD} + ${WITHDRAWAL_KEYWORD}`];
  if (hasCertification) return [CERTIFICATION_KEYWORD];
  if (hasWithdrawal) return [WITHDRAWAL_KEYWORD];
  return [];
}

/** "שמירה 2" -- the duty family's Hebrew wording, with its slot appended only when the family actually has one. Deliberately duplicated from (never imported from) `lib/presentation/duty.ts`'s `dutyBlockTitle` -- this domain module never reaches into `lib/presentation` (see this repo's engineering rules on layer separation); the same duplication already exists between the parser's own duty phrase table and the presentation label table. */
function dutyAddendumText(event: Event & { dutyFamily: DutyFamily }): string {
  const label = DUTY_FAMILY_WORDING[event.dutyFamily];
  return event.slot !== null ? `${label} ${event.slot}` : label;
}

/** Every distinct additive duty text for `eventsToday`, deduplicated and in a stable, deterministic order -- never the raw Event array's own (incidental) order. */
function resolveAdditiveDutyTexts(eventsToday: readonly Event[]): string[] {
  const dutyEvents = eventsToday.filter(isAdditiveDutyEvent);
  if (dutyEvents.length === 0) return [];

  const texts = new Set(
    [...dutyEvents]
      .sort((a, b) => {
        const familyDiff = DUTY_FAMILY_ORDER.indexOf(a.dutyFamily) - DUTY_FAMILY_ORDER.indexOf(b.dutyFamily);
        if (familyDiff !== 0) return familyDiff;
        return (a.slot ?? -1) - (b.slot ?? -1);
      })
      .map(dutyAddendumText),
  );
  return [...texts];
}

/** The day's PRIMARY status only (see the audit above) -- never includes additive duty text; `resolveRegularOrReserveStatus` appends that separately. */
function resolvePrimaryStatus(
  eventsToday: readonly Event[],
  eventsPrevDay: readonly Event[],
  blockingAbsencesToday: readonly (Event & { absenceKind: AbsenceKind })[],
  referralsToday: readonly Event[],
): string {
  if (blockingAbsencesToday.length > 0) {
    const distinctKinds = new Set(blockingAbsencesToday.map((event) => event.absenceKind));
    if (distinctKinds.size > 1) return UNKNOWN_REPORT_ONE_STATUS;
    const kind = blockingAbsencesToday[0].absenceKind;
    return BLOCKING_ABSENCE_WORDING[kind] ?? UNKNOWN_REPORT_ONE_STATUS;
  }

  const shiftEventsToday = eventsToday.filter((event) => event.category === "shift");

  if (referralsToday.length > 0) {
    // A same-day SHIFT is a second, contradictory primary signal (never
    // guessed which one wins) -- but referral itself is NOT in
    // `BLOCKING_ABSENCE_KINDS`, so a same-day DUTY is not a conflict here;
    // it's handled as an additive addendum by the caller instead.
    if (shiftEventsToday.length > 0) return UNKNOWN_REPORT_ONE_STATUS;
    return "הפנייה";
  }

  if (shiftEventsToday.length > 0) {
    const wordings = new Set(
      shiftEventsToday
        .filter(
          (event): event is Event & { role: "supervisor" | "technician"; period: "day" | "night" } =>
            (event.role === "supervisor" || event.role === "technician") &&
            (event.period === "day" || event.period === "night"),
        )
        .map((event) => shiftStatusWording(event.role, event.period)),
    );
    if (wordings.size === 1) return [...wordings][0];
    return UNKNOWN_REPORT_ONE_STATUS;
  }

  const hasAfterMarkerToday = eventsToday.some(
    (event) => event.category === "absence" && event.absenceKind === "after",
  );
  const hasNightShiftPrevDay = eventsPrevDay.some(
    (event) =>
      event.category === "shift" &&
      event.period === "night" &&
      (event.role === "supervisor" || event.role === "technician"),
  );
  if (hasAfterMarkerToday || hasNightShiftPrevDay) return AFTER_NIGHT_STATUS;

  return UNKNOWN_REPORT_ONE_STATUS;
}

/**
 * Resolves one סדיר/מילואים person's Report 1 status for `targetDate` from
 * their own already-typed `Event[]` on `targetDate` and the immediately
 * preceding calendar date -- never a fresh parse, never a guess. Reuses:
 *
 * - `Event.category`/`role`/`period`/`absenceKind`/`dutyFamily`, exactly as
 *   `lib/parsers/event.ts` already classified them from the schedule sheet;
 * - `BLOCKING_ABSENCE_KINDS` (`lib/domain/operationalIssues.ts`), the SAME
 *   set `detectBlockingAbsenceIssues` uses to flag a person as having both
 *   a blocking absence and a real assignment (shift OR duty) on one date --
 *   when that conflict is present here too, this returns "?" rather than
 *   inventing a precedence the rest of the app doesn't have (never a
 *   person shown as both on leave and on a shift/duty);
 * - the day/night shift-carryover structure `lib/domain/shiftSchedule.ts`
 *   documents (a night shift's 12h window always runs from that day's
 *   shift-end into the FOLLOWING calendar date, regardless of the
 *   configured start time) -- a night-period shift dated the day before
 *   `targetDate` is read as "still present, after that night" on
 *   `targetDate` without needing to resolve exact minutes.
 *
 * A resolved PRIMARY status (see the audit above `resolvePrimaryStatus`)
 * has every ADDITIVE duty for the day appended to it (e.g. "נוכח, אחרי
 * לילה, כונן פינויים") -- duties are real, already-typed facts, never a
 * guess, so they're appended even when the primary itself is "?" for lack
 * of other data. The one case that stays a bare "?" with nothing appended
 * is the genuine blocking-absence-vs-assignment conflict above, so the
 * report keeps flagging that specific contradiction for manual review
 * rather than implying it was resolved.
 *
 * ONE further refinement to that "?" case: when the primary is the bare
 * "?" for genuinely having no data at all today (no shift event today --
 * `hasShiftEventToday` below -- since ANY shift event today means the "?"
 * instead came from an unresolved SHIFT ambiguity, e.g. two conflicting
 * shift wordings the same day, which must stay flagged exactly as before)
 * and at least one of today's additive activities inherently requires
 * being on site (`isPresenceImplyingDuty` -- guard/kitchen/rasar -- OR
 * `isWithdrawalEvent`/`isCertificationEvent` -- משיכות/הסמכה), the primary
 * is synthesized to `PRESENT_STATUS` ("נוכח") instead of staying "?": the
 * activity itself already proves the person is physically present, so "?,
 * שמירה 1" (or "?, משיכות") was actively misleading. This can never fire
 * for the blocking-absence-vs-assignment conflict above (that returns
 * early, before this point) or the referral-vs-shift conflict (both have a
 * shift event today, so `hasShiftEventToday` excludes them) -- every
 * existing contradiction stays exactly as unresolved as it was. משיכות/
 * הסמכה never participate in that top-level blocking-absence conflict
 * check either way (`assignmentsToday`/`isAssignmentEvent` above only ever
 * matches category "shift"/"duty", exactly matching `detectBlockingAbsenceIssues`'s
 * own notion of a conflicting assignment) -- category "other" was never a
 * conflict signal there and this fix does not change that.
 */
export function resolveRegularOrReserveStatus(
  eventsToday: readonly Event[],
  eventsPrevDay: readonly Event[],
): string {
  const assignmentsToday = eventsToday.filter(isAssignmentEvent);
  const blockingAbsencesToday = eventsToday.filter(isBlockingAbsence);
  const referralsToday = eventsToday.filter((event) => event.category === "absence" && event.absenceKind === "referral");

  if (blockingAbsencesToday.length > 0 && assignmentsToday.length > 0) {
    return UNKNOWN_REPORT_ONE_STATUS;
  }

  let primary = resolvePrimaryStatus(eventsToday, eventsPrevDay, blockingAbsencesToday, referralsToday);
  const activityTexts = [...resolveAdditiveDutyTexts(eventsToday), ...resolveWithdrawalAndCertificationTexts(eventsToday)];

  if (primary === UNKNOWN_REPORT_ONE_STATUS && activityTexts.length > 0) {
    const hasShiftEventToday = eventsToday.some((event) => event.category === "shift");
    const hasPresenceImplyingActivityToday =
      eventsToday.some((event) => isAdditiveDutyEvent(event) && isPresenceImplyingDuty(event.dutyFamily)) ||
      eventsToday.some(isWithdrawalEvent) ||
      eventsToday.some(isCertificationEvent);
    if (!hasShiftEventToday && hasPresenceImplyingActivityToday) {
      primary = PRESENT_STATUS;
    }
  }

  if (activityTexts.length === 0) return primary;
  return [primary, ...activityTexts].join(", ");
}

/**
 * Whether `person` has a meaningful, already-resolved attendance/
 * assignment fact for the target date -- reuses `generatedStatus` exactly
 * as `resolveRegularOrReserveStatus` resolved it (a shift, a blocking
 * absence, a referral, after-night carryover, or ANY additive activity,
 * e.g. כונן פינויים/רס"ר/שמירה/משיכות/הסמכה -- see that function's own
 * audit of every case it covers), never a second/parallel rule system. The
 * ONE case this deliberately does NOT flag as meaningful is the bare unresolved "?" --
 * including the blocking-absence-vs-assignment conflict case, which
 * `resolveRegularOrReserveStatus` itself already deliberately collapses
 * to a bare "?" rather than surfacing the conflicting duty/shift fact
 * underneath it (see that function's own docs); this stays consistent
 * with that existing choice rather than inventing a new one.
 *
 * Used ONLY by the reserve-inclusion-toggle UI (see this repo's Report 1
 * reserve-inclusion spec) to decide whether unchecking/leaving-unchecked
 * a reserve person needs a warning -- never referenced by
 * `buildReportOneDraft` itself. Inclusion preferences are a separate,
 * persisted config concern (`lib/reportOne`), never baked into this
 * domain resolver.
 */
export function reportOnePersonHasMeaningfulTomorrowEvent(person: Pick<ReportOnePerson, "generatedStatus">): boolean {
  return person.generatedStatus !== UNKNOWN_REPORT_ONE_STATUS;
}

export interface BuildReportOneDraftInput {
  /** Full parsed roster, in the authoritative source's own stable order -- never reordered. */
  people: readonly Person[];
  /** Full parsed Event set (every person, every date) -- only `targetDate`/`prevDate` entries are ever read. */
  events: readonly Event[];
  /** "YYYY-MM-DD" -- tomorrow (see `resolveReportOneTargetDate`). */
  targetDate: string;
  /** "YYYY-MM-DD" -- the calendar date immediately before `targetDate` (i.e. today), for after-night carryover. */
  prevDate: string;
}

/**
 * Builds the full `ReportOneDraft`: excludes the permanent Report 1
 * exclusion list, classifies every remaining person into exactly one of
 * the four fixed sections (or drops them if they belong to none), and
 * resolves each סדיר/מילואים person's status via
 * `resolveRegularOrReserveStatus`. אנשי קבע always get "?" (V1 has no
 * authoritative permanent-staff attendance source -- see this repo's own
 * Report 1 spec). Preserves `people`'s own existing order within each
 * section -- never sorts alphabetically, never reorders by status.
 */
export function buildReportOneDraft(input: BuildReportOneDraftInput): ReportOneDraft {
  const { people, events, targetDate, prevDate } = input;

  const eventsByPersonToday = new Map<string, Event[]>();
  const eventsByPersonPrevDay = new Map<string, Event[]>();
  for (const event of events) {
    if (event.date === targetDate) {
      pushInto(eventsByPersonToday, event.personId, event);
    } else if (event.date === prevDate) {
      pushInto(eventsByPersonPrevDay, event.personId, event);
    }
  }

  const bySection = new Map<ReportOneSection, ReportOnePerson[]>(
    REPORT_ONE_SECTION_ORDER.map((section) => [section, []]),
  );

  for (const person of people) {
    if (isExcludedFromReportOne(person)) continue;

    const section = classifyReportOneSection(person);
    if (section === null) continue;

    const generatedStatus =
      section === "permanent"
        ? UNKNOWN_REPORT_ONE_STATUS
        : resolveRegularOrReserveStatus(
            eventsByPersonToday.get(person.id) ?? [],
            eventsByPersonPrevDay.get(person.id) ?? [],
          );

    bySection.get(section)!.push({ personId: person.id, name: person.name, section, generatedStatus });
  }

  const sections: ReportOneSectionGroup[] = REPORT_ONE_SECTION_ORDER.map((section) => ({
    section,
    label: SECTION_LABELS[section],
    people: bySection.get(section)!,
  }));

  return { targetDate, sections };
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
