import { describe, expect, it } from "vitest";
import type { Event } from "@/lib/domain/event";
import type { Person } from "@/lib/domain/types";
import { buildShiftSchedule } from "@/lib/domain/shiftSchedule";
import {
  buildSupervisorAssignedInformedBody,
  buildSupervisorAssignedTodayBody,
  buildTeamHelpAssignedBody,
  findLogisticsWithdrawalAssignees,
  isLogisticsWithdrawalFallbackDate,
  joinNamesWithVav,
  resolveEligibleLogisticsTechnicians,
  resolveRelevantSupervisors,
} from "./logisticsCoordination";

// day 07:30-19:30, night 19:30-07:30(+1) -- 13:00-14:00 falls inside the day shift.
const schedule = buildShiftSchedule("07:30");
const DATE = "2026-08-19";

function event(overrides: Partial<Event> & Pick<Event, "personId" | "category">): Event {
  return {
    personName: overrides.personId,
    date: DATE,
    title: "",
    rawValue: "",
    certainty: "confirmed",
    role: null,
    period: "unspecified",
    sourceSheet: "sheet",
    sourceCell: "A1",
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

function dayShift(personId: string, role: "supervisor" | "technician", overrides: Partial<Event> = {}): Event {
  return event({ personId, category: "shift", role, period: "day", ...overrides });
}

function person(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    name: id,
    email: `${id}@example.invalid`,
    isManager: false,
    isTechnician: false,
    isSupervisor: false,
    personnelType: null,
    dischargeDate: null,
    enlistmentDate: null,
    ...overrides,
  };
}

describe("findLogisticsWithdrawalAssignees", () => {
  it("finds the existing 'משיכות' detection unchanged", () => {
    const events = [event({ personId: "p1", category: "other", title: "משיכות מהלוגיסטיקה" })];
    expect(findLogisticsWithdrawalAssignees(events, DATE)).toEqual([{ personId: "p1", personName: "p1" }]);
  });

  it("dedupes multiple Events for the same person into one entry", () => {
    const events = [
      event({ personId: "p1", category: "other", title: "משיכות", sourceCell: "A1" }),
      event({ personId: "p1", category: "other", title: "משיכות מהלוגיסטיקה", sourceCell: "A2" }),
    ];
    expect(findLogisticsWithdrawalAssignees(events, DATE)).toHaveLength(1);
  });

  it("multiple distinct assignees are all returned, deterministically ordered", () => {
    const events = [
      event({ personId: "p_b", category: "other", title: "משיכות" }),
      event({ personId: "p_a", category: "other", title: "משיכות" }),
    ];
    expect(findLogisticsWithdrawalAssignees(events, DATE)).toEqual([
      { personId: "p_a", personName: "p_a" },
      { personId: "p_b", personName: "p_b" },
    ]);
  });

  it("ignores a different date", () => {
    const events = [event({ personId: "p1", category: "other", title: "משיכות", date: "2026-08-20" })];
    expect(findLogisticsWithdrawalAssignees(events, DATE)).toEqual([]);
  });

  it("returns empty when nobody is assigned", () => {
    expect(findLogisticsWithdrawalAssignees([], DATE)).toEqual([]);
  });
});

describe("resolveRelevantSupervisors", () => {
  it("a supervisor shift whose resolved interval overlaps 13:00-14:00 is relevant", () => {
    const events = [dayShift("p_sup", "supervisor")]; // 07:30-19:30, overlaps
    expect(resolveRelevantSupervisors(events, DATE, schedule)).toEqual([{ personId: "p_sup", personName: "p_sup" }]);
  });

  it("never guesses from Person.isSupervisor alone -- only Event-derived overlap counts (no Person input here at all)", () => {
    const events = [dayShift("p_sup", "supervisor", { endTimeOverride: "10:00" })]; // 07:30-10:00, no overlap
    expect(resolveRelevantSupervisors(events, DATE, schedule)).toEqual([]);
  });

  it("a shadow supervisor shift never establishes coverage", () => {
    const events = [dayShift("p_sup", "supervisor", { shadow: true })];
    expect(resolveRelevantSupervisors(events, DATE, schedule)).toEqual([]);
  });

  it("a shift not overlapping 13:00-14:00 does not establish eligibility", () => {
    const events = [dayShift("p_sup", "supervisor", { startTimeOverride: "07:30", endTimeOverride: "12:00" })];
    expect(resolveRelevantSupervisors(events, DATE, schedule)).toEqual([]);
  });

  it("resolved time overrides are respected -- an override that excludes the window means no coverage", () => {
    const events = [dayShift("p_sup", "supervisor", { startTimeOverride: "14:30" })]; // starts after the window ends
    expect(resolveRelevantSupervisors(events, DATE, schedule)).toEqual([]);
  });

  it("resolved time overrides are respected -- an override that INCLUDES the window still establishes coverage", () => {
    const events = [dayShift("p_sup", "supervisor", { startTimeOverride: "12:30" })]; // 12:30-19:30, overlaps
    expect(resolveRelevantSupervisors(events, DATE, schedule)).toEqual([{ personId: "p_sup", personName: "p_sup" }]);
  });

  it("multiple genuinely-overlapping supervisor shifts are ALL returned", () => {
    const events = [dayShift("p_a", "supervisor"), dayShift("p_b", "supervisor")];
    expect(resolveRelevantSupervisors(events, DATE, schedule)).toEqual([
      { personId: "p_a", personName: "p_a" },
      { personId: "p_b", personName: "p_b" },
    ]);
  });

  it("no supervisor Event at all fails conservatively -- empty, never a guess", () => {
    expect(resolveRelevantSupervisors([], DATE, schedule)).toEqual([]);
  });

  it("a technician shift is never mistaken for supervisor coverage", () => {
    const events = [dayShift("p_tech", "technician")];
    expect(resolveRelevantSupervisors(events, DATE, schedule)).toEqual([]);
  });
});

describe("resolveEligibleLogisticsTechnicians", () => {
  it("a technician present for the window is eligible", () => {
    const events = [dayShift("p1", "technician")];
    const people = [person("p1", { isTechnician: true })];
    expect(resolveEligibleLogisticsTechnicians(events, people, DATE, schedule)).toEqual(people);
  });

  it("requires isTechnician === true on the Person, even if present", () => {
    const events = [dayShift("p1", "supervisor")]; // present, but not flagged as technician
    const people = [person("p1", { isTechnician: false, isSupervisor: true })];
    expect(resolveEligibleLogisticsTechnicians(events, people, DATE, schedule)).toEqual([]);
  });

  it("requires structural presence -- isTechnician alone, with no overlapping shift, is not enough", () => {
    const people = [person("p1", { isTechnician: true })];
    expect(resolveEligibleLogisticsTechnicians([], people, DATE, schedule)).toEqual([]);
  });

  it("a shadow shift does not establish presence", () => {
    const events = [dayShift("p1", "technician", { shadow: true })];
    const people = [person("p1", { isTechnician: true })];
    expect(resolveEligibleLogisticsTechnicians(events, people, DATE, schedule)).toEqual([]);
  });

  it("a shift not overlapping the window does not establish eligibility", () => {
    const events = [dayShift("p1", "technician", { startTimeOverride: "07:30", endTimeOverride: "12:00" })];
    const people = [person("p1", { isTechnician: true })];
    expect(resolveEligibleLogisticsTechnicians(events, people, DATE, schedule)).toEqual([]);
  });

  it("any absence Event the same date excludes the technician", () => {
    const events = [dayShift("p1", "technician"), event({ personId: "p1", category: "absence", absenceKind: "vacation" })];
    const people = [person("p1", { isTechnician: true })];
    expect(resolveEligibleLogisticsTechnicians(events, people, DATE, schedule)).toEqual([]);
  });

  it("referral (הפנייה) excludes the technician, same as every other absence", () => {
    const events = [dayShift("p1", "technician"), event({ personId: "p1", category: "absence", absenceKind: "referral" })];
    const people = [person("p1", { isTechnician: true })];
    expect(resolveEligibleLogisticsTechnicians(events, people, DATE, schedule)).toEqual([]);
  });

  it("חופש (vacation) excludes the technician", () => {
    const events = [dayShift("p1", "technician"), event({ personId: "p1", category: "absence", absenceKind: "vacation" })];
    const people = [person("p1", { isTechnician: true })];
    expect(resolveEligibleLogisticsTechnicians(events, people, DATE, schedule)).toEqual([]);
  });

  it("אפטר (partial/ambiguous absence) STILL excludes the technician for THIS audience, unlike the general blocking-absence rule", () => {
    const events = [dayShift("p1", "technician"), event({ personId: "p1", category: "absence", absenceKind: "after" })];
    const people = [person("p1", { isTechnician: true })];
    expect(resolveEligibleLogisticsTechnicians(events, people, DATE, schedule)).toEqual([]);
  });

  it("אילוץ יום (day constraint) excludes the technician", () => {
    const events = [dayShift("p1", "technician"), event({ personId: "p1", category: "constraint", period: "day" })];
    const people = [person("p1", { isTechnician: true })];
    expect(resolveEligibleLogisticsTechnicians(events, people, DATE, schedule)).toEqual([]);
  });

  it("אילוץ לילה (night constraint) does NOT exclude the technician", () => {
    const events = [dayShift("p1", "technician"), event({ personId: "p1", category: "constraint", period: "night" })];
    const people = [person("p1", { isTechnician: true })];
    expect(resolveEligibleLogisticsTechnicians(events, people, DATE, schedule)).toEqual(people);
  });

  it("an unrelated constraint period (morning/unspecified) never invents new exclusion semantics", () => {
    const events1 = [dayShift("p1", "technician"), event({ personId: "p1", category: "constraint", period: "morning" })];
    const events2 = [dayShift("p1", "technician"), event({ personId: "p1", category: "constraint", period: "unspecified" })];
    const people = [person("p1", { isTechnician: true })];
    expect(resolveEligibleLogisticsTechnicians(events1, people, DATE, schedule)).toEqual(people);
    expect(resolveEligibleLogisticsTechnicians(events2, people, DATE, schedule)).toEqual(people);
  });

  it("deterministically orders multiple eligible technicians by personId", () => {
    const events = [dayShift("p_b", "technician"), dayShift("p_a", "technician")];
    const people = [person("p_b", { isTechnician: true }), person("p_a", { isTechnician: true })];
    const result = resolveEligibleLogisticsTechnicians(events, people, DATE, schedule);
    expect(result.map((p) => p.id)).toEqual(["p_a", "p_b"]);
  });
});

describe("joinNamesWithVav", () => {
  it("one name: unchanged", () => {
    expect(joinNamesWithVav(["איתן"])).toBe("איתן");
  });
  it("two names: 'X ו-Y' (no comma)", () => {
    expect(joinNamesWithVav(["איתן", "דניאל"])).toBe("איתן ודניאל");
  });
  it("three names: comma list + final 'ו'", () => {
    expect(joinNamesWithVav(["איתן", "דניאל", "משה"])).toBe("איתן, דניאל ומשה");
  });
});

describe("buildSupervisorAssignedInformedBody / buildTeamHelpAssignedBody -- singular/plural copy", () => {
  it("matches the approved singular wording exactly", () => {
    expect(buildSupervisorAssignedInformedBody(["איתן"])).toBe(
      "מחר איתן עושה משיכות בין 13:00–14:00. נדרש לוודא שהוא מכיר את המשימה.",
    );
    expect(buildTeamHelpAssignedBody(["איתן"])).toBe("איתן עושה משיכות היום בין 13:00–14:00. נדרש לעזור לו.");
  });

  it("uses clean plural copy for multiple assignees, never one push per assignee", () => {
    expect(buildSupervisorAssignedInformedBody(["איתן", "דניאל"])).toBe(
      "מחר איתן ודניאל עושים משיכות בין 13:00–14:00. נדרש לוודא שהם מכירים את המשימה.",
    );
    expect(buildTeamHelpAssignedBody(["איתן", "דניאל"])).toBe(
      "איתן ודניאל עושים משיכות היום בין 13:00–14:00. נדרש לעזור להם.",
    );
  });
});

describe("buildSupervisorAssignedTodayBody -- same-day (noon) counterpart of buildSupervisorAssignedInformedBody", () => {
  it("matches the approved singular wording exactly", () => {
    expect(buildSupervisorAssignedTodayBody(["איתן"])).toBe(
      "איתן עושה משיכות היום בין 13:00–14:00. נדרש לוודא שהוא מכיר את המשימה.",
    );
  });

  it("uses clean plural copy for multiple assignees, never one push per assignee", () => {
    expect(buildSupervisorAssignedTodayBody(["איתן", "דניאל"])).toBe(
      "איתן ודניאל עושים משיכות היום בין 13:00–14:00. נדרש לוודא שהם מכירים את המשימה.",
    );
  });
});

describe("isLogisticsWithdrawalFallbackDate", () => {
  it("Monday is the only genuine logistics-withdrawal fallback date", () => {
    expect(isLogisticsWithdrawalFallbackDate("2026-08-17")).toBe(true); // Monday
  });

  it("every other weekday is never a fallback date", () => {
    expect(isLogisticsWithdrawalFallbackDate("2026-08-16")).toBe(false); // Sunday
    expect(isLogisticsWithdrawalFallbackDate("2026-08-18")).toBe(false); // Tuesday
    expect(isLogisticsWithdrawalFallbackDate("2026-08-19")).toBe(false); // Wednesday
    expect(isLogisticsWithdrawalFallbackDate("2026-08-20")).toBe(false); // Thursday
    expect(isLogisticsWithdrawalFallbackDate("2026-08-21")).toBe(false); // Friday
    expect(isLogisticsWithdrawalFallbackDate("2026-08-22")).toBe(false); // Saturday
  });

  it("holds across a month/week boundary -- the next Monday is still true", () => {
    expect(isLogisticsWithdrawalFallbackDate("2026-08-24")).toBe(true); // Monday
    expect(isLogisticsWithdrawalFallbackDate("2026-08-31")).toBe(true); // Monday, crosses into September
  });

  it("an unparseable date conservatively never participates in the fallback", () => {
    expect(isLogisticsWithdrawalFallbackDate("not-a-date")).toBe(false);
  });
});
