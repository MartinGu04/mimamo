import { describe, expect, it } from "vitest";
import { buildShiftSchedule } from "@/lib/domain/shiftSchedule";
import type { Event } from "@/lib/domain/event";
import type { LocalNow } from "@/lib/domain/localNow";
import type { PotentialAllocation } from "@/lib/domain/potentialAllocation";
import type { Person } from "@/lib/domain/types";
import { parseEvent } from "@/lib/parsers/event";
import type { RawAssignment } from "@/lib/parsers/types";
import {
  buildPersonalScheduleReadModel,
  isCalendarDisplayEvent,
  isPersonalCalendarActivityEvent,
} from "./buildPersonalScheduleReadModel";
import type { PersonalScheduleReadModel } from "./types";

// day 07:30-19:30, night 19:30-07:30(+1)
const schedule = buildShiftSchedule("07:30");

let cellCounter = 0;
function nextCell(): string {
  cellCounter += 1;
  return `C${cellCounter}`;
}

const ME_ID = "p_me";
const COLLEAGUE_ID = "p_colleague";

function me(overrides: Partial<Person> = {}): Person {
  return {
    id: ME_ID,
    name: "דני בדיקה",
    email: "dani@example.invalid",
    isManager: false,
    isTechnician: true,
    isSupervisor: false,
    personnelType: null,
    dischargeDate: null,
    enlistmentDate: null,
    ...overrides,
  };
}

function colleague(overrides: Partial<Person> = {}): Person {
  return {
    id: COLLEAGUE_ID,
    name: "נועה דוגמה",
    email: "noa@example.invalid",
    isManager: false,
    isTechnician: false,
    isSupervisor: true,
    personnelType: null,
    dischargeDate: null,
    enlistmentDate: null,
    ...overrides,
  };
}

function baseEvent(overrides: Partial<Event> = {}): Event {
  return {
    personId: ME_ID,
    personName: "דני בדיקה",
    date: "2026-08-12",
    title: "טכנאי יום",
    rawValue: "טכנאי יום",
    category: "shift",
    certainty: "confirmed",
    role: "technician",
    period: "day",
    sourceSheet: "משמרות + תורנויות",
    sourceCell: nextCell(),
    slot: null,
    shadow: false,
    startTimeOverride: null,
    endTimeOverride: null,
    changeNote: null,
    dutyFamily: null,
    absenceKind: null,
    ...overrides,
  };
}

function myShift(overrides: Partial<Event> = {}): Event {
  return baseEvent({ category: "shift", ...overrides });
}

function myDuty(overrides: Partial<Event> = {}): Event {
  return baseEvent({
    category: "duty",
    role: null,
    period: "unspecified",
    dutyFamily: "guard",
    slot: 1,
    title: "שומר 1",
    rawValue: "שומר 1",
    ...overrides,
  });
}

function myAbsence(overrides: Partial<Event> = {}): Event {
  return baseEvent({
    category: "absence",
    role: null,
    period: "unspecified",
    absenceKind: "vacation",
    title: "חופש",
    rawValue: "חופש",
    ...overrides,
  });
}

function colleagueShift(overrides: Partial<Event> = {}): Event {
  return baseEvent({
    personId: COLLEAGUE_ID,
    personName: "נועה דוגמה",
    category: "shift",
    role: "supervisor",
    ...overrides,
  });
}

function allocation(overrides: Partial<PotentialAllocation> = {}): PotentialAllocation {
  return {
    date: "2026-08-20",
    dutyFamily: "guard",
    slot: 1,
    sourceSlot: 1,
    columnLabel: "שומר 1",
    sourceAllocationLabel: "דני בדיקה",
    resolvedSourcePersonId: null,
    sourceSheet: 'פוטנציאל תקש"אס 7-12/2026',
    sourceCell: nextCell(),
    ...overrides,
  };
}

function localNow(overrides: Partial<LocalNow> = {}): LocalNow {
  return { date: "2026-08-12", minuteOfDay: 10 * 60, ...overrides }; // 10:00
}

function build(opts: {
  person?: Person;
  people?: Person[];
  events?: Event[];
  now?: LocalNow;
  potentialAllocations?: PotentialAllocation[];
}): PersonalScheduleReadModel {
  const person = opts.person ?? me();
  const people = opts.people ?? [person];
  return buildPersonalScheduleReadModel({
    person,
    people,
    events: opts.events ?? [],
    shiftSchedule: schedule,
    fetchedAt: "2026-08-12T08:00:00.000Z",
    now: opts.now ?? localNow(),
    potentialAllocations: opts.potentialAllocations,
  });
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

describe("PersonalProfile", () => {
  it("exposes the authenticated person's safe profile fields", () => {
    const model = build({ person: me({ isManager: true, personnelType: "internal" }) });
    expect(model.person).toEqual({
      id: ME_ID,
      name: "דני בדיקה",
      isManager: true,
      isTechnician: true,
      isSupervisor: false,
      personnelType: "internal",
    });
  });

  it("10. never includes the authenticated person's email", () => {
    const model = build({});
    expect(JSON.stringify(model.person)).not.toContain("dani@example.invalid");
    expect(model.person).not.toHaveProperty("email");
  });

  it("11. never includes the full People[] array", () => {
    const model = build({ people: [me(), colleague()] });
    expect(model).not.toHaveProperty("people");
  });
});

// ---------------------------------------------------------------------------
// today / upcoming events
// ---------------------------------------------------------------------------

describe("todayEvents / upcomingEvents", () => {
  it("14. todayEvents contains only own Events dated today", () => {
    const events = [
      myShift({ date: "2026-08-12" }),
      myDuty({ date: "2026-08-13" }),
      colleagueShift({ date: "2026-08-12" }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.todayEvents).toHaveLength(1);
    expect(model.todayEvents[0].date).toBe("2026-08-12");
  });

  it("13. only the authenticated person's own Events appear anywhere in todayEvents/upcomingEvents", () => {
    const events = [myShift({ date: "2026-08-12" }), colleagueShift({ date: "2026-08-12" })];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.todayEvents.every((e) => e.title === "טכנאי יום")).toBe(true);
    expect(JSON.stringify(model.todayEvents)).not.toContain("נועה");
    expect(JSON.stringify(model.upcomingEvents)).not.toContain("נועה");
  });

  it("an overnight shift from yesterday still active after midnight remains in upcomingEvents", () => {
    const events = [myShift({ date: "2026-08-11", period: "night" })];
    const now = localNow({ date: "2026-08-12", minuteOfDay: 2 * 60 });
    const model = build({ events, now });
    expect(model.upcomingEvents.some((e) => e.date === "2026-08-11")).toBe(true);
  });

  it("a finished same-day shift stays in todayEvents but is dropped from upcomingEvents/currentAssignments", () => {
    const events = [myShift({ date: "2026-08-12", period: "day" })]; // 07:30-19:30
    const now = localNow({ date: "2026-08-12", minuteOfDay: 20 * 60 }); // 20:00, after end
    const model = build({ events, now });
    expect(model.todayEvents).toHaveLength(1);
    expect(model.upcomingEvents).toHaveLength(0);
    expect(model.currentAssignments).toHaveLength(0);
  });

  it("a not-yet-started later-today shift stays in upcomingEvents", () => {
    const events = [myShift({ date: "2026-08-12", period: "night" })]; // starts 19:30
    const now = localNow({ date: "2026-08-12", minuteOfDay: 10 * 60 });
    const model = build({ events, now });
    expect(model.upcomingEvents.some((e) => e.date === "2026-08-12")).toBe(true);
  });

  it("a currently-running same-day shift stays in upcomingEvents", () => {
    const events = [myShift({ date: "2026-08-12", period: "day" })];
    const now = localNow({ date: "2026-08-12", minuteOfDay: 10 * 60 });
    const model = build({ events, now });
    expect(model.upcomingEvents.some((e) => e.date === "2026-08-12")).toBe(true);
  });

  it("a future resolved shift stays in upcomingEvents", () => {
    const events = [myShift({ date: "2026-08-20", period: "day" })];
    const model = build({ events });
    expect(model.upcomingEvents.some((e) => e.date === "2026-08-20")).toBe(true);
  });

  it("a same-day not_evaluable shift is never dropped for lack of a guessed hour", () => {
    const events = [myShift({ date: "2026-08-12", period: "unspecified", role: null })];
    const model = build({ events }); // now = today, 10:00
    expect(model.upcomingEvents.some((e) => e.date === "2026-08-12")).toBe(true);
  });

  it("a future not_evaluable shift is never dropped for lack of a guessed hour", () => {
    const events = [myShift({ date: "2026-08-20", period: "unspecified", role: null })];
    const model = build({ events });
    expect(model.upcomingEvents.some((e) => e.date === "2026-08-20")).toBe(true);
  });

  it("16. historical Events are omitted from upcomingEvents", () => {
    const events = [myShift({ date: "2026-08-01", period: "day" })];
    const model = build({ events });
    expect(model.upcomingEvents).toHaveLength(0);
  });

  it("a finished overnight shift from yesterday is omitted from upcomingEvents", () => {
    const events = [myShift({ date: "2026-08-11", period: "night" })];
    const now = localNow({ date: "2026-08-12", minuteOfDay: 8 * 60 }); // after 07:30
    const model = build({ events, now });
    expect(model.upcomingEvents.some((e) => e.date === "2026-08-11")).toBe(false);
  });

  it("15. future Events are sorted deterministically by date", () => {
    const events = [
      myShift({ date: "2026-08-20", period: "day" }),
      myShift({ date: "2026-08-14", period: "day" }),
      myDuty({ date: "2026-08-16" }),
    ];
    const model = build({ events });
    expect(model.upcomingEvents.map((e) => e.date)).toEqual(["2026-08-14", "2026-08-16", "2026-08-20"]);
  });

  it("12. PersonalEventView never exposes sourceSheet/sourceCell", () => {
    const events = [myShift({ date: "2026-08-12" })];
    const model = build({ events });
    expect(model.todayEvents[0]).not.toHaveProperty("sourceSheet");
    expect(model.todayEvents[0]).not.toHaveProperty("sourceCell");
    expect(model.todayEvents[0].rawValue).toBe("טכנאי יום");
  });

  it("a resolved shift in todayEvents carries server-resolved timing", () => {
    const events = [myShift({ date: "2026-08-12", period: "day" })]; // 07:30-19:30
    const now = localNow({ date: "2026-08-12", minuteOfDay: 8 * 60 });
    const model = build({ events, now });
    expect(model.todayEvents[0].timing).toEqual({
      status: "resolved",
      startLocalTime: "07:30",
      endLocalTime: "19:30",
      durationMinutes: 720,
      elapsedMinutesAtLoad: 30,
      remainingMinutesAtLoad: 690,
      progressPercentAtLoad: 4,
      minutesUntilStartAtLoad: 0,
    });
  });

  it("a duty in todayEvents always carries not_evaluable timing -- no invented duration", () => {
    const events = [myDuty({ date: "2026-08-12" })];
    const model = build({ events });
    expect(model.todayEvents[0].timing).toEqual({ status: "not_evaluable" });
  });

  it("an overnight resolved shift in upcomingEvents carries correctly-wrapped 19:30 -> 07:30 timing", () => {
    const events = [myShift({ date: "2026-08-11", period: "night" })];
    const now = localNow({ date: "2026-08-12", minuteOfDay: 2 * 60 });
    const model = build({ events, now });
    const [event] = model.upcomingEvents;
    expect(event.timing).toEqual(
      expect.objectContaining({ status: "resolved", startLocalTime: "19:30", endLocalTime: "07:30" }),
    );
  });
});

// ---------------------------------------------------------------------------
// calendarEvents ("הלוח שלי" personal monthly calendar)
// ---------------------------------------------------------------------------

describe("isCalendarDisplayEvent (ICS scope) vs isPersonalCalendarActivityEvent (in-app calendar scope)", () => {
  it("isCalendarDisplayEvent -- the external ICS feed's own predicate -- stays narrow to shift/duty/absence, unaffected by the in-app widening", () => {
    expect(isCalendarDisplayEvent(baseEvent({ category: "shift" }))).toBe(true);
    expect(isCalendarDisplayEvent(baseEvent({ category: "duty" }))).toBe(true);
    expect(isCalendarDisplayEvent(baseEvent({ category: "absence" }))).toBe(true);
    expect(isCalendarDisplayEvent(baseEvent({ category: "status", title: "סוגר" }))).toBe(false);
    expect(isCalendarDisplayEvent(baseEvent({ category: "other", title: "שלב 9" }))).toBe(false);
    expect(isCalendarDisplayEvent(baseEvent({ category: "constraint" }))).toBe(false);
    expect(isCalendarDisplayEvent(baseEvent({ category: "context" }))).toBe(false);
  });

  it("isPersonalCalendarActivityEvent -- the in-app calendar's own wider predicate -- additionally includes non-empty status/other, but nothing wider than that", () => {
    expect(isPersonalCalendarActivityEvent(baseEvent({ category: "shift" }))).toBe(true);
    expect(isPersonalCalendarActivityEvent(baseEvent({ category: "duty" }))).toBe(true);
    expect(isPersonalCalendarActivityEvent(baseEvent({ category: "absence" }))).toBe(true);
    expect(isPersonalCalendarActivityEvent(baseEvent({ category: "status", title: "סוגר" }))).toBe(true);
    expect(isPersonalCalendarActivityEvent(baseEvent({ category: "other", title: "שלב 9" }))).toBe(true);
    expect(isPersonalCalendarActivityEvent(baseEvent({ category: "constraint" }))).toBe(false);
    expect(isPersonalCalendarActivityEvent(baseEvent({ category: "context" }))).toBe(false);
    expect(isPersonalCalendarActivityEvent(baseEvent({ category: "change_note", changeNote: "הוחלף" }))).toBe(false);
    expect(isPersonalCalendarActivityEvent(baseEvent({ category: "unknown" }))).toBe(false);
  });
});

describe("calendarEvents", () => {
  it("includes a historical (finished, past-dated) personal shift", () => {
    const events = [myShift({ date: "2026-08-01", period: "day" })];
    const model = build({ events }); // now = 2026-08-12
    expect(model.calendarEvents.some((e) => e.date === "2026-08-01")).toBe(true);
  });

  it("includes a currently-running personal shift", () => {
    const events = [myShift({ date: "2026-08-12", period: "day" })];
    const model = build({ events });
    expect(model.calendarEvents.some((e) => e.date === "2026-08-12")).toBe(true);
  });

  it("includes a future personal shift", () => {
    const events = [myShift({ date: "2026-08-20", period: "day" })];
    const model = build({ events });
    expect(model.calendarEvents.some((e) => e.date === "2026-08-20")).toBe(true);
  });

  it("includes duties, unlike the old shift-only calendar", () => {
    const events = [myShift({ date: "2026-08-12" }), myDuty({ date: "2026-08-12" })];
    const model = build({ events });
    expect(model.calendarEvents).toHaveLength(2);
    expect(model.calendarEvents.some((e) => e.category === "duty")).toBe(true);
  });

  it("includes absences, unlike the old shift-only calendar", () => {
    const events = [myShift({ date: "2026-08-12" }), myAbsence({ date: "2026-08-13" })];
    const model = build({ events });
    expect(model.calendarEvents).toHaveLength(2);
    expect(model.calendarEvents.some((e) => e.category === "absence")).toBe(true);
  });

  it("excludes non-calendar-worthy categories with no display-only carve-out (internal constraint/context rows)", () => {
    const events = [
      myShift({ date: "2026-08-12" }),
      baseEvent({ date: "2026-08-12", category: "constraint", title: "אילוץ" }),
      baseEvent({ date: "2026-08-12", category: "context", title: "מלחמה" }),
      baseEvent({ date: "2026-08-12", category: "change_note", title: "הוחלף", changeNote: "הוחלף" }),
    ];
    const model = build({ events });
    expect(model.calendarEvents).toHaveLength(1);
    expect(model.calendarEvents[0].category).toBe("shift");
  });

  describe("personal activities (status/other -- display-only informational entries)", () => {
    it("includes a 'status' activity (e.g. סוגר), unlike the old shift/duty/absence-only calendar", () => {
      const events = [baseEvent({ date: "2026-08-12", category: "status", title: "סוגר", rawValue: "סוגר" })];
      const model = build({ events });
      expect(model.calendarEvents).toHaveLength(1);
      expect(model.calendarEvents[0].category).toBe("status");
      expect(model.calendarEvents[0].title).toBe("סוגר");
    });

    it("includes an 'other' activity (e.g. שלב 9), unlike the old shift/duty/absence-only calendar", () => {
      const events = [baseEvent({ date: "2026-08-12", category: "other", title: "שלב 9", rawValue: "שלב 9" })];
      const model = build({ events });
      expect(model.calendarEvents).toHaveLength(1);
      expect(model.calendarEvents[0].category).toBe("other");
      expect(model.calendarEvents[0].title).toBe("שלב 9");
    });

    it("an activity coexists with a real shift on the same date -- neither hides the other", () => {
      const events = [
        myShift({ date: "2026-08-12", period: "day" }),
        baseEvent({ date: "2026-08-12", category: "status", title: "סוגר", rawValue: "סוגר" }),
      ];
      const model = build({ events });
      expect(model.calendarEvents).toHaveLength(2);
      expect(model.calendarEvents.map((e) => e.category).sort()).toEqual(["shift", "status"]);
    });

    it("an activity never becomes an assignment, current or otherwise -- currentAssignments stays shift/duty only", () => {
      const events = [
        myShift({ date: "2026-08-12", period: "day" }),
        baseEvent({ date: "2026-08-12", category: "status", title: "סוגר", rawValue: "סוגר" }),
      ];
      const model = build({ events });
      expect(model.currentAssignments).toHaveLength(1);
      expect(model.currentAssignments[0].category).toBe("shift");
    });

    it("an activity never enters dutyBlocks/dutyActions", () => {
      const events = [baseEvent({ date: "2026-08-12", category: "status", title: "סוגר", rawValue: "סוגר" })];
      const model = build({ events });
      expect(model.dutyBlocks).toHaveLength(0);
      expect(model.dutyActions).toHaveLength(0);
    });

    it("an activity never becomes an operational issue target", () => {
      const events = [baseEvent({ date: "2026-08-12", category: "status", title: "סוגר", rawValue: "סוגר" })];
      const model = build({ events });
      expect(model.issues).toHaveLength(0);
    });
  });

  it("excludes an unrelated person's events -- a colleague never becomes a calendar entry of mine", () => {
    const events = [myShift({ date: "2026-08-12" }), colleagueShift({ date: "2026-08-12" })];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.calendarEvents).toHaveLength(1);
    // The colleague's own Event never appears as an entry, and nothing about
    // them leaks onto MY event's own fields. Their name IS resolvable from
    // that shift's own `shiftCompanions` roster ("מי איתי במשמרת" -- asserted
    // in its own describe below), which is the single, deliberate place a
    // colleague is named on this page.
    const { shiftCompanions, ...ownFields } = model.calendarEvents[0];
    expect(shiftCompanions).not.toBeNull();
    expect(JSON.stringify(ownFields)).not.toContain("נועה");
  });

  it("is sorted deterministically by date, past through future, shifts before same-date duties/absences", () => {
    const events = [
      myShift({ date: "2026-08-20", period: "day" }),
      myAbsence({ date: "2026-08-01" }),
      myShift({ date: "2026-08-12", period: "day" }),
      myDuty({ date: "2026-08-12" }),
    ];
    const model = build({ events });
    expect(model.calendarEvents.map((e) => [e.date, e.category])).toEqual([
      ["2026-08-01", "absence"],
      ["2026-08-12", "shift"],
      ["2026-08-12", "duty"],
      ["2026-08-20", "shift"],
    ]);
  });

  it("preserves tentative/shadow/role/period/overrides and resolved timing for a shift", () => {
    const events = [
      myShift({
        date: "2026-08-12",
        period: "night",
        role: "supervisor",
        certainty: "tentative",
        shadow: true,
        startTimeOverride: "20:00",
      }),
    ];
    const model = build({ events });
    const [event] = model.calendarEvents;
    expect(event.certainty).toBe("tentative");
    expect(event.shadow).toBe(true);
    expect(event.role).toBe("supervisor");
    expect(event.period).toBe("night");
    expect(event.startTimeOverride).toBe("20:00");
    expect(event.timing.status).toBe("resolved");
  });

  it("preserves dutyFamily/slot on a duty entry", () => {
    const events = [myDuty({ date: "2026-08-12", dutyFamily: "reserve", slot: 2 })];
    const model = build({ events });
    expect(model.calendarEvents[0].dutyFamily).toBe("reserve");
    expect(model.calendarEvents[0].slot).toBe(2);
  });

  it("preserves absenceKind on an absence entry", () => {
    const events = [myAbsence({ date: "2026-08-12", absenceKind: "after" })];
    const model = build({ events });
    expect(model.calendarEvents[0].absenceKind).toBe("after");
  });

  it("never exposes sourceSheet/sourceCell/email on any calendarEvents entry", () => {
    const events = [myShift({ date: "2026-08-12" }), myDuty({ date: "2026-08-12" }), myAbsence({ date: "2026-08-13" })];
    const model = build({ events });
    for (const event of model.calendarEvents) {
      expect(event).not.toHaveProperty("sourceSheet");
      expect(event).not.toHaveProperty("sourceCell");
    }
    expect(JSON.stringify(model.calendarEvents)).not.toContain("dani@example.invalid");
  });
});

// ---------------------------------------------------------------------------
// calendarEvents[].shiftCompanions -- "מי איתי במשמרת"
// ---------------------------------------------------------------------------

describe('calendarEvents[].shiftCompanions — "מי איתי במשמרת"', () => {
  const THIRD_ID = "p_third";

  function thirdPerson(overrides: Partial<Person> = {}): Person {
    return colleague({ id: THIRD_ID, name: "יובל ישראלי", email: "yuval@example.invalid", ...overrides });
  }

  function thirdShift(overrides: Partial<Event> = {}): Event {
    return colleagueShift({ personId: THIRD_ID, personName: "יובל ישראלי", ...overrides });
  }

  function companionsOfFirstEvent(model: PersonalScheduleReadModel) {
    return model.calendarEvents[0].shiftCompanions;
  }

  const everyone = () => [me(), colleague(), thirdPerson()];

  it("1. a day shift lists another person's overlapping day shift", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day" }),
      thirdShift({ date: "2026-08-12", period: "day", role: "technician", title: "טכנאי יום", rawValue: "טכנאי יום" }),
    ];
    const model = build({ events, people: everyone() });
    expect(companionsOfFirstEvent(model)).toEqual([
      { personId: THIRD_ID, personName: "יובל ישראלי", shiftLabel: "טכנאי יום" },
    ]);
  });

  it("2. a shadow-role colleague is listed with their own צל label", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day" }),
      colleagueShift({
        date: "2026-08-12",
        period: "day",
        shadow: true,
        title: 'אחמ"ש צל',
        rawValue: 'אחמ"ש צל',
      }),
    ];
    const model = build({ events, people: everyone() });
    expect(companionsOfFirstEvent(model)).toEqual([
      { personId: COLLEAGUE_ID, personName: "נועה דוגמה", shiftLabel: 'אחמ"ש צל' },
    ]);
  });

  // Regression: a shift lead written in the FEMININE form ("אחמשית יום
  // צל") never showed up in "מי איתי במשמרת" because `parseEvent` only
  // recognized the masculine spelling 'אחמ"ש' -- the raw cell classified
  // as category "other" (role: null), so `shiftsOverlapInTime` never
  // considered it a shift at all. Runs the REAL raw-text pipeline
  // (`parseEvent`, not a hand-built Event) to prove the fix closes the gap
  // at the actual boundary the bug was reported at.
  it('2b. a feminine-form shift-lead colleague ("אחמשית יום צל", parsed from raw text) IS listed as a companion, same as the masculine form', () => {
    const rawColleagueCell: RawAssignment = {
      personId: COLLEAGUE_ID,
      personName: "נועה דוגמה",
      date: "2026-08-12",
      rawValue: "אחמשית יום צל",
      sourceSheet: "משמרות + תורנויות",
      sourceCell: nextCell(),
    };
    const events = [myShift({ date: "2026-08-12", period: "day" }), parseEvent(rawColleagueCell)];
    const model = build({ events, people: everyone() });
    expect(companionsOfFirstEvent(model)).toEqual([
      { personId: COLLEAGUE_ID, personName: "נועה דוגמה", shiftLabel: "אחמשית יום צל" },
    ]);
  });

  it("3. a same-day shift whose hours don't overlap is excluded", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", endTimeOverride: "10:00" }),
      colleagueShift({ date: "2026-08-12", period: "day", startTimeOverride: "12:00" }),
    ];
    const model = build({ events, people: everyone() });
    expect(companionsOfFirstEvent(model)).toEqual([]);
  });

  it("4. same-day vacation / הפנייה / duty never appear as companions", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day" }),
      colleagueShift({
        date: "2026-08-12",
        category: "absence",
        absenceKind: "vacation",
        role: null,
        period: "unspecified",
        title: "חופש",
        rawValue: "חופש",
      }),
      thirdShift({
        date: "2026-08-12",
        category: "duty",
        dutyFamily: "guard",
        slot: 1,
        role: null,
        period: "unspecified",
        title: "שומר 1",
        rawValue: "שומר 1",
      }),
    ];
    const model = build({ events, people: everyone() });
    expect(companionsOfFirstEvent(model)).toEqual([]);
  });

  it("5. the viewed person is never their own companion, not even via a second shift that day", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day" }),
      myShift({ date: "2026-08-12", period: "day", startTimeOverride: "12:00" }),
    ];
    const model = build({ events, people: everyone() });
    for (const event of model.calendarEvents) expect(event.shiftCompanions).toEqual([]);
  });

  it("6. a colleague assigned twice to the same shift is listed exactly once", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day" }),
      colleagueShift({
        date: "2026-08-12",
        period: "day",
        endTimeOverride: "13:00",
        title: 'אחמ"ש יום',
        rawValue: 'אחמ"ש יום',
      }),
      colleagueShift({
        date: "2026-08-12",
        period: "day",
        startTimeOverride: "13:00",
        title: 'אחמ"ש יום',
        rawValue: 'אחמ"ש יום',
      }),
    ];
    const model = build({ events, people: everyone() });
    expect(companionsOfFirstEvent(model)).toEqual([
      { personId: COLLEAGUE_ID, personName: "נועה דוגמה", shiftLabel: 'אחמ"ש יום' },
    ]);
  });

  it("7. an overnight shift resolves its companions across midnight, never by date alone", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "night", title: "טכנאי לילה", rawValue: "טכנאי לילה" }),
      // Starts 02:00 -- the NEXT calendar morning, still the same night shift.
      colleagueShift({
        date: "2026-08-12",
        period: "night",
        startTimeOverride: "02:00",
        title: 'אחמ"ש לילה',
        rawValue: 'אחמ"ש לילה',
      }),
      // Neighbouring nights: same period, adjacent dates, never overlapping.
      thirdShift({ date: "2026-08-11", period: "night" }),
      thirdShift({ date: "2026-08-13", period: "night" }),
    ];
    const model = build({ events, people: everyone() });
    expect(companionsOfFirstEvent(model)).toEqual([
      { personId: COLLEAGUE_ID, personName: "נועה דוגמה", shiftLabel: 'אחמ"ש לילה' },
    ]);
  });

  it("is null for every non-shift calendar entry -- a duty/absence is never asked the question", () => {
    const events = [
      myDuty({ date: "2026-08-12" }),
      myAbsence({ date: "2026-08-13" }),
      baseEvent({ date: "2026-08-14", category: "status", title: "סוגר", rawValue: "סוגר" }),
      colleagueShift({ date: "2026-08-12" }),
      colleagueShift({ date: "2026-08-13" }),
      colleagueShift({ date: "2026-08-14" }),
    ];
    const model = build({ events, people: everyone() });
    expect(model.calendarEvents).toHaveLength(3);
    for (const event of model.calendarEvents) expect(event.shiftCompanions).toBeNull();
  });

  it("carries the companion's own recorded shift text, never a role+period recomposition", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day" }),
      colleagueShift({ date: "2026-08-12", period: "day", title: "טכנאית צל", rawValue: "טכנאית צל", shadow: true }),
    ];
    const model = build({ events, people: everyone() });
    expect(companionsOfFirstEvent(model)?.[0].shiftLabel).toBe("טכנאית צל");
  });

  it("carries nothing about a companion beyond who they are and what they're on -- no email, no flags, no Events", () => {
    const events = [myShift({ date: "2026-08-12", period: "day" }), colleagueShift({ date: "2026-08-12" })];
    const model = build({ events, people: everyone() });
    const companion = companionsOfFirstEvent(model)?.[0];
    expect(Object.keys(companion ?? {}).sort()).toEqual(["personId", "personName", "shiftLabel"]);
    expect(JSON.stringify(companion)).not.toContain("noa@example.invalid");
  });

  it("is deterministic regardless of the input Event order", () => {
    const mine = myShift({ date: "2026-08-12", period: "day" });
    const first = colleagueShift({ date: "2026-08-12", period: "day" });
    const second = thirdShift({ date: "2026-08-12", period: "day" });

    const forward = build({ events: [mine, first, second], people: everyone() });
    const reversed = build({ events: [second, first, mine], people: everyone() });
    expect(companionsOfFirstEvent(forward)).toEqual(companionsOfFirstEvent(reversed));
    expect(companionsOfFirstEvent(forward)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// current assignments
// ---------------------------------------------------------------------------

describe("currentAssignments", () => {
  it("24. multiple additive assignments (shift + duty) on the same day are both preserved", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day" }),
      myDuty({ date: "2026-08-12" }),
    ];
    const model = build({ events });
    expect(model.currentAssignments).toHaveLength(2);
    expect(model.currentAssignments.every((a) => a.temporalState === "current")).toBe(true);
  });

  it("does not force a single current Event -- status alongside a shift is not an assignment", () => {
    const events = [myShift({ date: "2026-08-12", period: "day" }), baseEvent({ category: "status" })];
    const model = build({ events });
    expect(model.currentAssignments).toHaveLength(1);
    expect(model.currentAssignments[0].category).toBe("shift");
  });

  it("a past shift is not in currentAssignments", () => {
    const events = [myShift({ date: "2026-08-12", period: "day" })];
    const now = localNow({ date: "2026-08-12", minuteOfDay: 20 * 60 });
    const model = build({ events, now });
    expect(model.currentAssignments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// next assignment group
// ---------------------------------------------------------------------------

describe("nextAssignmentGroup", () => {
  it("25. picks a later-today shift over a future duty", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "night" }), // starts 19:30 today
      myDuty({ date: "2026-08-20" }),
    ];
    const model = build({ events }); // now = 10:00 today
    expect(model.nextAssignmentGroup?.date).toBe("2026-08-12");
    expect(model.nextAssignmentGroup?.events[0].category).toBe("shift");
  });

  it("26. picks a future duty when there is no upcoming shift", () => {
    const events = [myDuty({ date: "2026-08-20" })];
    const model = build({ events });
    expect(model.nextAssignmentGroup).toEqual({
      date: "2026-08-20",
      events: [expect.objectContaining({ category: "duty", temporalState: "upcoming" })],
    });
  });

  it("preserves multiple assignments sharing the same next date/start group", () => {
    const events = [
      myDuty({ date: "2026-08-20", dutyFamily: "guard", slot: 1, title: "שומר 1" }),
      myDuty({ date: "2026-08-20", dutyFamily: "reserve", slot: 2, title: "עתודה 2" }),
      myDuty({ date: "2026-08-25", dutyFamily: "guard", slot: 1 }),
    ];
    const model = build({ events });
    expect(model.nextAssignmentGroup?.date).toBe("2026-08-20");
    expect(model.nextAssignmentGroup?.events).toHaveLength(2);
  });

  it("null when there are no upcoming assignments", () => {
    const model = build({ events: [] });
    expect(model.nextAssignmentGroup).toBeNull();
  });

  it("27. a future not_evaluable shift is never dropped from nextAssignmentGroup -- its date is known even though its hour isn't", () => {
    const events = [myShift({ date: "2026-08-20", period: "unspecified", role: null })];
    const model = build({ events });
    expect(model.nextAssignmentGroup?.date).toBe("2026-08-20");
    expect(model.nextAssignmentGroup?.events).toEqual([
      expect.objectContaining({ date: "2026-08-20", category: "shift", temporalState: "not_evaluable" }),
    ]);
  });

  it("a same-day not_evaluable shift is never guessed into the group -- its timing could be either done or still to come", () => {
    const events = [myShift({ date: "2026-08-12", period: "unspecified", role: null })];
    const model = build({ events }); // now = today, 10:00
    expect(model.nextAssignmentGroup).toBeNull();
    // Still visible in the broader display list, just with no claimed temporal position.
    expect(model.todayEvents.some((e) => e.category === "shift")).toBe(true);
  });

  it("duty + one resolved shift on the same future date are both preserved in the group", () => {
    const events = [
      myDuty({ date: "2026-08-20", dutyFamily: "guard", slot: 1 }),
      myShift({ date: "2026-08-20", period: "day" }),
    ];
    const model = build({ events });
    expect(model.nextAssignmentGroup?.date).toBe("2026-08-20");
    expect(model.nextAssignmentGroup?.events.map((e) => e.category).sort()).toEqual(["duty", "shift"]);
  });

  it("duty + day + night shift on the same future date: the duty is preserved and only the earlier (day) shift joins it", () => {
    const events = [
      myDuty({ date: "2026-08-20", dutyFamily: "guard", slot: 1 }),
      myShift({ date: "2026-08-20", period: "day" }), // starts 07:30
      myShift({ date: "2026-08-20", period: "night" }), // starts 19:30 -- later
    ];
    const model = build({ events });
    expect(model.nextAssignmentGroup?.date).toBe("2026-08-20");
    expect(model.nextAssignmentGroup?.events).toHaveLength(2);
    expect(model.nextAssignmentGroup?.events.map((e) => e.category).sort()).toEqual(["duty", "shift"]);
    const shiftInGroup = model.nextAssignmentGroup?.events.find((e) => e.category === "shift");
    expect(shiftInGroup?.period).toBe("day");
  });

  it("not_evaluable shift + duty on the same future date are both preserved as date-level entries", () => {
    const events = [
      myDuty({ date: "2026-08-20", dutyFamily: "guard", slot: 1 }),
      myShift({ date: "2026-08-20", period: "unspecified", role: null }),
    ];
    const model = build({ events });
    expect(model.nextAssignmentGroup?.date).toBe("2026-08-20");
    expect(model.nextAssignmentGroup?.events).toHaveLength(2);
    const shiftInGroup = model.nextAssignmentGroup?.events.find((e) => e.category === "shift");
    expect(shiftInGroup?.temporalState).toBe("not_evaluable");
  });
});

// ---------------------------------------------------------------------------
// shift counterpart privacy
// ---------------------------------------------------------------------------

describe("currentShiftContexts / nextShiftContexts — colleague privacy", () => {
  it("28. current shift counterpart analysis uses all server Events", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor" }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.currentShiftContexts).toHaveLength(1);
    expect(model.currentShiftContexts[0].coverageStatus).toBe("full");
  });

  it("29. primary counterpart is exposed with only the minimal safe fields", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor" }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    const [counterpart] = model.currentShiftContexts[0].primaryCounterparts;
    expect(counterpart).toEqual({
      personId: COLLEAGUE_ID,
      personName: "נועה דוגמה",
      role: "supervisor",
      certainty: "confirmed",
      shadow: false,
      period: "day",
      startTimeOverride: null,
      endTimeOverride: null,
    });
  });

  it("32. colleague email is never exposed", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor" }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(JSON.stringify(model)).not.toContain("noa@example.invalid");
    expect(model.currentShiftContexts[0].primaryCounterparts[0]).not.toHaveProperty("email");
    expect(model.currentShiftContexts[0].primaryCounterparts[0]).not.toHaveProperty("isManager");
    expect(model.currentShiftContexts[0].primaryCounterparts[0]).not.toHaveProperty("isSupervisor");
    expect(model.currentShiftContexts[0].primaryCounterparts[0]).not.toHaveProperty("personnelType");
  });

  it("30. shadow counterparts are kept separate from primary counterparts", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor", shadow: true }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.currentShiftContexts[0].primaryCounterparts).toHaveLength(0);
    expect(model.currentShiftContexts[0].shadowCounterparts).toHaveLength(1);
    expect(model.currentShiftContexts[0].shadowCounterparts[0].shadow).toBe(true);
  });

  it("31. an unrelated coworker Event (different date/period) is never exposed", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({ date: "2026-09-01", period: "night", role: "supervisor" }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.currentShiftContexts[0].primaryCounterparts).toHaveLength(0);
    expect(JSON.stringify(model)).not.toContain("2026-09-01");
  });

  it("33. current overnight shift counterpart analysis still works after midnight", () => {
    const events = [
      myShift({ date: "2026-08-11", period: "night", role: "technician" }),
      colleagueShift({ date: "2026-08-11", period: "night", role: "supervisor" }),
    ];
    const now = localNow({ date: "2026-08-12", minuteOfDay: 2 * 60 });
    const model = build({ events, people: [me(), colleague()], now });
    expect(model.currentShiftContexts).toHaveLength(1);
    expect(model.currentShiftContexts[0].date).toBe("2026-08-11");
    expect(model.currentShiftContexts[0].primaryCounterparts[0].personId).toBe(COLLEAGUE_ID);
  });

  it("nextShiftContexts reflects the earliest upcoming SHIFT, independent of an earlier next duty", () => {
    const events = [
      myDuty({ date: "2026-08-13" }), // earlier than the shift, but not a shift
      myShift({ date: "2026-08-15", period: "day", role: "technician" }),
      colleagueShift({ date: "2026-08-15", period: "day", role: "supervisor" }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.nextAssignmentGroup?.date).toBe("2026-08-13"); // the duty
    expect(model.nextShiftContexts).toHaveLength(1);
    expect(model.nextShiftContexts[0].date).toBe("2026-08-15"); // the shift
    expect(model.nextShiftContexts[0].primaryCounterparts[0].personId).toBe(COLLEAGUE_ID);
  });

  it("currentShiftContexts/nextShiftContexts are empty when there is no current/next shift", () => {
    const model = build({ events: [myDuty({ date: "2026-08-12" })] });
    expect(model.currentShiftContexts).toHaveLength(0);
    expect(model.nextShiftContexts).toHaveLength(0);
  });

  it("a future not_evaluable shift before a later resolved shift: nextShiftContexts uses the earlier not_evaluable date", () => {
    const events = [
      myShift({ date: "2026-08-15", period: "unspecified", role: null }),
      myShift({ date: "2026-08-16", period: "day", role: "technician" }),
    ];
    const model = build({ events });
    expect(model.nextAssignmentGroup?.date).toBe("2026-08-15");
    expect(model.nextShiftContexts).toHaveLength(1);
    expect(model.nextShiftContexts[0].date).toBe("2026-08-15");
    expect(model.nextShiftContexts[0].coverageStatus).toBe("not_evaluable");
  });

  it("a future not_evaluable shift with a matching unspecified opposite-role counterpart stays machine-readable and privacy-safe", () => {
    const events = [
      myShift({ date: "2026-08-15", period: "unspecified", role: "technician" }),
      colleagueShift({ date: "2026-08-15", period: "unspecified", role: "supervisor" }),
    ];
    const model = build({ events, people: [me(), colleague()] });

    expect(model.nextShiftContexts).toHaveLength(1);
    expect(model.nextShiftContexts[0].date).toBe("2026-08-15");
    expect(model.nextShiftContexts[0].coverageStatus).toBe("not_evaluable");
    expect(model.nextShiftContexts[0].primaryCounterparts).toEqual([
      {
        personId: COLLEAGUE_ID,
        personName: "נועה דוגמה",
        role: "supervisor",
        certainty: "confirmed",
        shadow: false,
        period: "unspecified",
        startTimeOverride: null,
        endTimeOverride: null,
      },
    ]);
    expect(JSON.stringify(model.nextShiftContexts)).not.toContain("noa@example.invalid");
    expect(JSON.stringify(model.nextShiftContexts)).not.toContain("isSupervisor");
  });

  it("a same-day not_evaluable shift is still never guessed to be the next shift", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "unspecified", role: null }),
      myShift({ date: "2026-08-20", period: "day", role: "technician" }),
    ];
    const model = build({ events }); // now = 2026-08-12, 10:00
    expect(model.nextShiftContexts).toHaveLength(1);
    expect(model.nextShiftContexts[0].date).toBe("2026-08-20");
  });

  it("nextShiftContexts for a future not_evaluable shift is deterministic under shuffled input", () => {
    const events = [
      myShift({ date: "2026-08-15", period: "unspecified", role: "technician" }),
      colleagueShift({ date: "2026-08-15", period: "unspecified", role: "supervisor" }),
      myShift({ date: "2026-08-16", period: "day", role: "technician" }),
    ];
    const people = [me(), colleague()];
    const forward = build({ events, people });
    const reversed = build({ events: [...events].reverse(), people });
    expect(JSON.stringify(forward.nextShiftContexts)).toBe(JSON.stringify(reversed.nextShiftContexts));
    expect(JSON.stringify(forward.nextAssignmentGroup)).toBe(JSON.stringify(reversed.nextAssignmentGroup));
  });

  it("4. primary counterpart order is deterministic regardless of the full Event array's input order", () => {
    const c2 = colleague({ id: "p_colleague2", name: "משה בדיקה", email: "moshe@example.invalid" });
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({
        date: "2026-08-12",
        period: "day",
        role: "supervisor",
        startTimeOverride: "10:00",
      }),
      colleagueShift({
        date: "2026-08-12",
        period: "day",
        role: "supervisor",
        personId: c2.id,
        personName: c2.name,
        startTimeOverride: "08:00",
      }),
    ];
    const people = [me(), colleague(), c2];

    const forward = build({ events, people });
    const reversed = build({ events: [...events].reverse(), people });

    expect(forward.currentShiftContexts[0].primaryCounterparts.map((c) => c.personId)).toEqual([
      c2.id,
      COLLEAGUE_ID,
    ]);
    expect(JSON.stringify(forward.currentShiftContexts)).toBe(JSON.stringify(reversed.currentShiftContexts));
  });

  it("a same-role colleague (two supervisors, no technician) appears in primaryCounterparts, and coverageStatus is full -- the new multi-supervisor staffing rule", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "supervisor" }),
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor" }),
    ];
    const model = build({
      events,
      people: [me({ isTechnician: false, isSupervisor: true }), colleague({ isTechnician: false, isSupervisor: true })],
    });
    expect(model.currentShiftContexts).toHaveLength(1);
    const context = model.currentShiftContexts[0];
    expect(context.primaryCounterparts.map((c) => c.personId)).toEqual([COLLEAGUE_ID]);
    expect(context.primaryCounterparts[0].role).toBe("supervisor");
    expect(context.coverageStatus).toBe("full");
    expect(context.missingIntervals).toEqual([]);
  });

  it("a split-shift colleague with two Events for the same date+period shows as ONE roster row, not two", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor", endTimeOverride: "12:00" }),
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor", startTimeOverride: "12:00" }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.currentShiftContexts[0].primaryCounterparts).toHaveLength(1);
    expect(model.currentShiftContexts[0].primaryCounterparts[0].personId).toBe(COLLEAGUE_ID);
  });

  it("4. shadow counterpart order is also deterministic regardless of input order", () => {
    const c2 = colleague({ id: "p_colleague2", name: "משה בדיקה", email: "moshe@example.invalid" });
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({
        date: "2026-08-12",
        period: "day",
        role: "supervisor",
        shadow: true,
        startTimeOverride: "10:00",
      }),
      colleagueShift({
        date: "2026-08-12",
        period: "day",
        role: "supervisor",
        shadow: true,
        personId: c2.id,
        personName: c2.name,
        startTimeOverride: "08:00",
      }),
    ];
    const people = [me(), colleague(), c2];

    const forward = build({ events, people });
    const reversed = build({ events: [...events].reverse(), people });

    expect(forward.currentShiftContexts[0].shadowCounterparts.map((c) => c.personId)).toEqual([
      c2.id,
      COLLEAGUE_ID,
    ]);
    expect(JSON.stringify(forward.currentShiftContexts)).toBe(JSON.stringify(reversed.currentShiftContexts));
  });
});

// ---------------------------------------------------------------------------
// currentAdjacentShiftContexts (מי לפניי / מי אחריי)
// ---------------------------------------------------------------------------

describe("currentAdjacentShiftContexts", () => {
  it("resolves the previous shift's staffing for a current day shift (previous = yesterday's night shift)", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }), // current
      colleagueShift({ date: "2026-08-11", period: "night", role: "supervisor" }), // previous shift's staffing
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.currentAdjacentShiftContexts).toHaveLength(1);
    const [adjacent] = model.currentAdjacentShiftContexts;
    expect(adjacent.date).toBe("2026-08-12");
    expect(adjacent.period).toBe("day");
    expect(adjacent.previous).toEqual({
      date: "2026-08-11",
      period: "night",
      people: [
        {
          personId: COLLEAGUE_ID,
          personName: "נועה דוגמה",
          role: "supervisor",
          certainty: "confirmed",
          shadow: false,
          period: "night",
          startTimeOverride: null,
          endTimeOverride: null,
        },
      ],
    });
  });

  it("resolves the next shift's staffing for a current day shift (next = today's night shift)", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }), // current
      colleagueShift({ date: "2026-08-12", period: "night", role: "supervisor" }), // next shift's staffing
    ];
    const model = build({ events, people: [me(), colleague()] });
    const [adjacent] = model.currentAdjacentShiftContexts;
    expect(adjacent.next).toEqual({
      date: "2026-08-12",
      period: "night",
      people: [
        {
          personId: COLLEAGUE_ID,
          personName: "נועה דוגמה",
          role: "supervisor",
          certainty: "confirmed",
          shadow: false,
          period: "night",
          startTimeOverride: null,
          endTimeOverride: null,
        },
      ],
    });
  });

  it("crosses the calendar-date boundary: a current night shift's next is tomorrow's day shift", () => {
    const events = [
      myShift({ date: "2026-08-11", period: "night", role: "technician" }), // current, still active after midnight
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor" }), // next shift's staffing, next date
    ];
    const now = localNow({ date: "2026-08-12", minuteOfDay: 2 * 60 }); // 02:00, still inside the overnight shift
    const model = build({ events, people: [me(), colleague()], now });
    expect(model.currentAdjacentShiftContexts).toHaveLength(1);
    const [adjacent] = model.currentAdjacentShiftContexts;
    expect(adjacent.date).toBe("2026-08-11");
    expect(adjacent.next).toEqual(
      expect.objectContaining({ date: "2026-08-12", period: "day" }),
    );
  });

  it("crosses the calendar-date boundary: a current night shift's previous is the same date's day shift", () => {
    const events = [
      myShift({ date: "2026-08-11", period: "night", role: "technician" }),
      colleagueShift({ date: "2026-08-11", period: "day", role: "supervisor" }),
    ];
    const now = localNow({ date: "2026-08-12", minuteOfDay: 2 * 60 });
    const model = build({ events, people: [me(), colleague()], now });
    const [adjacent] = model.currentAdjacentShiftContexts;
    expect(adjacent.previous).toEqual(expect.objectContaining({ date: "2026-08-11", period: "day" }));
  });

  it("omits (never fabricates) the previous/next half when nobody is staffed on that adjacent shift", () => {
    const events = [myShift({ date: "2026-08-12", period: "day", role: "technician" })];
    const model = build({ events });
    const [adjacent] = model.currentAdjacentShiftContexts;
    expect(adjacent.previous).toBeNull();
    expect(adjacent.next).toBeNull();
  });

  it("is empty when there is no current shift at all", () => {
    const model = build({ events: [myDuty({ date: "2026-08-12" })] });
    expect(model.currentAdjacentShiftContexts).toEqual([]);
  });

  it("never exposes email or forbidden identity fields on adjacent staffing", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({ date: "2026-08-11", period: "night", role: "supervisor" }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(JSON.stringify(model.currentAdjacentShiftContexts)).not.toContain("noa@example.invalid");
  });

  it("existing currentShiftContexts (מי איתי) output is unaffected by the new adjacent-context computation", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor" }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.currentShiftContexts).toHaveLength(1);
    expect(model.currentShiftContexts[0].coverageStatus).toBe("full");
    expect(model.currentShiftContexts[0].primaryCounterparts[0].personId).toBe(COLLEAGUE_ID);
  });

  it("is deterministic regardless of input Event order", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({ date: "2026-08-11", period: "night", role: "supervisor" }),
      colleagueShift({ date: "2026-08-12", period: "night", role: "supervisor" }),
    ];
    const forward = build({ events, people: [me(), colleague()] });
    const reversed = build({ events: [...events].reverse(), people: [me(), colleague()] });
    expect(JSON.stringify(forward.currentAdjacentShiftContexts)).toBe(
      JSON.stringify(reversed.currentAdjacentShiftContexts),
    );
  });
});

// ---------------------------------------------------------------------------
// operational issues
// ---------------------------------------------------------------------------

describe("issues", () => {
  it("34. issues are computed from the full server-side event set (missing coverage detected)", () => {
    const events = [myShift({ date: "2026-08-12", period: "day", role: "technician" })];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.issues.some((issue) => issue.reason === "shift_coverage_missing")).toBe(true);
  });

  it("35. only the authenticated person's own issues are exposed", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day", role: "technician" }),
      colleagueShift({ date: "2026-09-01", period: "day", role: "supervisor" }), // colleague's own missing-coverage issue
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.issues.every((issue) => issue.date !== "2026-09-01")).toBe(true);
  });

  it("36. historical (non-carried-forward) issues are omitted", () => {
    const events = [myShift({ date: "2026-08-01", period: "day", role: "technician" })];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.issues).toHaveLength(0);
  });

  it("37. a current overnight shift's issue from the previous date is retained", () => {
    const events = [myShift({ date: "2026-08-11", period: "night", role: "technician" })];
    const now = localNow({ date: "2026-08-12", minuteOfDay: 2 * 60 });
    const model = build({ events, people: [me(), colleague()], now });
    expect(model.issues.some((issue) => issue.date === "2026-08-11")).toBe(true);
  });

  it("PersonalIssue never exposes raw evidence Events or sourceSheet/sourceCell", () => {
    const events = [myShift({ date: "2026-08-12", period: "day", role: "technician" })];
    const model = build({ events, people: [me(), colleague()] });
    const [issue] = model.issues;
    expect(issue).not.toHaveProperty("events");
    expect(JSON.stringify(issue)).not.toContain("sourceCell");
    expect(issue.targetEvent).toEqual({
      date: "2026-08-12",
      category: "shift",
      title: "טכנאי יום",
      role: "technician",
      period: "day",
      dutyFamily: null,
    });
  });
});

// ---------------------------------------------------------------------------
// duty blocks / actions
// ---------------------------------------------------------------------------

describe("dutyBlocks / dutyActions", () => {
  it("38. dutyBlocks contain only the authenticated person's duties", () => {
    const events = [
      myDuty({ date: "2026-08-12", dutyFamily: "guard", slot: 1 }),
      baseEvent({
        personId: COLLEAGUE_ID,
        personName: "נועה דוגמה",
        category: "duty",
        role: null,
        dutyFamily: "guard",
        slot: 1,
        date: "2026-08-12",
      }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(model.dutyBlocks).toHaveLength(1);
    expect(JSON.stringify(model.dutyBlocks)).not.toContain("נועה");
  });

  it("39. dutyActions contain only the authenticated person's actions, 41. 13:00 semantics unchanged", () => {
    const events = [
      myDuty({ date: "2026-08-12", dutyFamily: "guard", slot: 1 }),
      myDuty({ date: "2026-08-13", dutyFamily: "guard", slot: 1 }),
      myDuty({ date: "2026-08-14", dutyFamily: "guard", slot: 1 }),
    ];
    const model = build({ events });
    expect(model.dutyActions.every((a) => a.localTime === "13:00")).toBe(true);
    // Multi-day block -> no check-in on the final day.
    expect(model.dutyActions.map((a) => a.date)).toEqual(["2026-08-12", "2026-08-13"]);
  });

  it("40. old duty actions (before localNow.date) are omitted", () => {
    const events = [
      myDuty({ date: "2026-08-05", dutyFamily: "guard", slot: 1 }),
      myDuty({ date: "2026-08-06", dutyFamily: "guard", slot: 1 }),
    ];
    const model = build({ events });
    // Both action dates (08-05 check-in) are before "today" (08-12) -> none survive.
    expect(model.dutyActions).toHaveLength(0);
    // But the block itself is still reported (blocks are not date-filtered).
    expect(model.dutyBlocks).toHaveLength(1);
  });

  it("42. weekend kitchen completeness semantics are preserved through the projection", () => {
    // Thursday 2026-08-13, Friday 2026-08-14, Saturday 2026-08-15.
    const events = [
      myDuty({ date: "2026-08-13", dutyFamily: "weekend_kitchen", slot: null, title: 'סופ"ש מטבח' }),
      myDuty({ date: "2026-08-14", dutyFamily: "weekend_kitchen", slot: null, title: 'סופ"ש מטבח' }),
      myDuty({ date: "2026-08-15", dutyFamily: "weekend_kitchen", slot: null, title: 'סופ"ש מטבח' }),
    ];
    const model = build({ events });
    expect(model.dutyBlocks[0].weekendCompleteness).toBe("complete");
  });

  it("PersonalDutyBlock/PersonalDutyAction never expose personId or raw events", () => {
    const events = [myDuty({ date: "2026-08-12", dutyFamily: "guard", slot: 1 })];
    const model = build({ events });
    expect(model.dutyBlocks[0]).not.toHaveProperty("personId");
    expect(model.dutyBlocks[0]).not.toHaveProperty("events");
    expect(model.dutyActions[0]).not.toHaveProperty("personId");
    expect(model.dutyActions[0]).not.toHaveProperty("dutyBlock");
    expect(model.dutyActions[0]).not.toHaveProperty("sourceEvents");
  });
});

describe("dutyBlocks — תקשא\"ס period (Potential) sources are a GAP-FILLER, never a second source once a real duty exists", () => {
  it("1. a person with NO internal duty at all still gets their תקשא\"ס-only duty on their own Duties page, tentative", () => {
    const potentialAllocations = [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const model = build({ events: [], potentialAllocations });
    expect(model.dutyBlocks).toEqual([
      expect.objectContaining({
        dutyFamily: "guard",
        slot: 1,
        startDate: "2026-08-20",
        endDate: "2026-08-20",
        certainty: "tentative",
      }),
    ]);
  });

  it("2. a real internal duty + an identical (exact date+family+slot) Potential duty -- one real block, no duplicate", () => {
    const events = [myDuty({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const potentialAllocations = [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const model = build({ events, potentialAllocations });
    expect(model.dutyBlocks).toHaveLength(1);
    expect(model.dutyBlocks[0].certainty).toBe("confirmed");
  });

  it("3. a real daily_kitchen duty + a Potential full_kitchen allocation on the SAME date -- personal duty blocks show ONLY the real daily_kitchen, the real observed 'מטבח יומי' + 'מטבח מלא 3' case", () => {
    const events = [myDuty({ date: "2026-08-20", dutyFamily: "daily_kitchen", slot: null, title: "מטבח יומי" })];
    const potentialAllocations = [
      allocation({ date: "2026-08-20", dutyFamily: "full_kitchen", slot: null, sourceSlot: 3, columnLabel: "מטבח מלא 3" }),
    ];
    const model = build({ events, potentialAllocations });
    expect(model.dutyBlocks).toEqual([expect.objectContaining({ dutyFamily: "daily_kitchen", certainty: "confirmed" })]);
  });

  it("5. a multi-day תקשא\"ס-only duty (no internal duty on ANY of its dates) still appears on every one of its correct dates", () => {
    const potentialAllocations = [
      allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 }),
      allocation({ date: "2026-08-21", dutyFamily: "guard", slot: 1 }),
      allocation({ date: "2026-08-22", dutyFamily: "guard", slot: 1 }),
    ];
    const model = build({ events: [], potentialAllocations });
    expect(model.dutyBlocks).toEqual([
      expect.objectContaining({ startDate: "2026-08-20", endDate: "2026-08-22", dayCount: 3, certainty: "tentative" }),
    ]);
  });

  it("6. a real internal duty on only ONE date suppresses Potential only for THAT date -- an adjacent Potential-only date still fills in as its own (unmerged) block", () => {
    const events = [myDuty({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const potentialAllocations = [
      allocation({ date: "2026-08-20", dutyFamily: "full_kitchen", slot: null, sourceSlot: 1, columnLabel: "מטבח מלא 1" }),
      allocation({ date: "2026-08-21", dutyFamily: "full_kitchen", slot: null, sourceSlot: 1, columnLabel: "מטבח מלא 1" }),
    ];
    const model = build({ events, potentialAllocations });
    expect(model.dutyBlocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dutyFamily: "guard", startDate: "2026-08-20", endDate: "2026-08-20", certainty: "confirmed" }),
        expect.objectContaining({ dutyFamily: "full_kitchen", startDate: "2026-08-21", endDate: "2026-08-21", certainty: "tentative" }),
      ]),
    );
    expect(model.dutyBlocks).toHaveLength(2);
    // The 20th never gets a full_kitchen block -- suppressed by the real guard duty that date.
    expect(model.dutyBlocks.some((block) => block.dutyFamily === "full_kitchen" && block.startDate === "2026-08-20")).toBe(false);
  });

  it("the same gap-filling works for history -- a past-dated allocation still produces a real block with a past endDate", () => {
    const potentialAllocations = [allocation({ date: "2026-08-01", dutyFamily: "guard", slot: 1 })];
    const model = build({ events: [], potentialAllocations }); // localNow defaults to 2026-08-12
    expect(model.dutyBlocks).toEqual([
      expect.objectContaining({ startDate: "2026-08-01", endDate: "2026-08-01" }),
    ]);
  });

  it("short-name attribution works only through the existing safe resolver -- resolves a bare first name uniquely", () => {
    const potentialAllocations = [allocation({ sourceAllocationLabel: "דני" })];
    const model = build({ events: [], potentialAllocations, people: [me(), colleague()] });
    expect(model.dutyBlocks).toHaveLength(1);
  });

  it("ambiguous short-name ownership is never guessed -- two personnel sharing a leading token produce no duty for either", () => {
    const sharedFirstNamePerson = colleague({ id: "p_other", name: "דני אחר" });
    const potentialAllocations = [allocation({ sourceAllocationLabel: "דני" })];
    const model = build({
      events: [],
      potentialAllocations,
      people: [me(), sharedFirstNamePerson],
    });
    expect(model.dutyBlocks).toHaveLength(0);
  });

  it("adding a תקשא\"ס-only duty never classifies the person as a shift worker -- Person capability flags are untouched", () => {
    const nonShiftPerson = me({ isTechnician: false, isSupervisor: false });
    const potentialAllocations = [
      allocation({ sourceAllocationLabel: nonShiftPerson.name, date: "2026-08-20" }),
    ];
    const model = build({ person: nonShiftPerson, events: [], potentialAllocations });
    expect(model.dutyBlocks).toHaveLength(1);
    expect(model.person.isTechnician).toBe(false);
    expect(model.person.isSupervisor).toBe(false);
  });

  it("guard/reserve: an adjacent-date Potential entry for the SAME slot, in the SAME calendar week as a real duty, is suppressed rather than merged -- the slot is one continuous requirement per week, so a same-week Potential entry is redundant/stale evidence, never a genuine gap to fill in", () => {
    // 2026-08-20 (Thu) and 2026-08-21 (Fri) are the SAME Sun-Sat week
    // (16-22 Aug). Before the source-precedence fix, this merged into one
    // 2-day "mixed" block (Potential filling in the very next day); the
    // confirmed business rule is now that guard/reserve's numbered slot
    // represents ONE requirement across its whole week -- a real duty
    // ANYWHERE in that week already covers it, so the adjacent Potential
    // entry is treated as redundant, not a genuine continuation. See
    // `lib/domain/potentialDutyEvents.ts`'s `isAlreadyCoveredByInternalDuty`
    // (the SAME production-swap fix that keeps a stale/superseded Potential
    // entry from surfacing when a real internal duty for that slot was
    // simply moved to a different date within the same week).
    const events = [myDuty({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const potentialAllocations = [allocation({ date: "2026-08-21", dutyFamily: "guard", slot: 1 })];
    const model = build({ events, potentialAllocations });
    expect(model.dutyBlocks).toHaveLength(1);
    expect(model.dutyBlocks[0]).toMatchObject({
      startDate: "2026-08-20",
      endDate: "2026-08-20",
      dayCount: 1,
      certainty: "confirmed",
    });
  });

  it("non-slotted families (no real internal slot at all, e.g. full_kitchen) still merge an adjacent-date Potential gap-filler exactly as before -- the week-based rule is scoped to guard/reserve only", () => {
    const events = [myDuty({ date: "2026-08-20", dutyFamily: "full_kitchen", slot: null })];
    const potentialAllocations = [
      allocation({ date: "2026-08-21", dutyFamily: "full_kitchen", slot: null, sourceSlot: 1, columnLabel: "מטבח מלא 1" }),
    ];
    const model = build({ events, potentialAllocations });
    expect(model.dutyBlocks).toHaveLength(1);
    expect(model.dutyBlocks[0]).toMatchObject({
      startDate: "2026-08-20",
      endDate: "2026-08-21",
      dayCount: 2,
      certainty: "mixed",
    });
  });

  it("omitting potentialAllocations entirely keeps existing callers/tests working unchanged", () => {
    const events = [myDuty({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const model = buildPersonalScheduleReadModel({
      person: me(),
      people: [me()],
      events,
      shiftSchedule: schedule,
      fetchedAt: "2026-08-12T08:00:00.000Z",
      now: localNow(),
    });
    expect(model.dutyBlocks).toHaveLength(1);
  });
});

describe("calendarEvents / currentAssignments / nextAssignmentGroup — תקשא\"ס period (Potential) sources are a GAP-FILLER, never a second source once a real duty exists", () => {
  it("a non-shift person with only a תקשא\"ס duty and NO internal duty sees it on their calendar", () => {
    const nonShiftPerson = me({ isTechnician: false, isSupervisor: false });
    const potentialAllocations = [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const model = build({ person: nonShiftPerson, events: [], potentialAllocations });
    expect(model.calendarEvents).toEqual([
      expect.objectContaining({ date: "2026-08-20", category: "duty", dutyFamily: "guard", slot: 1 }),
    ]);
  });

  it("a multi-day תקשא\"ס duty (no internal duty on any date) appears on every one of its correct dates on the calendar", () => {
    const potentialAllocations = [
      allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 }),
      allocation({ date: "2026-08-21", dutyFamily: "guard", slot: 1 }),
      allocation({ date: "2026-08-22", dutyFamily: "guard", slot: 1 }),
    ];
    const model = build({ events: [], potentialAllocations });
    const dutyDates = model.calendarEvents.filter((e) => e.category === "duty").map((e) => e.date);
    expect(dutyDates).toEqual(["2026-08-20", "2026-08-21", "2026-08-22"]);
  });

  it("shows up in currentAssignments/nextAssignmentGroup exactly like a real duty would, when there is no real duty that date", () => {
    const potentialAllocations = [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const model = build({ events: [], potentialAllocations }); // localNow defaults to 2026-08-12
    expect(model.nextAssignmentGroup?.events).toEqual([
      expect.objectContaining({ date: "2026-08-20", category: "duty", dutyFamily: "guard" }),
    ]);
  });

  it("3 & 4. a real daily_kitchen duty + a mismatched Potential full_kitchen allocation on the SAME date -- personal calendar shows ONLY מטבח יומי, the real observed case", () => {
    const events = [myDuty({ date: "2026-08-20", dutyFamily: "daily_kitchen", slot: null, title: "מטבח יומי" })];
    const potentialAllocations = [
      allocation({ date: "2026-08-20", dutyFamily: "full_kitchen", slot: null, sourceSlot: 3, columnLabel: "מטבח מלא 3" }),
    ];
    const model = build({ events, potentialAllocations });
    const duties = model.calendarEvents.filter((e) => e.category === "duty");
    expect(duties).toHaveLength(1);
    expect(duties[0].dutyFamily).toBe("daily_kitchen");
    expect(duties[0].title).toBe("מטבח יומי");
    expect(model.calendarEvents.some((e) => e.dutyFamily === "full_kitchen")).toBe(false);
  });

  it("a normal department person's calendar/assignments are unaffected -- no duplicate from an overlapping allocation", () => {
    const events = [myDuty({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const potentialAllocations = [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const model = build({ events, potentialAllocations });
    expect(model.calendarEvents.filter((e) => e.category === "duty")).toHaveLength(1);
    expect(model.nextAssignmentGroup?.events).toHaveLength(1);
  });

  it("6. a real internal duty on only ONE date never suppresses an adjacent Potential-only date's own calendar entry", () => {
    const events = [myDuty({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const potentialAllocations = [
      allocation({ date: "2026-08-20", dutyFamily: "full_kitchen", slot: null, sourceSlot: 1, columnLabel: "מטבח מלא 1" }),
      allocation({ date: "2026-08-21", dutyFamily: "full_kitchen", slot: null, sourceSlot: 1, columnLabel: "מטבח מלא 1" }),
    ];
    const model = build({ events, potentialAllocations });
    const duties = model.calendarEvents.filter((e) => e.category === "duty");
    expect(duties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-08-20", dutyFamily: "guard" }),
        expect.objectContaining({ date: "2026-08-21", dutyFamily: "full_kitchen" }),
      ]),
    );
    expect(duties).toHaveLength(2);
  });

  it("ambiguous short-name ownership is excluded from the calendar too, not just dutyBlocks", () => {
    const sharedFirstNamePerson = colleague({ id: "p_other", name: "דני אחר" });
    const potentialAllocations = [allocation({ date: "2026-08-20", sourceAllocationLabel: "דני" })];
    const model = build({ events: [], potentialAllocations, people: [me(), sharedFirstNamePerson] });
    expect(model.calendarEvents.some((e) => e.category === "duty")).toBe(false);
    expect(model.currentAssignments).toHaveLength(0);
    expect(model.nextAssignmentGroup).toBeNull();
  });

  it("never affects shift-only sections -- currentShiftContexts/nextShiftContexts stay empty when only a duty was added", () => {
    const potentialAllocations = [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const model = build({ events: [], potentialAllocations });
    expect(model.currentShiftContexts).toEqual([]);
    expect(model.nextShiftContexts).toEqual([]);
  });

  it("7. a PR #76 personal activity (status/other) is unaffected by this precedence rule -- still reaches the personal calendar alongside a gap-filled Potential duty", () => {
    const potentialAllocations = [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })];
    const model = build({
      events: [baseEvent({ date: "2026-08-20", category: "status", title: "סוגר", rawValue: "סוגר" })],
      potentialAllocations,
    });
    expect(model.calendarEvents.some((e) => e.category === "status" && e.title === "סוגר")).toBe(true);
    expect(model.calendarEvents.some((e) => e.category === "duty" && e.dutyFamily === "guard")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// determinism / no mutation
// ---------------------------------------------------------------------------

describe("determinism and input safety", () => {
  it("43. output is identical regardless of input Event order", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day" }),
      myDuty({ date: "2026-08-13" }),
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor" }),
      myShift({ date: "2026-08-20", period: "night" }),
    ];
    const forward = build({ events, people: [me(), colleague()] });
    const shuffled = build({ events: [...events].reverse(), people: [me(), colleague()] });
    expect(JSON.stringify(forward)).toBe(JSON.stringify(shuffled));
  });

  it("44. input Events/People are never mutated", () => {
    const events = Object.freeze([Object.freeze(myShift({ date: "2026-08-12", period: "day" }))]);
    const people = Object.freeze([Object.freeze(me()), Object.freeze(colleague())]);
    expect(() =>
      buildPersonalScheduleReadModel({
        person: me(),
        people,
        events,
        shiftSchedule: schedule,
        fetchedAt: "2026-08-12T08:00:00.000Z",
        now: localNow(),
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// no full data leak
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYS = new Set([
  "sourceSheet",
  "sourceCell",
  "email",
  "spreadsheetId",
  "serviceAccountEmail",
  "privateKey",
  "people",
  "values",
  "sheets",
]);

function assertNoForbiddenKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error(`Forbidden key "${key}" found at ${path}.${key}`);
      }
      assertNoForbiddenKeys(val, `${path}.${key}`);
    }
  }
}

describe("no full data leak", () => {
  it("recursively contains none of the forbidden workbook/identity keys", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day" }),
      myDuty({ date: "2026-08-13" }),
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor" }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    expect(() => assertNoForbiddenKeys(model)).not.toThrow();
  });

  it("never contains either person's raw email value", () => {
    const events = [
      myShift({ date: "2026-08-12", period: "day" }),
      colleagueShift({ date: "2026-08-12", period: "day", role: "supervisor" }),
    ];
    const model = build({ events, people: [me(), colleague()] });
    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain("dani@example.invalid");
    expect(serialized).not.toContain("noa@example.invalid");
  });
});
