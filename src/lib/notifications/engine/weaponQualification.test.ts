import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCalendarDays, formatCalendarDate } from "@/lib/domain/dateRange";
import { parseCalendarDate } from "@/lib/domain/dutyBlocks";
import type { DutyFamily, Event } from "@/lib/domain/event";
import type { Person } from "@/lib/domain/types";
import type { CompletionRow } from "@/lib/shootingRanges/store";
import type { RecipientResolution, ResolvedRecipient } from "./recipients";

const getCompletionsForPersonIds = vi.fn();
const upsertAggregateNotificationJob = vi.fn();
const resolveAggregateNotificationJob = vi.fn();

// `filterManagerRecipients` (`./recipients`), `buildWeaponQualificationIndex`/
// `buildShootingRangeQualificationReadModel` (readModels), and
// `detectWeaponQualificationIssues` (domain) are all kept REAL -- pure
// functions, no I/O of their own -- so this exercises the SAME business
// logic Manager Area's own "דורש טיפול" reads, never a mocked pass-through.
// Only the genuine I/O boundaries are mocked: the מטווחים completions
// table and the aggregate-episode notification-job read/write RPCs.
vi.mock("@/lib/shootingRanges/store", () => ({ getCompletionsForPersonIds: (...args: unknown[]) => getCompletionsForPersonIds(...args) }));
vi.mock("./store", () => ({
  upsertAggregateNotificationJob: (...args: unknown[]) => upsertAggregateNotificationJob(...args),
  resolveAggregateNotificationJob: (...args: unknown[]) => resolveAggregateNotificationJob(...args),
}));

const { runWeaponQualificationCheck } = await import("./weaponQualification");

/**
 * A tiny in-memory stand-in for the real `notification_jobs` table's
 * relevant slice, mirroring the EXACT episode semantics
 * `upsert_aggregate_notification_job`/`resolve_aggregate_notification_job`
 * implement in Postgres (see the migration
 * `20260913214805_add_aggregate_notification_episode_dedupe.sql`): ONE row
 * per `dedupeKey`, ever: a fresh/reopened episode (no row yet, or the
 * existing row is resolved) replaces the row and reports `true`; an
 * already-open episode is content-refreshed in place and reports `false`.
 * The genuine proof that the real SQL implements this exact contract
 * (including under real concurrent connections) lives in
 * `notificationEngineFunctions.integration.test.ts`, not here -- this
 * fake exists so `runWeaponQualificationCheck`'s own orchestration
 * (which manager gets called, with what content, when) is exercised
 * against a real read-back round trip rather than a stateless mock
 * return value.
 */
interface FakeJob {
  category: string;
  recipientUserId: string;
  dedupeKey: string;
  title: string;
  body: string;
  path: string;
  sourceRef?: string;
  resolvedAt: string | null;
}

let fakeJobsByDedupeKey = new Map<string, FakeJob>();

function resetFakeStore() {
  fakeJobsByDedupeKey = new Map();

  upsertAggregateNotificationJob.mockReset();
  upsertAggregateNotificationJob.mockImplementation(async (job: Omit<FakeJob, "resolvedAt">) => {
    const existing = fakeJobsByDedupeKey.get(job.dedupeKey);
    if (!existing || existing.resolvedAt !== null) {
      fakeJobsByDedupeKey.set(job.dedupeKey, { ...job, resolvedAt: null });
      return true;
    }
    fakeJobsByDedupeKey.set(job.dedupeKey, { ...existing, title: job.title, body: job.body, path: job.path, sourceRef: job.sourceRef });
    return false;
  });

  resolveAggregateNotificationJob.mockReset();
  resolveAggregateNotificationJob.mockImplementation(async (dedupeKey: string) => {
    const existing = fakeJobsByDedupeKey.get(dedupeKey);
    if (existing && existing.resolvedAt === null) {
      fakeJobsByDedupeKey.set(dedupeKey, { ...existing, resolvedAt: "2026-08-30T18:00:00.000Z" });
    }
  });
}

function fakeJobs(): FakeJob[] {
  return [...fakeJobsByDedupeKey.values()];
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "p1",
    name: "איתי בדיקה",
    email: "itay@example.invalid",
    isManager: false,
    isTechnician: true,
    isSupervisor: false,
    personnelType: "חובה",
    dischargeDate: null,
    enlistmentDate: null,
    ...overrides,
  };
}

function manager(overrides: Partial<Person> = {}): Person {
  return person({ id: "mgr1", name: "מנהל בדיקה", isManager: true, isTechnician: false, ...overrides });
}

function resolution(recipients: ResolvedRecipient[]): RecipientResolution {
  return {
    resolved: new Map(recipients.map((r) => [r.personId, r])),
    unmappedCount: 0,
    ambiguousEmailCount: 0,
    noEmailCount: 0,
  };
}

function recipient(personId: string, userId: string): ResolvedRecipient {
  return { personId, email: `${personId}@example.invalid`, userId };
}

let cellCounter = 0;
function nextCell(): string {
  cellCounter += 1;
  return `C${cellCounter}`;
}

function dutyEvent(overrides: Partial<Event> = {}): Event {
  return {
    personId: "p1",
    personName: "איתי בדיקה",
    date: "2026-08-31",
    title: "אוקסיד",
    rawValue: "אוקסיד",
    category: "duty",
    certainty: "confirmed",
    role: null,
    period: "unspecified",
    sourceSheet: "משמרות + תורנויות",
    sourceCell: nextCell(),
    slot: null,
    shadow: false,
    startTimeOverride: null,
    endTimeOverride: null,
    changeNote: null,
    dutyFamily: "oxid",
    absenceKind: null,
    ...overrides,
  };
}

/** `2026-09-02` plus `daysAhead` calendar days, via the SAME `dateRange.ts` arithmetic production code uses -- never a second/ad-hoc `Date`-based implementation. */
function futureDate(daysAhead: number): string {
  const base = parseCalendarDate("2026-09-02")!;
  return formatCalendarDate(addCalendarDays(base, daysAhead));
}

/** A single APPROVED app completion, expired well before "today" (2026-08-30) -- `performedOn` + 6 calendar months = 2026-07-01. */
function expiredCompletion(personId: string): CompletionRow {
  return {
    id: `completion_${personId}`,
    personId,
    performedOn: "2026-01-01",
    source: "self_report",
    status: "approved",
    notes: null,
    submittedByPersonId: personId,
    submittedByPersonName: "בדיקה",
    approvedByPersonId: "mgr1",
    approvedByPersonName: "מנהל בדיקה",
    approvedAt: "2026-01-02T00:00:00.000Z",
    linkedPlannedDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Every person referenced by `events`, all with the SAME expired baseline, resolved eligibly (חובה + טכנאי). */
function eligiblePeopleFor(events: readonly Event[]): Person[] {
  const ids = [...new Set(events.map((event) => event.personId))];
  return ids.map((id) => person({ id, name: id }));
}

describe("runWeaponQualificationCheck -- aggregate notification (spec: fix production notification spam)", () => {
  const MGR_RECIPIENTS = resolution([recipient("mgr1", "u_mgr1")]);

  beforeEach(() => {
    resetFakeStore();
    getCompletionsForPersonIds.mockReset();
  });

  it("1. 39 invalid activity events -> exactly ONE notification per manager, never 39", async () => {
    const events = Array.from({ length: 39 }, (_, i) =>
      dutyEvent({
        personId: `p${(i % 7) + 1}`,
        date: futureDate(i),
        dutyFamily: (["oxid", "guard", "reserve"] as DutyFamily[])[i % 3],
      }),
    );
    const people = [...eligiblePeopleFor(events), manager()];
    getCompletionsForPersonIds.mockResolvedValue(people.filter((p) => p.id !== "mgr1").map((p) => expiredCompletion(p.id)));

    const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

    expect(result.issuesDetected).toBe(39);
    expect(upsertAggregateNotificationJob).toHaveBeenCalledTimes(1);
    expect(result.jobsCreated).toBe(1);

    const [job] = fakeJobs();
    expect(job.category).toBe("weapon_qualification_summary");
    expect(job.path).toBe("/manager");
    expect(job.title).toBe("⚠️ בעיות כשירות מטווחים");
    expect(job.body).toBe(
      "נמצאו 39 שיבוצים עתידיים ללא כשירות מטווחים בתוקף אצל 7 אנשים. האירוע הקרוב: 2.9. נדרש טיפול.",
    );
    expect(JSON.parse(job.sourceRef!)).toHaveLength(39);
  });

  it("2. multiple invalid events for the SAME person -> still one aggregate notification", async () => {
    const events = [
      dutyEvent({ personId: "p1", dutyFamily: "oxid", date: futureDate(0) }),
      dutyEvent({ personId: "p1", dutyFamily: "guard", date: futureDate(3) }),
      dutyEvent({ personId: "p1", dutyFamily: "reserve", date: futureDate(6) }),
    ];
    const people = [person({ id: "p1" }), manager()];
    getCompletionsForPersonIds.mockResolvedValue([expiredCompletion("p1")]);

    const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

    expect(result.issuesDetected).toBe(3);
    expect(upsertAggregateNotificationJob).toHaveBeenCalledTimes(1);
    expect(fakeJobs()[0].body).toContain("אצל אדם אחד"); // singular -- only one affected person
    expect(JSON.parse(fakeJobs()[0].sourceRef!)).toHaveLength(3);
  });

  it("3. multiple affected people -> one aggregate notification with the correct affected-person count", async () => {
    const events = [
      dutyEvent({ personId: "p1", dutyFamily: "oxid", date: futureDate(0) }),
      dutyEvent({ personId: "p2", dutyFamily: "guard", date: futureDate(1) }),
      dutyEvent({ personId: "p3", dutyFamily: "reserve", date: futureDate(2) }),
    ];
    const people = [...eligiblePeopleFor(events), manager()];
    getCompletionsForPersonIds.mockResolvedValue(["p1", "p2", "p3"].map(expiredCompletion));

    const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

    expect(upsertAggregateNotificationJob).toHaveBeenCalledTimes(1);
    expect(result.jobsCreated).toBe(1);
    expect(fakeJobs()[0].body).toContain("אצל 3 אנשים");
  });

  it("4. repeated evaluation with UNCHANGED issues -> no duplicate notification row and no additional push", async () => {
    const events = [
      dutyEvent({ personId: "p1", dutyFamily: "oxid", date: futureDate(0) }),
      dutyEvent({ personId: "p2", dutyFamily: "guard", date: futureDate(1) }),
    ];
    const people = [...eligiblePeopleFor(events), manager()];
    getCompletionsForPersonIds.mockResolvedValue(["p1", "p2"].map(expiredCompletion));

    const first = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);
    const second = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

    // The RPC is still called every eligible tick (it recomputes/refreshes
    // content unconditionally, same convention as `upsertPendingReminderJob`)
    // -- but it reports `reopened=false` the second time, so no second push.
    expect(upsertAggregateNotificationJob).toHaveBeenCalledTimes(2);
    expect(first.jobsCreated).toBe(1);
    expect(second.jobsCreated).toBe(0);
    expect(fakeJobs()).toHaveLength(1); // still ONE row -- never a duplicate
  });

  it("5. issue ORDERING changes -> no duplicate notification, no additional push", async () => {
    const eventA = dutyEvent({ personId: "p1", dutyFamily: "oxid", date: futureDate(0) });
    const eventB = dutyEvent({ personId: "p2", dutyFamily: "guard", date: futureDate(1) });
    const people = [...eligiblePeopleFor([eventA, eventB]), manager()];
    getCompletionsForPersonIds.mockResolvedValue(["p1", "p2"].map(expiredCompletion));

    await runWeaponQualificationCheck(people, [eventA, eventB], [], [], "2026-08-30", true, MGR_RECIPIENTS);
    const second = await runWeaponQualificationCheck(people, [eventB, eventA], [], [], "2026-08-30", true, MGR_RECIPIENTS); // same set, reversed order

    expect(fakeJobs()).toHaveLength(1);
    expect(second.jobsCreated).toBe(0);
  });

  it("6. the set SHRINKS (but doesn't fully resolve) -> the SAME notification's displayed count is refreshed, no new row, no additional push", async () => {
    const eventA = dutyEvent({ personId: "p1", dutyFamily: "oxid", date: futureDate(0) });
    const eventB = dutyEvent({ personId: "p2", dutyFamily: "guard", date: futureDate(1) });
    const eventC = dutyEvent({ personId: "p3", dutyFamily: "reserve", date: futureDate(2) });
    const people = [...eligiblePeopleFor([eventA, eventB, eventC]), manager()];
    getCompletionsForPersonIds.mockResolvedValue(["p1", "p2", "p3"].map(expiredCompletion));

    await runWeaponQualificationCheck(people, [eventA, eventB, eventC], [], [], "2026-08-30", true, MGR_RECIPIENTS);
    // p3's issue resolved (e.g. requalified / assignment removed) -- only A and B remain.
    const second = await runWeaponQualificationCheck(people, [eventA, eventB], [], [], "2026-08-30", true, MGR_RECIPIENTS);

    expect(second.jobsCreated).toBe(0);
    expect(fakeJobs()).toHaveLength(1);
    expect(fakeJobs()[0].body).toContain("אצל 2 אנשים"); // content stays honest/current
    expect(JSON.parse(fakeJobs()[0].sourceRef!)).toHaveLength(2);
  });

  it("7. the exact production incident: 38 -> 40 -> 44 -> ONE active notification updated in place, ONE push total", async () => {
    function eventsFor(count: number): Event[] {
      return Array.from({ length: count }, (_, i) =>
        dutyEvent({ personId: `p${(i % 10) + 1}`, date: futureDate(i), dutyFamily: (["oxid", "guard", "reserve"] as DutyFamily[])[i % 3] }),
      );
    }
    const allPeople = [...eligiblePeopleFor(eventsFor(44)), manager()];
    getCompletionsForPersonIds.mockResolvedValue(allPeople.filter((p) => p.id !== "mgr1").map((p) => expiredCompletion(p.id)));

    const at38 = await runWeaponQualificationCheck(allPeople, eventsFor(38), [], [], "2026-08-30", true, MGR_RECIPIENTS);
    expect(at38.jobsCreated).toBe(1); // 0 -> 38: one active notification + one push

    const at40 = await runWeaponQualificationCheck(allPeople, eventsFor(40), [], [], "2026-08-30", true, MGR_RECIPIENTS);
    expect(at40.jobsCreated).toBe(0); // 38 -> 40: same notification updated, no additional push

    const at44 = await runWeaponQualificationCheck(allPeople, eventsFor(44), [], [], "2026-08-30", true, MGR_RECIPIENTS);
    expect(at44.jobsCreated).toBe(0); // 40 -> 44: same notification updated, no additional push

    const at44Again = await runWeaponQualificationCheck(allPeople, eventsFor(44), [], [], "2026-08-30", true, MGR_RECIPIENTS);
    expect(at44Again.jobsCreated).toBe(0); // 44 -> 44: idempotent, no duplicate

    expect(upsertAggregateNotificationJob).toHaveBeenCalledTimes(4); // one call per tick, but only the first ever "reopened"
    expect(fakeJobs()).toHaveLength(1); // still exactly one active notification row
    expect(fakeJobs()[0].body).toContain("44 שיבוצים עתידיים");
  });

  it("8. a fully resolved episode (44 -> 0) closes the notification, and a LATER new problem (0 -> 3) is a genuinely new episode with a new push", async () => {
    function eventsFor(count: number): Event[] {
      return Array.from({ length: count }, (_, i) =>
        dutyEvent({ personId: `p${(i % 10) + 1}`, date: futureDate(i), dutyFamily: (["oxid", "guard", "reserve"] as DutyFamily[])[i % 3] }),
      );
    }
    const allPeople = [...eligiblePeopleFor(eventsFor(44)), manager()];
    getCompletionsForPersonIds.mockResolvedValue(allPeople.filter((p) => p.id !== "mgr1").map((p) => expiredCompletion(p.id)));

    await runWeaponQualificationCheck(allPeople, eventsFor(44), [], [], "2026-08-30", true, MGR_RECIPIENTS);
    expect(fakeJobs()[0].resolvedAt).toBeNull();

    // 44 -> 0: fully resolved.
    const resolved = await runWeaponQualificationCheck(allPeople, [], [], [], "2026-08-30", true, MGR_RECIPIENTS);
    expect(resolved.jobsCreated).toBe(0);
    expect(resolveAggregateNotificationJob).toHaveBeenCalledTimes(1);
    expect(resolveAggregateNotificationJob).toHaveBeenCalledWith("weapon_qualification_summary:u_mgr1");
    expect(fakeJobs()[0].resolvedAt).not.toBeNull();
    expect(upsertAggregateNotificationJob).toHaveBeenCalledTimes(1); // never called while there's nothing to report

    // 0 -> 3 later: a genuinely new episode.
    const reopened = await runWeaponQualificationCheck(allPeople, eventsFor(3), [], [], "2026-08-30", true, MGR_RECIPIENTS);
    expect(reopened.jobsCreated).toBe(1); // a fresh push
    expect(fakeJobs()).toHaveLength(1); // the SAME row/dedupe key is reused, never a second one
    expect(fakeJobs()[0].resolvedAt).toBeNull();
    expect(JSON.parse(fakeJobs()[0].sourceRef!)).toHaveLength(3);
  });

  it("9. an issue set that was already empty stays a no-op -- resolving something never opened never throws or creates a row", async () => {
    getCompletionsForPersonIds.mockResolvedValue([]);
    const events: Event[] = [dutyEvent({ dutyFamily: null, category: "shift", title: "טכנאי יום" })];
    const people = [person(), manager()];

    const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

    expect(result).toEqual({ issuesDetected: 0, jobsCreated: 0 });
    expect(resolveAggregateNotificationJob).toHaveBeenCalledTimes(1);
    expect(upsertAggregateNotificationJob).not.toHaveBeenCalled();
    expect(fakeJobs()).toHaveLength(0);
  });

  it("10. a permanent (קבע) staff member with an expired qualification produces the SAME alert as a regular person -- requiresWeaponQualification is driven by the activity, never a personnel-category special case", async () => {
    const permanentGuard = person({ id: "p_perm", name: "קבע בדיקה", personnelType: "קבע", isTechnician: true });
    const events = [dutyEvent({ personId: "p_perm", personName: "קבע בדיקה", dutyFamily: "guard", date: futureDate(0) })];
    const people = [permanentGuard, manager()];
    getCompletionsForPersonIds.mockResolvedValue([expiredCompletion("p_perm")]);

    const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

    expect(result.issuesDetected).toBe(1);
    expect(upsertAggregateNotificationJob).toHaveBeenCalledTimes(1);
    expect(result.jobsCreated).toBe(1);
    // Completions are fetched for the FULL roster, never pre-filtered by isEligibleForShootingRanges.
    expect(getCompletionsForPersonIds).toHaveBeenCalledWith(expect.arrayContaining(["p_perm", "mgr1"]));
  });

  describe("11. weapon-qualification alert is activity-driven, never scoped by isEligibleForShootingRanges (role/service-category)", () => {
    it("a permanent (קבע) staff member who is NEITHER אחמ\"ש nor טכנאי, with an expired qualification, still produces the alert", async () => {
      const permanentNonShiftCapable = person({ id: "p_perm_ns", name: "קבע לא כשיר", personnelType: "קבע", isTechnician: false, isSupervisor: false });
      const events = [dutyEvent({ personId: "p_perm_ns", personName: "קבע לא כשיר", dutyFamily: "guard", date: futureDate(0) })];
      const people = [permanentNonShiftCapable, manager()];
      getCompletionsForPersonIds.mockResolvedValue([expiredCompletion("p_perm_ns")]);

      const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

      expect(result.issuesDetected).toBe(1);
      expect(result.jobsCreated).toBe(1);
    });

    it("a regular (חובה) staff member who is NEITHER אחמ\"ש nor טכנאי, with an expired qualification, still produces the alert -- same rule, not permanent-specific", async () => {
      const regularNonShiftCapable = person({ id: "p_reg_ns", name: "חובה לא כשיר", personnelType: "חובה", isTechnician: false, isSupervisor: false });
      const events = [dutyEvent({ personId: "p_reg_ns", personName: "חובה לא כשיר", dutyFamily: "oxid", date: futureDate(0) })];
      const people = [regularNonShiftCapable, manager()];
      getCompletionsForPersonIds.mockResolvedValue([expiredCompletion("p_reg_ns")]);

      const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

      expect(result.issuesDetected).toBe(1);
      expect(result.jobsCreated).toBe(1);
    });

    it("a permanent (קבע) staff member who is NEITHER אחמ\"ש nor טכנאי, with NO qualification data at all, still produces the alert -- missing data is never silently ignored", async () => {
      const permanentNoData = person({ id: "p_perm_missing", name: "קבע חסר נתונים", personnelType: "קבע", isTechnician: false, isSupervisor: false });
      const events = [dutyEvent({ personId: "p_perm_missing", personName: "קבע חסר נתונים", dutyFamily: "reserve", date: futureDate(0) })];
      const people = [permanentNoData, manager()];
      getCompletionsForPersonIds.mockResolvedValue([]); // no completions at all, and no sheet baseline either

      const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

      expect(result.issuesDetected).toBe(1);
      expect(result.jobsCreated).toBe(1);
    });

    it("a valid (non-expired) qualification for a non-shift-capable permanent person -> no issue, no notification", async () => {
      const permanentValid = person({ id: "p_perm_valid", name: "קבע תקין", personnelType: "קבע", isTechnician: false, isSupervisor: false });
      const events = [dutyEvent({ personId: "p_perm_valid", personName: "קבע תקין", dutyFamily: "guard", date: futureDate(0) })];
      const people = [permanentValid, manager()];
      // Completed 2026-08-01, expires 2027-02-01 -- well past futureDate(0) (2026-09-02).
      getCompletionsForPersonIds.mockResolvedValue([
        { ...expiredCompletion("p_perm_valid"), performedOn: "2026-08-01" },
      ]);

      const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

      expect(result).toEqual({ issuesDetected: 0, jobsCreated: 0 });
      expect(upsertAggregateNotificationJob).not.toHaveBeenCalled();
    });

    it("an activity that does NOT require weapon qualification -> no issue even for an expired non-shift-capable permanent person", async () => {
      const permanentExpired = person({ id: "p_perm_unrelated", name: "קבע לא רלוונטי לפעילות", personnelType: "קבע", isTechnician: false, isSupervisor: false });
      const events = [dutyEvent({ personId: "p_perm_unrelated", personName: "קבע לא רלוונטי לפעילות", dutyFamily: null, category: "shift", title: "משמרת יום", date: futureDate(0) })];
      const people = [permanentExpired, manager()];
      getCompletionsForPersonIds.mockResolvedValue([expiredCompletion("p_perm_unrelated")]);

      const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

      expect(result).toEqual({ issuesDetected: 0, jobsCreated: 0 });
      expect(upsertAggregateNotificationJob).not.toHaveBeenCalled();
    });
  });

  it("valid qualification / unrelated activity -> no issue, no notification", async () => {
    getCompletionsForPersonIds.mockResolvedValue([]);
    const events: Event[] = [dutyEvent({ dutyFamily: null, category: "shift", title: "טכנאי יום" })];
    const people = [person(), manager()];

    const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

    expect(result).toEqual({ issuesDetected: 0, jobsCreated: 0 });
    expect(upsertAggregateNotificationJob).not.toHaveBeenCalled();
  });

  it("dry-run (persist: false) detects issues but never creates, reads, or resolves a notification", async () => {
    const events = [dutyEvent({ personId: "p1", date: futureDate(0) })];
    const people = [person({ id: "p1" }), manager()];
    getCompletionsForPersonIds.mockResolvedValue([expiredCompletion("p1")]);

    const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", false, MGR_RECIPIENTS);

    expect(result).toEqual({ issuesDetected: 1, jobsCreated: 0 });
    expect(upsertAggregateNotificationJob).not.toHaveBeenCalled();
    expect(resolveAggregateNotificationJob).not.toHaveBeenCalled();
  });

  it("a past invalid duty (date < today) never reaches detection, and creates no notification -- existing future-only filtering preserved", async () => {
    const events = [dutyEvent({ personId: "p1", date: "2026-08-01" })]; // before "today" (2026-08-30)
    const people = [person({ id: "p1" }), manager()];
    getCompletionsForPersonIds.mockResolvedValue([expiredCompletion("p1")]);

    const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, MGR_RECIPIENTS);

    expect(result).toEqual({ issuesDetected: 0, jobsCreated: 0 });
    expect(upsertAggregateNotificationJob).not.toHaveBeenCalled();
  });

  it("no managers resolved -> no notification, but issues are still counted as detected", async () => {
    const events = [dutyEvent({ personId: "p1", date: futureDate(0) })];
    const people = [person({ id: "p1" })]; // no manager at all
    getCompletionsForPersonIds.mockResolvedValue([expiredCompletion("p1")]);

    const result = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, resolution([]));

    expect(result).toEqual({ issuesDetected: 1, jobsCreated: 0 });
  });

  it("each manager is notified independently -- a manager with an already-open episode is content-refreshed while a different/newer manager opens a fresh one", async () => {
    const events = [dutyEvent({ personId: "p1", date: futureDate(0) })];
    const people = [person({ id: "p1" }), manager(), manager({ id: "mgr2", name: "מנהל שתיים" })];
    getCompletionsForPersonIds.mockResolvedValue([expiredCompletion("p1")]);
    const bothManagers = resolution([recipient("mgr1", "u_mgr1"), recipient("mgr2", "u_mgr2")]);

    // mgr1 already has an open episode from a previous tick; mgr2 has never been notified.
    await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, resolution([recipient("mgr1", "u_mgr1")]));
    expect(upsertAggregateNotificationJob).toHaveBeenCalledTimes(1);

    const second = await runWeaponQualificationCheck(people, events, [], [], "2026-08-30", true, bothManagers);

    // The RPC is called for EVERY manager on every eligible tick
    // (unconditionally, by design -- see `upsertAggregateNotificationJob`'s
    // own docstring): 1 call for mgr1 alone on the first tick, then 2 more
    // (mgr1 + mgr2) on the second tick -- 3 total.
    expect(upsertAggregateNotificationJob).toHaveBeenCalledTimes(3);
    expect(second.jobsCreated).toBe(1); // only mgr2's call reopened/pushed -- mgr1's was a silent content refresh
    const recipientIds = fakeJobs().map((job) => job.recipientUserId).sort();
    expect(recipientIds).toEqual(["u_mgr1", "u_mgr2"]);
  });
});
