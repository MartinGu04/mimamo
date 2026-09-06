import { describe, expect, it } from "vitest";
import {
  buildReportOneDraft,
  classifyReportOneSection,
  reportOnePersonHasMeaningfulTomorrowEvent,
  resolveReportOneTargetDate,
  resolveRegularOrReserveStatus,
  UNKNOWN_REPORT_ONE_STATUS,
} from "./reportOne";
import type { Event } from "./event";
import type { LocalNow } from "./localNow";
import type { Person } from "./types";

let cellCounter = 0;
function nextCell(): string {
  cellCounter += 1;
  return `C${cellCounter}`;
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "p_test",
    name: "דני בדיקה",
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

function shiftEvent(role: "supervisor" | "technician", period: "day" | "night", overrides: Partial<Event> = {}): Event {
  return event({ category: "shift", role, period, ...overrides });
}

function absenceEvent(absenceKind: NonNullable<Event["absenceKind"]>, overrides: Partial<Event> = {}): Event {
  return event({ category: "absence", role: null, period: "unspecified", absenceKind, ...overrides });
}

function dutyEvent(dutyFamily: NonNullable<Event["dutyFamily"]>, overrides: Partial<Event> = {}): Event {
  return event({ category: "duty", role: null, period: "unspecified", dutyFamily, slot: null, ...overrides });
}

/** A category "other" event carrying `title`, matching how `parseEvent` classifies unrecognized schedule-cell text like "משיכות"/"הסמכה" (see `lib/notifications/engine/logisticsWithdrawal.ts`'s own docs). */
function otherEvent(title: string, overrides: Partial<Event> = {}): Event {
  return event({ category: "other", role: null, period: "unspecified", title, ...overrides });
}

// --- 1-3. Tomorrow calculation --------------------------------------------

describe("resolveReportOneTargetDate", () => {
  it("1. an ordinary day: tomorrow is the next calendar date", () => {
    const now: LocalNow = { date: "2026-08-25", minuteOfDay: 600 };
    expect(resolveReportOneTargetDate(now)).toBe("2026-08-26");
  });

  it("2. month boundary: 31.8 -> 1.9", () => {
    const now: LocalNow = { date: "2026-08-31", minuteOfDay: 0 };
    expect(resolveReportOneTargetDate(now)).toBe("2026-09-01");
  });

  it("3. year boundary: 31.12 -> 1.1 of the next year", () => {
    const now: LocalNow = { date: "2026-12-31", minuteOfDay: 1439 };
    expect(resolveReportOneTargetDate(now)).toBe("2027-01-01");
  });
});

// --- 4-7. Section classification + exclusions -----------------------------

describe("classifyReportOneSection", () => {
  it("permanent (קבע) -> 'permanent'", () => {
    expect(classifyReportOneSection(person({ personnelType: "קבע" }))).toBe("permanent");
  });

  it("reserve (מילואים) -> 'reserve'", () => {
    expect(classifyReportOneSection(person({ personnelType: "מילואים" }))).toBe("reserve");
  });

  it("regular (חובה) + supervisor -> 'regular_manager'", () => {
    expect(classifyReportOneSection(person({ personnelType: "חובה", isSupervisor: true }))).toBe("regular_manager");
  });

  it("regular (חובה) + technician -> 'regular_technician'", () => {
    expect(classifyReportOneSection(person({ personnelType: "חובה", isTechnician: true }))).toBe("regular_technician");
  });

  it("regular (חובה) + neither supervisor nor technician -> no section", () => {
    expect(classifyReportOneSection(person({ personnelType: "חובה" }))).toBeNull();
  });

  it("unclassified -> no section", () => {
    expect(classifyReportOneSection(person({ personnelType: null }))).toBeNull();
  });
});

describe("buildReportOneDraft — permanent exclusions (5, 6, 7)", () => {
  const targetDate = "2026-08-26";
  const prevDate = "2026-08-25";

  it("5. דימה מירו is excluded", () => {
    const people = [person({ id: "p_dima", name: "דימה מירו", personnelType: "קבע" })];
    const draft = buildReportOneDraft({ people, events: [], targetDate, prevDate });
    expect(draft.sections.flatMap((s) => s.people).map((p) => p.name)).not.toContain("דימה מירו");
  });

  it("6. מרטין בדיקות is excluded", () => {
    const people = [person({ id: "p_martin", name: "מרטין בדיקות", personnelType: "קבע" })];
    const draft = buildReportOneDraft({ people, events: [], targetDate, prevDate });
    expect(draft.sections.flatMap((s) => s.people).map((p) => p.name)).not.toContain("מרטין בדיקות");
  });

  it("7. נדב וקנין is excluded", () => {
    const people = [person({ id: "p_nadav", name: "נדב וקנין", personnelType: "מילואים" })];
    const draft = buildReportOneDraft({ people, events: [], targetDate, prevDate });
    expect(draft.sections.flatMap((s) => s.people).map((p) => p.name)).not.toContain("נדב וקנין");
  });
});

// --- Permanent staff default to "?" -----------------------------------------

describe("buildReportOneDraft — permanent staff", () => {
  it("4. permanent staff always default to '?', never נוכח, regardless of schedule data", () => {
    const people = [person({ id: "p_perm", name: "עמנואל צגה", personnelType: "קבע" })];
    const events = [shiftEvent("supervisor", "day", { personId: "p_perm", date: "2026-08-26" })];
    const draft = buildReportOneDraft({ people, events, targetDate: "2026-08-26", prevDate: "2026-08-25" });
    const permanentGroup = draft.sections.find((s) => s.section === "permanent")!;
    expect(permanentGroup.people).toEqual([
      { personId: "p_perm", name: "עמנואל צגה", section: "permanent", generatedStatus: UNKNOWN_REPORT_ONE_STATUS },
    ]);
  });
});

// --- 8-15. resolveRegularOrReserveStatus wording ---------------------------

describe("resolveRegularOrReserveStatus", () => {
  it("8. אחמ\"ש day shift", () => {
    expect(resolveRegularOrReserveStatus([shiftEvent("supervisor", "day")], [])).toBe('נוכח, אחמ"ש יום');
  });

  it("9. אחמ\"ש night shift", () => {
    expect(resolveRegularOrReserveStatus([shiftEvent("supervisor", "night")], [])).toBe('נוכח, אחמ"ש לילה');
  });

  it("10. technician day shift", () => {
    expect(resolveRegularOrReserveStatus([shiftEvent("technician", "day")], [])).toBe("נוכח, טכנאי יום");
  });

  it("11. technician night shift", () => {
    expect(resolveRegularOrReserveStatus([shiftEvent("technician", "night")], [])).toBe("נוכח, טכנאי לילה");
  });

  // --- Shadow ("צל") is a role-independent modifier -- see event.ts's own
  // `shadow: boolean` field docs. `shiftStatusWording` derives wording from
  // `event.role`/`event.period` ONLY (never `event.shadow`), so a shadow
  // shift's wording must be IDENTICAL to its non-shadow counterpart --
  // never silently reclassified to a different role. The report (spec:
  // shadow support must generalize to אחמ"ש, not stay technician-only)
  // asks specifically that אחמ"ש יום -- shadow or not -- can never render
  // as טכנאי יום; these four combinations plus the explicit negative
  // assertion below are that regression guard.
  it('11b. אחמ"ש day shadow shift resolves to the SAME wording as a non-shadow אחמ"ש day shift -- never טכנאי', () => {
    const status = resolveRegularOrReserveStatus([shiftEvent("supervisor", "day", { shadow: true })], []);
    expect(status).toBe('נוכח, אחמ"ש יום');
    expect(status).not.toContain("טכנאי");
  });

  it('11c. אחמ"ש night shadow shift resolves to the SAME wording as a non-shadow אחמ"ש night shift -- never טכנאי', () => {
    const status = resolveRegularOrReserveStatus([shiftEvent("supervisor", "night", { shadow: true })], []);
    expect(status).toBe('נוכח, אחמ"ש לילה');
    expect(status).not.toContain("טכנאי");
  });

  it("11d. technician day shadow shift resolves to the SAME wording as a non-shadow technician day shift", () => {
    const status = resolveRegularOrReserveStatus([shiftEvent("technician", "day", { shadow: true })], []);
    expect(status).toBe("נוכח, טכנאי יום");
  });

  it("11e. technician night shadow shift resolves to the SAME wording as a non-shadow technician night shift", () => {
    const status = resolveRegularOrReserveStatus([shiftEvent("technician", "night", { shadow: true })], []);
    expect(status).toBe("נוכח, טכנאי לילה");
  });

  it("12. vacation", () => {
    expect(resolveRegularOrReserveStatus([absenceEvent("vacation")], [])).toBe("חופש");
  });

  it("13. referral", () => {
    expect(resolveRegularOrReserveStatus([absenceEvent("referral")], [])).toBe("הפנייה");
  });

  it("14. admin/errand day (day_off)", () => {
    expect(resolveRegularOrReserveStatus([absenceEvent("day_off")], [])).toBe("יום סידורים");
  });

  it("15. after-night: a night shift on the previous day, nothing today -> 'נוכח, אחרי לילה'", () => {
    const prevDay = [shiftEvent("technician", "night", { date: "2026-08-25" })];
    expect(resolveRegularOrReserveStatus([], prevDay)).toBe("נוכח, אחרי לילה");
  });

  it("15b. an explicit 'אפטר' marker alone also resolves to after-night", () => {
    expect(resolveRegularOrReserveStatus([absenceEvent("after")], [])).toBe("נוכח, אחרי לילה");
  });

  it("18. no data at all -> '?'", () => {
    expect(resolveRegularOrReserveStatus([], [])).toBe(UNKNOWN_REPORT_ONE_STATUS);
  });

  it("20. existing conflict resolution respected: a blocking absence + an assignment on the same day never resolves to either -- falls back to '?'", () => {
    const events = [absenceEvent("vacation"), shiftEvent("technician", "day")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe(UNKNOWN_REPORT_ONE_STATUS);
  });

  it("a referral + an assignment on the same day is also an unresolved conflict", () => {
    const events = [absenceEvent("referral"), shiftEvent("supervisor", "night")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe(UNKNOWN_REPORT_ONE_STATUS);
  });

  it("two conflicting shift events on the same day never guess -- '?'", () => {
    const events = [shiftEvent("supervisor", "day"), shiftEvent("technician", "night")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe(UNKNOWN_REPORT_ONE_STATUS);
  });
});

// --- Additive duty statuses: layered onto the primary status, never dropped --

describe("resolveRegularOrReserveStatus — additive duty statuses (the Martin bug + full audit)", () => {
  it("the reported bug: after-night + כונן פינויים -> 'נוכח, אחרי לילה, כונן פינויים', never dropped", () => {
    const prevDay = [shiftEvent("technician", "night", { date: "2026-08-25" })];
    const today = [dutyEvent("evacuation_on_call")];
    expect(resolveRegularOrReserveStatus(today, prevDay)).toBe("נוכח, אחרי לילה, כונן פינויים");
  });

  it("day shift + duty combines: 'נוכח, אחמ\"ש יום, כונן פינויים'", () => {
    const events = [shiftEvent("supervisor", "day"), dutyEvent("evacuation_on_call")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('נוכח, אחמ"ש יום, כונן פינויים');
  });

  it("night shift + guard duty with a slot appends 'שמירה 2'", () => {
    const events = [shiftEvent("technician", "night"), dutyEvent("guard", { slot: 2 })];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, טכנאי לילה, שמירה 2");
  });

  it("referral + duty is NOT treated as a conflict (unlike referral + shift) -- combines instead of dropping the duty", () => {
    const events = [absenceEvent("referral"), dutyEvent("rasar")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('הפנייה, רס"ר');
  });

  it("multiple additive duties the same day all appear, in stable canonical order regardless of input order", () => {
    const events = [
      shiftEvent("supervisor", "day"),
      dutyEvent("oxid"),
      dutyEvent("guard", { slot: 1 }),
      dutyEvent("evacuation_on_call"),
    ];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('נוכח, אחמ"ש יום, שמירה 1, כונן פינויים, אוקסיד');
  });

  it("duty-only, no other data -> the unresolved primary '?' still carries the duty fact: '?, כונן פינויים'", () => {
    const events = [dutyEvent("evacuation_on_call")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("?, כונן פינויים");
  });

  it("every DutyFamily produces its own distinct additive wording", () => {
    const cases: Array<[NonNullable<Event["dutyFamily"]>, string]> = [
      ["guard", "שמירה"],
      ["reserve", "עתודה"],
      ["evacuation_on_call", "כונן פינויים"],
      ["full_kitchen", "מטבח מלא"],
      ["daily_kitchen", "מטבח יומי"],
      ["weekend_kitchen", 'מטבח סופ"ש'],
      ["rasar", 'רס"ר'],
      ["oxid", "אוקסיד"],
      ["callup", "הקפצה"],
    ];
    for (const [dutyFamily, wording] of cases) {
      const events = [shiftEvent("technician", "day"), dutyEvent(dutyFamily)];
      expect(resolveRegularOrReserveStatus(events, [])).toBe(`נוכח, טכנאי יום, ${wording}`);
    }
  });

  it("a blocking absence (vacation) + duty is STILL a genuine unresolved conflict -- bare '?', no duty appended (matches detectBlockingAbsenceIssues, which treats duty as a conflicting assignment too)", () => {
    const events = [absenceEvent("vacation"), dutyEvent("evacuation_on_call")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe(UNKNOWN_REPORT_ONE_STATUS);
  });

  it("duplicate identical duty events the same day are not doubled in the appended text", () => {
    const events = [shiftEvent("technician", "day"), dutyEvent("evacuation_on_call"), dutyEvent("evacuation_on_call")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, טכנאי יום, כונן פינויים");
  });
});

// --- Presence-implying duties: a bare "?" primary is synthesized to "נוכח" --

describe("resolveRegularOrReserveStatus — presence-implying duties synthesize 'נוכח' when there is no other primary", () => {
  it("1. guard-only -> 'נוכח, שמירה 1'", () => {
    const events = [dutyEvent("guard", { slot: 1 })];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, שמירה 1");
  });

  it("2. kitchen-only (daily_kitchen) -> 'נוכח, מטבח יומי'", () => {
    const events = [dutyEvent("daily_kitchen")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, מטבח יומי");
  });

  it("2b. kitchen-only (full_kitchen) -> 'נוכח, מטבח מלא'", () => {
    const events = [dutyEvent("full_kitchen")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, מטבח מלא");
  });

  it("2c. kitchen-only (weekend_kitchen) -> 'נוכח, מטבח סופ\"ש'", () => {
    const events = [dutyEvent("weekend_kitchen")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('נוכח, מטבח סופ"ש');
  });

  it('3. rasar-only -> \'נוכח, רס"ר\'', () => {
    const events = [dutyEvent("rasar")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('נוכח, רס"ר');
  });

  it("4. a non-presence-implying duty alone (כונן פינויים) stays '?, ...' -- never synthesized", () => {
    const events = [dutyEvent("evacuation_on_call")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("?, כונן פינויים");
  });

  it("4b. another non-presence-implying duty alone (עתודה) also stays '?, ...'", () => {
    const events = [dutyEvent("reserve", { slot: 1 })];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("?, עתודה 1");
  });

  it("4c. an ambiguous-family duty (אוקסיד) also stays '?, ...' -- never guessed presence-implying", () => {
    const events = [dutyEvent("oxid")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("?, אוקסיד");
  });

  it("5. an existing real primary (day shift) is kept as-is, with the presence-implying duty simply appended -- never overwritten by synthesis", () => {
    const events = [shiftEvent("technician", "day"), dutyEvent("rasar")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('נוכח, טכנאי יום, רס"ר');
  });

  it("5b. after-night carryover + a presence-implying duty also keeps the real primary, duty simply appended", () => {
    const prevDay = [shiftEvent("technician", "night", { date: "2026-08-25" })];
    const today = [dutyEvent("guard", { slot: 3 })];
    expect(resolveRegularOrReserveStatus(today, prevDay)).toBe("נוכח, אחרי לילה, שמירה 3");
  });

  it("6. a blocking absence (vacation) + a presence-implying duty (guard) is STILL a genuine unresolved conflict -- bare '?', never synthesized to 'נוכח'", () => {
    const events = [absenceEvent("vacation"), dutyEvent("guard", { slot: 1 })];
    expect(resolveRegularOrReserveStatus(events, [])).toBe(UNKNOWN_REPORT_ONE_STATUS);
  });

  it("6b. an ambiguous shift-wording conflict (two different shifts same day) + a presence-implying duty also stays a bare '?' primary -- the shift conflict is never silently resolved by the duty", () => {
    const events = [shiftEvent("supervisor", "day"), shiftEvent("technician", "night"), dutyEvent("rasar")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('?, רס"ר');
  });

  it("6c. a referral + shift conflict + a presence-implying duty also stays a bare '?' primary", () => {
    const events = [absenceEvent("referral"), shiftEvent("supervisor", "night"), dutyEvent("rasar")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('?, רס"ר');
  });

  it("7. multiple presence-implying duties with no other primary -> exactly one synthesized 'נוכח', all duties appended in stable canonical order", () => {
    const events = [dutyEvent("rasar"), dutyEvent("guard", { slot: 2 }), dutyEvent("daily_kitchen")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('נוכח, שמירה 2, מטבח יומי, רס"ר');
  });

  it("a mix of a presence-implying duty and a non-presence-implying duty, no other primary -> still synthesizes 'נוכח' (at least one presence-implying duty is enough)", () => {
    const events = [dutyEvent("evacuation_on_call"), dutyEvent("guard", { slot: 1 })];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, שמירה 1, כונן פינויים");
  });
});

// --- משיכות / הסמכה: category "other" activities with no dedicated DutyFamily,
// but which are physically on-site work like guard/kitchen/rasar duty --------

describe("resolveRegularOrReserveStatus — משיכות/הסמכה (category 'other' presence-implying activities)", () => {
  it("1. משיכות alone -> 'נוכח, משיכות'", () => {
    const events = [otherEvent("משיכות")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, משיכות");
  });

  it("1b. the full phrase 'משיכות מהלוגיסטיקה' alone also synthesizes 'נוכח, משיכות'", () => {
    const events = [otherEvent("משיכות מהלוגיסטיקה")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, משיכות");
  });

  it("2. הסמכה alone -> 'נוכח, הסמכה'", () => {
    const events = [otherEvent("הסמכה")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, הסמכה");
  });

  it("3. both on the same day -> 'נוכח, הסמכה + משיכות' (one combined entry, never two comma-separated ones)", () => {
    const events = [otherEvent("הסמכה"), otherEvent("משיכות")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, הסמכה + משיכות");
  });

  it("3b. combined wording is the same regardless of the source events' own order", () => {
    const events = [otherEvent("משיכות"), otherEvent("הסמכה")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, הסמכה + משיכות");
  });

  it("4. an existing shift primary is preserved, with משיכות simply appended", () => {
    const events = [shiftEvent("supervisor", "day"), otherEvent("משיכות")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('נוכח, אחמ"ש יום, משיכות');
  });

  it("4b. an existing shift primary is preserved, with הסמכה simply appended", () => {
    const events = [shiftEvent("technician", "night"), otherEvent("הסמכה")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, טכנאי לילה, הסמכה");
  });

  it("5. multiple additive activities (a duty family plus משיכות/הסמכה) never collapse to '?' -- everything appends, in a stable order", () => {
    const events = [
      shiftEvent("supervisor", "day"),
      dutyEvent("evacuation_on_call"),
      otherEvent("משיכות"),
      otherEvent("הסמכה"),
    ];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('נוכח, אחמ"ש יום, כונן פינויים, הסמכה + משיכות');
  });

  it("5b. משיכות/הסמכה with no shift and no other primary still synthesize exactly one 'נוכח', never '?'", () => {
    const events = [otherEvent("הסמכה"), otherEvent("משיכות"), dutyEvent("rasar")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe('נוכח, רס"ר, הסמכה + משיכות');
  });

  it("6. a genuine absence/presence conflict (vacation + a real shift/duty assignment) still follows the existing conflict policy -- bare '?', unaffected by an unrelated משיכות/הסמכה event elsewhere in the audit", () => {
    const events = [absenceEvent("vacation"), dutyEvent("guard", { slot: 1 })];
    expect(resolveRegularOrReserveStatus(events, [])).toBe(UNKNOWN_REPORT_ONE_STATUS);
  });

  it("6b. a category 'other' event never itself counts as the conflicting assignment for a blocking absence -- vacation + משיכות alone is not the same structural conflict as vacation + a real shift/duty", () => {
    const events = [absenceEvent("vacation"), otherEvent("משיכות")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("חופש, משיכות");
  });

  it("unrelated 'other'-category text is still never surfaced -- only the משיכות/הסמכה keywords are exceptions", () => {
    const events = [otherEvent("הערה כללית")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe(UNKNOWN_REPORT_ONE_STATUS);
  });

  it("duplicate משיכות events the same day are not doubled in the appended text", () => {
    const events = [shiftEvent("technician", "day"), otherEvent("משיכות"), otherEvent("משיכות מהלוגיסטיקה")];
    expect(resolveRegularOrReserveStatus(events, [])).toBe("נוכח, טכנאי יום, משיכות");
  });
});

// --- 16-17. Reserve personnel ------------------------------------------------

describe("buildReportOneDraft — reserve personnel (16, 17)", () => {
  it("16. reserve personnel with a resolvable assignment reuses the SAME wording as סדיר", () => {
    const people = [person({ id: "p_res", name: "רועי לוין", personnelType: "מילואים", isSupervisor: true })];
    const events = [shiftEvent("supervisor", "night", { personId: "p_res", date: "2026-08-26" })];
    const draft = buildReportOneDraft({ people, events, targetDate: "2026-08-26", prevDate: "2026-08-25" });
    const reserveGroup = draft.sections.find((s) => s.section === "reserve")!;
    expect(reserveGroup.people[0].generatedStatus).toBe('נוכח, אחמ"ש לילה');
  });

  it("17. reserve personnel with no authoritative status falls back to '?'", () => {
    const people = [person({ id: "p_res2", name: "אלמוני מילואים", personnelType: "מילואים" })];
    const draft = buildReportOneDraft({ people, events: [], targetDate: "2026-08-26", prevDate: "2026-08-25" });
    const reserveGroup = draft.sections.find((s) => s.section === "reserve")!;
    expect(reserveGroup.people[0].generatedStatus).toBe(UNKNOWN_REPORT_ONE_STATUS);
  });
});

// --- 19. A person cannot appear in multiple sections ------------------------

describe("buildReportOneDraft — structural invariants (19, 21)", () => {
  it("19. every person appears in exactly one section", () => {
    const people = [
      person({ id: "p_perm", name: "עמנואל צגה", personnelType: "קבע" }),
      person({ id: "p_res", name: "רועי לוין", personnelType: "מילואים" }),
      person({ id: "p_sup", name: "עילאי שפירא", personnelType: "חובה", isSupervisor: true }),
      person({ id: "p_tech", name: "איתי אוליר", personnelType: "חובה", isTechnician: true }),
    ];
    const draft = buildReportOneDraft({ people, events: [], targetDate: "2026-08-26", prevDate: "2026-08-25" });

    const allIds = draft.sections.flatMap((section) => section.people.map((p) => p.personId));
    expect(allIds).toHaveLength(4);
    expect(new Set(allIds).size).toBe(4);
  });

  it("21. personnel ordering remains stable -- never reordered alphabetically or by status", () => {
    const people = [
      person({ id: "p_c", name: "גדעון פולין", personnelType: "חובה", isTechnician: true }),
      person({ id: "p_a", name: "איתי אוליר", personnelType: "חובה", isTechnician: true }),
      person({ id: "p_b", name: "בן בדיקה", personnelType: "חובה", isTechnician: true }),
    ];
    const draft = buildReportOneDraft({ people, events: [], targetDate: "2026-08-26", prevDate: "2026-08-25" });
    const technicians = draft.sections.find((s) => s.section === "regular_technician")!;
    expect(technicians.people.map((p) => p.name)).toEqual(["גדעון פולין", "איתי אוליר", "בן בדיקה"]);
  });

  it("section ordering is always אנשי קבע -> מילואים -> אחמשים -> טכנאים, even if empty", () => {
    const draft = buildReportOneDraft({ people: [], events: [], targetDate: "2026-08-26", prevDate: "2026-08-25" });
    expect(draft.sections.map((s) => s.section)).toEqual(["permanent", "reserve", "regular_manager", "regular_technician"]);
  });

  it("17. existing hard exclusions (דימה מירו/מרטין בדיקות/נדב וקנין) never appear in any section, regardless of personnelType or events -- the reserve-inclusion feature never touches this", () => {
    const people = [
      person({ id: "p_dima", name: "דימה מירו", personnelType: "מילואים" }),
      person({ id: "p_martin", name: "מרטין בדיקות", personnelType: "מילואים" }),
      person({ id: "p_nadav2", name: "נדב וקנין", personnelType: "מילואים" }),
    ];
    const events = people.map((p) => shiftEvent("technician", "day", { personId: p.id, date: "2026-08-26" }));
    const draft = buildReportOneDraft({ people, events, targetDate: "2026-08-26", prevDate: "2026-08-25" });
    const allNames = draft.sections.flatMap((s) => s.people).map((p) => p.name);
    expect(allNames).not.toContain("דימה מירו");
    expect(allNames).not.toContain("מרטין בדיקות");
    expect(allNames).not.toContain("נדב וקנין");
  });

  it(
    "regression: a shift manager shadowing (אחמ\"ש יום - צל) alongside a real technician on the SAME day never renders as " +
      "two טכנאי יום lines -- the shadow assignment's own status must stay אחמ\"ש",
    () => {
      const manager = person({ id: "p_mgr", name: "עילאי שפירא", personnelType: "חובה", isSupervisor: true });
      const technician = person({ id: "p_tech", name: "איתי אוליר", personnelType: "חובה", isTechnician: true });
      const events = [
        shiftEvent("supervisor", "day", { personId: manager.id, date: "2026-08-26", shadow: true }),
        shiftEvent("technician", "day", { personId: technician.id, date: "2026-08-26" }),
      ];
      const draft = buildReportOneDraft({ people: [manager, technician], events, targetDate: "2026-08-26", prevDate: "2026-08-25" });

      const managerSection = draft.sections.find((section) => section.section === "regular_manager")!;
      const technicianSection = draft.sections.find((section) => section.section === "regular_technician")!;

      expect(managerSection.people).toHaveLength(1);
      expect(managerSection.people[0].generatedStatus).toBe('נוכח, אחמ"ש יום');

      expect(technicianSection.people).toHaveLength(1);
      expect(technicianSection.people[0].generatedStatus).toBe("נוכח, טכנאי יום");

      // Exactly one טכנאי יום line in the whole draft -- the shift manager's
      // shadow assignment must never contribute a second one.
      const allStatuses = draft.sections.flatMap((section) => section.people).map((p) => p.generatedStatus);
      expect(allStatuses.filter((status) => status === "נוכח, טכנאי יום")).toHaveLength(1);
    },
  );
});

// --- reportOnePersonHasMeaningfulTomorrowEvent (reserve-inclusion warning/confirm gate) --

describe("reportOnePersonHasMeaningfulTomorrowEvent", () => {
  it("no data at all ('?') -> not meaningful", () => {
    expect(reportOnePersonHasMeaningfulTomorrowEvent({ generatedStatus: UNKNOWN_REPORT_ONE_STATUS })).toBe(false);
  });

  it("a day shift status -> meaningful", () => {
    expect(reportOnePersonHasMeaningfulTomorrowEvent({ generatedStatus: 'נוכח, אחמ"ש יום' })).toBe(true);
  });

  it("a night shift status -> meaningful", () => {
    expect(reportOnePersonHasMeaningfulTomorrowEvent({ generatedStatus: "נוכח, טכנאי לילה" })).toBe(true);
  });

  it("a blocking absence status (e.g. חופש) -> meaningful", () => {
    expect(reportOnePersonHasMeaningfulTomorrowEvent({ generatedStatus: "חופש" })).toBe(true);
  });

  it("an additive-duty-only status ('?, כונן פינויים') -> meaningful, even though the primary itself is unresolved", () => {
    expect(reportOnePersonHasMeaningfulTomorrowEvent({ generatedStatus: "?, כונן פינויים" })).toBe(true);
  });

  it("after-night carryover -> meaningful", () => {
    expect(reportOnePersonHasMeaningfulTomorrowEvent({ generatedStatus: "נוכח, אחרי לילה" })).toBe(true);
  });
});
