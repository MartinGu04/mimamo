import { describe, expect, it } from "vitest";
import { APP_NAME } from "@/lib/config/productName";
import { renderIcsFeed, type IcsCalendarItem } from "./icsRender";

const GENERATED_AT = new Date("2026-08-18T10:00:00.000Z");

function timedItem(overrides: Partial<IcsCalendarItem> = {}): IcsCalendarItem {
  return {
    uid: "abc123",
    summary: 'אחמ"ש יום',
    description: null,
    timing: { kind: "timed", startUtc: new Date("2026-08-19T04:30:00.000Z"), endUtc: new Date("2026-08-19T16:30:00.000Z") },
    color: null,
    ...overrides,
  };
}

describe("renderIcsFeed", () => {
  it("wraps every VEVENT inside exactly one BEGIN/END:VCALENDAR pair, CRLF-terminated throughout", () => {
    const text = renderIcsFeed({ personName: "דני", items: [timedItem()], generatedAt: GENERATED_AT });
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("BEGIN:VEVENT\r\n");
    expect(text).toContain("END:VEVENT\r\n");
    expect(text).not.toMatch(/[^\r]\n/); // every LF is preceded by CR -- never a bare LF
  });

  it("declares VERSION:2.0, METHOD:PUBLISH, and the Hebrew calendar name", () => {
    const text = renderIcsFeed({ personName: "דני בדיקה", items: [], generatedAt: GENERATED_AT });
    expect(text).toContain("VERSION:2.0\r\n");
    expect(text).toContain("METHOD:PUBLISH\r\n");
    expect(text).toContain(`X-WR-CALNAME:${APP_NAME} — דני בדיקה\r\n`);
  });

  it("renders zero VEVENTs as a valid, empty calendar", () => {
    const text = renderIcsFeed({ personName: "דני", items: [], generatedAt: GENERATED_AT });
    expect(text).not.toContain("BEGIN:VEVENT");
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("END:VCALENDAR");
  });

  it("a timed item gets UTC DTSTART/DTEND in the YYYYMMDDTHHMMSSZ form", () => {
    const text = renderIcsFeed({ personName: "דני", items: [timedItem()], generatedAt: GENERATED_AT });
    expect(text).toContain("DTSTART:20260819T043000Z\r\n");
    expect(text).toContain("DTEND:20260819T163000Z\r\n");
  });

  it("an all-day item gets VALUE=DATE DTSTART/DTEND, with DTEND exclusive (one day after)", () => {
    const item = timedItem({ timing: { kind: "allDay", date: "2026-08-20" } });
    const text = renderIcsFeed({ personName: "דני", items: [item], generatedAt: GENERATED_AT });
    expect(text).toContain("DTSTART;VALUE=DATE:20260820\r\n");
    expect(text).toContain("DTEND;VALUE=DATE:20260821\r\n");
  });

  it("an all-day item on the last day of a month rolls DTEND into the next month/year correctly", () => {
    const item = timedItem({ timing: { kind: "allDay", date: "2026-12-31" } });
    const text = renderIcsFeed({ personName: "דני", items: [item], generatedAt: GENERATED_AT });
    expect(text).toContain("DTSTART;VALUE=DATE:20261231\r\n");
    expect(text).toContain("DTEND;VALUE=DATE:20270101\r\n");
  });

  it("every VEVENT carries a UID with the fixed domain suffix and a DTSTAMP", () => {
    const text = renderIcsFeed({ personName: "דני", items: [timedItem({ uid: "deadbeef" })], generatedAt: GENERATED_AT });
    expect(text).toContain("UID:deadbeef@mi-ma-mo.app\r\n");
    expect(text).toContain("DTSTAMP:20260818T100000Z\r\n");
  });

  it("SUMMARY is escaped for RFC 5545 special characters", () => {
    const item = timedItem({ summary: "שומר, 2; הערה\\אחרת" });
    const text = renderIcsFeed({ personName: "דני", items: [item], generatedAt: GENERATED_AT });
    expect(text).toContain("SUMMARY:שומר\\, 2\\; הערה\\\\אחרת\r\n");
  });

  it("DESCRIPTION is omitted entirely when null, and multi-line when present (escaped as \\n)", () => {
    const withoutDescription = renderIcsFeed({ personName: "דני", items: [timedItem({ description: null })], generatedAt: GENERATED_AT });
    expect(withoutDescription).not.toContain("DESCRIPTION");

    const withDescription = renderIcsFeed({
      personName: "דני",
      items: [timedItem({ description: "שורה א\nשורה ב" })],
      generatedAt: GENERATED_AT,
    });
    expect(withDescription).toContain("DESCRIPTION:שורה א\\nשורה ב\r\n");
  });

  it("multiple items each get their own VEVENT block, in the given order", () => {
    const items = [timedItem({ uid: "first" }), timedItem({ uid: "second" })];
    const text = renderIcsFeed({ personName: "דני", items, generatedAt: GENERATED_AT });
    const firstIndex = text.indexOf("UID:first@");
    const secondIndex = text.indexOf("UID:second@");
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("COLOR is omitted entirely when null, and emitted verbatim when present", () => {
    const withoutColor = renderIcsFeed({ personName: "דני", items: [timedItem({ color: null })], generatedAt: GENERATED_AT });
    expect(withoutColor).not.toContain("COLOR");

    const withColor = renderIcsFeed({ personName: "דני", items: [timedItem({ color: "goldenrod" })], generatedAt: GENERATED_AT });
    expect(withColor).toContain("COLOR:goldenrod\r\n");
  });

  it("a COLOR property never affects any other VEVENT field -- UID/timing/SUMMARY/DESCRIPTION stay identical with or without it", () => {
    const withoutColor = renderIcsFeed({
      personName: "דני",
      items: [timedItem({ uid: "x", color: null })],
      generatedAt: GENERATED_AT,
    });
    const withColor = renderIcsFeed({
      personName: "דני",
      items: [timedItem({ uid: "x", color: "royalblue" })],
      generatedAt: GENERATED_AT,
    });
    const stripColorLine = (text: string) => text.replace(/COLOR:[^\r\n]*\r\n/, "");
    expect(stripColorLine(withColor)).toBe(withoutColor);
  });

  it("never produces a line exceeding 75 octets (folding is applied end-to-end) even for a long Hebrew summary", () => {
    const longSummary = "משמרת יום עם הערה ארוכה מאוד ".repeat(6);
    const text = renderIcsFeed({ personName: "דני", items: [timedItem({ summary: longSummary })], generatedAt: GENERATED_AT });
    for (const line of text.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });
});
