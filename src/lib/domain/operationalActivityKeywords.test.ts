import { describe, expect, it } from "vitest";
import type { Event } from "./event";
import {
  CERTIFICATION_KEYWORD,
  WITHDRAWAL_KEYWORD,
  isCertificationEvent,
  isRecognizedOperationalActivityEvent,
  isShootingRangeEvent,
  isWithdrawalEvent,
} from "./operationalActivityKeywords";

function event(overrides: Partial<Event> = {}): Event {
  return {
    personId: "p_test",
    personName: "דני בדיקה",
    date: "2026-08-26",
    title: "",
    rawValue: "",
    category: "shift",
    certainty: "confirmed",
    role: null,
    period: "unspecified",
    sourceSheet: "משמרות + תורנויות",
    sourceCell: "C1",
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

function otherEvent(title: string, overrides: Partial<Event> = {}): Event {
  return event({ category: "other", role: null, period: "unspecified", title, ...overrides });
}

describe("WITHDRAWAL_KEYWORD / isWithdrawalEvent", () => {
  it("matches the bare 'משיכות' keyword", () => {
    expect(isWithdrawalEvent(otherEvent("משיכות"))).toBe(true);
  });

  it("matches the longer real phrasing 'משיכות מהלוגיסטיקה' via substring", () => {
    expect(isWithdrawalEvent(otherEvent("משיכות מהלוגיסטיקה"))).toBe(true);
  });

  it("never matches a category other than 'other'", () => {
    expect(isWithdrawalEvent(event({ category: "shift", title: "משיכות" }))).toBe(false);
  });

  it("never matches unrelated 'other' text", () => {
    expect(isWithdrawalEvent(otherEvent("הערה כללית"))).toBe(false);
  });

  it("exposes the exact keyword constant", () => {
    expect(WITHDRAWAL_KEYWORD).toBe("משיכות");
  });
});

describe("CERTIFICATION_KEYWORD / isCertificationEvent", () => {
  it("matches 'הסמכה'", () => {
    expect(isCertificationEvent(otherEvent("הסמכה"))).toBe(true);
  });

  it("never matches a category other than 'other'", () => {
    expect(isCertificationEvent(event({ category: "duty", title: "הסמכה" }))).toBe(false);
  });

  it("exposes the exact keyword constant", () => {
    expect(CERTIFICATION_KEYWORD).toBe("הסמכה");
  });
});

describe("isShootingRangeEvent", () => {
  it("matches the plural 'מטווחים'", () => {
    expect(isShootingRangeEvent(otherEvent("מטווחים"))).toBe(true);
  });

  it("matches the singular 'מטווח' too (a substring of the plural)", () => {
    expect(isShootingRangeEvent(otherEvent("מטווח"))).toBe(true);
  });

  it("never matches a category other than 'other'", () => {
    expect(isShootingRangeEvent(event({ category: "shift", title: "מטווחים" }))).toBe(false);
  });

  it("never matches unrelated 'other' text", () => {
    expect(isShootingRangeEvent(otherEvent("הערה כללית"))).toBe(false);
  });
});

describe("isRecognizedOperationalActivityEvent", () => {
  it("is true for each of the three narrow exceptions", () => {
    expect(isRecognizedOperationalActivityEvent(otherEvent("מטווחים"))).toBe(true);
    expect(isRecognizedOperationalActivityEvent(otherEvent("משיכות"))).toBe(true);
    expect(isRecognizedOperationalActivityEvent(otherEvent("הסמכה"))).toBe(true);
  });

  it("is false for unrelated 'other' text -- never a blanket 'any other text is fine' rule", () => {
    expect(isRecognizedOperationalActivityEvent(otherEvent("הערה כללית"))).toBe(false);
  });

  it("is false for a typed shift/duty/absence category -- this is an 'other'-only exception, never a general-purpose check", () => {
    expect(isRecognizedOperationalActivityEvent(event({ category: "shift", title: "מטווחים" }))).toBe(false);
    expect(isRecognizedOperationalActivityEvent(event({ category: "duty", title: "משיכות" }))).toBe(false);
  });
});
