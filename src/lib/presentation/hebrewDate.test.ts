import { describe, expect, it } from "vitest";
import {
  formatCompactDate,
  formatDateRange,
  formatHebrewDayAndMonth,
  formatHebrewMonthName,
  formatHebrewMonthYear,
  formatHebrewWeekday,
  formatHebrewWeekdayAndDate,
  formatHebrewWeekRangeLabel,
  formatShortWeekday,
  parseHebrewWeekdayName,
  relativeDayLabel,
  SHORT_WEEKDAY_LABELS,
} from "./hebrewDate";

describe("formatHebrewWeekdayAndDate", () => {
  it("formats a known date correctly (2026-08-12 is a Wednesday)", () => {
    expect(formatHebrewWeekdayAndDate("2026-08-12")).toBe("יום רביעי · 12 באוגוסט");
  });

  it("formats a different month correctly", () => {
    expect(formatHebrewWeekdayAndDate("2026-01-01")).toBe("יום חמישי · 1 בינואר");
  });

  it("returns null for an unparseable date, never throws", () => {
    expect(formatHebrewWeekdayAndDate("not-a-date")).toBeNull();
    expect(formatHebrewWeekdayAndDate("2026-13-01")).toBeNull();
  });
});

describe("formatHebrewWeekday", () => {
  it("returns just the weekday label", () => {
    expect(formatHebrewWeekday("2026-08-13")).toBe("יום חמישי");
  });
});

describe("formatHebrewDayAndMonth", () => {
  it("formats the day-of-month and month without the weekday", () => {
    expect(formatHebrewDayAndMonth("2026-08-14")).toBe("14 באוגוסט");
  });

  it("returns null for an unparseable date, never throws", () => {
    expect(formatHebrewDayAndMonth("not-a-date")).toBeNull();
  });
});

describe("formatHebrewMonthName", () => {
  it("formats just the month label with its ב prefix", () => {
    expect(formatHebrewMonthName("2026-08-14")).toBe("באוגוסט");
    expect(formatHebrewMonthName("2026-01-01")).toBe("בינואר");
  });

  it("returns null for an unparseable date, never throws", () => {
    expect(formatHebrewMonthName("not-a-date")).toBeNull();
  });
});

describe("formatShortWeekday", () => {
  it("formats the standard single-letter abbreviation", () => {
    expect(formatShortWeekday("2026-08-13")).toBe("ה׳"); // Thursday
  });

  it("returns null for an invalid date", () => {
    expect(formatShortWeekday("bad")).toBeNull();
  });
});

describe("formatCompactDate", () => {
  it("formats day.month compactly", () => {
    expect(formatCompactDate("2026-08-13")).toBe("13.8");
  });

  it("returns null for an invalid date", () => {
    expect(formatCompactDate("bad")).toBeNull();
  });
});

describe("formatHebrewMonthYear", () => {
  it("formats a month/year header label", () => {
    expect(formatHebrewMonthYear(2026, 8)).toBe("אוגוסט 2026");
  });

  it("returns null for an out-of-range month", () => {
    expect(formatHebrewMonthYear(2026, 0)).toBeNull();
    expect(formatHebrewMonthYear(2026, 13)).toBeNull();
  });
});

describe("formatDateRange", () => {
  it("formats a single day as a full weekday+date", () => {
    expect(formatDateRange("2026-08-19", "2026-08-19")).toBe("יום רביעי · 19 באוגוסט");
  });

  it("formats a multi-day range within the same month compactly", () => {
    expect(formatDateRange("2026-08-19", "2026-08-21")).toBe("19–21 באוגוסט");
  });

  it("formats a range crossing a Gregorian month with both months named", () => {
    expect(formatDateRange("2026-08-31", "2026-09-02")).toBe("31 באוגוסט – 2 בספטמבר");
  });

  it("formats a range crossing a year boundary", () => {
    expect(formatDateRange("2026-12-30", "2027-01-02")).toBe("30 בדצמבר – 2 בינואר");
  });

  it("returns null for an unparseable date, never throws", () => {
    expect(formatDateRange("not-a-date", "2026-08-21")).toBeNull();
    expect(formatDateRange("2026-08-19", "bad")).toBeNull();
  });
});

describe("formatHebrewWeekRangeLabel", () => {
  it("formats a week within the same month, always with the year", () => {
    expect(formatHebrewWeekRangeLabel("2026-09-20", "2026-09-26")).toBe("20–26 בספטמבר 2026");
  });

  it("formats a week crossing a Gregorian month, each end its own month name, one shared year", () => {
    expect(formatHebrewWeekRangeLabel("2026-08-30", "2026-09-05")).toBe("30 באוגוסט – 5 בספטמבר 2026");
  });

  it("formats a week crossing a year boundary, each end its own year", () => {
    expect(formatHebrewWeekRangeLabel("2026-12-27", "2027-01-02")).toBe("27 בדצמבר 2026 – 2 בינואר 2027");
  });

  it("returns null for an unparseable date, never throws", () => {
    expect(formatHebrewWeekRangeLabel("not-a-date", "2026-09-26")).toBeNull();
    expect(formatHebrewWeekRangeLabel("2026-09-20", "bad")).toBeNull();
  });
});

describe("SHORT_WEEKDAY_LABELS", () => {
  it("is Sunday-first with 7 entries, matching dayOfWeek's 0=Sunday convention", () => {
    expect(SHORT_WEEKDAY_LABELS).toHaveLength(7);
    expect(SHORT_WEEKDAY_LABELS[0]).toBe("א׳");
    expect(SHORT_WEEKDAY_LABELS[6]).toBe("ש׳");
  });
});

describe("relativeDayLabel", () => {
  it("recognizes today", () => {
    expect(relativeDayLabel("2026-08-12", "2026-08-12")).toBe("today");
  });

  it("recognizes tomorrow", () => {
    expect(relativeDayLabel("2026-08-13", "2026-08-12")).toBe("tomorrow");
  });

  it("recognizes a month-boundary tomorrow", () => {
    expect(relativeDayLabel("2026-09-01", "2026-08-31")).toBe("tomorrow");
  });

  it("everything else is other", () => {
    expect(relativeDayLabel("2026-08-20", "2026-08-12")).toBe("other");
    expect(relativeDayLabel("2026-08-11", "2026-08-12")).toBe("other");
  });
});

describe("parseHebrewWeekdayName", () => {
  it("parses every bare weekday name, Sunday-first", () => {
    expect(parseHebrewWeekdayName("ראשון")).toBe(0);
    expect(parseHebrewWeekdayName("שני")).toBe(1);
    expect(parseHebrewWeekdayName("שלישי")).toBe(2);
    expect(parseHebrewWeekdayName("רביעי")).toBe(3);
    expect(parseHebrewWeekdayName("חמישי")).toBe(4);
    expect(parseHebrewWeekdayName("שישי")).toBe(5);
    expect(parseHebrewWeekdayName("שבת")).toBe(6);
  });

  it("parses the 'יום X' compound form", () => {
    expect(parseHebrewWeekdayName("יום חמישי")).toBe(4);
    expect(parseHebrewWeekdayName("יום שבת")).toBe(6);
  });

  it("trims and collapses surrounding whitespace", () => {
    expect(parseHebrewWeekdayName("  חמישי  ")).toBe(4);
    expect(parseHebrewWeekdayName("יום   חמישי")).toBe(4);
  });

  it("returns null for anything that isn't a bare weekday name -- never matches a substring", () => {
    expect(parseHebrewWeekdayName("יום חמישי בבוקר")).toBeNull();
    expect(parseHebrewWeekdayName("עילאי")).toBeNull();
    expect(parseHebrewWeekdayName("")).toBeNull();
    expect(parseHebrewWeekdayName("19.8")).toBeNull();
  });
});
