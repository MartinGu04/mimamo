import { describe, expect, it } from "vitest";
import type { ScheduleTeamWeekView } from "@/lib/readModels/scheduleTypes";
import { activeTeamWeekPersonIds, filterTeamWeekPeople, parseTeamWeekPeopleFilter } from "./teamWeekFilter";

const DATES = ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"];

function emptyCells(peopleIds: string[]): ScheduleTeamWeekView["cells"] {
  const cells: ScheduleTeamWeekView["cells"] = {};
  for (const id of peopleIds) {
    cells[id] = Object.fromEntries(DATES.map((date) => [date, []]));
  }
  return cells;
}

function teamWeek(overrides: Partial<ScheduleTeamWeekView> = {}): ScheduleTeamWeekView {
  const people = overrides.people ?? [
    { id: "p_eitan", name: "איתן דוגמה", roleGroup: "supervisor" as const, serviceCategory: "regular" as const },
    { id: "p_daniel", name: "דניאל כהן", roleGroup: "technician" as const, serviceCategory: "regular" as const },
    { id: "p_noa", name: "נועה דוגמה", roleGroup: "technician" as const, serviceCategory: "regular" as const },
  ];
  return {
    weekStart: "2026-08-09",
    weekEnd: "2026-08-15",
    dates: DATES,
    people,
    cells: emptyCells(people.map((p) => p.id)),
    ...overrides,
  };
}

describe("parseTeamWeekPeopleFilter", () => {
  it("defaults to 'active' when no param is present", () => {
    expect(parseTeamWeekPeopleFilter(null)).toBe("active");
  });

  it("parses 'active' and 'all' explicitly", () => {
    expect(parseTeamWeekPeopleFilter("active")).toBe("active");
    expect(parseTeamWeekPeopleFilter("all")).toBe("all");
  });

  it("safely falls back to 'active' for any invalid/unrecognized value -- never a crash, never silently 'all'", () => {
    expect(parseTeamWeekPeopleFilter("")).toBe("active");
    expect(parseTeamWeekPeopleFilter("everyone")).toBe("active");
    expect(parseTeamWeekPeopleFilter("<script>")).toBe("active");
  });
});

describe("activeTeamWeekPersonIds", () => {
  it("a person with zero items anywhere in the week is never active", () => {
    const view = teamWeek();
    expect(activeTeamWeekPersonIds(view).has("p_eitan")).toBe(false);
  });

  it("a person with only a shift item is active", () => {
    const view = teamWeek({
      cells: {
        ...emptyCells(["p_eitan", "p_daniel", "p_noa"]),
        p_daniel: { ...emptyCells(["p_daniel"]).p_daniel, "2026-08-11": [{ key: "a", title: "טכנאי יום", category: "shift", period: "day", dutyFamily: null, absenceKind: null, tentative: false, shadow: false }] },
      },
    });
    expect(activeTeamWeekPersonIds(view).has("p_daniel")).toBe(true);
  });

  it("a person with only a duty item is active", () => {
    const view = teamWeek({
      cells: {
        ...emptyCells(["p_eitan", "p_daniel", "p_noa"]),
        p_daniel: {
          ...emptyCells(["p_daniel"]).p_daniel,
          "2026-08-11": [{ key: "a", title: "שמירה 2", category: "duty", period: "unspecified", dutyFamily: "guard", absenceKind: null, tentative: false, shadow: false }],
        },
      },
    });
    expect(activeTeamWeekPersonIds(view).has("p_daniel")).toBe(true);
  });

  it("a person with only an absence item is active", () => {
    const view = teamWeek({
      cells: {
        ...emptyCells(["p_eitan", "p_daniel", "p_noa"]),
        p_daniel: {
          ...emptyCells(["p_daniel"]).p_daniel,
          "2026-08-11": [{ key: "a", title: "חופש", category: "absence", period: "unspecified", dutyFamily: null, absenceKind: "vacation", tentative: false, shadow: false }],
        },
      },
    });
    expect(activeTeamWeekPersonIds(view).has("p_daniel")).toBe(true);
  });

  it("a person with only a recognized 'other' activity (מטווחים) is active -- the SAME relevance rule buildScheduleTeamWeekView already applied, never a second definition", () => {
    const view = teamWeek({
      cells: {
        ...emptyCells(["p_eitan", "p_daniel", "p_noa"]),
        p_noa: {
          ...emptyCells(["p_noa"]).p_noa,
          "2026-08-12": [{ key: "a", title: "מטווחים", category: "other", period: "unspecified", dutyFamily: null, absenceKind: null, tentative: false, shadow: false }],
        },
      },
    });
    expect(activeTeamWeekPersonIds(view).has("p_noa")).toBe(true);
  });
});

describe("filterTeamWeekPeople -- 'active' always keeps regular (חובה) people, only hides an inactive reserve (מילואים) person", () => {
  // Genuinely supervisor-first/technician-second, matching the real order
  // `buildScheduleTeamWeekView` produces (every supervisor, roster order
  // preserved, then every technician, roster order preserved) -- NOT an
  // interleaved list, so tests below that assert order-preservation
  // actually prove that contract rather than accidentally passing on a
  // fixture that was never grouped that way to begin with.
  function mixedRosterView(overrides: Partial<ScheduleTeamWeekView> = {}): ScheduleTeamWeekView {
    return teamWeek({
      people: [
        { id: "p_reg_sup", name: "אחמ\"ש חובה", roleGroup: "supervisor", serviceCategory: "regular" },
        { id: "p_res_active_sup", name: "אחמ\"ש מילואים פעיל", roleGroup: "supervisor", serviceCategory: "reserve" },
        { id: "p_res_inactive_sup", name: "אחמ\"ש מילואים לא פעיל", roleGroup: "supervisor", serviceCategory: "reserve" },
        { id: "p_reg_tech", name: "טכנאי חובה", roleGroup: "technician", serviceCategory: "regular" },
        { id: "p_res_active_tech", name: "טכנאי מילואים פעיל", roleGroup: "technician", serviceCategory: "reserve" },
        { id: "p_res_inactive_tech", name: "טכנאי מילואים לא פעיל", roleGroup: "technician", serviceCategory: "reserve" },
      ],
      cells: {
        ...emptyCells([
          "p_reg_sup",
          "p_reg_tech",
          "p_res_active_sup",
          "p_res_inactive_sup",
          "p_res_active_tech",
          "p_res_inactive_tech",
        ]),
        p_res_active_sup: {
          ...emptyCells(["p_res_active_sup"]).p_res_active_sup,
          "2026-08-11": [{ key: "a", title: 'אחמ"ש יום', category: "shift", period: "day", dutyFamily: null, absenceKind: null, tentative: false, shadow: false }],
        },
        p_res_active_tech: {
          ...emptyCells(["p_res_active_tech"]).p_res_active_tech,
          "2026-08-11": [{ key: "b", title: "טכנאי יום", category: "shift", period: "day", dutyFamily: null, absenceKind: null, tentative: false, shadow: false }],
        },
      },
      ...overrides,
    });
  }

  it("1. a regular supervisor with zero events stays visible under 'active'", () => {
    const visible = filterTeamWeekPeople(mixedRosterView(), "active");
    expect(visible.map((p) => p.id)).toContain("p_reg_sup");
  });

  it("2. a regular technician with zero events stays visible under 'active'", () => {
    const visible = filterTeamWeekPeople(mixedRosterView(), "active");
    expect(visible.map((p) => p.id)).toContain("p_reg_tech");
  });

  it("3. an inactive reserve supervisor is hidden under 'active'", () => {
    const visible = filterTeamWeekPeople(mixedRosterView(), "active");
    expect(visible.map((p) => p.id)).not.toContain("p_res_inactive_sup");
  });

  it("4. an inactive reserve technician is hidden under 'active'", () => {
    const visible = filterTeamWeekPeople(mixedRosterView(), "active");
    expect(visible.map((p) => p.id)).not.toContain("p_res_inactive_tech");
  });

  it("5. an active reserve person (supervisor and technician) remains visible under 'active'", () => {
    const visible = filterTeamWeekPeople(mixedRosterView(), "active").map((p) => p.id);
    expect(visible).toContain("p_res_active_sup");
    expect(visible).toContain("p_res_active_tech");
  });

  it("full expected 'active' visibility set for the mixed roster", () => {
    const visible = filterTeamWeekPeople(mixedRosterView(), "active").map((p) => p.id);
    expect(visible).toEqual(["p_reg_sup", "p_res_active_sup", "p_reg_tech", "p_res_active_tech"]);
  });

  it("6. 'all' reveals every eligible person, including the inactive reserves", () => {
    const visible = filterTeamWeekPeople(mixedRosterView(), "all").map((p) => p.id);
    expect(visible).toEqual([
      "p_reg_sup",
      "p_res_active_sup",
      "p_res_inactive_sup",
      "p_reg_tech",
      "p_res_active_tech",
      "p_res_inactive_tech",
    ]);
  });

  it("7. preserves supervisor-first/technician-second and each group's roster-relative order under both filters", () => {
    const view = mixedRosterView();
    // The fixture itself must actually BE supervisor-first/technician-second
    // (the real order buildScheduleTeamWeekView produces) -- otherwise the
    // assertions below would only prove pass-through behavior, never the
    // stated ordering contract.
    expect(view.people.map((p) => p.roleGroup)).toEqual([
      "supervisor",
      "supervisor",
      "supervisor",
      "technician",
      "technician",
      "technician",
    ]);

    expect(filterTeamWeekPeople(view, "all").map((p) => p.id)).toEqual(view.people.map((p) => p.id));
    // Under "active", the inactive reserves drop out but supervisor-first/
    // technician-second AND each group's roster-relative order among
    // everyone remaining is unchanged (never re-sorted).
    expect(filterTeamWeekPeople(view, "active").map((p) => p.id)).toEqual([
      "p_reg_sup",
      "p_res_active_sup",
      "p_reg_tech",
      "p_res_active_tech",
    ]);
  });

  it("never mutates the underlying team-week view -- filtering is presentation-only", () => {
    const view = mixedRosterView();
    const before = JSON.stringify(view);
    filterTeamWeekPeople(view, "active");
    filterTeamWeekPeople(view, "all");
    expect(JSON.stringify(view)).toBe(before);
  });

  it("a permanent/unclassified person can never reappear under 'all' -- buildScheduleTeamWeekView already excludes them from teamWeek.people, and this filter never adds anyone back", () => {
    // teamWeek.people is the read model's own already-filtered roster (item
    // 1's permanent-personnel exclusion) -- this test just proves
    // filterTeamWeekPeople("all") is a pure pass-through, never a place
    // permanent personnel could sneak back in.
    const view = mixedRosterView();
    expect(filterTeamWeekPeople(view, "all")).toEqual(view.people);
  });
});
