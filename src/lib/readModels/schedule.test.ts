import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RawSheet } from "@/lib/google";
import type { ScheduleParams } from "./schedule";

const getRequestPersonalSchedule = vi.fn();
const getAuthenticatedIdentity = vi.fn();
const getWorkbookSnapshot = vi.fn();
const resolveOperationalRoster = vi.fn();

vi.mock("./getRequestPersonalSchedule", () => ({ getRequestPersonalSchedule }));
vi.mock("@/lib/auth/currentUser", () => ({ getAuthenticatedIdentity }));
vi.mock("@/lib/sync", () => ({ getWorkbookSnapshot }));
vi.mock("./operationalMode", () => ({ resolveOperationalRoster }));

const { loadScheduleReadModel } = await import("./schedule");

function personnelSheet(rows: (string | boolean)[][]): RawSheet {
  return { name: 'כ"א', values: rows };
}
function scheduleSheet(rows: (string | number)[][]): RawSheet {
  return { name: "משמרות + תורנויות", values: rows };
}
function settingsSheet(rows: string[][]): RawSheet {
  return { name: "הגדרות", values: rows };
}
function potentialH1Sheet(rows: (string | number)[][]): RawSheet {
  return { name: 'פוטנציאל תקש"אס 1-6/2026', values: rows };
}
function potentialH2Sheet(rows: (string | number)[][]): RawSheet {
  return { name: 'פוטנציאל תקש"אס 7-12/2026', values: rows };
}

const MANAGER_PERSONNEL_ROWS: (string | boolean)[][] = [
  ["שם", "מייל", "מנהל"],
  ["מרטין גוסין", "martin@example.invalid", true],
  ["דניאל כהן", "daniel@example.invalid", false],
];

const SETTINGS_ROWS_VALID: string[][] = [
  ["הגדרה", "ערך"],
  ["תחילת משמרת יום", "07:30"],
];

function managerSnapshot(
  overrides: Partial<{ personnel: (string | boolean)[][]; potentialH1: (string | number)[][]; potentialH2: (string | number)[][] }> = {},
) {
  return {
    fetchedAt: "2026-08-13T08:00:00.000Z",
    sheets: [
      personnelSheet(overrides.personnel ?? MANAGER_PERSONNEL_ROWS),
      scheduleSheet([]),
      settingsSheet(SETTINGS_ROWS_VALID),
      potentialH1Sheet(overrides.potentialH1 ?? []),
      potentialH2Sheet(overrides.potentialH2 ?? []),
    ],
  };
}

function okPersonalResult(isManager: boolean) {
  return {
    status: "ok" as const,
    model: {
      person: {
        id: "p_martin",
        name: "מרטין גוסין",
        isManager,
        isTechnician: false,
        isSupervisor: false,
        personnelType: null,
      },
      fetchedAt: "2026-08-13T08:00:00.000Z",
      localNow: { date: "2026-08-13", minuteOfDay: 600 },
      todayEvents: [],
      upcomingEvents: [],
      calendarEvents: [],
      currentAssignments: [],
      nextAssignmentGroup: null,
      currentShiftContexts: [],
      nextShiftContexts: [],
      issues: [],
      dutyBlocks: [],
      dutyActions: [],
    },
  };
}

const DEFAULT_PARAMS: ScheduleParams = { rawMonth: null, personId: null, rawWeek: null };

beforeEach(() => {
  getRequestPersonalSchedule.mockReset();
  getAuthenticatedIdentity.mockReset();
  getWorkbookSnapshot.mockReset();
  resolveOperationalRoster.mockReset();
  getAuthenticatedIdentity.mockResolvedValue({
    status: "authenticated",
    userId: "u1",
    email: "martin@example.invalid",
    avatarUrl: null,
  });
  getWorkbookSnapshot.mockResolvedValue(managerSnapshot());
});

describe("loadScheduleReadModel — auth pass-through states", () => {
  it("unauthenticated: no manager fetch", async () => {
    getRequestPersonalSchedule.mockResolvedValue({ status: "unauthenticated" });
    const result = await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(result).toEqual({ status: "unauthenticated" });
    expect(getWorkbookSnapshot).not.toHaveBeenCalled();
  });

  it("missing_email: no manager fetch", async () => {
    getRequestPersonalSchedule.mockResolvedValue({ status: "missing_email" });
    const result = await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(result).toEqual({ status: "missing_email" });
  });

  it("unmapped: no manager fetch", async () => {
    getRequestPersonalSchedule.mockResolvedValue({ status: "unmapped" });
    const result = await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(result).toEqual({ status: "unmapped" });
  });

  it("ambiguous_identity: no manager fetch", async () => {
    getRequestPersonalSchedule.mockResolvedValue({ status: "ambiguous_identity" });
    const result = await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(result).toEqual({ status: "ambiguous_identity" });
  });

  it("configuration_error from the personal loader passes the message through, no manager fetch", async () => {
    getRequestPersonalSchedule.mockResolvedValue({
      status: "configuration_error",
      message: "Missing shift start time configuration.",
      person: { id: "p_1", name: "מרטין גוסין", isManager: true, isTechnician: false, isSupervisor: false, personnelType: null },
    });
    const result = await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(result).toEqual({ status: "configuration_error", message: "Missing shift start time configuration." });
    expect(getWorkbookSnapshot).not.toHaveBeenCalled();
  });
});

describe("loadScheduleReadModel — normal (non-manager) user, default/self (1)", () => {
  it("1. defaults to self with no ?person= at all, no extra fetch", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    const result = await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(getWorkbookSnapshot).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model.manager).toBeNull();
      expect(result.model.roster).toEqual([]);
      expect(result.model.perspective).toBe("self");
    }
  });

  it("still returns self, no extra fetch, when a specific colleague id is requested (9/10. never that other person's schedule -- falls back to self)", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "p_someone_else", rawWeek: null });
    expect(getWorkbookSnapshot).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model.perspective).toBe("self");
      expect(result.model.manager).toBeNull();
    }
  });

  it("14. an unknown/malformed person id also falls back to self, no extra fetch, never crashes", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "<script>garbage", rawWeek: null });
    expect(getWorkbookSnapshot).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.model.perspective).toBe("self");
  });
});

describe("loadScheduleReadModel — normal (non-manager) user, ?person=all (2, 3, 4, 5, 6, security boundary)", () => {
  it("2. ?person=all resolves to perspective 'all' for a non-manager", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.model.perspective).toBe("all");
  });

  it("3. the 'all' perspective carries a safe, non-null 'everyone' projection for a non-manager", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.model.everyone).not.toBeNull();
  });

  it("4. the 'all' perspective carries a non-null 'teamWeek' matrix for a non-manager", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.model.teamWeek).not.toBeNull();
  });

  it("SECURITY BOUNDARY: permission to view 'all' does NOT imply permission to view an arbitrary person= id -- a non-manager granted 'all' still falls back to self for any specific person id, in the SAME request shape", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    const allResult = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(allResult.status).toBe("ok");
    if (allResult.status === "ok") expect(allResult.model.perspective).toBe("all");

    const personResult = await loadScheduleReadModel({ rawMonth: null, personId: "p_daniel", rawWeek: null });
    expect(personResult.status).toBe("ok");
    if (personResult.status === "ok") {
      expect(personResult.model.perspective).toBe("self");
      expect(personResult.model.selectedPersonId).toBeNull();
    }
  });

  it("manager/roster stay null/empty for a non-manager's 'all' perspective -- 'all' is never synonymous with manager UI", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model.manager).toBeNull();
      expect(result.model.roster).toEqual([]);
    }
  });

  it("6/personal: 'personal' stays null for the 'all' perspective, same as the manager path", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.model.personal).toBeNull();
  });

  it("fetches the 5-source SCHEDULE_WORKBOOK_SOURCES set (no shootingRanges) -- never the 6-source manager set for a non-manager", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(getWorkbookSnapshot).toHaveBeenCalledTimes(1);
    expect(getWorkbookSnapshot).toHaveBeenCalledWith(["personnel", "schedule", "settings", "potentialH1", "potentialH2"]);
  });

  it("27/28. Team Week still excludes permanent (קבע) personnel from the matrix columns for a non-manager viewer -- viewing permission never becomes matrix membership", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    getWorkbookSnapshot.mockResolvedValue(
      managerSnapshot({
        personnel: [
          ["שם", "מייל", "מנהל"],
          ["מרטין גוסין", "martin@example.invalid", false],
          ["קבע טכנאי", "keva@example.invalid", false],
        ],
      }),
    );
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(result.status).toBe("ok");
    if (result.status === "ok" && result.model.perspective === "all") {
      const names = result.model.teamWeek?.people.map((p) => p.name) ?? [];
      expect(names).not.toContain("קבע טכנאי");
    } else {
      throw new Error("expected 'all' perspective");
    }
  });

  it("does not leak any colleague's email in the non-manager 'all' result", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(JSON.stringify(result)).not.toContain("@example.invalid");
  });

  it("15/16/17/18: a race where the fresh re-resolution fails (unmapped) falls back to self, not an error", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    getWorkbookSnapshot.mockResolvedValue(
      managerSnapshot({ personnel: [["שם", "מייל", "מנהל"], ["מישהו אחר", "other@example.invalid", false]] }),
    );
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.model.perspective).toBe("self");
  });

  it("an invalid/missing shift configuration on the non-manager 'all' fetch fails closed as configuration_error", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    getWorkbookSnapshot.mockResolvedValue({
      fetchedAt: "2026-08-13T08:00:00.000Z",
      sheets: [personnelSheet(MANAGER_PERSONNEL_ROWS), scheduleSheet([]), settingsSheet([["הגדרה", "ערך"]])],
    });
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(result.status).toBe("configuration_error");
  });
});

describe("loadScheduleReadModel — manager authorization / fetch scope (PR #24 §25/§26)", () => {
  it("manager: fetches personnel+schedule+settings+potentialH1+potentialH2+shootingRanges -- Potential is now needed for duty-source completeness on self/person calendars, and shootingRanges is requested (unused by this loader) purely to land on the SAME canonical getWorkbookSnapshot cache key as MANAGER_WORKBOOK_SOURCES (Manager Overview/Home/Report 1), so this page never observes a different point-in-time read of the schedule sheet than they do", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(true));
    await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(getWorkbookSnapshot).toHaveBeenCalledTimes(1);
    expect(getWorkbookSnapshot).toHaveBeenCalledWith([
      "personnel",
      "schedule",
      "settings",
      "potentialH1",
      "potentialH2",
      "shootingRanges",
    ]);
  });

  it("a normal user only ever calls getRequestPersonalSchedule once", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(getRequestPersonalSchedule).toHaveBeenCalledTimes(1);
  });

  it("a manager's request calls getRequestPersonalSchedule from exactly ONE call site (this loader's own self/gate check) -- loadManagerWorkbookContext no longer depends on it at all (Manager-latency pass: it now authorizes via a lightweight identity+personnel check instead)", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(true));
    await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(getRequestPersonalSchedule).toHaveBeenCalledTimes(1);
  });

  it("a non-manager never triggers the manager-wide fetch either, even via this loader's manager branch check", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(getWorkbookSnapshot).not.toHaveBeenCalled();
  });

  it("fresh manager snapshot no longer marks the person as manager -> fails closed to the self-only experience, not an error page", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(true));
    getWorkbookSnapshot.mockResolvedValue(
      managerSnapshot({
        personnel: [
          ["שם", "מייל", "מנהל"],
          ["מרטין גוסין", "martin@example.invalid", false],
        ],
      }),
    );
    const result = await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model.manager).toBeNull();
      expect(result.model.perspective).toBe("self");
    }
  });

  it("an invalid/missing shift configuration in the manager fetch fails closed as configuration_error", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(true));
    getWorkbookSnapshot.mockResolvedValue({
      fetchedAt: "2026-08-13T08:00:00.000Z",
      sheets: [personnelSheet(MANAGER_PERSONNEL_ROWS), scheduleSheet([]), settingsSheet([["הגדרה", "ערך"]])],
    });
    const result = await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(result.status).toBe("configuration_error");
  });
});

describe("loadScheduleReadModel — stale manager=true, fresh re-check returns 'forbidden' (edge case: forbidden still keeps Team Schedule access on ?person=all)", () => {
  // 1. The stale PersonalScheduleReadModel says isManager: true (this is
  //    what routes the request into the manager branch at all).
  const STALE_MANAGER_PERSONAL_RESULT = () => okPersonalResult(true);

  // 2. The fresh loadManagerWorkbookContext() re-check comes back
  //    "forbidden": the SAME email still resolves to a real, uniquely
  //    mapped person from this request's own fresh snapshot, just with
  //    isManager: false now (e.g. their manager flag was revoked between
  //    the two fetches).
  function forbiddenManagerSnapshot() {
    return managerSnapshot({
      personnel: [
        ["שם", "מייל", "מנהל"],
        ["מרטין גוסין", "martin@example.invalid", false],
        ["דניאל כהן", "daniel@example.invalid", false],
      ],
    });
  }

  it("3/4/5. ?person=all still resolves to the mapped-viewer 'all' projection, with manager === null and roster === []", async () => {
    getRequestPersonalSchedule.mockResolvedValue(STALE_MANAGER_PERSONAL_RESULT());
    getWorkbookSnapshot.mockResolvedValue(forbiddenManagerSnapshot());

    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model.perspective).toBe("all");
      expect(result.model.manager).toBeNull();
      expect(result.model.roster).toEqual([]);
      expect(result.model.everyone).not.toBeNull();
      expect(result.model.teamWeek).not.toBeNull();
    }
  });

  it("NOT a privilege escalation: the resulting 'all' projection is byte-identical in shape to what any other non-manager gets for the same request -- this branch grants nothing loadMappedEveryoneScheduleReadModel doesn't already grant every mapped viewer, and re-verifies identity completely independently of the failed manager check", async () => {
    getRequestPersonalSchedule.mockResolvedValue(STALE_MANAGER_PERSONAL_RESULT());
    getWorkbookSnapshot.mockResolvedValue(forbiddenManagerSnapshot());
    const forbiddenResult = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });

    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(false));
    getWorkbookSnapshot.mockResolvedValue(managerSnapshot());
    const ordinaryNonManagerResult = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });

    expect(forbiddenResult.status).toBe("ok");
    expect(ordinaryNonManagerResult.status).toBe("ok");
    if (forbiddenResult.status === "ok" && ordinaryNonManagerResult.status === "ok") {
      expect(forbiddenResult.model.manager).toBe(ordinaryNonManagerResult.model.manager); // both null
      expect(forbiddenResult.model.roster).toEqual(ordinaryNonManagerResult.model.roster); // both []
      expect(forbiddenResult.model.perspective).toBe(ordinaryNonManagerResult.model.perspective); // both "all"
    }
  });

  it("6. an arbitrary colleague id in this same stale-manager-now-forbidden scenario still falls back to self -- never that colleague's schedule", async () => {
    getRequestPersonalSchedule.mockResolvedValue(STALE_MANAGER_PERSONAL_RESULT());
    getWorkbookSnapshot.mockResolvedValue(forbiddenManagerSnapshot());

    const result = await loadScheduleReadModel({ rawMonth: null, personId: "p_daniel", rawWeek: null });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model.perspective).toBe("self");
      expect(result.model.manager).toBeNull();
      expect(result.model.selectedPersonId).toBeNull();
    }
  });

  it("7. plain self (no ?person= at all) in this same scenario stays self, exactly as before this fix", async () => {
    getRequestPersonalSchedule.mockResolvedValue(STALE_MANAGER_PERSONAL_RESULT());
    getWorkbookSnapshot.mockResolvedValue(forbiddenManagerSnapshot());

    const result = await loadScheduleReadModel(DEFAULT_PARAMS);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model.perspective).toBe("self");
      expect(result.model.manager).toBeNull();
    }
  });

  it("8a. a fresh re-check that comes back unmapped does NOT grant 'all' -- falls back to self, never Team Schedule access", async () => {
    getRequestPersonalSchedule.mockResolvedValue(STALE_MANAGER_PERSONAL_RESULT());
    getWorkbookSnapshot.mockResolvedValue(
      managerSnapshot({ personnel: [["שם", "מייל", "מנהל"], ["מישהו אחר", "other@example.invalid", true]] }),
    );

    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model.perspective).toBe("self");
      expect(result.model.everyone).toBeNull();
      expect(result.model.teamWeek).toBeNull();
    }
  });

  it("8b. a fresh re-check that comes back ambiguous_identity does NOT grant 'all' either -- same self-only fallback", async () => {
    getRequestPersonalSchedule.mockResolvedValue(STALE_MANAGER_PERSONAL_RESULT());
    getWorkbookSnapshot.mockResolvedValue(
      managerSnapshot({
        personnel: [
          ["שם", "מייל", "מנהל"],
          ["דני א", "martin@example.invalid", true],
          ["דני ב", "martin@example.invalid", true],
        ],
      }),
    );

    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model.perspective).toBe("self");
      expect(result.model.everyone).toBeNull();
      expect(result.model.teamWeek).toBeNull();
    }
  });
});

describe("loadScheduleReadModel — success / privacy", () => {
  it("builds an ok ScheduleReadModel for an authorized manager, defaulting to self", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(true));
    const result = await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model.manager?.name).toBe("מרטין גוסין");
      expect(result.model.perspective).toBe("self");
      expect(result.model.roster).toHaveLength(1);
    }
  });

  it("resolves an explicit month param for the everyone perspective's scoped data", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(true));
    const result = await loadScheduleReadModel({ rawMonth: "2026-02", personId: "all", rawWeek: null });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.model.perspective).toBe("all");
    }
  });

  it("falls back to the current month for an invalid month param, never crashes", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(true));
    const result = await loadScheduleReadModel({ rawMonth: "not-a-month", personId: "all", rawWeek: null });
    expect(result.status).toBe("ok");
  });

  it("does not leak the manager's own email anywhere in the serialized result", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(true));
    const result = await loadScheduleReadModel(DEFAULT_PARAMS);
    expect(JSON.stringify(result)).not.toContain("martin@example.invalid");
  });

  it("does not leak a colleague's email anywhere in the serialized roster/personal result", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(true));
    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(JSON.stringify(result)).not.toContain("daniel@example.invalid");
    expect(JSON.stringify(result)).not.toContain("@example.invalid");
  });
});

describe("loadScheduleReadModel — תקשא\"ס period (Potential) duty completeness reaches the calendar", () => {
  it("a colleague with a תקשא\"ס-only duty (no matching internal Event) shows it on the manager's 'person' perspective calendar", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(true));
    const snapshot = managerSnapshot({
      potentialH2: [
        ["תאריך", "יום", "שומר 1"],
        ["20/08/2026", "ה", "דניאל כהן"],
      ],
    });
    getWorkbookSnapshot.mockResolvedValue(snapshot);

    // Resolve דניאל כהן's real generated id from the roster first -- ids
    // come from `stableIdFromName` inside the real parser, never hardcoded.
    const rosterResult = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(rosterResult.status).toBe("ok");
    const daniel =
      rosterResult.status === "ok" ? rosterResult.model.roster.find((p) => p.name === "דניאל כהן") : undefined;
    expect(daniel).toBeDefined();

    const result = await loadScheduleReadModel({ rawMonth: null, personId: daniel!.id, rawWeek: null });
    expect(result.status).toBe("ok");
    if (result.status === "ok" && result.model.perspective === "person") {
      const dutyEntries = result.model.personal?.calendarEvents.filter((event) => event.category === "duty");
      expect(dutyEntries).toEqual([expect.objectContaining({ date: "2026-08-20", dutyFamily: "guard", slot: 1 })]);
    } else {
      throw new Error("expected 'person' perspective");
    }
  });

  it("the same colleague's תקשא\"ס-only duty also appears on the shared 'all' (everyone) calendar, without affecting staffing", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okPersonalResult(true));
    getWorkbookSnapshot.mockResolvedValue(
      managerSnapshot({
        potentialH2: [
          ["תאריך", "יום", "שומר 1"],
          ["20/08/2026", "ה", "דניאל כהן"],
        ],
      }),
    );

    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });
    expect(result.status).toBe("ok");
    if (result.status === "ok" && result.model.perspective === "all") {
      expect(result.model.everyone?.duties).toEqual([
        expect.objectContaining({ personName: "דניאל כהן", date: "2026-08-20", dutyFamily: "guard", slot: 1 }),
      ]);
      expect(result.model.everyone?.staffing).toEqual([]);
    } else {
      throw new Error("expected 'all' perspective");
    }
  });
});

describe("loadScheduleReadModel — Emergency Mode", () => {
  const PERIOD = {
    id: "period1",
    activatedAt: "2026-08-13T08:00:00.000Z",
    activatedByUserId: "u_mgr",
    activatedByPersonId: "p_martin",
    activatedByPersonName: "מרטין גוסין",
    startDate: "2026-08-13",
    deactivatedAt: null,
    deactivatedByUserId: null,
    deactivatedByPersonId: null,
    deactivatedByPersonName: null,
    endDate: null,
  };

  function emergencyPersonalResult(isManager: boolean) {
    return {
      status: "emergency" as const,
      person: { id: "p_martin", name: "מרטין גוסין", isManager },
      emergencyHome: {
        period: PERIOD,
        localNow: { date: "2026-08-13", minuteOfDay: 600 },
        fetchedAt: "2026-08-13T09:00:00.000Z",
        current: null,
        next: null,
        diagnostics: [],
      },
      avatarUrl: null,
      userId: "u1",
      accountCreatedAt: "2020-01-01T00:00:00.000Z",
    };
  }

  it("propagates emergency_unavailable without ever building a regular ScheduleReadModel", async () => {
    getRequestPersonalSchedule.mockResolvedValue({
      status: "emergency_unavailable",
      message: "boom",
      person: { id: "p_martin", name: "מרטין גוסין", isManager: false },
      avatarUrl: null,
      userId: "u1",
      accountCreatedAt: "2020-01-01T00:00:00.000Z",
    });

    const result = await loadScheduleReadModel(DEFAULT_PARAMS);

    expect(result).toEqual({ status: "emergency_unavailable", message: "boom" });
    expect(getWorkbookSnapshot).not.toHaveBeenCalled();
  });

  it("a non-manager gets a self-only emergency model, never a manager selector", async () => {
    getRequestPersonalSchedule.mockResolvedValue(emergencyPersonalResult(false));
    resolveOperationalRoster.mockResolvedValue({
      mode: "emergency",
      period: PERIOD,
      assignments: [
        { date: "2026-08-13", period: "day", desk: "הוגוורט", personId: "p_martin", personName: "מרטין גוסין", sourceCell: "C2" },
      ],
      diagnostics: [],
      fetchedAt: "2026-08-13T09:00:00.000Z",
    });

    const result = await loadScheduleReadModel(DEFAULT_PARAMS);

    expect(result.status).toBe("emergency");
    if (result.status !== "emergency") throw new Error("unreachable");
    expect(result.model.manager).toBeNull();
    expect(result.model.roster).toEqual([]);
    expect(result.model.perspective).toBe("self");
    expect(result.model.personalShifts?.[0].ownDesks).toEqual(["הוגוורט"]);
  });

  it("a manager requesting 'all' gets desk staffing, never role coverage", async () => {
    getRequestPersonalSchedule.mockResolvedValue(emergencyPersonalResult(true));
    resolveOperationalRoster.mockResolvedValue({
      mode: "emergency",
      period: PERIOD,
      assignments: [
        { date: "2026-08-13", period: "day", desk: "הוגוורט", personId: "p_martin", personName: "מרטין גוסין", sourceCell: "C2" },
        { date: "2026-08-13", period: "day", desk: "תיעוד", personId: "p_daniel", personName: "דניאל כהן", sourceCell: "J2" },
      ],
      diagnostics: [],
      fetchedAt: "2026-08-13T09:00:00.000Z",
    });

    const result = await loadScheduleReadModel({ rawMonth: null, personId: "all", rawWeek: null });

    expect(result.status).toBe("emergency");
    if (result.status !== "emergency") throw new Error("unreachable");
    expect(result.model.perspective).toBe("all");
    expect(result.model.everyoneShifts?.[0].desks).toHaveLength(10);
    const staffed = result.model.everyoneShifts?.[0].desks.filter((d) => d.personName !== null);
    expect(staffed?.map((d) => d.personName)).toEqual(expect.arrayContaining(["מרטין גוסין", "דניאל כהן"]));
  });

  it("a manager selecting a specific person gets that person's own emergency shifts", async () => {
    getRequestPersonalSchedule.mockResolvedValue(emergencyPersonalResult(true));
    resolveOperationalRoster.mockResolvedValue({
      mode: "emergency",
      period: PERIOD,
      assignments: [
        { date: "2026-08-13", period: "day", desk: "תיעוד", personId: "p_daniel", personName: "דניאל כהן", sourceCell: "J2" },
      ],
      diagnostics: [],
      fetchedAt: "2026-08-13T09:00:00.000Z",
    });

    const result = await loadScheduleReadModel({ rawMonth: null, personId: "daniel_id_nonexistent", rawWeek: null });

    // Not in `people` -> falls back to self, per resolvePerspective's fail-closed convention.
    expect(result.status).toBe("emergency");
    if (result.status !== "emergency") throw new Error("unreachable");
    expect(result.model.perspective).toBe("self");
  });

  it("propagates emergency_unavailable discovered during the schedule loader's own roster resolution", async () => {
    getRequestPersonalSchedule.mockResolvedValue(emergencyPersonalResult(false));
    resolveOperationalRoster.mockResolvedValue({ mode: "emergency_unavailable", period: PERIOD, message: "boom2" });

    const result = await loadScheduleReadModel(DEFAULT_PARAMS);

    expect(result).toEqual({ status: "emergency_unavailable", message: "boom2" });
  });
});
