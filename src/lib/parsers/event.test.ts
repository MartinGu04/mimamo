import { describe, expect, it } from "vitest";
import type { RawAssignment } from "./types";
import { parseEvent } from "./event";

function rawAssignment(rawValue: string, overrides: Partial<RawAssignment> = {}): RawAssignment {
  return {
    personId: "p_test",
    personName: "דני בדיקה",
    date: "2026-01-05",
    rawValue,
    sourceSheet: "משמרות + תורנויות",
    sourceCell: "C2",
    ...overrides,
  };
}

describe("parseEvent — shift", () => {
  it("1. supervisor day", () => {
    const event = parseEvent(rawAssignment('אחמ"ש יום'));
    expect(event).toMatchObject({
      category: "shift",
      role: "supervisor",
      period: "day",
      certainty: "confirmed",
      shadow: false,
      slot: null,
      dutyFamily: null,
      startTimeOverride: null,
      endTimeOverride: null,
      changeNote: null,
    });
  });

  it("2. supervisor night", () => {
    const event = parseEvent(rawAssignment('אחמ"ש לילה'));
    expect(event).toMatchObject({ category: "shift", role: "supervisor", period: "night" });
  });

  it("3. generic supervisor (unspecified period)", () => {
    const event = parseEvent(rawAssignment('אחמ"ש'));
    expect(event).toMatchObject({ category: "shift", role: "supervisor", period: "unspecified" });
  });

  it("4. technician day", () => {
    const event = parseEvent(rawAssignment("טכנאי יום"));
    expect(event).toMatchObject({ category: "shift", role: "technician", period: "day" });
  });

  it("5. technician night", () => {
    const event = parseEvent(rawAssignment("טכנאי לילה"));
    expect(event).toMatchObject({ category: "shift", role: "technician", period: "night" });
  });

  it("6. feminine technician form", () => {
    const event = parseEvent(rawAssignment("טכנאית יום"));
    expect(event).toMatchObject({ category: "shift", role: "technician", period: "day" });
  });

  it("generic technician (unspecified period)", () => {
    const event = parseEvent(rawAssignment("טכנאית"));
    expect(event).toMatchObject({ category: "shift", role: "technician", period: "unspecified" });
  });

  it("7. partial start-time shift", () => {
    const event = parseEvent(rawAssignment("טכנאי יום מ-12"));
    expect(event).toMatchObject({
      category: "shift",
      role: "technician",
      period: "day",
      startTimeOverride: "12:00",
      endTimeOverride: null,
    });
  });

  it("7b. partial start-time shift with dash+space and no colon padding", () => {
    const event = parseEvent(rawAssignment("טכנאי יום מ- 12:00"));
    expect(event.startTimeOverride).toBe("12:00");
  });

  it("7c. partial start-time shift with plain space, no dash", () => {
    const event = parseEvent(rawAssignment("טכנאית יום מ 12"));
    expect(event).toMatchObject({ role: "technician", period: "day", startTimeOverride: "12:00" });
  });

  it("8. partial end-time shift", () => {
    const event = parseEvent(rawAssignment("טכנאי יום עד 12"));
    expect(event).toMatchObject({
      category: "shift",
      period: "day",
      startTimeOverride: null,
      endTimeOverride: "12:00",
    });
  });

  it("8b. partial end-time shift with colon", () => {
    const event = parseEvent(rawAssignment("טכנאי יום עד 12:00"));
    expect(event.endTimeOverride).toBe("12:00");
  });

  it("9. time format normalization (HH:mm passthrough vs. bare hour padding)", () => {
    expect(parseEvent(rawAssignment("טכנאית יום מ 12:30")).startTimeOverride).toBe("12:30");
    expect(parseEvent(rawAssignment("טכנאי יום מ-12")).startTimeOverride).toBe("12:00");
  });

  it("10. shadow shift", () => {
    const feminine = parseEvent(rawAssignment("טכנאית יום - צל"));
    expect(feminine).toMatchObject({ category: "shift", role: "technician", period: "day", shadow: true });

    const masculine = parseEvent(rawAssignment("טכנאי יום - צל"));
    expect(masculine).toMatchObject({ category: "shift", role: "technician", period: "day", shadow: true });
  });

  // Shadow ("צל") is a modifier of the underlying shift ROLE, never a
  // technician-specific concept -- `parseShift` derives `role` from
  // whichever leading token matched (`isShiftLeadRoleToken`/
  // `TECHNICIAN_TOKENS`) and `shadow` from the trailing `SHADOW_MODIFIER_RE`
  // completely independently of that role, so אחמ"ש must support the SAME
  // "- צל" modifier a technician shift does. These four cases are the full
  // role × period matrix the shadow modifier must generalize across.
  it('10b. אחמ"ש day shadow shift -- role stays "supervisor", never falls back to "technician"', () => {
    const event = parseEvent(rawAssignment('אחמ"ש יום - צל'));
    expect(event).toMatchObject({ category: "shift", role: "supervisor", period: "day", shadow: true });
    expect(event.role).not.toBe("technician");
  });

  it('10c. אחמ"ש night shadow shift -- role stays "supervisor", never falls back to "technician"', () => {
    const event = parseEvent(rawAssignment('אחמ"ש לילה - צל'));
    expect(event).toMatchObject({ category: "shift", role: "supervisor", period: "night", shadow: true });
    expect(event.role).not.toBe("technician");
  });

  it('10d. all four role×period shadow combinations stay distinct from one another', () => {
    const supervisorDay = parseEvent(rawAssignment('אחמ"ש יום - צל'));
    const supervisorNight = parseEvent(rawAssignment('אחמ"ש לילה - צל'));
    const technicianDay = parseEvent(rawAssignment("טכנאי יום - צל"));
    const technicianNight = parseEvent(rawAssignment("טכנאי לילה - צל"));

    expect(supervisorDay).toMatchObject({ role: "supervisor", period: "day", shadow: true });
    expect(supervisorNight).toMatchObject({ role: "supervisor", period: "night", shadow: true });
    expect(technicianDay).toMatchObject({ role: "technician", period: "day", shadow: true });
    expect(technicianNight).toMatchObject({ role: "technician", period: "night", shadow: true });

    const combos = [supervisorDay, supervisorNight, technicianDay, technicianNight].map(
      (event) => `${event.role}:${event.period}`,
    );
    expect(new Set(combos).size).toBe(4); // every combination is genuinely distinguishable
  });

  // Regression: a shift-lead role written in the FEMININE form (אחמשית /
  // אחמ"שית) was silently dropped -- classify() only ever recognized the
  // single masculine spelling 'אחמ"ש', so a feminine shift lead's Event
  // never got role: "supervisor" and she never showed up as a shift
  // companion. `isShiftLeadRoleToken` (lib/domain/shiftLeadRole.ts) is now
  // the ONE place that decides which spellings belong to this role family,
  // covering masculine/feminine, any quote-character variant or none, and
  // an optional hyphen in the quote's place.
  it('10e. feminine shift-lead form "אחמשית יום צל" (no hyphen before צל) is recognized exactly like the masculine form', () => {
    const event = parseEvent(rawAssignment("אחמשית יום צל"));
    expect(event).toMatchObject({ category: "shift", role: "supervisor", period: "day", shadow: true });
    expect(event.role).not.toBe("technician");
  });

  it.each([
    // masculine
    ['אחמ"ש', "unspecified", false],
    ["אחמש", "unspecified", false],
    ['אחמ"ש יום', "day", false],
    ["אחמש לילה", "night", false],
    ['אחמ"ש יום - צל', "day", true],
    ["אחמש לילה - צל", "night", true],
    ["אחמש יום צל", "day", true],
    // feminine
    ['אחמ"שית', "unspecified", false],
    ["אחמשית", "unspecified", false],
    ['אחמ"שית יום', "day", false],
    ["אחמשית לילה", "night", false],
    ['אחמ"שית יום - צל', "day", true],
    ["אחמשית לילה - צל", "night", true],
    ["אחמשית יום צל", "day", true],
    // alternate quote characters around the masculine/feminine forms
    ["אחמ״ש יום", "day", false],
    ["אחמ׳ש לילה", "night", false],
    ["אחמ״שית יום - צל", "day", true],
  ] as const)("10f. shift-lead variant '%s' -> role=supervisor, period=%s, shadow=%s", (cellText, expectedPeriod, expectedShadow) => {
    const event = parseEvent(rawAssignment(cellText));
    expect(event).toMatchObject({
      category: "shift",
      role: "supervisor",
      period: expectedPeriod,
      shadow: expectedShadow,
    });
  });

  it("10g. the ORIGINAL raw text is preserved untouched for display -- normalization is for classification only", () => {
    const event = parseEvent(rawAssignment("אחמשית   יום   צל"));
    expect(event.role).toBe("supervisor");
    expect(event.shadow).toBe(true);
    expect(event.rawValue).toBe("אחמשית   יום   צל");
  });

  it("10h. an unrelated word sharing the אחמ prefix is never misclassified as a shift-lead role", () => {
    const event = parseEvent(rawAssignment("אחמד"));
    expect(event.role).not.toBe("supervisor");
    expect(event.category).not.toBe("shift");
  });
});

describe("parseEvent — absence / constraint", () => {
  it("11. vacation", () => {
    const event = parseEvent(rawAssignment("חופש"));
    expect(event.category).toBe("absence");
    expect(event.absenceKind).toBe("vacation");
  });

  it("12. abroad absence", () => {
    const event = parseEvent(rawAssignment('חו"ל'));
    expect(event.category).toBe("absence");
    expect(event.absenceKind).toBe("abroad");
  });

  it("future-compatible absence labels without medical logic", () => {
    const medical = parseEvent(rawAssignment("גימלים"));
    expect(medical.category).toBe("absence");
    expect(medical.absenceKind).toBe("medical");

    const dayOff = parseEvent(rawAssignment("יום ד"));
    expect(dayOff.category).toBe("absence");
    expect(dayOff.absenceKind).toBe("day_off");
  });

  it("אפטר is represented as an absence-like event with its own distinct, non-blocking kind", () => {
    const event = parseEvent(rawAssignment("אפטר"));
    expect(event.category).toBe("absence");
    expect(event.absenceKind).toBe("after");
  });

  it("הפנייה is a real absence (referral), not 'other'", () => {
    const event = parseEvent(rawAssignment("הפנייה"));
    expect(event.category).toBe("absence");
    expect(event.absenceKind).toBe("referral");
  });

  it("הפניה (alternate spelling, missing the י) is ALSO recognized as referral", () => {
    const event = parseEvent(rawAssignment("הפניה"));
    expect(event.category).toBe("absence");
    expect(event.absenceKind).toBe("referral");
  });

  it("a tentative referral ('הפנייה?') is still classified as referral, just marked tentative", () => {
    const event = parseEvent(rawAssignment("הפנייה?"));
    expect(event.category).toBe("absence");
    expect(event.absenceKind).toBe("referral");
    expect(event.certainty).toBe("tentative");
  });

  it("referral recognition is an exact match only, never a fuzzy substring -- unrelated text containing similar letters stays 'other'", () => {
    const notReferral = parseEvent(rawAssignment("הפנייה למחלקה אחרת"));
    expect(notReferral.category).not.toBe("absence");
    expect(notReferral.absenceKind).toBeNull();

    const alsoNotReferral = parseEvent(rawAssignment("משהו הפנייה"));
    expect(alsoNotReferral.category).not.toBe("absence");
    expect(alsoNotReferral.absenceKind).toBeNull();
  });

  it("absenceKind is null for every non-absence category", () => {
    expect(parseEvent(rawAssignment('אחמ"ש יום')).absenceKind).toBeNull();
    expect(parseEvent(rawAssignment("אוקסיד")).absenceKind).toBeNull();
    expect(parseEvent(rawAssignment("סוגר")).absenceKind).toBeNull();
    expect(parseEvent(rawAssignment("ניקיון כללי")).absenceKind).toBeNull();
  });

  it("13. constraint: bare, day, night, morning", () => {
    expect(parseEvent(rawAssignment("אילוץ"))).toMatchObject({
      category: "constraint",
      period: "unspecified",
    });
    expect(parseEvent(rawAssignment("אילוץ יום"))).toMatchObject({
      category: "constraint",
      period: "day",
    });
    expect(parseEvent(rawAssignment("אילוץ לילה"))).toMatchObject({
      category: "constraint",
      period: "night",
    });
    expect(parseEvent(rawAssignment("אילוץ בוקר"))).toMatchObject({
      category: "constraint",
      period: "morning",
    });
  });
});

describe("parseEvent — duty", () => {
  it("14. guard slot extraction", () => {
    for (const slot of [1, 2, 3, 4]) {
      const event = parseEvent(rawAssignment(`שומר ${slot}`));
      expect(event).toMatchObject({ category: "duty", dutyFamily: "guard", slot });
    }
  });

  it("does not treat guard slots as separate duty families", () => {
    const families = [1, 2, 3, 4].map(
      (slot) => parseEvent(rawAssignment(`שומר ${slot}`)).dutyFamily,
    );
    expect(new Set(families)).toEqual(new Set(["guard"]));
  });

  it("15. reserve slot extraction", () => {
    expect(parseEvent(rawAssignment("עתודה 1"))).toMatchObject({
      category: "duty",
      dutyFamily: "reserve",
      slot: 1,
    });
    expect(parseEvent(rawAssignment("עתודה 2"))).toMatchObject({
      category: "duty",
      dutyFamily: "reserve",
      slot: 2,
    });
  });

  it("16. reserve spacing variant (no space before the number)", () => {
    const event = parseEvent(rawAssignment("עתודה2"));
    expect(event).toMatchObject({ category: "duty", dutyFamily: "reserve", slot: 2 });
  });

  it("17. evacuation on-call", () => {
    expect(parseEvent(rawAssignment("כונן פינויים"))).toMatchObject({
      category: "duty",
      dutyFamily: "evacuation_on_call",
    });
  });

  it("18. full kitchen", () => {
    expect(parseEvent(rawAssignment("מטבח מלא"))).toMatchObject({
      category: "duty",
      dutyFamily: "full_kitchen",
    });
  });

  it("19. daily kitchen", () => {
    expect(parseEvent(rawAssignment("מטבח יומי"))).toMatchObject({
      category: "duty",
      dutyFamily: "daily_kitchen",
    });
  });

  it("20. weekend kitchen", () => {
    expect(parseEvent(rawAssignment('סופ"ש מטבח'))).toMatchObject({
      category: "duty",
      dutyFamily: "weekend_kitchen",
    });
  });

  it("21. rasar (both observed spellings)", () => {
    expect(parseEvent(rawAssignment('רס"ר'))).toMatchObject({ category: "duty", dutyFamily: "rasar" });
    expect(parseEvent(rawAssignment('ררס"ר'))).toMatchObject({ category: "duty", dutyFamily: "rasar" });
  });

  it("22. oxid", () => {
    expect(parseEvent(rawAssignment("אוקסיד"))).toMatchObject({ category: "duty", dutyFamily: "oxid" });
  });

  it("callup duty family", () => {
    expect(parseEvent(rawAssignment('הקפצה - רס"ר'))).toMatchObject({
      category: "duty",
      dutyFamily: "callup",
    });
    expect(parseEvent(rawAssignment("הקפצת פסח"))).toMatchObject({
      category: "duty",
      dutyFamily: "callup",
    });
  });
});

describe("parseEvent — status / context", () => {
  it("23. closing status (additive, not an exclusive duty)", () => {
    const event = parseEvent(rawAssignment("סוגר"));
    expect(event.category).toBe("status");
    expect(event.category).not.toBe("duty");
  });

  it("24. spacing status (ריווח with extra internal whitespace, with and without a number)", () => {
    expect(parseEvent(rawAssignment("ריווח")).category).toBe("status");
    expect(parseEvent(rawAssignment("ריווח  1")).category).toBe("status");
    const withSlot = parseEvent(rawAssignment("ריווח  1"));
    expect(withSlot.category).not.toBe("duty");
  });

  it("25. emergency/context event", () => {
    const event = parseEvent(rawAssignment("מלחמה"));
    expect(event.category).toBe("context");
    expect(event.category).not.toBe("shift");
    expect(event.category).not.toBe("duty");
    expect(event.category).not.toBe("absence");
  });
});

describe("parseEvent — tentative marker", () => {
  it("26. tentative course (unrecognized free text stays 'other')", () => {
    const event = parseEvent(rawAssignment("קורס?"));
    expect(event.certainty).toBe("tentative");
    expect(event.category).toBe("other");
    expect(event.title).toBe("קורס");
  });

  it("27. tentative vacation — whitespace before '?' must not matter", () => {
    const event = parseEvent(rawAssignment("חופש ?"));
    expect(event.certainty).toBe("tentative");
    expect(event.category).toBe("absence");
  });

  it("28. tentative guard", () => {
    const event = parseEvent(rawAssignment("שומר 4 ?"));
    expect(event.certainty).toBe("tentative");
    expect(event).toMatchObject({ category: "duty", dutyFamily: "guard", slot: 4 });
  });

  it("29. only '?' is unknown + tentative", () => {
    const event = parseEvent(rawAssignment("?"));
    expect(event.category).toBe("unknown");
    expect(event.certainty).toBe("tentative");
  });

  it("never rewrites rawValue when stripping the tentative marker", () => {
    const event = parseEvent(rawAssignment("שומר 4 ?"));
    expect(event.rawValue).toBe("שומר 4 ?");
  });
});

describe("parseEvent — change note priority", () => {
  it("30. change-note priority over a known duty name", () => {
    const oxidNote = parseEvent(rawAssignment('אוקסיד - הוחלף עם Test User'));
    expect(oxidNote.category).toBe("change_note");
    expect(oxidNote.category).not.toBe("duty");
    expect(oxidNote.changeNote).toBe('אוקסיד - הוחלף עם Test User');

    const kitchenNote = parseEvent(rawAssignment("מטבח מלא - הוחלף ל- Test User"));
    expect(kitchenNote.category).toBe("change_note");

    const guardNote = parseEvent(rawAssignment("שומר 2 - הוחלף"));
    expect(guardNote.category).toBe("change_note");
    expect(guardNote.dutyFamily).toBeNull();
    expect(guardNote.slot).toBeNull();
  });
});

describe("parseEvent — unknown / free text", () => {
  it("31. arbitrary free text survives untouched as 'other'", () => {
    const event = parseEvent(rawAssignment("ניקיון כללי"));
    expect(event.category).toBe("other");
    expect(event.title).toBe("ניקיון כללי");
  });

  it("unrecognized text never throws", () => {
    expect(() => parseEvent(rawAssignment("🎉 יום הולדת למישהו 🎂"))).not.toThrow();
  });
});

describe("parseEvent — rawValue / passthrough guarantees", () => {
  it("32. rawValue including trailing spaces is preserved exactly", () => {
    const event = parseEvent(rawAssignment("בוקר  "));
    expect(event.rawValue).toBe("בוקר  ");
    expect(event.title).toBe("בוקר");
  });

  it("33. sourceSheet/sourceCell pass through unchanged", () => {
    const event = parseEvent(
      rawAssignment("חופש", { sourceSheet: "משמרות + תורנויות", sourceCell: "F17" }),
    );
    expect(event.sourceSheet).toBe("משמרות + תורנויות");
    expect(event.sourceCell).toBe("F17");
  });

  it("34. two RawAssignments for the same person/date produce two independent Events", () => {
    const first = rawAssignment("בוקר", { sourceCell: "C2" });
    const second = rawAssignment("משימה נוספת", { sourceCell: "D2" });

    const firstEvent = parseEvent(first);
    const secondEvent = parseEvent(second);

    expect(firstEvent).not.toBe(secondEvent);
    expect(firstEvent.personId).toBe(secondEvent.personId);
    expect(firstEvent.date).toBe(secondEvent.date);
    expect(firstEvent.rawValue).toBe("בוקר");
    expect(secondEvent.rawValue).toBe("משימה נוספת");
    expect(firstEvent.sourceCell).toBe("C2");
    expect(secondEvent.sourceCell).toBe("D2");
  });
});
