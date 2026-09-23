import { describe, expect, it } from "vitest";
import type { Event } from "@/lib/domain/event";
import type { OperationalWeek } from "@/lib/domain/operationalWeek";
import type { Person } from "@/lib/domain/types";
import { parseEvent } from "@/lib/parsers/event";
import type { RawAssignment } from "@/lib/parsers/types";
import { buildScheduleTeamWeekView } from "./buildScheduleTeamWeekView";

const WEEK: OperationalWeek = {
  weekStart: "2026-08-09",
  weekEnd: "2026-08-15",
  dates: ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"],
};

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "p_x",
    name: "שם",
    email: "someone@example.invalid",
    isManager: false,
    isTechnician: false,
    isSupervisor: false,
    personnelType: "חובה", // regular -- the common case for this suite's shift-capable fixtures
    dischargeDate: null,
    enlistmentDate: null,
    ...overrides,
  };
}

function event(overrides: Partial<Event> = {}): Event {
  return {
    personId: "p_daniel",
    personName: "דניאל כהן",
    date: "2026-08-11",
    title: "טכנאי יום",
    rawValue: "טכנאי יום",
    category: "shift",
    certainty: "confirmed",
    role: "technician",
    period: "day",
    sourceSheet: "משמרות + תורנויות",
    sourceCell: "C7",
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

const EITAN = person({ id: "p_eitan", name: "איתן דוגמה", isSupervisor: true });
const DANIEL = person({ id: "p_daniel", name: "דניאל כהן", isTechnician: true });
const NOA = person({ id: "p_noa", name: "נועה דוגמה", isTechnician: true });
const MANAGER = person({ id: "p_manager", name: "מנהל", isManager: true }); // neither supervisor nor technician

describe("buildScheduleTeamWeekView — roster membership (5, permanent/unrelated exclusion)", () => {
  it("only includes shift-capable people (isSupervisor || isTechnician) -- never a permanent/unrelated person with neither flag", () => {
    const view = buildScheduleTeamWeekView([], [EITAN, DANIEL, MANAGER], WEEK);
    expect(view.people.map((p) => p.id)).toEqual(["p_eitan", "p_daniel"]);
    expect(view.people.map((p) => p.id)).not.toContain(MANAGER.id);
  });

  it("5. groups supervisors before technicians, regardless of roster interleaving", () => {
    const interleaved = [DANIEL, EITAN, NOA]; // technician, supervisor, technician
    const view = buildScheduleTeamWeekView([], interleaved, WEEK);
    expect(view.people.map((p) => p.roleGroup)).toEqual(["supervisor", "technician", "technician"]);
    expect(view.people.map((p) => p.id)).toEqual(["p_eitan", "p_daniel", "p_noa"]);
  });

  it("preserves the roster's own relative order WITHIN each role group -- never re-sorted alphabetically", () => {
    const laterAlphabetically = person({ id: "p_zvi", name: "אבי אחרון", isTechnician: true });
    const view = buildScheduleTeamWeekView([], [NOA, laterAlphabetically], WEEK);
    // NOA ("נועה") came first in the roster -- stays first even though its
    // name sorts after "אבי אחרון" alphabetically.
    expect(view.people.map((p) => p.id)).toEqual(["p_noa", "p_zvi"]);
  });

  it("someone who is BOTH isSupervisor and isTechnician counts once, as supervisor (classifyRoleGroup's own precedence)", () => {
    const both = person({ id: "p_both", name: "גם וגם", isSupervisor: true, isTechnician: true });
    const view = buildScheduleTeamWeekView([], [both], WEEK);
    expect(view.people).toHaveLength(1);
    expect(view.people[0].roleGroup).toBe("supervisor");
  });
});

describe("buildScheduleTeamWeekView — personnel-type eligibility (permanent/קבע excluded)", () => {
  it("excludes a permanent (קבע) person even when isSupervisor is true", () => {
    const permanentSupervisor = person({ id: "p_perm_sup", name: "קבע אחמ\"ש", isSupervisor: true, personnelType: "קבע" });
    const view = buildScheduleTeamWeekView([], [permanentSupervisor], WEEK);
    expect(view.people).toHaveLength(0);
  });

  it("excludes a permanent (קבע) person even when isTechnician is true", () => {
    const permanentTechnician = person({ id: "p_perm_tech", name: "קבע טכנאי", isTechnician: true, personnelType: "קבע" });
    const view = buildScheduleTeamWeekView([], [permanentTechnician], WEEK);
    expect(view.people).toHaveLength(0);
  });

  it("includes a regular (חובה) supervisor and technician", () => {
    const regularSupervisor = person({ id: "p_reg_sup", name: "חובה אחמ\"ש", isSupervisor: true, personnelType: "חובה" });
    const regularTechnician = person({ id: "p_reg_tech", name: "חובה טכנאי", isTechnician: true, personnelType: "חובה" });
    const view = buildScheduleTeamWeekView([], [regularSupervisor, regularTechnician], WEEK);
    expect(view.people.map((p) => p.id)).toEqual(["p_reg_sup", "p_reg_tech"]);
  });

  it("includes a reserve (מילואים) supervisor and technician", () => {
    const reserveSupervisor = person({ id: "p_res_sup", name: "מילואים אחמ\"ש", isSupervisor: true, personnelType: "מילואים" });
    const reserveTechnician = person({ id: "p_res_tech", name: "מילואים טכנאי", isTechnician: true, personnelType: "מילואים" });
    const view = buildScheduleTeamWeekView([], [reserveSupervisor, reserveTechnician], WEEK);
    expect(view.people.map((p) => p.id)).toEqual(["p_res_sup", "p_res_tech"]);
  });

  it("excludes a non-operational person (neither isSupervisor nor isTechnician), regardless of personnelType", () => {
    const regularNonOperational = person({ id: "p_reg_other", name: "חובה לא תפעולי", personnelType: "חובה" });
    const view = buildScheduleTeamWeekView([], [regularNonOperational], WEEK);
    expect(view.people).toHaveLength(0);
  });

  it("excludes an unclassified personnelType (null / unrecognized string), even when isSupervisor/isTechnician is true", () => {
    const unclassifiedSupervisor = person({ id: "p_unc_sup", name: "לא מסווג", isSupervisor: true, personnelType: null });
    const unrecognizedTechnician = person({ id: "p_unrec_tech", name: "מחרוזת לא מוכרת", isTechnician: true, personnelType: "משהו אחר" });
    const view = buildScheduleTeamWeekView([], [unclassifiedSupervisor, unrecognizedTechnician], WEEK);
    expect(view.people).toHaveLength(0);
  });

  it("duplicate-name safety still works after personnelType filtering -- each stays keyed by id", () => {
    const dupA = person({ id: "p_dup_a", name: "דניאל כהן", isTechnician: true, personnelType: "חובה" });
    const dupPermanent = person({ id: "p_dup_b", name: "דניאל כהן", isTechnician: true, personnelType: "קבע" });
    const view = buildScheduleTeamWeekView([], [dupA, dupPermanent], WEEK);
    expect(view.people.map((p) => p.id)).toEqual(["p_dup_a"]);
    expect(view.people[0].name).toBe("דניאל כהן");
  });

  it("supervisor/technician grouping stays deterministic once permanent personnel are filtered out of an interleaved roster", () => {
    const permanentTechnician = person({ id: "p_perm", name: "קבע באמצע", isTechnician: true, personnelType: "קבע" });
    const regularSupervisor = person({ id: "p_sup", name: "אחמ\"ש", isSupervisor: true, personnelType: "חובה" });
    const reserveTechnician = person({ id: "p_tech", name: "טכנאי", isTechnician: true, personnelType: "מילואים" });
    const view = buildScheduleTeamWeekView([], [permanentTechnician, regularSupervisor, reserveTechnician], WEEK);
    expect(view.people.map((p) => p.roleGroup)).toEqual(["supervisor", "technician"]);
    expect(view.people.map((p) => p.id)).toEqual(["p_sup", "p_tech"]);
  });
});

describe("buildScheduleTeamWeekView — cells are keyed by person ID, densely populated (6, 11)", () => {
  it("6. seeds an empty array for every person × every week date, never a missing/sparse key", () => {
    const view = buildScheduleTeamWeekView([], [EITAN, DANIEL], WEEK);
    for (const p of view.people) {
      for (const date of WEEK.dates) {
        expect(view.cells[p.id][date]).toEqual([]);
      }
    }
  });

  it("11. an empty cell is a real, present empty array (calm rendering downstream, never undefined)", () => {
    const view = buildScheduleTeamWeekView([], [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"]).toEqual([]);
  });

  it("places an event in the exact person × date cell it belongs to", () => {
    const view = buildScheduleTeamWeekView([event({ personId: "p_daniel", date: "2026-08-11" })], [DANIEL, EITAN], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"]).toHaveLength(1);
    expect(view.cells["p_daniel"]["2026-08-11"][0].title).toBe("טכנאי יום");
    expect(view.cells["p_eitan"]["2026-08-11"]).toEqual([]);
    expect(view.cells["p_daniel"]["2026-08-12"]).toEqual([]);
  });
});

describe("buildScheduleTeamWeekView — duplicate names stay safe (7)", () => {
  it("7. two roster members sharing a display name each get their own, independently correct column keyed by id", () => {
    const dupA = person({ id: "p_a", name: "דניאל כהן", isTechnician: true });
    const dupB = person({ id: "p_b", name: "דניאל כהן", isTechnician: true });
    const events = [
      event({ personId: "p_a", personName: "דניאל כהן", date: "2026-08-11", title: "טכנאי יום" }),
      event({ personId: "p_b", personName: "דניאל כהן", date: "2026-08-11", title: "חופש", category: "absence", absenceKind: "vacation" }),
    ];
    const view = buildScheduleTeamWeekView(events, [dupA, dupB], WEEK);

    expect(view.people.map((p) => p.name)).toEqual(["דניאל כהן", "דניאל כהן"]);
    expect(view.cells["p_a"]["2026-08-11"]).toHaveLength(1);
    expect(view.cells["p_a"]["2026-08-11"][0].title).toBe("טכנאי יום");
    expect(view.cells["p_b"]["2026-08-11"]).toHaveLength(1);
    expect(view.cells["p_b"]["2026-08-11"][0].title).toBe("חופש");
  });
});

describe("buildScheduleTeamWeekView — shadow identifiability (8)", () => {
  it("8. carries the shadow flag through untouched, distinct from a non-shadow assignment on the same item shape", () => {
    const shadowEvent = event({ personId: "p_daniel", date: "2026-08-11", title: 'אחמ"ש יום - צל', shadow: true, role: "supervisor" });
    const view = buildScheduleTeamWeekView([shadowEvent], [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"][0].shadow).toBe(true);
  });

  it("a non-shadow event on the same person/date is never misreported as shadow", () => {
    const view = buildScheduleTeamWeekView([event({ personId: "p_daniel", date: "2026-08-11", shadow: false })], [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"][0].shadow).toBe(false);
  });
});

describe("buildScheduleTeamWeekView — multiple events per cell (9, 10)", () => {
  it("9. a shift and a duty on the same person/day both survive, neither dropped", () => {
    const events = [
      event({ personId: "p_daniel", date: "2026-08-11", category: "shift", title: "טכנאי יום" }),
      event({ personId: "p_daniel", date: "2026-08-11", category: "duty", title: "שמירה 2", dutyFamily: "guard", slot: 2, role: null, period: "unspecified" }),
    ];
    const view = buildScheduleTeamWeekView(events, [DANIEL], WEEK);
    const items = view.cells["p_daniel"]["2026-08-11"];
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title)).toEqual(["טכנאי יום", "שמירה 2"]);
  });

  it("10. the full list of items is preserved even when more than the UI's 2-item display budget exist -- capping is a rendering concern, never a data-loss one", () => {
    const events = [
      event({ personId: "p_daniel", date: "2026-08-11", category: "shift", title: "טכנאי יום" }),
      event({ personId: "p_daniel", date: "2026-08-11", category: "duty", title: "שמירה 2", dutyFamily: "guard", slot: 2, role: null, period: "unspecified" }),
      event({ personId: "p_daniel", date: "2026-08-11", category: "duty", title: "עתודה 1", dutyFamily: "reserve", slot: 1, role: null, period: "unspecified" }),
    ];
    const view = buildScheduleTeamWeekView(events, [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"]).toHaveLength(3);
  });

  it("every item within one cell gets a distinct key", () => {
    const events = [
      event({ personId: "p_daniel", date: "2026-08-11", title: "טכנאי יום" }),
      event({ personId: "p_daniel", date: "2026-08-11", category: "duty", title: "שמירה 2", dutyFamily: "guard", role: null, period: "unspecified" }),
    ];
    const view = buildScheduleTeamWeekView(events, [DANIEL], WEEK);
    const keys = view.cells["p_daniel"]["2026-08-11"].map((i) => i.key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe("buildScheduleTeamWeekView — scope (week dates only, relevant categories only)", () => {
  it("ignores an event dated outside the requested week", () => {
    const view = buildScheduleTeamWeekView([event({ personId: "p_daniel", date: "2026-08-01" })], [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-09"]).toEqual([]);
    expect(Object.values(view.cells["p_daniel"]).flat()).toEqual([]);
  });

  it("ignores a category outside shift/duty/absence -- e.g. an internal constraint/change_note/status entry", () => {
    const events = [
      event({ personId: "p_daniel", date: "2026-08-11", category: "constraint", title: "אילוץ" }),
      event({ personId: "p_daniel", date: "2026-08-11", category: "change_note", title: "שינוי", changeNote: "שינוי" }),
      event({ personId: "p_daniel", date: "2026-08-11", category: "status", title: "סוגר" }),
    ];
    const view = buildScheduleTeamWeekView(events, [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"]).toEqual([]);
  });

  it("still ignores an unrecognized category 'other' string -- 'other' is not blanket-included", () => {
    const events = [event({ personId: "p_daniel", date: "2026-08-11", category: "other", title: "הערה כללית" })];
    const view = buildScheduleTeamWeekView(events, [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"]).toEqual([]);
  });

  it("ignores an event for a person who isn't on the roster at all (defensive -- never crashes)", () => {
    const view = buildScheduleTeamWeekView([event({ personId: "p_ghost", date: "2026-08-11" })], [DANIEL], WEEK);
    expect(view.cells["p_ghost"]).toBeUndefined();
    expect(view.cells["p_daniel"]["2026-08-11"]).toEqual([]);
  });

  it("still returns weekStart/weekEnd/dates straight from the given week", () => {
    const view = buildScheduleTeamWeekView([], [], WEEK);
    expect(view.weekStart).toBe(WEEK.weekStart);
    expect(view.weekEnd).toBe(WEEK.weekEnd);
    expect(view.dates).toEqual(WEEK.dates);
  });
});

describe("buildScheduleTeamWeekView — never leaks raw workbook/PII data (17)", () => {
  it("no cell item, person, or top-level field carries sourceSheet/sourceCell/email/rawValue", () => {
    const events = [
      event({ personId: "p_daniel", date: "2026-08-11", sourceSheet: "משמרות + תורנויות", sourceCell: "Z99", rawValue: "טכנאי יום " }),
    ];
    const view = buildScheduleTeamWeekView(events, [DANIEL], WEEK);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("sourceSheet");
    expect(serialized).not.toContain("sourceCell");
    expect(serialized).not.toContain("Z99");
    expect(serialized).not.toContain("@example.invalid");
    expect(serialized).not.toContain("rawValue");
  });

  it("a cell item's own keys are exactly the safe, typed shape -- nothing extra smuggled through", () => {
    const view = buildScheduleTeamWeekView([event({ personId: "p_daniel", date: "2026-08-11" })], [DANIEL], WEEK);
    const item = view.cells["p_daniel"]["2026-08-11"][0];
    expect(Object.keys(item).sort()).toEqual(
      ["absenceKind", "category", "dutyFamily", "key", "period", "shadow", "tentative", "title"].sort(),
    );
  });

  it("a person's own keys never include email or any other Person field beyond id/name/roleGroup", () => {
    const view = buildScheduleTeamWeekView([], [DANIEL], WEEK);
    expect(Object.keys(view.people[0]).sort()).toEqual(["id", "name", "roleGroup"]);
  });
});

describe("buildScheduleTeamWeekView — tentative certainty", () => {
  it("marks an item tentative from Event.certainty, confirmed otherwise", () => {
    const events = [
      event({ personId: "p_daniel", date: "2026-08-11", certainty: "tentative" }),
      event({ personId: "p_daniel", date: "2026-08-12", certainty: "confirmed" }),
    ];
    const view = buildScheduleTeamWeekView(events, [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"][0].tentative).toBe(true);
    expect(view.cells["p_daniel"]["2026-08-12"][0].tentative).toBe(false);
  });
});

// --- recognized "other"-category operational activities (מטווחים/משיכות/
// הסמכה) -- a narrow, explicit exception to the shift/duty/absence-only
// scope above, shared from lib/domain/operationalActivityKeywords.ts (the
// same detectors lib/domain/reportOne.ts already relies on), never a
// blanket "any 'other' text is fine" rule --------------------------------

describe("buildScheduleTeamWeekView — recognized 'other'-category activities (מטווחים/משיכות/הסמכה)", () => {
  it("מטווחים alone survives, as a category 'other' item", () => {
    const view = buildScheduleTeamWeekView(
      [event({ personId: "p_daniel", date: "2026-08-11", category: "other", title: "מטווחים" })],
      [DANIEL],
      WEEK,
    );
    const items = view.cells["p_daniel"]["2026-08-11"];
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("מטווחים");
    expect(items[0].category).toBe("other");
  });

  it("the singular 'מטווח' spelling is recognized too, exactly like the plural", () => {
    const view = buildScheduleTeamWeekView(
      [event({ personId: "p_daniel", date: "2026-08-11", category: "other", title: "מטווח" })],
      [DANIEL],
      WEEK,
    );
    expect(view.cells["p_daniel"]["2026-08-11"]).toHaveLength(1);
  });

  it("משיכות is recognized (the sibling keyword reportOne.ts already relies on)", () => {
    const view = buildScheduleTeamWeekView(
      [event({ personId: "p_daniel", date: "2026-08-11", category: "other", title: "משיכות" })],
      [DANIEL],
      WEEK,
    );
    expect(view.cells["p_daniel"]["2026-08-11"]).toHaveLength(1);
    expect(view.cells["p_daniel"]["2026-08-11"][0].title).toBe("משיכות");
  });

  it("הסמכה is recognized (the sibling keyword reportOne.ts already relies on)", () => {
    const view = buildScheduleTeamWeekView(
      [event({ personId: "p_daniel", date: "2026-08-11", category: "other", title: "הסמכה" })],
      [DANIEL],
      WEEK,
    );
    expect(view.cells["p_daniel"]["2026-08-11"]).toHaveLength(1);
    expect(view.cells["p_daniel"]["2026-08-11"][0].title).toBe("הסמכה");
  });

  it('אחמ"ש יום - צל (shift) + מטווחים (other) on the same person/date: BOTH survive, neither dropped', () => {
    const events = [
      event({ personId: "p_daniel", date: "2026-08-11", category: "shift", title: 'אחמ"ש יום - צל', role: "supervisor", period: "day", shadow: true }),
      event({ personId: "p_daniel", date: "2026-08-11", category: "other", title: "מטווחים" }),
    ];
    const view = buildScheduleTeamWeekView(events, [DANIEL], WEEK);
    const items = view.cells["p_daniel"]["2026-08-11"];
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title)).toEqual(['אחמ"ש יום - צל', "מטווחים"]);
  });

  it("2 relevant items (one typed, one recognized 'other') both survive at the data layer -- overflow capping is a UI-only concern, never data loss here", () => {
    const events = [
      event({ personId: "p_daniel", date: "2026-08-11", category: "shift", title: "טכנאי יום" }),
      event({ personId: "p_daniel", date: "2026-08-11", category: "duty", title: "שמירה 2", dutyFamily: "guard", role: null, period: "unspecified" }),
      event({ personId: "p_daniel", date: "2026-08-11", category: "other", title: "מטווחים" }),
    ];
    const view = buildScheduleTeamWeekView(events, [DANIEL], WEEK);
    const items = view.cells["p_daniel"]["2026-08-11"];
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.title)).toEqual(["טכנאי יום", "שמירה 2", "מטווחים"]);
  });
});

describe("buildScheduleTeamWeekView — real parsed-pipeline regression (parseEvent -> buildScheduleTeamWeekView)", () => {
  function rawAssignment(rawValue: string, overrides: Partial<RawAssignment> = {}): RawAssignment {
    return {
      personId: "p_daniel",
      personName: "דניאל כהן",
      date: "2026-08-11",
      rawValue,
      sourceSheet: "משמרות + תורנויות",
      sourceCell: "C7",
      ...overrides,
    };
  }

  it("'מטווחים' raw schedule-cell text parses to category 'other' and reaches the matrix", () => {
    const parsed = parseEvent(rawAssignment("מטווחים"));
    expect(parsed.category).toBe("other");
    const view = buildScheduleTeamWeekView([parsed], [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"]).toHaveLength(1);
    expect(view.cells["p_daniel"]["2026-08-11"][0].title).toBe("מטווחים");
  });

  it('exact reported regression through the real parser: \'אחמ"ש יום - צל\' + \'מטווחים\' for the same person/date -> buildScheduleTeamWeekView() contains BOTH items', () => {
    const shadowShift = parseEvent(rawAssignment('אחמ"ש יום - צל'));
    const shootingRange = parseEvent(rawAssignment("מטווחים"));
    expect(shadowShift.category).toBe("shift");
    expect(shadowShift.shadow).toBe(true);
    expect(shootingRange.category).toBe("other");

    const view = buildScheduleTeamWeekView([shadowShift, shootingRange], [DANIEL], WEEK);
    const items = view.cells["p_daniel"]["2026-08-11"];
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('אחמ"ש יום - צל');
    expect(items[0].shadow).toBe(true);
    expect(items[1].title).toBe("מטווחים");
  });

  it("unrelated free-text 'other' schedule-cell content still never reaches the matrix through the real parser", () => {
    const parsed = parseEvent(rawAssignment("הערה כללית"));
    expect(parsed.category).toBe("other");
    const view = buildScheduleTeamWeekView([parsed], [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"]).toEqual([]);
  });

  it("'משיכות' raw schedule-cell text also reaches the matrix through the real parser", () => {
    const parsed = parseEvent(rawAssignment("משיכות"));
    expect(parsed.category).toBe("other");
    const view = buildScheduleTeamWeekView([parsed], [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"]).toHaveLength(1);
  });

  it("'הסמכה' raw schedule-cell text also reaches the matrix through the real parser", () => {
    const parsed = parseEvent(rawAssignment("הסמכה"));
    expect(parsed.category).toBe("other");
    const view = buildScheduleTeamWeekView([parsed], [DANIEL], WEEK);
    expect(view.cells["p_daniel"]["2026-08-11"]).toHaveLength(1);
  });
});
