import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawSheet } from "@/lib/google";

const getRequestAuthenticatedIdentity = vi.fn();
const getWorkbookSnapshot = vi.fn();

vi.mock("@/lib/auth/getRequestAuthenticatedIdentity", () => ({ getRequestAuthenticatedIdentity }));
vi.mock("@/lib/sync", () => ({ getWorkbookSnapshot }));

const { loadScheduleWorkbookContext, getScheduleWorkbookSheet, SCHEDULE_WORKBOOK_SOURCES } = await import(
  "./scheduleWorkbookContext"
);

function personnelSheet(rows: (string | boolean)[][]): RawSheet {
  return { name: 'כ"א', values: rows };
}
function scheduleSheet(rows: (string | number)[][]): RawSheet {
  return { name: "משמרות + תורנויות", values: rows };
}
function settingsSheet(rows: string[][]): RawSheet {
  return { name: "הגדרות", values: rows };
}
function potentialSheet(name: string, rows: (string | number)[][]): RawSheet {
  return { name, values: rows };
}

const PERSONNEL_ROWS: (string | boolean)[][] = [
  ["שם", "מייל", "מנהל"],
  ["דני מנהל", "dani@example.invalid", true],
  ["נועה עובדת", "noa@example.invalid", false],
];

function scheduleSnapshot(overrides: Partial<{ personnel: (string | boolean)[][] }> = {}) {
  return {
    fetchedAt: "2026-09-23T08:00:00.000Z",
    sheets: [
      personnelSheet(overrides.personnel ?? PERSONNEL_ROWS),
      scheduleSheet([]),
      settingsSheet([["הגדרה", "ערך"]]),
      potentialSheet('פוטנציאל תקש"אס 1-6/2026', []),
      potentialSheet('פוטנציאל תקש"אס 7-12/2026', []),
    ],
  };
}

beforeEach(() => {
  getRequestAuthenticatedIdentity.mockReset();
  getWorkbookSnapshot.mockReset();
  getRequestAuthenticatedIdentity.mockResolvedValue({
    status: "authenticated",
    userId: "u1",
    email: "noa@example.invalid",
    avatarUrl: null,
  });
  getWorkbookSnapshot.mockResolvedValue(scheduleSnapshot());
});

describe("loadScheduleWorkbookContext — auth pass-through states (15, 16, 17, 18)", () => {
  it("15. unauthenticated: no workbook fetch at all", async () => {
    getRequestAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    const result = await loadScheduleWorkbookContext();
    expect(result).toEqual({ status: "unauthenticated" });
    expect(getWorkbookSnapshot).not.toHaveBeenCalled();
  });

  it("16. missing_email: no workbook fetch at all", async () => {
    getRequestAuthenticatedIdentity.mockResolvedValue({ status: "missing_email", userId: "u1" });
    const result = await loadScheduleWorkbookContext();
    expect(result).toEqual({ status: "missing_email" });
    expect(getWorkbookSnapshot).not.toHaveBeenCalled();
  });

  it("17. an email absent from כ\"א fails closed as unmapped, AFTER the fetch (the fresh snapshot is what's authoritative)", async () => {
    getRequestAuthenticatedIdentity.mockResolvedValue({
      status: "authenticated",
      userId: "u9",
      email: "stranger@example.invalid",
      avatarUrl: null,
    });
    const result = await loadScheduleWorkbookContext();
    expect(result).toEqual({ status: "unmapped" });
  });

  it("18. an email matching more than one כ\"א record fails closed as ambiguous_identity", async () => {
    getRequestAuthenticatedIdentity.mockResolvedValue({
      status: "authenticated",
      userId: "u9",
      email: "dup@example.invalid",
      avatarUrl: null,
    });
    getWorkbookSnapshot.mockResolvedValue(
      scheduleSnapshot({
        personnel: [
          ["שם", "מייל", "מנהל"],
          ["דני א", "dup@example.invalid", false],
          ["דני ב", "dup@example.invalid", false],
        ],
      }),
    );
    const result = await loadScheduleWorkbookContext();
    expect(result).toEqual({ status: "ambiguous_identity" });
  });
});

describe("loadScheduleWorkbookContext — deliberately NOT manager-gated", () => {
  it("succeeds for a non-manager viewer -- this boundary never inspects isManager at all", async () => {
    const result = await loadScheduleWorkbookContext();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.context.viewer.name).toBe("נועה עובדת");
      expect(result.context.viewer.isManager).toBe(false);
    }
  });

  it("also succeeds for a manager viewer -- the SAME code path, no special-casing either way", async () => {
    getRequestAuthenticatedIdentity.mockResolvedValue({
      status: "authenticated",
      userId: "u2",
      email: "dani@example.invalid",
      avatarUrl: null,
    });
    const result = await loadScheduleWorkbookContext();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.context.viewer.name).toBe("דני מנהל");
      expect(result.context.viewer.isManager).toBe(true);
    }
  });
});

describe("loadScheduleWorkbookContext — fetch scope / cache-key alignment", () => {
  it("fetches exactly the 5-source SCHEDULE_WORKBOOK_SOURCES set -- the SAME canonical set personalSchedule.ts's REQUIRED_SOURCES uses, deliberately never the 6-source manager set", async () => {
    await loadScheduleWorkbookContext();
    expect(getWorkbookSnapshot).toHaveBeenCalledTimes(1);
    expect(getWorkbookSnapshot).toHaveBeenCalledWith(SCHEDULE_WORKBOOK_SOURCES);
    expect(SCHEDULE_WORKBOOK_SOURCES).toEqual(["personnel", "schedule", "settings", "potentialH1", "potentialH2"]);
    expect(SCHEDULE_WORKBOOK_SOURCES).not.toContain("shootingRanges");
  });

  it("calls getRequestAuthenticatedIdentity exactly once", async () => {
    await loadScheduleWorkbookContext();
    expect(getRequestAuthenticatedIdentity).toHaveBeenCalledTimes(1);
  });

  it("returns the full parsed roster and raw snapshot alongside the viewer", async () => {
    const result = await loadScheduleWorkbookContext();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.context.people).toHaveLength(2);
      expect(result.context.snapshot.sheets).toHaveLength(5);
    }
  });

  it("never returns a `context` on any non-ok status", async () => {
    getRequestAuthenticatedIdentity.mockResolvedValue({ status: "unauthenticated" });
    const result = await loadScheduleWorkbookContext();
    expect(result).not.toHaveProperty("context");
  });
});

describe("getScheduleWorkbookSheet", () => {
  it("finds a sheet by logical key", () => {
    const snapshot = scheduleSnapshot();
    const sheet = getScheduleWorkbookSheet(snapshot, "personnel");
    expect(sheet.name).toBe('כ"א');
  });

  it("throws when the snapshot is missing the requested sheet", () => {
    const snapshot = { fetchedAt: "x", sheets: [] };
    expect(() => getScheduleWorkbookSheet(snapshot, "personnel")).toThrow();
  });
});
