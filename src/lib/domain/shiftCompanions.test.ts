import { describe, expect, it } from "vitest";
import type { Event } from "./event";
import { findOverlappingShiftCompanionEvents, shiftsOverlapInTime } from "./shiftCompanions";
import { buildShiftSchedule } from "./shiftSchedule";

// day 07:30-19:30, night 19:30-07:30(+1)
const schedule = buildShiftSchedule("07:30");

let cellCounter = 0;
function nextCell(): string {
  cellCounter += 1;
  return `C${cellCounter}`;
}

const ME_ID = "p_me";

function event(overrides: Partial<Event> = {}): Event {
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

/** Anyone other than the target person -- the only events that can ever be companions. */
function other(personId: string, overrides: Partial<Event> = {}): Event {
  return event({ personId, personName: `עמית ${personId}`, ...overrides });
}

function companionPersonIds(target: Event, events: readonly Event[]): string[] {
  return findOverlappingShiftCompanionEvents(target, events, schedule).map((found) => found.personId);
}

describe("shiftsOverlapInTime", () => {
  it("1. two plain day shifts on the same date overlap", () => {
    expect(shiftsOverlapInTime(event(), other("p_1"), schedule)).toBe(true);
  });

  it("2. a shadow/צל shift overlaps exactly like any other -- shadow is a role nuance, never an absence from the shift", () => {
    expect(
      shiftsOverlapInTime(event(), other("p_1", { shadow: true, title: 'אחמ"ש צל' }), schedule),
    ).toBe(true);
  });

  it("3. same date, same period, but disjoint time windows do NOT overlap", () => {
    const morningHalf = event({ endTimeOverride: "10:00" });
    const eveningHalf = other("p_1", { startTimeOverride: "12:00" });
    expect(shiftsOverlapInTime(morningHalf, eveningHalf, schedule)).toBe(false);
  });

  it("3b. same date, same period, partially-overlapping windows DO overlap", () => {
    const early = event({ endTimeOverride: "14:00" });
    const late = other("p_1", { startTimeOverride: "12:00" });
    expect(shiftsOverlapInTime(early, late, schedule)).toBe(true);
  });

  it("4. a non-shift event never overlaps, however much its date matches", () => {
    const vacation = other("p_1", {
      category: "absence",
      absenceKind: "vacation",
      role: null,
      period: "unspecified",
      title: "חופש",
      rawValue: "חופש",
    });
    const referral = other("p_2", {
      category: "absence",
      absenceKind: "referral",
      role: null,
      period: "unspecified",
      title: "הפנייה",
      rawValue: "הפנייה",
    });
    const duty = other("p_3", {
      category: "duty",
      dutyFamily: "guard",
      slot: 1,
      role: null,
      period: "unspecified",
      title: "שומר 1",
      rawValue: "שומר 1",
    });

    expect(shiftsOverlapInTime(event(), vacation, schedule)).toBe(false);
    expect(shiftsOverlapInTime(event(), referral, schedule)).toBe(false);
    expect(shiftsOverlapInTime(event(), duty, schedule)).toBe(false);
    // ...and neither does a non-shift TARGET against a real shift.
    expect(shiftsOverlapInTime(duty, event({ personId: "p_4" }), schedule)).toBe(false);
  });

  it("7. a night shift starting after midnight still overlaps the night shift it shares -- absolute timeline, not minute-of-day", () => {
    const fullNight = event({ period: "night", title: "טכנאי לילה" });
    // 02:00 belongs to the NEXT calendar morning, inside this night's window.
    const lateNight = other("p_1", { period: "night", startTimeOverride: "02:00", title: 'אחמ"ש לילה' });
    expect(shiftsOverlapInTime(fullNight, lateNight, schedule)).toBe(true);
  });

  it("7b. back-to-back shifts that merely touch at midnight-crossing boundaries never overlap", () => {
    const previousNight = other("p_1", { date: "2026-08-11", period: "night" }); // ends 07:30 on the 12th
    const myDay = event({ date: "2026-08-12", period: "day" }); // starts 07:30 on the 12th
    expect(shiftsOverlapInTime(myDay, previousNight, schedule)).toBe(false);

    const myNight = event({ date: "2026-08-12", period: "night" }); // ends 07:30 on the 13th
    const nextDay = other("p_2", { date: "2026-08-13", period: "day" }); // starts 07:30 on the 13th
    expect(shiftsOverlapInTime(myNight, nextDay, schedule)).toBe(false);
  });

  it("7c. the same period on a neighbouring date is never an overlap", () => {
    const myNight = event({ date: "2026-08-12", period: "night" });
    const nextNight = other("p_1", { date: "2026-08-13", period: "night" });
    expect(shiftsOverlapInTime(myNight, nextNight, schedule)).toBe(false);
  });

  it("falls back to the structural date+period rule when a period has no canonical window -- never to date alone", () => {
    const unspecified = event({ period: "unspecified", title: "טכנאי" });
    expect(shiftsOverlapInTime(unspecified, other("p_1", { period: "unspecified" }), schedule)).toBe(true);
    expect(shiftsOverlapInTime(unspecified, other("p_2", { period: "day" }), schedule)).toBe(false);
    expect(
      shiftsOverlapInTime(unspecified, other("p_3", { period: "unspecified", date: "2026-08-13" }), schedule),
    ).toBe(false);
  });
});

describe("findOverlappingShiftCompanionEvents", () => {
  it("1. finds another person's overlapping day shift", () => {
    const target = event();
    const events = [target, other("p_1", { role: "supervisor", title: 'אחמ"ש יום' })];
    expect(companionPersonIds(target, events)).toEqual(["p_1"]);
  });

  it("2. includes a shadow-role colleague on the same shift", () => {
    const target = event();
    const events = [target, other("p_1", { shadow: true, role: "supervisor", title: 'אחמ"ש צל' })];
    expect(companionPersonIds(target, events)).toEqual(["p_1"]);
  });

  it("3. excludes a same-day shift that doesn't overlap in time", () => {
    const target = event({ endTimeOverride: "10:00" });
    const events = [target, other("p_1", { startTimeOverride: "12:00" })];
    expect(companionPersonIds(target, events)).toEqual([]);
  });

  it("4. excludes non-shift activity on the same day -- vacation, הפנייה, duty", () => {
    const target = event();
    const events = [
      target,
      other("p_1", { category: "absence", absenceKind: "vacation", title: "חופש", rawValue: "חופש" }),
      other("p_2", { category: "absence", absenceKind: "referral", title: "הפנייה", rawValue: "הפנייה" }),
      other("p_3", { category: "duty", dutyFamily: "guard", slot: 1, title: "שומר 1", rawValue: "שומר 1" }),
    ];
    expect(companionPersonIds(target, events)).toEqual([]);
  });

  it("5. excludes the target person themselves, including their own second shift that day", () => {
    const target = event({ period: "day" });
    const events = [target, event({ period: "day", startTimeOverride: "12:00" })];
    expect(companionPersonIds(target, events)).toEqual([]);
  });

  it("6. keeps every real Event for a split-shift colleague -- deduplication is the read model's decision, not this layer's", () => {
    const target = event();
    const events = [
      target,
      other("p_1", { endTimeOverride: "13:00" }),
      other("p_1", { startTimeOverride: "13:00" }),
    ];
    expect(companionPersonIds(target, events)).toEqual(["p_1", "p_1"]);
  });

  it("7. resolves overnight companions across midnight without pulling in the neighbouring nights", () => {
    const target = event({ date: "2026-08-12", period: "night", title: "טכנאי לילה" });
    const events = [
      target,
      other("p_1", { date: "2026-08-12", period: "night", startTimeOverride: "02:00" }),
      other("p_2", { date: "2026-08-11", period: "night" }),
      other("p_3", { date: "2026-08-13", period: "night" }),
      other("p_4", { date: "2026-08-13", period: "day" }),
    ];
    expect(companionPersonIds(target, events)).toEqual(["p_1"]);
  });

  it("returns nothing for a non-shift target -- the question is never asked of a duty or an absence", () => {
    const target = event({ category: "duty", dutyFamily: "guard", slot: 1, title: "שומר 1", rawValue: "שומר 1" });
    expect(companionPersonIds(target, [target, other("p_1")])).toEqual([]);
  });
});
