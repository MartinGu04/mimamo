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
    { id: "p_eitan", name: "איתן דוגמה", roleGroup: "supervisor" as const },
    { id: "p_daniel", name: "דניאל כהן", roleGroup: "technician" as const },
    { id: "p_noa", name: "נועה דוגמה", roleGroup: "technician" as const },
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

describe("filterTeamWeekPeople", () => {
  const view = teamWeek({
    cells: {
      ...emptyCells(["p_eitan", "p_daniel", "p_noa"]),
      p_daniel: { ...emptyCells(["p_daniel"]).p_daniel, "2026-08-11": [{ key: "a", title: "טכנאי יום", category: "shift", period: "day", dutyFamily: null, absenceKind: null, tentative: false, shadow: false }] },
    },
  });

  it("'active' (default) hides a zero-event eligible person", () => {
    const visible = filterTeamWeekPeople(view, "active");
    expect(visible.map((p) => p.id)).toEqual(["p_daniel"]);
  });

  it("'all' reveals every eligible person, including zero-event ones", () => {
    const visible = filterTeamWeekPeople(view, "all");
    expect(visible.map((p) => p.id)).toEqual(["p_eitan", "p_daniel", "p_noa"]);
  });

  it("preserves people order (supervisors/technicians in original roster order) under both filters", () => {
    expect(filterTeamWeekPeople(view, "all").map((p) => p.id)).toEqual(view.people.map((p) => p.id));
  });

  it("never mutates the underlying team-week view -- filtering is presentation-only", () => {
    const before = JSON.stringify(view);
    filterTeamWeekPeople(view, "active");
    filterTeamWeekPeople(view, "all");
    expect(JSON.stringify(view)).toBe(before);
  });

  it("a permanent person can never reappear under 'all' -- buildScheduleTeamWeekView already excludes them from teamWeek.people, and this filter never adds anyone back", () => {
    // teamWeek.people is the read model's own already-filtered roster (item
    // 1's permanent-personnel exclusion) -- this test just proves
    // filterTeamWeekPeople("all") is a pure pass-through, never a place
    // permanent personnel could sneak back in.
    expect(filterTeamWeekPeople(view, "all")).toEqual(view.people);
  });
});
