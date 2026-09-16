import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawSheet } from "@/lib/google";

const getRequestAuthenticatedIdentity = vi.fn();
const getWorkbookSnapshot = vi.fn();

vi.mock("@/lib/auth/getRequestAuthenticatedIdentity", () => ({ getRequestAuthenticatedIdentity }));
vi.mock("@/lib/sync", () => ({ getWorkbookSnapshot }));

const { loadDischargeCountdownView } = await import("./dischargeCountdown");

function personnelSheet(rows: (string | boolean)[][]): RawSheet {
  return { name: 'כ"א', values: rows };
}

function personnelSnapshot(rows: (string | boolean)[][]) {
  return { fetchedAt: "2026-08-13T08:00:00.000Z", sheets: [personnelSheet(rows)] };
}

beforeEach(() => {
  getRequestAuthenticatedIdentity.mockReset();
  getWorkbookSnapshot.mockReset();
  getRequestAuthenticatedIdentity.mockResolvedValue({
    status: "authenticated",
    userId: "u1",
    email: "dani@example.invalid",
    avatarUrl: null,
  });
});

describe("loadDischargeCountdownView — auth pass-through states", () => {
  it("unauthenticated: no workbook fetch at all", async () => {
    getRequestAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    const result = await loadDischargeCountdownView();
    expect(result).toEqual({ status: "unauthenticated" });
    expect(getWorkbookSnapshot).not.toHaveBeenCalled();
  });

  it("missing_email: no workbook fetch at all", async () => {
    getRequestAuthenticatedIdentity.mockResolvedValue({ status: "missing_email", userId: "u1" });
    const result = await loadDischargeCountdownView();
    expect(result).toEqual({ status: "missing_email" });
    expect(getWorkbookSnapshot).not.toHaveBeenCalled();
  });

  it("an email absent from כ\"א fails closed as unmapped", async () => {
    getWorkbookSnapshot.mockResolvedValue(personnelSnapshot([["שם", "מייל"], ["דני בדיקה", "dani@example.invalid"]]));
    getRequestAuthenticatedIdentity.mockResolvedValue({
      status: "authenticated",
      userId: "u9",
      email: "stranger@example.invalid",
      avatarUrl: null,
    });
    const result = await loadDischargeCountdownView();
    expect(result).toEqual({ status: "unmapped" });
  });

  it("an email matching more than one כ\"א record fails closed as ambiguous_identity", async () => {
    getWorkbookSnapshot.mockResolvedValue(
      personnelSnapshot([
        ["שם", "מייל"],
        ["דני בדיקה", "dup@example.invalid"],
        ["נועה דוגמה", "DUP@example.invalid"],
      ]),
    );
    getRequestAuthenticatedIdentity.mockResolvedValue({
      status: "authenticated",
      userId: "u9",
      email: "dup@example.invalid",
      avatarUrl: null,
    });
    const result = await loadDischargeCountdownView();
    expect(result).toEqual({ status: "ambiguous_identity" });
  });

  it("only ever fetches the personnel source, never the full manager/personal-schedule set", async () => {
    getWorkbookSnapshot.mockResolvedValue(personnelSnapshot([["שם", "מייל"], ["דני בדיקה", "dani@example.invalid"]]));
    await loadDischargeCountdownView();
    expect(getWorkbookSnapshot).toHaveBeenCalledWith(["personnel"]);
  });
});

describe("loadDischargeCountdownView — resolved view", () => {
  it("resolves both instants from the person's own discharge/enlistment dates", async () => {
    getWorkbookSnapshot.mockResolvedValue(
      personnelSnapshot([
        ["שם", "מייל", "תאריך גיוס", "תאריך שחרור"],
        ["דני בדיקה", "dani@example.invalid", "24/01/2024", "24/01/2027"],
      ]),
    );

    const result = await loadDischargeCountdownView();

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.view.personName).toBe("דני בדיקה");
    expect(result.view.dischargeDate).toBe("2027-01-24");
    expect(result.view.dischargeInstantIso).toBe(new Date("2027-01-24T00:00:00.000+02:00").toISOString());
    expect(result.view.enlistmentInstantIso).toBe(new Date("2024-01-24T00:00:00.000+02:00").toISOString());
    // The discharge day's own last moment -- still the SAME civil day, never the next one.
    expect(new Date(result.view.dischargeDayEndInstantIso!).getUTCDate()).toBe(24);
  });

  it("resolves every instant to null when כ\"א has neither date for this person", async () => {
    getWorkbookSnapshot.mockResolvedValue(personnelSnapshot([["שם", "מייל"], ["דני בדיקה", "dani@example.invalid"]]));

    const result = await loadDischargeCountdownView();

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.view.dischargeDate).toBeNull();
    expect(result.view.dischargeInstantIso).toBeNull();
    expect(result.view.dischargeDayEndInstantIso).toBeNull();
    expect(result.view.enlistmentInstantIso).toBeNull();
  });

  it("resolves an enlistment instant independently of whether a discharge date exists", async () => {
    getWorkbookSnapshot.mockResolvedValue(
      personnelSnapshot([
        ["שם", "מייל", "תאריך גיוס"],
        ["דני בדיקה", "dani@example.invalid", "24/01/2024"],
      ]),
    );

    const result = await loadDischargeCountdownView();

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.view.dischargeDate).toBeNull();
    expect(result.view.enlistmentInstantIso).not.toBeNull();
  });
});

describe('loadDischargeCountdownView — the "כולם" roster gate', () => {
  const HEADERS = ["שם", "מייל", 'סוג כ"א', "תאריך שחרור", "תאריך גיוס", "מנהל"];

  /** `dani@example.invalid` is always the caller (see the identity mock above). */
  function snapshotWith(rows: (string | boolean)[][]) {
    return personnelSnapshot([HEADERS, ...rows]);
  }

  async function loadOk() {
    const result = await loadDischargeCountdownView();
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    return result.view;
  }

  it("gives a regular-service caller the roster", async () => {
    getWorkbookSnapshot.mockResolvedValue(
      snapshotWith([["דני בדיקה", "dani@example.invalid", "חובה", "2027-01-01", "2025-01-01", ""]]),
    );
    const view = await loadOk();
    expect(view.everyone).not.toBeNull();
    expect(view.everyone?.map((p) => p.personName)).toEqual(["דני בדיקה"]);
  });

  it("gives a manager the roster even when the manager is not regular service", async () => {
    getWorkbookSnapshot.mockResolvedValue(
      snapshotWith([
        ["דני בדיקה", "dani@example.invalid", "קבע", "", "", true],
        ["נועה דוגמה", "noa@example.invalid", "חובה", "2027-03-01", "2025-03-01", ""],
      ]),
    );
    const view = await loadOk();
    expect(view.everyone?.map((p) => p.personName)).toEqual(["נועה דוגמה"]);
  });

  it("withholds the roster entirely from a non-manager permanent or reserve caller", async () => {
    for (const personnelType of ["קבע", "מילואים"]) {
      getWorkbookSnapshot.mockResolvedValue(
        snapshotWith([
          ["דני בדיקה", "dani@example.invalid", personnelType, "", "", ""],
          ["נועה דוגמה", "noa@example.invalid", "חובה", "2027-03-01", "2025-03-01", ""],
        ]),
      );
      // null, not [] -- the page treats the absent roster as the authorization
      // answer and ignores ?view=/?person= outright.
      expect((await loadOk()).everyone).toBeNull();
    }
  });

  it("lists regular service only -- permanent and reserve personnel never appear", async () => {
    getWorkbookSnapshot.mockResolvedValue(
      snapshotWith([
        ["דני בדיקה", "dani@example.invalid", "חובה", "2027-01-01", "2025-01-01", ""],
        ["קבוע", "kavua@example.invalid", "קבע", "2027-01-02", "2025-01-01", ""],
        ["מילואימניק", "miluim@example.invalid", "מילואים", "2027-01-03", "2025-01-01", ""],
        ["לא מסווג", "none@example.invalid", "", "2027-01-04", "2025-01-01", ""],
      ]),
    );
    expect((await loadOk()).everyone?.map((p) => p.personName)).toEqual(["דני בדיקה"]);
  });

  it("orders the roster by discharge date, closest first, undated last", async () => {
    getWorkbookSnapshot.mockResolvedValue(
      snapshotWith([
        ["דני בדיקה", "dani@example.invalid", "חובה", "2027-12-31", "2025-01-01", ""],
        ["ללא תאריך", "nodate@example.invalid", "חובה", "", "2025-01-01", ""],
        ["הכי קרוב", "soon@example.invalid", "חובה", "2026-02-01", "2025-01-01", ""],
      ]),
    );
    expect((await loadOk()).everyone?.map((p) => p.personName)).toEqual([
      "הכי קרוב",
      "דני בדיקה",
      "ללא תאריך",
    ]);
  });

  it("resolves each roster entry's instants the same Jerusalem way as the personal view", async () => {
    getWorkbookSnapshot.mockResolvedValue(
      snapshotWith([["דני בדיקה", "dani@example.invalid", "חובה", "2027-01-01", "2025-01-01", ""]]),
    );
    const view = await loadOk();
    const self = view.everyone?.[0];
    // Same person, so the roster entry and the personal view must agree
    // exactly -- a card and that person's full countdown can never disagree
    // about which civil day their discharge falls on.
    expect(self?.dischargeInstantIso).toBe(view.dischargeInstantIso);
    expect(self?.dischargeDayEndInstantIso).toBe(view.dischargeDayEndInstantIso);
    expect(self?.enlistmentInstantIso).toBe(view.enlistmentInstantIso);
  });

  it("leaves an undated roster entry's instants null rather than guessing a date", async () => {
    getWorkbookSnapshot.mockResolvedValue(
      snapshotWith([["דני בדיקה", "dani@example.invalid", "חובה", "", "", ""]]),
    );
    const self = (await loadOk()).everyone?.[0];
    expect(self?.dischargeDate).toBeNull();
    expect(self?.dischargeInstantIso).toBeNull();
    expect(self?.dischargeDayEndInstantIso).toBeNull();
    expect(self?.enlistmentInstantIso).toBeNull();
  });

  it("returns an empty roster -- not null -- when an allowed caller has nobody to list", async () => {
    getWorkbookSnapshot.mockResolvedValue(
      snapshotWith([["דני בדיקה", "dani@example.invalid", "קבע", "", "", true]]),
    );
    // Allowed (manager) but no regular-service personnel exist: the overview
    // shows its empty state rather than the page hiding the toggle.
    expect((await loadOk()).everyone).toEqual([]);
  });
});
