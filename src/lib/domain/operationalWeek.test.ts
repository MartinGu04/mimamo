import { describe, expect, it } from "vitest";
import {
  getNextOperationalWeek,
  getOperationalWeek,
  getOperationalWeekForDate,
  getPreviousOperationalWeek,
  nextCalendarDateString,
} from "./operationalWeek";
import type { LocalNow } from "./localNow";

function localNow(date: string): LocalNow {
  return { date, minuteOfDay: 0 };
}

describe("getOperationalWeek", () => {
  it("resolves a mid-week Wednesday to its Sunday-based week", () => {
    // 2026-08-19 is a Wednesday.
    const week = getOperationalWeek(localNow("2026-08-19"));
    expect(week.weekStart).toBe("2026-08-16"); // the preceding Sunday
    expect(week.weekEnd).toBe("2026-08-22");
    expect(week.dates).toEqual([
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
    ]);
  });

  it("a Sunday itself is the start of its own week", () => {
    const week = getOperationalWeek(localNow("2026-08-16"));
    expect(week.weekStart).toBe("2026-08-16");
  });

  it("a Saturday is the end of its own week", () => {
    const week = getOperationalWeek(localNow("2026-08-22"));
    expect(week.weekStart).toBe("2026-08-16");
    expect(week.weekEnd).toBe("2026-08-22");
  });

  it("correctly rolls across a month boundary", () => {
    // 2026-08-31 is a Monday.
    const week = getOperationalWeek(localNow("2026-08-31"));
    expect(week.weekStart).toBe("2026-08-30");
    expect(week.weekEnd).toBe("2026-09-05");
  });
});

describe("getOperationalWeek — cross-month week includes all seven dates (3)", () => {
  it("a week crossing a month boundary still resolves exactly seven ascending dates", () => {
    // 2026-08-31 is a Monday -- the week runs 2026-08-30 .. 2026-09-05.
    const week = getOperationalWeek(localNow("2026-08-31"));
    expect(week.dates).toHaveLength(7);
    expect(week.dates).toEqual([
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ]);
  });

  it("a week crossing a year boundary still resolves exactly seven ascending dates", () => {
    // 2026-12-31 is a Thursday -- the week runs 2026-12-27 .. 2027-01-02.
    const week = getOperationalWeekForDate("2026-12-31");
    expect(week?.dates).toHaveLength(7);
    expect(week).toEqual({
      weekStart: "2026-12-27",
      weekEnd: "2027-01-02",
      dates: ["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"],
    });
  });
});

describe("getOperationalWeekForDate — arbitrary ?week= anchor resolution (2)", () => {
  it("resolves an arbitrary mid-week anchor to its own Sunday-based week", () => {
    const week = getOperationalWeekForDate("2026-09-23"); // a Wednesday
    expect(week).toEqual({
      weekStart: "2026-09-20",
      weekEnd: "2026-09-26",
      dates: ["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26"],
    });
  });

  it("returns null for an unparseable anchor -- never a fabricated week", () => {
    expect(getOperationalWeekForDate("not-a-date")).toBeNull();
    expect(getOperationalWeekForDate("")).toBeNull();
  });

  it("returns null for a structurally-invalid calendar date", () => {
    expect(getOperationalWeekForDate("2026-13-40")).toBeNull();
  });
});

describe("getNextOperationalWeek", () => {
  it("returns the week immediately after the given one", () => {
    const week = getOperationalWeek(localNow("2026-08-19"));
    const next = getNextOperationalWeek(week);
    expect(next.weekStart).toBe("2026-08-23");
    expect(next.weekEnd).toBe("2026-08-29");
  });
});

describe("getPreviousOperationalWeek (4, previous/next week navigation)", () => {
  it("returns the week immediately before the given one", () => {
    const week = getOperationalWeek(localNow("2026-08-19"));
    const prev = getPreviousOperationalWeek(week);
    expect(prev.weekStart).toBe("2026-08-09");
    expect(prev.weekEnd).toBe("2026-08-15");
  });

  it("composes with getNextOperationalWeek to round-trip back to the original week", () => {
    const week = getOperationalWeek(localNow("2026-08-19"));
    const roundTrip = getPreviousOperationalWeek(getNextOperationalWeek(week));
    expect(roundTrip).toEqual(week);
  });

  it("correctly rolls backward across a month boundary", () => {
    const week = getOperationalWeekForDate("2026-09-01"); // week 2026-08-30..2026-09-05
    const prev = getPreviousOperationalWeek(week!);
    expect(prev.weekStart).toBe("2026-08-23");
    expect(prev.weekEnd).toBe("2026-08-29");
  });
});

describe("nextCalendarDateString", () => {
  it("returns the following calendar date", () => {
    expect(nextCalendarDateString("2026-08-19")).toBe("2026-08-20");
  });

  it("rolls across a month/year boundary", () => {
    expect(nextCalendarDateString("2026-12-31")).toBe("2027-01-01");
  });

  it("returns null for an unparseable date", () => {
    expect(nextCalendarDateString("not-a-date")).toBeNull();
  });
});
