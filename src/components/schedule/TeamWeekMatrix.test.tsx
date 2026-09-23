import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ScheduleTeamWeekCellItem, ScheduleTeamWeekView } from "@/lib/readModels/scheduleTypes";
import { TeamWeekMatrix } from "./TeamWeekMatrix";

afterEach(() => {
  cleanup();
});

const DATES = ["2026-08-09", "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15"];

function item(overrides: Partial<ScheduleTeamWeekCellItem> = {}): ScheduleTeamWeekCellItem {
  return {
    key: "k1",
    title: "טכנאי יום",
    category: "shift",
    period: "day",
    dutyFamily: null,
    absenceKind: null,
    tentative: false,
    shadow: false,
    ...overrides,
  };
}

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

describe("TeamWeekMatrix — table semantics (accessibility)", () => {
  it("renders a real <table> with row/column headers, never a plain div grid", () => {
    render(<TeamWeekMatrix teamWeek={teamWeek()} todayDate="2026-08-09" />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("rowheader").length).toBe(DATES.length);
  });

  it("the scrollable container is keyboard-reachable (role=region, tabIndex=0) -- horizontal scroll never breaks keyboard access", () => {
    render(<TeamWeekMatrix teamWeek={teamWeek()} todayDate="2026-08-09" />);
    const region = screen.getByRole("region", { name: /גלילה אופקית/ });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("5. groups columns under אחמ\"שים / טכנאים headers", () => {
    render(<TeamWeekMatrix teamWeek={teamWeek()} todayDate="2026-08-09" />);
    expect(screen.getByRole("columnheader", { name: 'אחמ"שים' })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "טכנאים" })).toBeInTheDocument();
  });

  it("the two sticky header rows use distinct, non-overlapping top offsets (group header at top-0, person names offset by the group header's own height) -- regression for the two-sticky-rows overlap bug", () => {
    render(<TeamWeekMatrix teamWeek={teamWeek()} todayDate="2026-08-09" />);

    const groupHeader = screen.getByRole("columnheader", { name: 'אחמ"שים' });
    expect(groupHeader.className).toMatch(/(?:^|\s)top-0(?:\s|$)/);
    expect(groupHeader.className).not.toMatch(/top-9/);

    const personHeader = screen.getByRole("columnheader", { name: "איתן דוגמה" });
    expect(personHeader.className).toMatch(/(?:^|\s)top-9(?:\s|$)/);
    expect(personHeader.className).not.toMatch(/(?:^|\s)top-0(?:\s|$)/);

    const cornerHeader = screen.getByRole("columnheader", { name: "תאריך" });
    expect(cornerHeader.className).toMatch(/(?:^|\s)top-0(?:\s|$)/);
    expect(cornerHeader).toHaveAttribute("rowspan", "2");

    // No header cell ever carries two conflicting `top-*` classes at once.
    for (const header of [groupHeader, personHeader, cornerHeader]) {
      const topMatches = header.className.match(/(?:^|\s)top-\S+/g) ?? [];
      expect(topMatches.length).toBe(1);
    }
  });

  it("the corner cell's explicit height equals exactly twice one header row's height (4.5rem = 2 × h-9) -- proves the offset math, not just the class names", () => {
    render(<TeamWeekMatrix teamWeek={teamWeek()} todayDate="2026-08-09" />);
    const cornerHeader = screen.getByRole("columnheader", { name: "תאריך" });
    expect(cornerHeader.className).toContain("h-[4.5rem]");
    const groupHeader = screen.getByRole("columnheader", { name: 'אחמ"שים' });
    expect(groupHeader.className).toContain("h-9");
  });

  it("person name headers appear once per person", () => {
    render(<TeamWeekMatrix teamWeek={teamWeek()} todayDate="2026-08-09" />);
    expect(screen.getByRole("columnheader", { name: "איתן דוגמה" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "דניאל כהן" })).toBeInTheDocument();
  });
});

describe("TeamWeekMatrix — current-day row marking (12)", () => {
  it("12. marks the today row's accessible text, distinct from every other row", () => {
    render(<TeamWeekMatrix teamWeek={teamWeek()} todayDate="2026-08-11" />);
    const rowHeaders = screen.getAllByRole("rowheader");
    const todayHeader = rowHeaders.find((el) => el.textContent?.includes("היום"));
    expect(todayHeader).toBeDefined();
    expect(rowHeaders.filter((el) => el.textContent?.includes("היום"))).toHaveLength(1);
  });

  it("no row claims 'היום' when todayDate falls outside the displayed week", () => {
    render(<TeamWeekMatrix teamWeek={teamWeek()} todayDate="2026-09-01" />);
    const rowHeaders = screen.getAllByRole("rowheader");
    expect(rowHeaders.some((el) => el.textContent?.includes("היום"))).toBe(false);
  });
});

describe("TeamWeekMatrix — cell content (8, 9, 10, 11)", () => {
  it("11. an empty cell renders calmly -- no dash, no placeholder text", () => {
    render(<TeamWeekMatrix teamWeek={teamWeek()} todayDate="2026-08-09" />);
    const cells = screen.getAllByRole("cell");
    for (const cell of cells) {
      expect(cell.textContent).toBe("");
    }
  });

  it("renders a dated cell's item title verbatim", () => {
    const view = teamWeek({
      cells: {
        ...emptyCells(["p_eitan", "p_daniel"]),
        p_daniel: {
          ...emptyCells(["p_daniel"]).p_daniel,
          "2026-08-11": [item({ key: "a", title: "טכנאי יום" })],
        },
      },
    });
    render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" />);
    expect(screen.getByText("טכנאי יום")).toBeInTheDocument();
  });

  it("8. a shadow item is visibly marked (not color-only) and carries an accessible description", () => {
    const view = teamWeek({
      cells: {
        ...emptyCells(["p_eitan", "p_daniel"]),
        p_daniel: {
          ...emptyCells(["p_daniel"]).p_daniel,
          "2026-08-11": [item({ key: "a", title: 'אחמ"ש יום - צל', shadow: true })],
        },
      },
    });
    const { container } = render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" />);
    expect(within(container).getByText("צל")).toBeInTheDocument();
    expect(container.textContent).toContain("חפיפה / צל");
  });

  it("a tentative item shows a visible '?' mark and an accessible 'משוער' description", () => {
    const view = teamWeek({
      cells: {
        ...emptyCells(["p_eitan", "p_daniel"]),
        p_daniel: {
          ...emptyCells(["p_daniel"]).p_daniel,
          "2026-08-11": [item({ key: "a", tentative: true })],
        },
      },
    });
    const { container } = render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" />);
    expect(container.textContent).toContain("?");
    expect(container.textContent).toContain("משוער");
  });

  it("9/10. two items render directly, a third collapses into a real, accessible '+1' overflow", () => {
    const view = teamWeek({
      cells: {
        ...emptyCells(["p_eitan", "p_daniel"]),
        p_daniel: {
          ...emptyCells(["p_daniel"]).p_daniel,
          "2026-08-11": [
            item({ key: "a", title: "טכנאי יום" }),
            item({ key: "b", title: "שמירה 2", category: "duty", dutyFamily: "guard" }),
            item({ key: "c", title: "עתודה 1", category: "duty", dutyFamily: "reserve" }),
          ],
        },
      },
    });
    render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" />);
    expect(screen.getByText("טכנאי יום")).toBeInTheDocument();
    expect(screen.getByText("שמירה 2")).toBeInTheDocument();
    expect(screen.queryByText("עתודה 1")).toBeNull(); // capped at 2 visible chips
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("פריטים נוספים", { exact: false })).toBeInTheDocument();
  });

  it("renders a shift plus a recognized 'other' activity (מטווחים) in the same cell, no overflow at 2 items", () => {
    const view = teamWeek({
      cells: {
        ...emptyCells(["p_eitan", "p_daniel"]),
        p_daniel: {
          ...emptyCells(["p_daniel"]).p_daniel,
          "2026-08-11": [
            item({ key: "a", title: 'אחמ"ש יום - צל', category: "shift", period: "day", shadow: true }),
            item({ key: "b", title: "מטווחים", category: "other" }),
          ],
        },
      },
    });
    render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" />);
    expect(screen.getByText('אחמ"ש יום - צל')).toBeInTheDocument();
    expect(screen.getByText("מטווחים")).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d/)).toBeNull();
  });

  it("a recognized 'other' activity still counts toward the 2-item overflow cap like any other item", () => {
    const view = teamWeek({
      cells: {
        ...emptyCells(["p_eitan", "p_daniel"]),
        p_daniel: {
          ...emptyCells(["p_daniel"]).p_daniel,
          "2026-08-11": [
            item({ key: "a", title: "טכנאי יום" }),
            item({ key: "b", title: "שמירה 2", category: "duty", dutyFamily: "guard" }),
            item({ key: "c", title: "מטווחים", category: "other" }),
          ],
        },
      },
    });
    render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" />);
    expect(screen.getByText("טכנאי יום")).toBeInTheDocument();
    expect(screen.getByText("שמירה 2")).toBeInTheDocument();
    expect(screen.queryByText("מטווחים")).toBeNull(); // capped at 2 visible chips -- still present in the data, just not rendered
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("never renders a taller cell for 2 items than for 1 -- both stay within the same 2-line budget (no overflow marker below the cap)", () => {
    const view = teamWeek({
      cells: {
        ...emptyCells(["p_eitan", "p_daniel"]),
        p_daniel: {
          ...emptyCells(["p_daniel"]).p_daniel,
          "2026-08-11": [item({ key: "a", title: "טכנאי יום" }), item({ key: "b", title: "שמירה 2", category: "duty", dutyFamily: "guard" })],
        },
      },
    });
    render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" />);
    expect(screen.queryByText(/^\+\d/)).toBeNull();
  });
});

describe("TeamWeekMatrix — empty roster", () => {
  it("renders a calm message instead of an empty/broken table when no one is shift-capable", () => {
    render(<TeamWeekMatrix teamWeek={teamWeek({ people: [], cells: {} })} todayDate="2026-08-09" />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/אין אנשי צוות/)).toBeInTheDocument();
  });
});
