import { describe, expect, it } from "vitest";
import { canViewDischargeRoster, selectDischargeRoster } from "./dischargeRoster";

function person(overrides: Partial<{ name: string; personnelType: string | null; dischargeDate: string | null }> = {}) {
  return {
    name: "דני בדיקה",
    personnelType: "חובה",
    dischargeDate: "2027-01-01",
    ...overrides,
  };
}

describe("canViewDischargeRoster", () => {
  it("lets regular-service personnel and managers in", () => {
    expect(canViewDischargeRoster({ isManager: false, personnelType: "חובה" })).toBe(true);
    expect(canViewDischargeRoster({ isManager: true, personnelType: "קבע" })).toBe(true);
    expect(canViewDischargeRoster({ isManager: true, personnelType: "מילואים" })).toBe(true);
  });

  it("keeps non-manager permanent and reserve personnel out", () => {
    expect(canViewDischargeRoster({ isManager: false, personnelType: "קבע" })).toBe(false);
    expect(canViewDischargeRoster({ isManager: false, personnelType: "מילואים" })).toBe(false);
  });

  it("fails closed on an unclassified personnel type", () => {
    // A blank or unrecognised כ"א value must never be treated as regular
    // service -- an unproven classification can't unlock a roster-wide view.
    expect(canViewDischargeRoster({ isManager: false, personnelType: null })).toBe(false);
    expect(canViewDischargeRoster({ isManager: false, personnelType: "" })).toBe(false);
    expect(canViewDischargeRoster({ isManager: false, personnelType: "משהו אחר" })).toBe(false);
  });
});

describe("selectDischargeRoster", () => {
  it("includes regular service only, excluding permanent, reserve and unclassified", () => {
    const roster = selectDischargeRoster([
      person({ name: "סדיר", personnelType: "חובה" }),
      person({ name: "קבע", personnelType: "קבע" }),
      person({ name: "מילואים", personnelType: "מילואים" }),
      person({ name: "ריק", personnelType: null }),
      person({ name: "לא מוכר", personnelType: "אחר" }),
    ]);

    expect(roster.map((p) => p.name)).toEqual(["סדיר"]);
  });

  it("tolerates whitespace/spacing variants of the personnel type", () => {
    // Normalization is classifyPersonnelType's job -- this just proves the
    // filter goes through it rather than comparing raw strings.
    const roster = selectDischargeRoster([person({ name: "מרווח", personnelType: "  חובה  " })]);
    expect(roster.map((p) => p.name)).toEqual(["מרווח"]);
  });

  it("sorts by discharge date ascending -- the closest discharge first", () => {
    const roster = selectDischargeRoster([
      person({ name: "רחוק", dischargeDate: "2027-12-31" }),
      person({ name: "קרוב", dischargeDate: "2026-02-01" }),
      person({ name: "אמצע", dischargeDate: "2027-03-15" }),
    ]);

    expect(roster.map((p) => p.name)).toEqual(["קרוב", "אמצע", "רחוק"]);
  });

  it("keeps people with no discharge date, placed after every dated entry", () => {
    const roster = selectDischargeRoster([
      person({ name: "בלי תאריך", dischargeDate: null }),
      person({ name: "עם תאריך", dischargeDate: "2027-05-05" }),
    ]);

    expect(roster.map((p) => p.name)).toEqual(["עם תאריך", "בלי תאריך"]);
  });

  it("orders ties by name, so the list is stable rather than inheriting sheet order", () => {
    const sameDate = selectDischargeRoster([
      person({ name: "ב", dischargeDate: "2027-05-05" }),
      person({ name: "א", dischargeDate: "2027-05-05" }),
    ]);
    expect(sameDate.map((p) => p.name)).toEqual(["א", "ב"]);

    const undated = selectDischargeRoster([
      person({ name: "ד", dischargeDate: null }),
      person({ name: "ג", dischargeDate: null }),
    ]);
    expect(undated.map((p) => p.name)).toEqual(["ג", "ד"]);
  });

  it("does not mutate or reorder the caller's array", () => {
    const input = [
      person({ name: "רחוק", dischargeDate: "2027-12-31" }),
      person({ name: "קרוב", dischargeDate: "2026-02-01" }),
    ];
    selectDischargeRoster(input);
    expect(input.map((p) => p.name)).toEqual(["רחוק", "קרוב"]);
  });

  it("returns an empty list when nobody is in regular service", () => {
    expect(selectDischargeRoster([person({ personnelType: "קבע" })])).toEqual([]);
    expect(selectDischargeRoster([])).toEqual([]);
  });
});
