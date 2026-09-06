import "server-only";
import type { DutyFamily, Event, EventPeriod } from "@/lib/domain/event";
import type { EmergencyAssignment } from "@/lib/domain/emergencyShift";
import type { Person } from "@/lib/domain/types";
import type { OperationalWeek } from "@/lib/domain/operationalWeek";
import type { LocalNow } from "@/lib/domain/localNow";
import { nextCalendarDateString } from "@/lib/domain/operationalWeek";
import { dayOfWeek, parseCalendarDate, buildDutyBlocks } from "@/lib/domain/dutyBlocks";
import { deriveDutyActions } from "@/lib/domain/dutyActions";
import { resolveEventShiftInterval, type ShiftSchedule } from "@/lib/domain/shiftSchedule";
import { dutyFamilyLabel, periodLabel } from "@/lib/presentation/labels";
import { jerusalemLocalTimeToInstant } from "@/lib/time/jerusalemClock";
import { resolveMotzashShabbatInstant } from "@/lib/time/motzashShabbat";
import {
  buildSupervisorAssignedInformedBody,
  buildSupervisorAssignedTodayBody,
  buildTeamHelpAssignedBody,
  findLogisticsWithdrawalAssignees,
  isLogisticsWithdrawalFallbackDate,
  resolveEligibleLogisticsTechnicians,
  resolveRelevantSupervisors,
} from "./logisticsCoordination";
import { isLogisticsWithdrawalEvent } from "./logisticsWithdrawal";
import { resolveNonPermanentConstraintsRecipients, type RecipientResolution } from "./recipients";
import { isSystemRulePersonAllowed, type NotificationRuleConfig, type SystemRuleConfig } from "./ruleConfig";
import { applySystemRuleCopy } from "./systemRuleCopy";
import {
  cancelPendingSystemReminderJob,
  listPendingJobDedupeKeysByPrefix,
  upsertPendingSystemReminderJob,
  type NewNotificationJob,
} from "./store";

export interface RemindersSummary {
  tomorrowShiftJobs: number;
  tomorrowDutyJobs: number;
  tomorrowLogisticsWithdrawalJobs: number;
  tomorrowLogisticsWithdrawalSupervisorJobs: number;
  logisticsWithdrawalNoonAssignedJobs: number;
  logisticsWithdrawalNoonSupervisorJobs: number;
  logisticsWithdrawalNoonTeamJobs: number;
  almashCheckInJobs: number;
  tomorrowShiftCancelled: number;
  tomorrowDutyCancelled: number;
  tomorrowLogisticsWithdrawalCancelled: number;
  tomorrowLogisticsWithdrawalSupervisorCancelled: number;
  logisticsWithdrawalNoonAssignedCancelled: number;
  logisticsWithdrawalNoonSupervisorCancelled: number;
  logisticsWithdrawalNoonTeamCancelled: number;
  almashCheckInCancelled: number;
  constraintsJobs: number;
  constraintsCancelled: number;
}

export interface RemindersInput {
  events: readonly Event[];
  /** Needed only by the logistics-withdrawal team-coordination reminders (`isTechnician` eligibility) and the weekly constraints reminders' own non-permanent recipient resolution -- every other reminder in this file is Event-driven alone. */
  people: readonly Person[];
  shiftSchedule: ShiftSchedule;
  week: OperationalWeek;
  now: LocalNow;
  persist: boolean;
  recipientResolution: RecipientResolution;
  /**
   * The Fixed / Recurring Notifications Center's managed configuration --
   * loaded ONCE per worker tick by the caller (`pipeline.ts`) and passed
   * down, never re-queried per reminder here. This is the RUNTIME source
   * of truth for every system rule's enabled/disabled state and local
   * send time -- `lib/config/notificationTiming.ts`'s constants remain
   * only as this table's own migration seed values, never consulted here
   * again. A system rule missing from `ruleConfig.systemRules` (should be
   * unreachable once the seed migration has run) is treated as disabled
   * -- fail safe, never fall back to a hardcoded time.
   */
  ruleConfig: NotificationRuleConfig;
  /**
   * Which operational world is live right now (spec section 24/25).
   * `"emergency"` switches `tomorrow_shift` to desk-based content
   * (`emergencyAssignments`, never `events`) and suspends every regular-
   * duty/logistics-coordination reminder entirely (`tomorrow_duty`,
   * `almash_check_in`, every `*logistics_withdrawal*` reminder) -- their
   * own `applyReminderJobs(..., [], ...)` call then naturally CANCELS
   * any already-pending job for that category, since regular duties are
   * suspended system-wide while Emergency Mode is active. Defaults to
   * `"regular"` -- byte-for-byte unchanged behavior for any existing
   * caller/test that predates this field.
   */
  operationalMode?: "regular" | "emergency";
  /** Emergency Mode's own desk assignments -- consulted ONLY when `operationalMode === "emergency"`. Defaults to `[]`. */
  emergencyAssignments?: readonly EmergencyAssignment[];
}

function formatMinuteAsClock(minute: number): string {
  const normalized = ((minute % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const remaining = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function toIso(dateStr: string, hour: number, minute: number): string {
  return jerusalemLocalTimeToInstant(dateStr, hour, minute).toISOString();
}

/**
 * Phase 9-10 of the worker pipeline (PR #30 spec section 23): time-based
 * reminder jobs, which are allowed to cross operational-week boundaries
 * (spec sections 16-18) since they are driven purely by calendar date,
 * never by the current/next-week change-notification rule. In dry-run
 * mode (`persist: false`), no job is written -- only computed and
 * counted.
 */
export async function runReminders(input: RemindersInput): Promise<RemindersSummary> {
  const tomorrowShift = await runTomorrowShiftReminders(input);
  const tomorrowDuty = await runTomorrowDutyReminders(input);
  const tomorrowLogisticsWithdrawal = await runTomorrowLogisticsWithdrawalReminders(input);
  const tomorrowLogisticsWithdrawalSupervisor = await runTomorrowLogisticsWithdrawalSupervisorReminders(input);
  const logisticsWithdrawalNoon = await runLogisticsWithdrawalNoonReminders(input);
  const almashCheckIn = await runAlmashCheckInReminders(input);
  const constraintsJobs = await runConstraintsReminders(input);

  return {
    tomorrowShiftJobs: tomorrowShift.created,
    tomorrowDutyJobs: tomorrowDuty.created,
    tomorrowLogisticsWithdrawalJobs: tomorrowLogisticsWithdrawal.created,
    tomorrowLogisticsWithdrawalSupervisorJobs: tomorrowLogisticsWithdrawalSupervisor.created,
    logisticsWithdrawalNoonAssignedJobs: logisticsWithdrawalNoon.assigned.created,
    logisticsWithdrawalNoonSupervisorJobs: logisticsWithdrawalNoon.supervisor.created,
    logisticsWithdrawalNoonTeamJobs: logisticsWithdrawalNoon.team.created,
    almashCheckInJobs: almashCheckIn.created,
    tomorrowShiftCancelled: tomorrowShift.cancelled,
    tomorrowDutyCancelled: tomorrowDuty.cancelled,
    tomorrowLogisticsWithdrawalCancelled: tomorrowLogisticsWithdrawal.cancelled,
    tomorrowLogisticsWithdrawalSupervisorCancelled: tomorrowLogisticsWithdrawalSupervisor.cancelled,
    logisticsWithdrawalNoonAssignedCancelled: logisticsWithdrawalNoon.assigned.cancelled,
    logisticsWithdrawalNoonSupervisorCancelled: logisticsWithdrawalNoon.supervisor.cancelled,
    logisticsWithdrawalNoonTeamCancelled: logisticsWithdrawalNoon.team.cancelled,
    almashCheckInCancelled: almashCheckIn.cancelled,
    constraintsJobs: constraintsJobs.created,
    constraintsCancelled: constraintsJobs.cancelled,
  };
}

// ---------------------------------------------------------------------------
// Tomorrow shift reminder (spec section 16)
// ---------------------------------------------------------------------------

async function runTomorrowShiftReminders(input: RemindersInput): Promise<{ created: number; cancelled: number }> {
  const tomorrowDate = nextCalendarDateString(input.now.date);
  if (!tomorrowDate) return { created: 0, cancelled: 0 };

  const rule = input.ruleConfig.systemRules.get("tomorrow_shift");
  if (!rule?.enabled) return applyReminderJobs("tomorrow_shift", tomorrowDate, [], input.persist, rule);

  const scheduledFor = toIso(input.now.date, rule.localHour, rule.localMinute);

  const validJobs =
    input.operationalMode === "emergency"
      ? buildTomorrowEmergencyShiftJobs(input, tomorrowDate, rule, scheduledFor)
      : buildTomorrowRegularShiftJobs(input, tomorrowDate, rule, scheduledFor);

  return applyReminderJobs("tomorrow_shift", tomorrowDate, validJobs, input.persist, rule);
}

function buildTomorrowRegularShiftJobs(
  input: RemindersInput,
  tomorrowDate: string,
  rule: SystemRuleConfig,
  scheduledFor: string,
): NewNotificationJob[] {
  const tomorrowShiftEvents = input.events.filter(
    (event) => event.category === "shift" && event.date === tomorrowDate && !event.shadow,
  );

  const validJobs: NewNotificationJob[] = [];
  for (const event of tomorrowShiftEvents) {
    if (!isSystemRulePersonAllowed(rule, event.personId, input.people)) continue;
    const recipient = input.recipientResolution.resolved.get(event.personId);
    if (!recipient) continue;

    const resolution = resolveEventShiftInterval(event, input.shiftSchedule);
    const label = periodLabel(event.period);
    const details =
      resolution.status === "resolved"
        ? label
          ? `מחר ב־${formatMinuteAsClock(resolution.interval.startMinute)} מתחילה משמרת ${label} שלך`
          : `מחר ב־${formatMinuteAsClock(resolution.interval.startMinute)} מתחילה המשמרת שלך`
        : label
          ? `מחר יש לך משמרת ${label}`
          : "מחר יש לך משמרת";
    const { title, body } = applySystemRuleCopy("tomorrow_shift", rule, { title: "⏰ המשמרת שלך מחר", body: details });

    validJobs.push({
      category: "tomorrow_shift",
      recipientUserId: recipient.userId,
      title,
      body,
      path: "/",
      // Includes `event.period`, same as `dedupeKey` below -- a person
      // can structurally have two distinct shift Events on the same
      // date with different periods (e.g. day + night); without period
      // here the second push would silently replace the first at the
      // OS/Notifications-API level (the tag collision class PR #62
      // found for almash_check_in) even though both stay distinct jobs.
      tag: `tomorrow-shift-${tomorrowDate}-${recipient.userId}-${event.period}`,
      dedupeKey: `tomorrow_shift:${tomorrowDate}:${recipient.userId}:${event.period}`,
      scheduledFor,
      sourceRef: `shift:${event.personId}:${event.date}`,
    });
  }
  return validJobs;
}

/**
 * Emergency Mode's own `tomorrow_shift` content (spec section 24) --
 * SAME category/dedupe-key shape (`tomorrow_shift:${date}:${userId}:${period}`)
 * as the regular reminder above, deliberately: `applyReminderJobs`'s own
 * cancel-by-prefix sweep then transparently reconciles the switch in
 * EITHER direction (entering emergency cancels any stale regular-shift
 * reminder for someone no longer on a desk; returning to regular mode
 * cancels any stale desk reminder), with no special-cased transition
 * logic needed here. Desk assignments for the SAME person+date+period
 * are combined into ONE job (mirrors `icsEmergencyItems.ts`'s own "one
 * calendar item per person per shift" convention), never one job per
 * desk cell.
 */
function buildTomorrowEmergencyShiftJobs(
  input: RemindersInput,
  tomorrowDate: string,
  rule: SystemRuleConfig,
  scheduledFor: string,
): NewNotificationJob[] {
  const desksByPersonPeriod = new Map<string, { personId: string; period: string; desks: string[] }>();
  for (const assignment of input.emergencyAssignments ?? []) {
    if (assignment.personId === null || assignment.date !== tomorrowDate) continue;
    const key = `${assignment.personId} ${assignment.period}`;
    const existing = desksByPersonPeriod.get(key);
    if (existing) existing.desks.push(assignment.desk);
    else desksByPersonPeriod.set(key, { personId: assignment.personId, period: assignment.period, desks: [assignment.desk] });
  }

  const validJobs: NewNotificationJob[] = [];
  for (const { personId, period, desks } of desksByPersonPeriod.values()) {
    if (!isSystemRulePersonAllowed(rule, personId, input.people)) continue;
    const recipient = input.recipientResolution.resolved.get(personId);
    if (!recipient) continue;

    const label = periodLabel(period as EventPeriod);
    const desksText = desks.join(", ");
    const details = label ? `מחר משמרת ${label} שלך -- דסק ${desksText}` : `מחר המשמרת שלך -- דסק ${desksText}`;
    const { title, body } = applySystemRuleCopy("tomorrow_shift", rule, { title: "🚨 המשמרת שלך מחר", body: details });

    validJobs.push({
      category: "tomorrow_shift",
      recipientUserId: recipient.userId,
      title,
      body,
      path: "/schedule",
      tag: `tomorrow-shift-${tomorrowDate}-${recipient.userId}-${period}`,
      dedupeKey: `tomorrow_shift:${tomorrowDate}:${recipient.userId}:${period}`,
      scheduledFor,
      sourceRef: `emergency_shift:${personId}:${tomorrowDate}`,
    });
  }
  return validJobs;
}

// ---------------------------------------------------------------------------
// Tomorrow duty reminder (spec section 17)
// ---------------------------------------------------------------------------

async function runTomorrowDutyReminders(input: RemindersInput): Promise<{ created: number; cancelled: number }> {
  const tomorrowDate = nextCalendarDateString(input.now.date);
  if (!tomorrowDate) return { created: 0, cancelled: 0 };

  const rule = input.ruleConfig.systemRules.get("tomorrow_duty");
  if (!rule?.enabled) return applyReminderJobs("tomorrow_duty", tomorrowDate, [], input.persist, rule);
  // Spec section 25 -- regular duties are suspended system-wide while
  // Emergency Mode is active; an empty valid-jobs set here also CANCELS
  // any already-pending tomorrow_duty job (`applyReminderJobs`'s own
  // prefix sweep), so entering Emergency Mode silences these on the
  // very next tick.
  if (input.operationalMode === "emergency") return applyReminderJobs("tomorrow_duty", tomorrowDate, [], input.persist, rule);

  const scheduledFor = toIso(input.now.date, rule.localHour, rule.localMinute);
  const tomorrowDutyEvents = input.events.filter(
    (event) => event.category === "duty" && event.date === tomorrowDate && event.dutyFamily !== null,
  );

  const validJobs: NewNotificationJob[] = [];
  for (const event of tomorrowDutyEvents) {
    if (event.dutyFamily === null) continue;
    if (!isSystemRulePersonAllowed(rule, event.personId, input.people)) continue;
    const recipient = input.recipientResolution.resolved.get(event.personId);
    if (!recipient) continue;

    const label = dutyFamilyLabel(event.dutyFamily);
    const { title, body } = applySystemRuleCopy("tomorrow_duty", rule, {
      title: "🪖 תורנות מתקרבת",
      body: `מחר אתה ${label} — כדאי לבדוק את הפרטים`,
    });
    validJobs.push({
      category: "tomorrow_duty",
      recipientUserId: recipient.userId,
      title,
      body,
      path: "/duties",
      // Includes dutyFamily/slot, same as `dedupeKey` -- confirmed the
      // same tag-collision class PR #62 found for almash_check_in: a
      // person can have two concurrent tomorrow-duty Events on the same
      // date (different family/slot), which stay distinct jobs but would
      // otherwise collapse to one OS-level notification.
      tag: `tomorrow-duty-${tomorrowDate}-${recipient.userId}-${event.dutyFamily}-${event.slot ?? ""}`,
      dedupeKey: `tomorrow_duty:${tomorrowDate}:${recipient.userId}:${event.dutyFamily}:${event.slot ?? ""}`,
      scheduledFor,
      sourceRef: `duty:${event.personId}:${event.date}`,
    });
  }

  return applyReminderJobs("tomorrow_duty", tomorrowDate, validJobs, input.persist, rule);
}

// ---------------------------------------------------------------------------
// Tomorrow logistics-withdrawal reminder (משיכות מהלוגיסטיקה)
// ---------------------------------------------------------------------------

/**
 * Automatic, Sheet-derived -- NOT a manager-created notification (that
 * category is explicitly out of scope for PR #30, see spec section 2).
 * Reuses the exact same "current assignment exists tomorrow -> resolve
 * its recipient -> upsert-or-cancel reminder job" shape as the shift/duty
 * reminders above, sourced from `isLogisticsWithdrawalEvent` (see that
 * module's own docstring for why no new parser/column was needed).
 */
async function runTomorrowLogisticsWithdrawalReminders(
  input: RemindersInput,
): Promise<{ created: number; cancelled: number }> {
  const tomorrowDate = nextCalendarDateString(input.now.date);
  if (!tomorrowDate) return { created: 0, cancelled: 0 };

  const rule = input.ruleConfig.systemRules.get("tomorrow_logistics_withdrawal");
  if (!rule?.enabled) return applyReminderJobs("tomorrow_logistics_withdrawal", tomorrowDate, [], input.persist, rule);
  // Spec section 25 -- logistics-withdrawal coordination reads regular
  // shift/duty Events as "who's currently assigned"; during Emergency
  // Mode that data must never be trusted as authoritative (fail closed),
  // so this reminder is suspended entirely, same as `tomorrow_duty`.
  if (input.operationalMode === "emergency") {
    return applyReminderJobs("tomorrow_logistics_withdrawal", tomorrowDate, [], input.persist, rule);
  }

  const scheduledFor = toIso(input.now.date, rule.localHour, rule.localMinute);
  const tomorrowLogisticsWithdrawalEvents = input.events.filter(
    (event) => event.date === tomorrowDate && isLogisticsWithdrawalEvent(event),
  );

  const validJobs: NewNotificationJob[] = [];
  for (const event of tomorrowLogisticsWithdrawalEvents) {
    if (!isSystemRulePersonAllowed(rule, event.personId, input.people)) continue;
    const recipient = input.recipientResolution.resolved.get(event.personId);
    if (!recipient) continue;

    const { title, body } = applySystemRuleCopy("tomorrow_logistics_withdrawal", rule, {
      title: "📦 משיכות מהלוגיסטיקה מחר",
      // Names the operational window explicitly (13:00–14:00) rather than
      // the former generic "אתה משובץ" -- part of this feature's team-
      // coordination expansion (see `logisticsCoordination.ts`).
      body: "מחר אתה עושה משיכות בין 13:00–14:00.",
    });
    validJobs.push({
      category: "tomorrow_logistics_withdrawal",
      recipientUserId: recipient.userId,
      title,
      body,
      // No dedicated page represents this assignment -- but it already
      // surfaces generically on the dashboard's todayEvents/upcomingEvents
      // (buildPersonalScheduleReadModel includes every category, unfiltered),
      // so "/" is both the spec's stated fallback AND the page this
      // assignment is factually visible on today.
      path: "/",
      tag: `tomorrow-logistics-withdrawal-${tomorrowDate}-${recipient.userId}`,
      dedupeKey: `tomorrow_logistics_withdrawal:${tomorrowDate}:${recipient.userId}`,
      scheduledFor,
      sourceRef: `logistics_withdrawal:${event.personId}:${event.date}`,
    });
  }

  return applyReminderJobs("tomorrow_logistics_withdrawal", tomorrowDate, validJobs, input.persist, rule);
}

// ---------------------------------------------------------------------------
// Tomorrow logistics-withdrawal SUPERVISOR reminder (day-before, 20:00) --
// team-coordination expansion on top of the assigned-person reminder above.
// ---------------------------------------------------------------------------

/**
 * One consolidated 20:00 job per relevant אחמ"ש for TOMORROW's withdrawal
 * window (`resolveRelevantSupervisors` -- structural, never
 * `Person.isSupervisor` alone; empty when no supervisor can be proven, per
 * spec "fail conservatively"). Content branches on whether anyone is
 * currently assigned:
 *
 *  - assigned: informs the supervisor who it is (spec Case A.2) -- works on
 *    ANY weekday (an explicit "משיכות" Event is always an intentional
 *    withdrawal, Monday or not) -- excludes any assignee who is ALSO a
 *    resolved supervisor recipient (precedence: a person never gets told
 *    about their own assignment twice under two different roles).
 *  - unassigned: the anti-spam warning (spec Case B.1) -- ONLY when
 *    tomorrow is genuinely a logistics-withdrawal date
 *    (`isLogisticsWithdrawalFallbackDate` -- Monday; withdrawals are not
 *    operationally expected any other day, so an unassigned Tuesday is not
 *    a gap worth warning about). Even on a qualifying date, ONLY the
 *    supervisor is warned the evening before; technicians are deliberately
 *    never notified at this hour (spec: "the assignment may still be
 *    fixed before noon").
 *
 * Same upsert-or-cancel-by-prefix model as every other tomorrow reminder,
 * so a supervisor swap, a newly-proven assignment, or an assignment
 * disappearing all resolve correctly on the next tick.
 */
async function runTomorrowLogisticsWithdrawalSupervisorReminders(
  input: RemindersInput,
): Promise<{ created: number; cancelled: number }> {
  const tomorrowDate = nextCalendarDateString(input.now.date);
  if (!tomorrowDate) return { created: 0, cancelled: 0 };

  const rule = input.ruleConfig.systemRules.get("tomorrow_logistics_withdrawal_supervisor");
  if (!rule?.enabled) {
    return applyReminderJobs("tomorrow_logistics_withdrawal_supervisor", tomorrowDate, [], input.persist, rule);
  }
  // Spec section 25 -- `resolveRelevantSupervisors` reads regular shift
  // Events as "who's currently on shift"; that must never be trusted
  // during Emergency Mode (fail closed), so this reminder is suspended
  // entirely.
  if (input.operationalMode === "emergency") {
    return applyReminderJobs("tomorrow_logistics_withdrawal_supervisor", tomorrowDate, [], input.persist, rule);
  }

  const scheduledFor = toIso(input.now.date, rule.localHour, rule.localMinute);
  const assignees = findLogisticsWithdrawalAssignees(input.events, tomorrowDate);
  const assignedPersonIds = new Set(assignees.map((assignee) => assignee.personId));
  const isAssigned = assignees.length > 0;
  const participatesTomorrow = isAssigned || isLogisticsWithdrawalFallbackDate(tomorrowDate);

  const supervisors = participatesTomorrow
    ? resolveRelevantSupervisors(input.events, tomorrowDate, input.shiftSchedule).filter(
        (supervisor) => !assignedPersonIds.has(supervisor.personId),
      )
    : [];

  const builtIn = isAssigned
    ? { title: "📦 משיכות מחר", body: buildSupervisorAssignedInformedBody(assignees.map((a) => a.personName)) }
    : {
        title: "⚠️ לא הוגדר טכנאי למשיכות",
        body: "לא הוגדר טכנאי למשיכות מחר בין 13:00–14:00. נדרש לוודא שכל הטכנאים הזמינים יוצאים למשיכות.",
      };
  const { title, body } = applySystemRuleCopy("tomorrow_logistics_withdrawal_supervisor", rule, builtIn);

  const validJobs: NewNotificationJob[] = [];
  for (const supervisor of supervisors) {
    if (!isSystemRulePersonAllowed(rule, supervisor.personId, input.people)) continue;
    const recipient = input.recipientResolution.resolved.get(supervisor.personId);
    if (!recipient) continue;

    validJobs.push({
      category: "tomorrow_logistics_withdrawal_supervisor",
      recipientUserId: recipient.userId,
      title,
      body,
      path: "/",
      tag: `tomorrow-logistics-withdrawal-supervisor-${tomorrowDate}-${recipient.userId}`,
      dedupeKey: `tomorrow_logistics_withdrawal_supervisor:${tomorrowDate}:${recipient.userId}`,
      scheduledFor,
      sourceRef: `logistics_withdrawal_supervisor:${supervisor.personId}:${tomorrowDate}`,
    });
  }

  return applyReminderJobs("tomorrow_logistics_withdrawal_supervisor", tomorrowDate, validJobs, input.persist, rule);
}

// ---------------------------------------------------------------------------
// Same-day noon (12:00) logistics-withdrawal team coordination: assigned
// technician / relevant supervisor / eligible teammates -- all computed
// together since they share the SAME underlying "who's assigned / who's
// the supervisor / who's eligible" query for TODAY's date.
// ---------------------------------------------------------------------------

interface NoonReminderCategorySummary {
  assigned: { created: number; cancelled: number };
  supervisor: { created: number; cancelled: number };
  team: { created: number; cancelled: number };
}

/**
 * Three audiences, computed together:
 *   1. the assigned person (when someone is assigned) gets their existing
 *      personal reminder.
 *   2. the relevant supervisor gets a logistics-context notification
 *      whenever the withdrawal genuinely participates today (an explicit
 *      assignment OR a qualifying unassigned Monday) -- informational,
 *      naming the assignee(s), when assigned; the anti-spam warning
 *      otherwise. This is NOT an unassigned-only fallback.
 *   3. other eligible technicians get either the unassigned Monday
 *      all-hands fallback, or "help the assigned technician(s)" copy when
 *      someone is assigned.
 *
 * Recipient precedence, enforced by construction (spec: "A single user
 * should not receive two pushes for the same logistics purpose/time
 * merely because they hold multiple capability flags"):
 *   1. assigned-person-specific copy (the assignee(s) themselves)
 *   2. supervisor-specific copy (excludes anyone already an assignee)
 *   3. generic technician-team copy (excludes anyone already an assignee
 *      OR already a supervisor recipient above)
 */
async function runLogisticsWithdrawalNoonReminders(input: RemindersInput): Promise<NoonReminderCategorySummary> {
  const today = input.now.date;
  const assignedRule = input.ruleConfig.systemRules.get("logistics_withdrawal_noon_assigned");
  const supervisorRule = input.ruleConfig.systemRules.get("logistics_withdrawal_noon_supervisor");
  const teamRule = input.ruleConfig.systemRules.get("logistics_withdrawal_noon_team");

  // Spec section 25 -- every branch below (assigned/supervisor/team)
  // ultimately reads regular shift Events as "who's currently on shift"
  // (`resolveRelevantSupervisors`/`resolveEligibleLogisticsTechnicians`),
  // which must never be trusted during Emergency Mode (fail closed).
  // Suspended entirely -- an empty valid-jobs set for each category also
  // cancels any already-pending job via `applyReminderJobs`'s own prefix
  // sweep.
  if (input.operationalMode === "emergency") {
    const assigned = await applyReminderJobs("logistics_withdrawal_noon_assigned", today, [], input.persist, assignedRule);
    const supervisor = await applyReminderJobs("logistics_withdrawal_noon_supervisor", today, [], input.persist, supervisorRule);
    const team = await applyReminderJobs("logistics_withdrawal_noon_team", today, [], input.persist, teamRule);
    return { assigned, supervisor, team };
  }

  const assignees = findLogisticsWithdrawalAssignees(input.events, today);
  const assignedPersonIds = new Set(assignees.map((assignee) => assignee.personId));
  const isAssigned = assignees.length > 0;
  // An explicit "משיכות" Event works on any weekday; the UNASSIGNED
  // fallback (supervisor warning + all-hands teammate message) only ever
  // exists on a genuine logistics-withdrawal date (Monday) -- see
  // `isLogisticsWithdrawalFallbackDate`'s own docstring.
  const participatesToday = isAssigned || isLogisticsWithdrawalFallbackDate(today);

  const assignedJobs: NewNotificationJob[] = [];
  if (assignedRule?.enabled) {
    const scheduledFor = toIso(today, assignedRule.localHour, assignedRule.localMinute);
    const { title, body } = applySystemRuleCopy("logistics_withdrawal_noon_assigned", assignedRule, {
      title: "📦 משיכות בעוד שעה",
      body: "היום אתה עושה משיכות בין 13:00–14:00.",
    });
    for (const assignee of assignees) {
      if (!isSystemRulePersonAllowed(assignedRule, assignee.personId, input.people)) continue;
      const recipient = input.recipientResolution.resolved.get(assignee.personId);
      if (!recipient) continue;
      assignedJobs.push({
        category: "logistics_withdrawal_noon_assigned",
        recipientUserId: recipient.userId,
        title,
        body,
        path: "/",
        tag: `logistics-withdrawal-noon-assigned-${today}-${recipient.userId}`,
        dedupeKey: `logistics_withdrawal_noon_assigned:${today}:${recipient.userId}`,
        scheduledFor,
        sourceRef: `logistics_withdrawal:${assignee.personId}:${today}`,
      });
    }
  }
  const assignedResult = await applyReminderJobs(
    "logistics_withdrawal_noon_assigned",
    today,
    assignedJobs,
    input.persist,
    assignedRule,
  );

  // The relevant supervisor gets a noon logistics notification whenever the
  // withdrawal genuinely participates today (`participatesToday`: an
  // explicit assignment OR a qualifying unassigned Monday) -- NOT only when
  // unassigned. Copy branches on `isAssigned`: informational (naming the
  // assignee(s)) when someone is assigned, the anti-spam warning otherwise.
  // No supervisor job at all on a non-Monday with nothing assigned -- any
  // previously-upserted job naturally becomes stale and is cancelled by
  // `applyReminderJobs`'s own prefix sweep.
  const supervisorCandidates = participatesToday
    ? resolveRelevantSupervisors(input.events, today, input.shiftSchedule).filter(
        (supervisor) => !assignedPersonIds.has(supervisor.personId),
      )
    : [];
  const supervisorJobs: NewNotificationJob[] = [];
  if (participatesToday && supervisorRule?.enabled) {
    const scheduledFor = toIso(today, supervisorRule.localHour, supervisorRule.localMinute);
    const builtInSupervisorCopy = isAssigned
      ? { title: "📦 משיכות היום", body: buildSupervisorAssignedTodayBody(assignees.map((a) => a.personName)) }
      : {
          title: "⚠️ לא הוגדר טכנאי למשיכות",
          body: "לא הוגדר טכנאי למשיכות היום בין 13:00–14:00. נדרש לוודא שכל הטכנאים הזמינים יוצאים למשיכות.",
        };
    const { title, body } = applySystemRuleCopy("logistics_withdrawal_noon_supervisor", supervisorRule, builtInSupervisorCopy);
    for (const supervisor of supervisorCandidates) {
      if (!isSystemRulePersonAllowed(supervisorRule, supervisor.personId, input.people)) continue;
      const recipient = input.recipientResolution.resolved.get(supervisor.personId);
      if (!recipient) continue;
      supervisorJobs.push({
        category: "logistics_withdrawal_noon_supervisor",
        recipientUserId: recipient.userId,
        title,
        body,
        path: "/",
        tag: `logistics-withdrawal-noon-supervisor-${today}-${recipient.userId}`,
        dedupeKey: `logistics_withdrawal_noon_supervisor:${today}:${recipient.userId}`,
        scheduledFor,
        sourceRef: `logistics_withdrawal_supervisor:${supervisor.personId}:${today}`,
      });
    }
  }
  const supervisorResult = await applyReminderJobs(
    "logistics_withdrawal_noon_supervisor",
    today,
    supervisorJobs,
    input.persist,
    supervisorRule,
  );

  // Eligible teammates, excluding anyone already reached above (precedence).
  // Same `participatesToday` gate as the supervisor notification: on a
  // non-Monday with nothing assigned, there is no team notification either
  // (spec: "create zero logistics fallback jobs").
  const supervisorRecipientPersonIds = new Set(supervisorCandidates.map((supervisor) => supervisor.personId));
  const eligibleTechnicians: readonly Person[] = participatesToday
    ? resolveEligibleLogisticsTechnicians(input.events, input.people, today, input.shiftSchedule).filter(
        (person) => !assignedPersonIds.has(person.id) && !supervisorRecipientPersonIds.has(person.id),
      )
    : [];

  const teamBuiltIn = isAssigned
    ? { title: "🤝 משיכות היום", body: buildTeamHelpAssignedBody(assignees.map((a) => a.personName)) }
    : {
        title: "📦 משיכות היום",
        body: "לא הוגדר טכנאי למשיכות היום. כל הטכנאים הזמינים נדרשים לצאת למשיכות בין 13:00–14:00.",
      };

  const teamJobs: NewNotificationJob[] = [];
  if (teamRule?.enabled) {
    const scheduledFor = toIso(today, teamRule.localHour, teamRule.localMinute);
    const { title: teamTitle, body: teamBody } = applySystemRuleCopy("logistics_withdrawal_noon_team", teamRule, teamBuiltIn);
    for (const person of eligibleTechnicians) {
      if (!isSystemRulePersonAllowed(teamRule, person.id, input.people)) continue;
      const recipient = input.recipientResolution.resolved.get(person.id);
      if (!recipient) continue;
      teamJobs.push({
        category: "logistics_withdrawal_noon_team",
        recipientUserId: recipient.userId,
        title: teamTitle,
        body: teamBody,
        path: "/",
        tag: `logistics-withdrawal-noon-team-${today}-${recipient.userId}`,
        dedupeKey: `logistics_withdrawal_noon_team:${today}:${recipient.userId}`,
        scheduledFor,
        sourceRef: `logistics_withdrawal_team:${person.id}:${today}`,
      });
    }
  }
  const teamResult = await applyReminderJobs("logistics_withdrawal_noon_team", today, teamJobs, input.persist, teamRule);

  return { assigned: assignedResult, supervisor: supervisorResult, team: teamResult };
}

// ---------------------------------------------------------------------------
// עלמ״ש check-in reminder (שמירה / עתודה / אוקסיד only)
// ---------------------------------------------------------------------------

/**
 * Only these three duty families get an עלמ״ש check-in push -- NOT every
 * family `deriveDutyActions()` produces a `duty_check_in` action for
 * (kitchen/rasar/callup also get one, but are out of scope here by product
 * decision). Filtered here, at the notification boundary, rather than by
 * changing `deriveDutyActions()` itself -- that function's broader output
 * is still correct domain data for its existing UI consumers
 * (`duties/page.tsx`, `TodayTimeline`); this is a narrower selection ON
 * TOP of it, never a fork of it.
 */
const ALMASH_CHECKIN_DUTY_FAMILIES: ReadonlySet<DutyFamily> = new Set<DutyFamily>(["guard", "reserve", "oxid"]);

/**
 * Reuses `buildDutyBlocks`/`deriveDutyActions` (the SAME domain functions
 * `duties/page.tsx` already renders from) rather than re-deriving
 * check-in dates from `Event`s directly -- so multi-day block semantics
 * (check-in on every actual duty date EXCEPT the final day), dedup, and
 * source-event traceability all come for free and can never drift from
 * what the Duties page itself shows.
 *
 * Fires the SAME calendar day as the check-in (`action.date`), not the
 * day before -- this is a same-day "noon-style" reminder like
 * `logistics_withdrawal_noon_*`, not a day-before "tomorrow-style" one.
 * Sunday-Friday: 12:45 (a quarter hour before the 13:00 check-in).
 * Saturday: the actual מוצ״ש for that date (`resolveMotzashShabbatInstant`)
 * -- 13:00/12:45 are never reachable/relevant on a Saturday, and מוצ״ש
 * itself IS the real check-in moment then, not a 15-minutes-early nudge.
 * A date whose מוצ״ש can't be resolved (should be unreachable --
 * `action.date` always comes from a previously-validated `Event.date`)
 * is skipped rather than falling back to a guessed clock time.
 */
async function runAlmashCheckInReminders(input: RemindersInput): Promise<{ created: number; cancelled: number }> {
  const today = input.now.date;
  const todayParsed = parseCalendarDate(today);
  if (!todayParsed) return { created: 0, cancelled: 0 };

  const rule = input.ruleConfig.systemRules.get("almash_check_in");
  if (!rule?.enabled) return applyReminderJobs("almash_check_in", today, [], input.persist, rule);
  // Spec section 25 -- regular duties (guard/reserve/oxid check-ins
  // included) are suspended system-wide while Emergency Mode is active.
  if (input.operationalMode === "emergency") return applyReminderJobs("almash_check_in", today, [], input.persist, rule);

  const isSaturday = dayOfWeek(todayParsed) === 6;
  // Saturday always uses the real astronomical מוצ״ש instant -- protected
  // domain behavior, never the manager-configured hour/minute (13:00/12:45
  // are never reachable/relevant on a Saturday). Sunday-Friday uses the
  // rule's own configured local send time.
  const scheduledFor = isSaturday
    ? resolveMotzashShabbatInstant(today)?.toISOString()
    : toIso(today, rule.localHour, rule.localMinute);
  if (!scheduledFor) return { created: 0, cancelled: 0 };

  const dutyBlocks = buildDutyBlocks(input.events);
  const todayActions = deriveDutyActions(dutyBlocks).filter(
    (action) => action.date === today && ALMASH_CHECKIN_DUTY_FAMILIES.has(action.dutyBlock.dutyFamily),
  );

  const validJobs: NewNotificationJob[] = [];
  for (const action of todayActions) {
    if (!isSystemRulePersonAllowed(rule, action.personId, input.people)) continue;
    const recipient = input.recipientResolution.resolved.get(action.personId);
    if (!recipient) continue;

    const label = dutyFamilyLabel(action.dutyBlock.dutyFamily);
    const builtIn = isSaturday
      ? { title: "🫡 הגיע הזמן לעלמ״ש", body: `יש לך הערב עלמ״ש ל${label}` }
      : { title: "🫡 עלמ״ש בעוד רבע שעה", body: `יש לך היום עלמ״ש ל${label} — מתחילים ב־13:00` };
    const { title, body } = applySystemRuleCopy("almash_check_in", rule, builtIn);

    const slot = action.dutyBlock.slot ?? "";
    validJobs.push({
      category: "almash_check_in",
      recipientUserId: recipient.userId,
      title,
      body,
      path: "/duties",
      // Must include dutyFamily/slot, same as `dedupeKey` below -- the
      // service worker passes this tag straight through to
      // `showNotification()` (`public/sw.js`), where the Notifications
      // API replaces/collapses any existing OS-level notification with
      // the same tag. A coarser tag (date+recipient alone) would silently
      // drop a second legitimate same-day almash push for one person
      // (e.g. two concurrent duty families/slots) even though both stay
      // fully distinct logical jobs in notification_jobs/the inbox.
      tag: `almash-check-in-${today}-${recipient.userId}-${action.dutyBlock.dutyFamily}-${slot}`,
      dedupeKey: `almash_check_in:${today}:${recipient.userId}:${action.dutyBlock.dutyFamily}:${slot}`,
      scheduledFor,
      sourceRef: `duty:${action.personId}:${action.date}`,
    });
  }

  return applyReminderJobs("almash_check_in", today, validJobs, input.persist, rule);
}

/** Every dedupe-key prefix any reminder category above ever uses -- kept as a union so `applyReminderJobs` can't be called with a typo'd/unrelated category string. */
type ReminderCategory =
  | "tomorrow_shift"
  | "tomorrow_duty"
  | "tomorrow_logistics_withdrawal"
  | "tomorrow_logistics_withdrawal_supervisor"
  | "logistics_withdrawal_noon_assigned"
  | "logistics_withdrawal_noon_supervisor"
  | "logistics_withdrawal_noon_team"
  | "almash_check_in"
  | "constraints_sunday"
  | "constraints_monday";

/**
 * Shared upsert-or-cancel application for every time-based reminder
 * category (both the day-before-at-20:00 ones and the same-day-at-12:00
 * logistics-coordination ones): every job whose content is still valid
 * this tick is upserted (creating it, or refreshing its content/recipient
 * if the underlying assignment changed before send -- spec sections
 * 16-17); every previously-created, still-pending job for the same
 * `dateKey` whose dedupe_key is no longer among the valid set (the
 * assignment disappeared, moved to a different recipient, or the
 * recipient set itself changed) is cancelled. `dateKey` is whichever
 * calendar date the category's own dedupe-key scheme uses (tomorrow's
 * date for the 20:00 categories, today's date for the noon ones) -- never
 * assumed to be "tomorrow" specifically.
 *
 * `rule` is THIS tick's own loaded `SystemRuleConfig` for `category` --
 * every call site's own `if (!rule?.enabled) return applyReminderJobs(category, dateKey, [], persist, rule)`
 * early-return guarantees `rule` is defined AND enabled whenever
 * `validJobs` is non-empty. `rule` being `undefined` here (missing from
 * this tick's loaded config entirely -- should be unreachable once the
 * seed migration has run) is handled as its own case below: fail-safe
 * means "create nothing" (already guaranteed by every call site, since
 * `validJobs` is always `[]` in that branch), but there is no rule
 * identity/revision to AUTHORIZE a cancellation with either -- so this
 * tick does NOT touch this category's existing pending jobs at all
 * rather than fall back to an unguarded mutation (see below).
 *
 * Both the upsert AND the cancellation sweep go through a revision-
 * guarded RPC -- never the generic `upsertPendingReminderJob`/
 * `cancelPendingReminderJob` -- closing two MIRROR-IMAGE races a worker's
 * own possibly-stale `NotificationRuleConfig` snapshot could otherwise
 * cause against a manager's concurrent `updateSystemRule` edit:
 *
 *  - `upsertPendingSystemReminderJob` stops a stale worker from
 *    re-CREATING a job under an OLD (superseded) configuration.
 *  - `cancelPendingSystemReminderJob` stops a stale worker from
 *    CANCELLING a job a FRESHER worker (or the manager's own
 *    reconciliation) has since created under the CURRENT revision --
 *    e.g. a worker that loaded a disabled revision, computed zero valid
 *    jobs, and would otherwise treat a concurrent re-enable's freshly-
 *    created job as "not in my valid set" and destroy it. See that
 *    function's own docstring for why it deliberately does NOT require
 *    `enabled = true` the way the upsert guard does.
 *
 * Either guard rejecting is a documented, benign no-op -- logged, never
 * thrown -- since the category's own next tick reloads the current
 * revision and reconciles correctly on its own. `created`/`cancelled`
 * reflect only WRITES the guarded RPCs actually authorized, never a raw
 * candidate/stale-key count.
 */
async function applyReminderJobs(
  category: ReminderCategory,
  dateKey: string,
  validJobs: readonly NewNotificationJob[],
  persist: boolean,
  rule: SystemRuleConfig | undefined,
): Promise<{ created: number; cancelled: number }> {
  if (!persist) {
    return { created: validJobs.length, cancelled: 0 };
  }

  if (!rule) {
    if (validJobs.length > 0) {
      throw new Error(`applyReminderJobs: missing system rule config for category "${category}" despite non-empty validJobs`);
    }
    console.warn(
      `[notifications] no rule config loaded for system category=${category} -- skipping this tick's job materialization/cancellation for it entirely (fail-safe: no rule identity/revision to authorize a mutation with)`,
    );
    return { created: 0, cancelled: 0 };
  }

  let created = 0;
  for (const job of validJobs) {
    const wrote = await upsertPendingSystemReminderJob(job, { ruleId: rule.id, expectedRevision: rule.revision });
    if (wrote) {
      created++;
    } else {
      console.warn(
        `[notifications] stale rule revision for category=${category} ruleId=${rule.id} expectedRevision=${rule.revision} dedupeKey=${job.dedupeKey} -- upsert skipped (a concurrent manager edit is now authoritative; reconciles on this category's own next tick)`,
      );
    }
  }

  const prefix = `${category}:${dateKey}:`;
  const existingKeys = await listPendingJobDedupeKeysByPrefix(prefix);
  const validKeys = new Set(validJobs.map((job) => job.dedupeKey));
  const staleKeys = existingKeys.filter((key) => !validKeys.has(key));

  let cancelled = 0;
  for (const key of staleKeys) {
    const cancelledOk = await cancelPendingSystemReminderJob(key, { ruleId: rule.id, category, expectedRevision: rule.revision });
    if (cancelledOk) {
      cancelled++;
    } else {
      console.warn(
        `[notifications] stale rule revision for category=${category} ruleId=${rule.id} expectedRevision=${rule.revision} dedupeKey=${key} -- cancellation skipped (a concurrent manager edit is now authoritative; a newer job under the current revision is left untouched)`,
      );
    }
  }

  return { created, cancelled };
}

// ---------------------------------------------------------------------------
// Weekly constraints reminders (spec section 18)
// ---------------------------------------------------------------------------

async function runConstraintsReminders(input: RemindersInput): Promise<{ created: number; cancelled: number }> {
  const today = parseCalendarDate(input.now.date);
  if (!today) return { created: 0, cancelled: 0 };

  const weekday = dayOfWeek(today);

  if (weekday === 0) {
    return buildAndApplyConstraintsJobs(input, "constraints_sunday", {
      title: "📌 תזכורת לאילוצים",
      body: "יש אילוץ לשבוע הבא? אפשר לשלוח עד מחר.",
    });
  }
  if (weekday === 1) {
    return buildAndApplyConstraintsJobs(input, "constraints_monday", {
      title: "⏳ היום האחרון לאילוצים",
      body: "אפשר לשלוח אילוצים לשבוע הבא עד סוף היום.",
    });
  }

  return { created: 0, cancelled: 0 };
}

/**
 * Recipient source is every CURRENTLY-ROSTERED person who is NOT
 * `classifyPersonnelType(...) === "permanent"` (קבע), mapped to their
 * real Supabase auth user id (`resolveNonPermanentConstraintsRecipients`)
 * -- permanent staff never submit weekly אילוצים and must never receive
 * either constraints reminder. This REPLACES the previous "every real
 * auth account" source: an auth account that cannot be proven non-
 * permanent (no כ"א mapping at all) is correctly excluded, never
 * accidentally included (fail conservative, see that function's own
 * docstring). Deliberately still not gated on push-subscription state --
 * a user with Push disabled must still see this in their Notification
 * Center; `runDelivery` already correctly no-ops Push for a recipient
 * with zero subscriptions without affecting the job/inbox item itself.
 *
 * Uses the SAME upsert-or-cancel-by-prefix model (`applyReminderJobs`)
 * every other system rule uses -- so disabling the rule mid-day cancels
 * an already-upserted pending job, and changing its send time before
 * send safely re-upserts the SAME job at the new time rather than
 * creating a duplicate.
 */
async function buildAndApplyConstraintsJobs(
  input: RemindersInput,
  category: "constraints_sunday" | "constraints_monday",
  copy: { title: string; body: string },
): Promise<{ created: number; cancelled: number }> {
  const rule = input.ruleConfig.systemRules.get(category);
  if (!rule?.enabled) return applyReminderJobs(category, input.week.weekStart, [], input.persist, rule);

  const recipients = await resolveNonPermanentConstraintsRecipients(input.people);
  const scheduledFor = toIso(input.now.date, rule.localHour, rule.localMinute);
  const { title, body } = applySystemRuleCopy(category, rule, copy);

  const validJobs: NewNotificationJob[] = recipients
    // `resolveNonPermanentConstraintsRecipients` already guarantees every
    // returned `personId` matches a genuine member of `input.people` (it
    // iterates `people` itself) -- a permanent person is never even a
    // candidate here to begin with, so no `audienceMode`/group/exclusion
    // configuration below can ever cause them to receive this reminder
    // (see `isSystemRulePersonAllowed`'s own docstring: a pure FILTER,
    // never a broadening, over whatever domain eligibility already
    // decided).
    .filter((recipient) => isSystemRulePersonAllowed(rule, recipient.personId, input.people))
    .map(({ userId }) => ({
      category,
      recipientUserId: userId,
      title,
      body,
      path: "/",
      tag: `${category}-${input.week.weekStart}-${userId}`,
      dedupeKey: `${category}:${input.week.weekStart}:${userId}`,
      scheduledFor,
      sourceRef: `constraints:${input.week.weekStart}`,
    }));

  return applyReminderJobs(category, input.week.weekStart, validJobs, input.persist, rule);
}
