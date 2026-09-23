import { describe, expect, it } from "vitest";
import type { Event } from "@/lib/domain/event";
import type { LocalNow } from "@/lib/domain/localNow";
import type { OperationalWeek } from "@/lib/domain/operationalWeek";
import type { PotentialAllocation } from "@/lib/domain/potentialAllocation";
import { buildShiftSchedule } from "@/lib/domain/shiftSchedule";
import type { Person } from "@/lib/domain/types";
import { buildManagerScheduleReadModel, buildSelfOnlyScheduleReadModel } from "./buildScheduleReadModel";
import { buildPersonalScheduleReadModel } from "./buildPersonalScheduleReadModel";
import type { PersonalScheduleReadModel } from "./types";

// day 07:30-19:30, night 19:30-07:30(+1)
const schedule = buildShiftSchedule("07:30");
const now: LocalNow = { date: "2026-08-13", minuteOfDay: 600 };

let cellCounter = 0;
function nextCell(): string {
  cellCounter += 1;
  return `C${cellCounter}`;
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "p_x",
    name: "שם",
    email: null,
    isManager: false,
    isTechnician: false,
    isSupervisor: false,
    personnelType: null,
    dischargeDate: null,
    enlistmentDate: null,
    ...overrides,
  };
}

const MANAGER = person({ id: "p_manager", name: "מרטין גוסין", isManager: true });
const DANIEL = person({ id: "p_daniel", name: "דניאל כהן", isTechnician: true });
const EITAN = person({ id: "p_eitan", name: "איתן דוגמה", isSupervisor: true });
const NOA = person({ id: "p_noa", name: "נועה דוגמה", isTechnician: true });

function event(overrides: Partial<Event> = {}): Event {
  return {
    personId: DANIEL.id,
    personName: DANIEL.name,
    date: "2026-08-13",
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

const AUGUST_DATES = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`);

// The operational week containing `now` (2026-08-13, a Thursday) -- a
// fixed fixture reused by every `buildManagerScheduleReadModel` call
// below, since this file's suites are about perspective resolution, not
// about the team-week matrix itself (see `buildScheduleTeamWeekView.test.ts`
// for that).
const WEEK: OperationalWeek = {
  weekStart: "2026-08-09",
  weekEnd: "2026-08-15",
  dates: ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"],
};

const PEOPLE: Person[] = [MANAGER, DANIEL, EITAN, NOA];

function allocation(overrides: Partial<PotentialAllocation> = {}): PotentialAllocation {
  return {
    date: "2026-08-20",
    dutyFamily: "guard",
    slot: 1,
    sourceSlot: 1,
    columnLabel: "שומר 1",
    sourceAllocationLabel: DANIEL.name,
    resolvedSourcePersonId: null,
    sourceSheet: 'פוטנציאל תקש"אס 7-12/2026',
    sourceCell: nextCell(),
    ...overrides,
  };
}

describe("buildManagerScheduleReadModel — perspective resolution (PR #24 §9)", () => {
  it("no requested person -> self", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: null,
    });
    expect(model.perspective).toBe("self");
    expect(model.selectedPersonId).toBeNull();
    expect(model.personal?.person.name).toBe(MANAGER.name);
    expect(model.everyone).toBeNull();
  });

  it('"all" sentinel -> everyone', () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
    });
    expect(model.perspective).toBe("all");
    expect(model.personal).toBeNull();
    expect(model.everyone).not.toBeNull();
  });

  it("a valid roster person id -> person perspective", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: DANIEL.id,
    });
    expect(model.perspective).toBe("person");
    expect(model.selectedPersonId).toBe(DANIEL.id);
    expect(model.selectedPersonName).toBe(DANIEL.name);
    expect(model.personal?.person.name).toBe(DANIEL.name);
  });

  it("an unknown/stale/malformed id falls back to self -- never to everyone", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "p_does_not_exist",
    });
    expect(model.perspective).toBe("self");
    expect(model.everyone).toBeNull();
  });

  it("selecting the manager's own id normalizes to self (no self-referencing person mode)", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: MANAGER.id,
    });
    expect(model.perspective).toBe("self");
    expect(model.selectedPersonId).toBeNull();
  });
});

describe("buildManagerScheduleReadModel — roster (PR #24 §6)", () => {
  it("excludes the manager's own entry from the roster", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: null,
    });
    expect(model.roster.map((p) => p.id)).not.toContain(MANAGER.id);
    expect(model.roster).toHaveLength(3);
  });

  it("roster options never carry email or isManager -- only id/name plus the grouping fields the shared PersonPicker needs", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: null,
    });
    for (const option of model.roster) {
      expect(Object.keys(option).sort()).toEqual(["id", "isSupervisor", "isTechnician", "name", "personnelType"]);
    }
  });

  it("orders the roster by name, then id as a stable tiebreak for duplicate names", () => {
    const dup1 = person({ id: "p_b", name: "דניאל כהן" });
    const dup2 = person({ id: "p_a", name: "דניאל כהן" });
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: [MANAGER, dup1, dup2],
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: null,
    });
    expect(model.roster.map((p) => p.id)).toEqual(["p_a", "p_b"]);
  });
});

describe("buildManagerScheduleReadModel — self mode reuses buildPersonalScheduleReadModel outright (PR #24 §11)", () => {
  it("self's `personal` is exactly what buildPersonalScheduleReadModel produces for the manager", () => {
    const events = [event({ personId: MANAGER.id, personName: MANAGER.name })];
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events,
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: null,
    });
    const expected: PersonalScheduleReadModel = buildPersonalScheduleReadModel({
      person: MANAGER,
      people: PEOPLE,
      events,
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
    });
    expect(model.personal).toEqual(expected);
  });
});

describe("buildManagerScheduleReadModel — person mode (PR #24 §10-12)", () => {
  it("selected person's calendarEvents are their own real events", () => {
    const events = [
      event({ personId: DANIEL.id, personName: DANIEL.name, date: "2026-08-13" }),
      event({ personId: EITAN.id, personName: EITAN.name, date: "2026-08-13", role: "supervisor" }),
    ];
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events,
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: DANIEL.id,
    });
    expect(model.personal?.calendarEvents).toHaveLength(1);
    expect(model.personal?.calendarEvents[0].title).toBe("טכנאי יום");
  });

  it("a person with zero shift events this month still gets a personal model (page renders the empty-month note, not this builder)", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: DANIEL.id,
    });
    expect(model.personal?.calendarEvents).toEqual([]);
  });
});

describe("buildManagerScheduleReadModel — everyone mode (PR #24 §14-19)", () => {
  it("day technicians/supervisors and night technicians/supervisors render as separate, correct groups", () => {
    const events = [
      event({ personId: DANIEL.id, personName: DANIEL.name, date: "2026-08-13", period: "day", role: "technician" }),
      event({ personId: EITAN.id, personName: EITAN.name, date: "2026-08-13", period: "day", role: "supervisor" }),
      event({ personId: NOA.id, personName: NOA.name, date: "2026-08-13", period: "night", role: "technician" }),
      event({ personId: MANAGER.id, personName: MANAGER.name, date: "2026-08-13", period: "night", role: "supervisor" }),
    ];
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events,
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
    });

    const dayGroup = model.everyone?.staffing.find((g) => g.date === "2026-08-13" && g.period === "day");
    const nightGroup = model.everyone?.staffing.find((g) => g.date === "2026-08-13" && g.period === "night");
    expect(dayGroup?.technicians.map((p) => p.personName)).toEqual([DANIEL.name]);
    expect(dayGroup?.supervisors.map((p) => p.personName)).toEqual([EITAN.name]);
    expect(nightGroup?.technicians.map((p) => p.personName)).toEqual([NOA.name]);
    expect(nightGroup?.supervisors.map((p) => p.personName)).toEqual([MANAGER.name]);
  });

  it("preserves multiple assignees for the same role instead of collapsing them", () => {
    const events = [
      event({ personId: DANIEL.id, personName: DANIEL.name, date: "2026-08-13", period: "day", role: "technician" }),
      event({ personId: NOA.id, personName: NOA.name, date: "2026-08-13", period: "day", role: "technician" }),
    ];
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events,
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
    });
    const dayGroup = model.everyone?.staffing.find((g) => g.date === "2026-08-13" && g.period === "day");
    expect(dayGroup?.technicians.map((p) => p.personName).sort()).toEqual([DANIEL.name, NOA.name].sort());
  });

  it("keeps shadow technicians/supervisors distinct from primary staffing", () => {
    const events = [
      event({ personId: DANIEL.id, personName: DANIEL.name, date: "2026-08-13", period: "day", role: "technician" }),
      event({
        personId: NOA.id,
        personName: NOA.name,
        date: "2026-08-13",
        period: "day",
        role: "technician",
        shadow: true,
      }),
    ];
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events,
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
    });
    const dayGroup = model.everyone?.staffing.find((g) => g.date === "2026-08-13" && g.period === "day");
    expect(dayGroup?.technicians.map((p) => p.personName)).toEqual([DANIEL.name]);
    expect(dayGroup?.shadowTechnicians.map((p) => p.personName)).toEqual([NOA.name]);
  });

  it("a role with zero non-shadow events uses roleCoverage 'missing', not a guessed empty list", () => {
    const events = [
      event({ personId: DANIEL.id, personName: DANIEL.name, date: "2026-08-13", period: "day", role: "technician" }),
      // No supervisor at all this day/period.
    ];
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events,
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
    });
    const dayGroup = model.everyone?.staffing.find((g) => g.date === "2026-08-13" && g.period === "day");
    expect(dayGroup?.roleCoverage.supervisor.status).toBe("missing");
    expect(dayGroup?.coverageStatus).toBe("missing");
  });

  it("groups duties by date+person and scopes them to the given monthDates", () => {
    const events = [
      event({
        personId: DANIEL.id,
        personName: DANIEL.name,
        date: "2026-08-13",
        category: "duty",
        dutyFamily: "guard",
        slot: 1,
        role: null,
        period: "unspecified",
      }),
      event({
        personId: NOA.id,
        personName: NOA.name,
        date: "2026-09-01", // outside monthDates
        category: "duty",
        dutyFamily: "guard",
        slot: 2,
        role: null,
        period: "unspecified",
      }),
    ];
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events,
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
    });
    expect(model.everyone?.duties).toHaveLength(1);
    expect(model.everyone?.duties[0].personName).toBe(DANIEL.name);
  });

  it("groups absences by date+person and scopes them to the given monthDates", () => {
    const events = [
      event({
        personId: EITAN.id,
        personName: EITAN.name,
        date: "2026-08-13",
        category: "absence",
        absenceKind: "vacation",
        role: null,
        period: "unspecified",
      }),
    ];
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events,
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
    });
    expect(model.everyone?.absences).toHaveLength(1);
    expect(model.everyone?.absences[0].personName).toBe(EITAN.name);
    expect(model.everyone?.absences[0].absenceKind).toBe("vacation");
  });
});

describe("buildSelfOnlyScheduleReadModel (normal user / fail-closed fallback)", () => {
  it("wraps a PersonalScheduleReadModel with no manager scope at all", () => {
    const personal = buildPersonalScheduleReadModel({
      person: DANIEL,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
    });
    const model = buildSelfOnlyScheduleReadModel(personal);
    expect(model.manager).toBeNull();
    expect(model.roster).toEqual([]);
    expect(model.perspective).toBe("self");
    expect(model.personal).toBe(personal);
    expect(model.everyone).toBeNull();
  });
});

describe("buildManagerScheduleReadModel — 'self'/'person' perspectives: תקשא\"ס (Potential) duty completeness is a gap-filler, never a second source once a real duty exists", () => {
  it("'person' perspective: a colleague's תקשא\"ס-only allocation (no matching internal Event) shows on their calendar", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: DANIEL.id,
      potentialAllocations: [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })],
    });
    expect(model.perspective).toBe("person");
    const dutyEvents = model.personal?.calendarEvents.filter((e) => e.category === "duty") ?? [];
    expect(dutyEvents).toEqual([expect.objectContaining({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })]);
  });

  it("'self' perspective: the manager's OWN תקשא\"ס-only allocation shows on their calendar too", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: null,
      potentialAllocations: [allocation({ sourceAllocationLabel: MANAGER.name })],
    });
    expect(model.perspective).toBe("self");
    const dutyEvents = model.personal?.calendarEvents.filter((e) => e.category === "duty") ?? [];
    expect(dutyEvents).toHaveLength(1);
  });

  it("a normal department person's real duty is unaffected by an overlapping allocation -- no duplicate, no change", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [event({ category: "duty", role: null, period: "unspecified", dutyFamily: "guard", slot: 1, date: "2026-08-20" })],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: DANIEL.id,
      potentialAllocations: [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })],
    });
    const dutyEvents = model.personal?.calendarEvents.filter((e) => e.category === "duty") ?? [];
    expect(dutyEvents).toHaveLength(1);
  });

  it("a duty family mismatch on the same date (real daily_kitchen vs. Potential full_kitchen) never adds a second pseudo-duty to the personal calendar", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [
        event({ category: "duty", role: null, period: "unspecified", dutyFamily: "daily_kitchen", slot: null, title: "מטבח יומי", date: "2026-08-20" }),
      ],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: DANIEL.id,
      potentialAllocations: [
        allocation({ date: "2026-08-20", dutyFamily: "full_kitchen", slot: null, sourceSlot: 3, columnLabel: "מטבח מלא 3" }),
      ],
    });
    const dutyEvents = model.personal?.calendarEvents.filter((e) => e.category === "duty") ?? [];
    expect(dutyEvents).toEqual([expect.objectContaining({ dutyFamily: "daily_kitchen", title: "מטבח יומי" })]);
  });

  it("adding a תקשא\"ס duty never makes a non-shift-capable person a shift worker", () => {
    const nonShiftPerson = person({ id: "p_nonshift", name: "אלון דוגמה", isTechnician: false, isSupervisor: false });
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: [MANAGER, nonShiftPerson],
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: nonShiftPerson.id,
      potentialAllocations: [allocation({ sourceAllocationLabel: nonShiftPerson.name })],
    });
    expect(model.personal?.person.isTechnician).toBe(false);
    expect(model.personal?.person.isSupervisor).toBe(false);
    expect(model.personal?.calendarEvents.some((e) => e.category === "duty")).toBe(true);
  });

  it("the 'all' (everyone) calendar shows an attributed תקשא\"ס-only duty as a normal duty entry", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
      potentialAllocations: [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })],
    });
    expect(model.perspective).toBe("all");
    expect(model.everyone?.duties).toEqual([
      expect.objectContaining({ personId: DANIEL.id, date: "2026-08-20", dutyFamily: "guard", slot: 1 }),
    ]);
  });

  it("the 'all' perspective NEVER mixes a תקשא\"ס duty into staffing/coverage -- everyone.staffing is untouched", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
      potentialAllocations: [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })],
    });
    expect(model.everyone?.staffing).toEqual([]);
  });

  it("a normal department person's duty in the 'all' calendar is unaffected -- no duplicate from an overlapping allocation", () => {
    const events: Event[] = [
      event({ personId: DANIEL.id, personName: DANIEL.name, category: "duty", role: null, period: "unspecified", dutyFamily: "guard", slot: 1, date: "2026-08-20" }),
    ];
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events,
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
      potentialAllocations: [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })],
    });
    expect(model.everyone?.duties).toHaveLength(1);
  });

  it("ambiguous source ownership is excluded from the 'all' calendar too", () => {
    const danielTwin = person({ id: "p_daniel_twin", name: "דניאל אחר" });
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: [MANAGER, DANIEL, danielTwin, EITAN, NOA],
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
      potentialAllocations: [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1, sourceAllocationLabel: "דניאל" })],
    });
    expect(model.everyone?.duties).toEqual([]);
  });

  it("source-precedence swap regression ('person' perspective): a stale same-week Potential guard entry is suppressed once a real internal duty for the same slot exists elsewhere in that week", () => {
    // 2026-08-20 (Thu) and 2026-08-22 (Sat) are in the SAME Sun-Sat week
    // (16-22 Aug) -- a real internal swap moved the guard slot 1 duty from
    // Thursday to Saturday within that same week.
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [event({ category: "duty", role: null, period: "unspecified", dutyFamily: "guard", slot: 1, date: "2026-08-22" })],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: DANIEL.id,
      potentialAllocations: [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })],
    });
    const dutyEvents = model.personal?.calendarEvents.filter((e) => e.category === "duty") ?? [];
    expect(dutyEvents).toEqual([expect.objectContaining({ date: "2026-08-22", dutyFamily: "guard", slot: 1 })]);
  });

  it("source-precedence swap regression ('all' perspective): the roster-wide duties list never shows the stale same-week Potential entry either", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [
        event({
          personId: DANIEL.id,
          personName: DANIEL.name,
          category: "duty",
          role: null,
          period: "unspecified",
          dutyFamily: "guard",
          slot: 1,
          date: "2026-08-22",
        }),
      ],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
      potentialAllocations: [allocation({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })],
    });
    expect(model.everyone?.duties).toEqual([
      expect.objectContaining({ personId: DANIEL.id, date: "2026-08-22", dutyFamily: "guard", slot: 1 }),
    ]);
  });

  it("omitting potentialAllocations entirely keeps the 'all' perspective working unchanged", () => {
    const model = buildManagerScheduleReadModel({
      manager: MANAGER,
      people: PEOPLE,
      events: [],
      shiftSchedule: schedule,
      fetchedAt: "2026-08-13T08:00:00.000Z",
      now,
      monthDates: AUGUST_DATES,
      week: WEEK,
      requestedPersonId: "all",
    });
    expect(model.perspective).toBe("all");
    expect(model.everyone?.duties).toEqual([]);
  });
});
