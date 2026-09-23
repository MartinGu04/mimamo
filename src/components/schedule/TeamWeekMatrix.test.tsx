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
    { id: "p_eitan", name: "איתן דוגמה", roleGroup: "supervisor" as const, serviceCategory: "regular" as const },
    { id: "p_daniel", name: "דניאל כהן", roleGroup: "technician" as const, serviceCategory: "regular" as const },
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
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-08-09" peopleFilter="all" />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("rowheader").length).toBe(DATES.length);
  });

  it("the scrollable container is keyboard-reachable (role=region, tabIndex=0) -- horizontal scroll never breaks keyboard access", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-08-09" peopleFilter="all" />);
    const region = screen.getByRole("region", { name: /גלילה אופקית/ });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("5. groups columns under אחמ\"שים / טכנאים headers", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-08-09" peopleFilter="all" />);
    expect(screen.getByRole("columnheader", { name: 'אחמ"שים' })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "טכנאים" })).toBeInTheDocument();
  });

  it("the two sticky header rows use distinct, non-overlapping top offsets (group header at top-0, person names offset by the group header's own height) -- regression for the two-sticky-rows overlap bug", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-08-09" peopleFilter="all" />);

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
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-08-09" peopleFilter="all" />);
    const cornerHeader = screen.getByRole("columnheader", { name: "תאריך" });
    expect(cornerHeader.className).toContain("h-[4.5rem]");
    const groupHeader = screen.getByRole("columnheader", { name: 'אחמ"שים' });
    expect(groupHeader.className).toContain("h-9");
  });

  it("person name headers appear once per person", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-08-09" peopleFilter="all" />);
    expect(screen.getByRole("columnheader", { name: "איתן דוגמה" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "דניאל כהן" })).toBeInTheDocument();
  });
});

describe("TeamWeekMatrix — current-day row marking (12)", () => {
  it("12. marks the today row's accessible text, distinct from every other row", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-08-11" peopleFilter="all" />);
    const rowHeaders = screen.getAllByRole("rowheader");
    const todayHeader = rowHeaders.find((el) => el.textContent?.includes("היום"));
    expect(todayHeader).toBeDefined();
    expect(rowHeaders.filter((el) => el.textContent?.includes("היום"))).toHaveLength(1);
  });

  it("no row claims 'היום' when todayDate falls outside the displayed week", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-09-01" peopleFilter="all" />);
    const rowHeaders = screen.getAllByRole("rowheader");
    expect(rowHeaders.some((el) => el.textContent?.includes("היום"))).toBe(false);
  });

  it("the today date cell gets a stronger, non-flat visual anchor (a rounded ring/pill), not just the row's own flat background", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-08-11" peopleFilter="all" />);
    const rowHeaders = screen.getAllByRole("rowheader");
    const todayHeader = rowHeaders.find((el) => el.textContent?.includes("היום"));
    expect(todayHeader).toBeDefined();
    const pill = todayHeader!.querySelector("div");
    expect(pill).not.toBeNull();
    expect(pill!.className).toContain("ring-1");
    expect(pill!.className).toContain("ring-primary/50");
    expect(pill!.className).toContain("rounded-lg");
  });

  it("a visible (non-sr-only) 'היום' indicator renders inside the today cell", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-08-11" peopleFilter="all" />);
    const rowHeaders = screen.getAllByRole("rowheader");
    const todayHeader = rowHeaders.find((el) => el.textContent?.includes("היום"));
    const visibleMarkers = Array.from(todayHeader!.querySelectorAll('[aria-hidden="true"]')).filter((el) => el.textContent === "היום");
    expect(visibleMarkers.length).toBeGreaterThan(0);
  });

  it("a non-today row never gets the ring/pill treatment", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-08-11" peopleFilter="all" />);
    const rowHeaders = screen.getAllByRole("rowheader");
    const otherHeader = rowHeaders.find((el) => !el.textContent?.includes("היום"));
    expect(otherHeader).toBeDefined();
    const pill = otherHeader!.querySelector("div");
    expect(pill!.className).not.toContain("ring-primary/50");
  });
});

describe("TeamWeekMatrix — supervisor/technician group divider (3)", () => {
  it("the group boundary column's header and body cells carry a visible divider border; the first supervisor column never does", () => {
    const view = teamWeek({
      people: [
        { id: "p_eitan", name: "איתן דוגמה", roleGroup: "supervisor" as const, serviceCategory: "regular" as const },
        { id: "p_daniel", name: "דניאל כהן", roleGroup: "technician" as const, serviceCategory: "regular" as const },
        { id: "p_noa", name: "נועה דוגמה", roleGroup: "technician" as const, serviceCategory: "regular" as const },
      ],
    });
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="all" />);

    const technicianGroupHeader = screen.getByRole("columnheader", { name: "טכנאים" });
    expect(technicianGroupHeader.className).toContain("border-s-2");

    const supervisorGroupHeader = screen.getByRole("columnheader", { name: 'אחמ"שים' });
    expect(supervisorGroupHeader.className).not.toContain("border-s-2");

    const firstTechnicianHeader = screen.getByRole("columnheader", { name: "דניאל כהן" });
    expect(firstTechnicianHeader.className).toContain("border-s-2");

    const secondTechnicianHeader = screen.getByRole("columnheader", { name: "נועה דוגמה" });
    expect(secondTechnicianHeader.className).not.toContain("border-s-2");

    const firstSupervisorHeader = screen.getByRole("columnheader", { name: "איתן דוגמה" });
    expect(firstSupervisorHeader.className).not.toContain("border-s-2");
  });

  it("the divider is a real border on each body row's boundary cell too, not just the header (survives vertical scroll -- it's part of the cell, not an overlay)", () => {
    const view = teamWeek({
      people: [
        { id: "p_eitan", name: "איתן דוגמה", roleGroup: "supervisor" as const, serviceCategory: "regular" as const },
        { id: "p_daniel", name: "דניאל כהן", roleGroup: "technician" as const, serviceCategory: "regular" as const },
      ],
    });
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="all" />);
    const cells = screen.getAllByRole("cell");
    const boundaryCells = cells.filter((cell) => cell.className.includes("border-s-2"));
    // One boundary <td> per date row.
    expect(boundaryCells).toHaveLength(DATES.length);
  });

  it("renders with a single group and no divider at all when only one role group is present", () => {
    const view = teamWeek({
      people: [
        { id: "p_daniel", name: "דניאל כהן", roleGroup: "technician" as const, serviceCategory: "regular" as const },
        { id: "p_noa", name: "נועה דוגמה", roleGroup: "technician" as const, serviceCategory: "regular" as const },
      ],
    });
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="all" />);
    expect(screen.queryByRole("columnheader", { name: 'אחמ"שים' })).toBeNull();
    const technicianGroupHeader = screen.getByRole("columnheader", { name: "טכנאים" });
    expect(technicianGroupHeader.className).not.toContain("border-s-2");
  });
});

describe("TeamWeekMatrix — active-only people filter: regular (חובה) always visible, reserve (מילואים) activity-gated (5)", () => {
  function mixedRosterView(): ScheduleTeamWeekView {
    return teamWeek({
      people: [
        { id: "p_reg_sup", name: "אחמ\"ש חובה", roleGroup: "supervisor" as const, serviceCategory: "regular" as const },
        { id: "p_reg_tech", name: "טכנאי חובה", roleGroup: "technician" as const, serviceCategory: "regular" as const },
        { id: "p_res_inactive", name: "מילואים לא פעיל", roleGroup: "technician" as const, serviceCategory: "reserve" as const },
        { id: "p_res_active", name: "מילואים פעיל", roleGroup: "technician" as const, serviceCategory: "reserve" as const },
      ],
      cells: {
        ...emptyCells(["p_reg_sup", "p_reg_tech", "p_res_inactive", "p_res_active"]),
        p_res_active: {
          ...emptyCells(["p_res_active"]).p_res_active,
          "2026-08-11": [item({ key: "a", title: "טכנאי יום" })],
        },
      },
    });
  }

  it("1/2. peopleFilter='active' keeps a zero-event regular supervisor AND technician visible", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={mixedRosterView()} todayDate="2026-08-09" peopleFilter="active" />);
    expect(screen.getByRole("columnheader", { name: 'אחמ"ש חובה' })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "טכנאי חובה" })).toBeInTheDocument();
  });

  it("3/4. peopleFilter='active' hides a zero-event reserve person's column entirely", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={mixedRosterView()} todayDate="2026-08-09" peopleFilter="active" />);
    expect(screen.queryByRole("columnheader", { name: "מילואים לא פעיל" })).toBeNull();
  });

  it("5. peopleFilter='active' keeps a reserve person with an item this week visible", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={mixedRosterView()} todayDate="2026-08-09" peopleFilter="active" />);
    expect(screen.getByRole("columnheader", { name: "מילואים פעיל" })).toBeInTheDocument();
  });

  it("6. peopleFilter='all' shows every eligible person, including the inactive reserve", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={mixedRosterView()} todayDate="2026-08-09" peopleFilter="all" />);
    expect(screen.getByRole("columnheader", { name: 'אחמ"ש חובה' })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "טכנאי חובה" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "מילואים לא פעיל" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "מילואים פעיל" })).toBeInTheDocument();
  });

  it("filtering never mutates teamWeek.cells -- the underlying projection stays intact regardless of which filter is rendered", () => {
    const view = mixedRosterView();
    const before = JSON.stringify(view);
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="active" />);
    expect(JSON.stringify(view)).toBe(before);
  });

  it("shows a distinct, informative empty state only when the active filter hides EVERYONE (an all-inactive-reserve roster), rather than the generic 'no shift-capable roster' message", () => {
    const view = teamWeek({
      people: [{ id: "p_res_inactive", name: "מילואים לא פעיל", roleGroup: "supervisor" as const, serviceCategory: "reserve" as const }],
      cells: emptyCells(["p_res_inactive"]),
    });
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="active" />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/אין אנשי צוות פעילים בשבוע זה/)).toBeInTheDocument();
  });

  it("regression: an all-reserve roster with zero activity (columns.length === 0) still shows the VIEWER's personal fallback, not the generic empty-active message, when the viewer is one of those eligible-but-hidden reserve people", () => {
    const view = teamWeek({
      people: [
        { id: "p_res_a", name: "מילואים א", roleGroup: "supervisor" as const, serviceCategory: "reserve" as const },
        { id: "p_res_b", name: "מילואים ב", roleGroup: "technician" as const, serviceCategory: "reserve" as const },
      ],
      cells: emptyCells(["p_res_a", "p_res_b"]),
    });
    render(
      <TeamWeekMatrix
        teamWeek={view}
        todayDate="2026-08-09"
        peopleFilter="active"
        viewerPersonId="p_res_a"
        allPeopleFilterHref="/schedule?person=all&view=team-week"
      />,
    );
    // Never the generic empty-active message -- the viewer's own personal
    // fallback takes precedence.
    expect(screen.queryByText(/אין אנשי צוות פעילים בשבוע זה/)).toBeNull();
    expect(screen.getByText(/אין לך פעילות השבוע/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "הצג את כולם" });
    expect(link).toHaveAttribute("href", "/schedule?person=all&view=team-week");
    // Still no table and no Find Me button -- there is genuinely nothing to scroll to.
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: /איפה אני/ })).toBeNull();
  });

  it("an all-reserve roster with zero activity where the VIEWER is not part of the roster at all still shows the generic empty-active message", () => {
    const view = teamWeek({
      people: [{ id: "p_res_a", name: "מילואים א", roleGroup: "supervisor" as const, serviceCategory: "reserve" as const }],
      cells: emptyCells(["p_res_a"]),
    });
    render(
      <TeamWeekMatrix
        teamWeek={view}
        todayDate="2026-08-09"
        peopleFilter="active"
        viewerPersonId="p_viewer_none"
        allPeopleFilterHref="/schedule?person=all&view=team-week"
      />,
    );
    expect(screen.getByText(/אין אנשי צוות פעילים בשבוע זה/)).toBeInTheDocument();
    expect(screen.queryByText(/אין לך פעילות השבוע/)).toBeNull();
  });

  it("a regular-only roster with zero events anywhere never hits the active-filter empty state -- regular people are never activity-gated", () => {
    const view = teamWeek({
      people: [{ id: "p_reg_sup", name: "אחמ\"ש חובה", roleGroup: "supervisor" as const, serviceCategory: "regular" as const }],
      cells: emptyCells(["p_reg_sup"]),
    });
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="active" />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: 'אחמ"ש חובה' })).toBeInTheDocument();
  });

  it("9. a regular viewer with zero activity this week still has their own column and Find Me available under the default 'active' filter", () => {
    const view = teamWeek({
      people: [{ id: "p_reg_sup", name: "אחמ\"ש חובה", roleGroup: "supervisor" as const, serviceCategory: "regular" as const }],
      cells: emptyCells(["p_reg_sup"]),
    });
    render(
      <TeamWeekMatrix
        teamWeek={view}
        todayDate="2026-08-09"
        peopleFilter="active"
        viewerPersonId="p_reg_sup"
        allPeopleFilterHref="/schedule?person=all&view=team-week"
      />,
    );
    expect(screen.getByRole("columnheader", { name: 'אחמ"ש חובה, אני' })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /איפה אני/ })).toBeInTheDocument();
    expect(screen.queryByText(/אין לך פעילות השבוע/)).toBeNull();
  });

  it("10. the 'אין לך פעילות השבוע · הצג את כולם' fallback now applies only to an eligible reserve viewer hidden by the active filter -- never a regular viewer", () => {
    const view = mixedRosterView();
    render(
      <TeamWeekMatrix
        teamWeek={view}
        todayDate="2026-08-09"
        peopleFilter="active"
        viewerPersonId="p_res_inactive"
        allPeopleFilterHref="/schedule?person=all&view=team-week"
      />,
    );
    expect(screen.queryByRole("columnheader", { name: /מילואים לא פעיל/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /איפה אני/ })).toBeNull();
    expect(screen.getByText(/אין לך פעילות השבוע/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "הצג את כולם" });
    expect(link).toHaveAttribute("href", "/schedule?person=all&view=team-week");
  });
});

describe("TeamWeekMatrix — cell content (8, 9, 10, 11)", () => {
  it("11. an empty cell renders calmly -- no dash, no placeholder text", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek()} todayDate="2026-08-09" peopleFilter="all" />);
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
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="all" />);
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
    const { container } = render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="all" />);
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
    const { container } = render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="all" />);
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
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="all" />);
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
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="all" />);
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
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="all" />);
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
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={view} todayDate="2026-08-09" peopleFilter="all" />);
    expect(screen.queryByText(/^\+\d/)).toBeNull();
  });
});

describe("TeamWeekMatrix — 'איפה אני?' self orientation (viewerPersonId, 7-14, 20-21)", () => {
  it("7. duplicate display names never confuse self detection -- only the id-matching column gets the badge", () => {
    const view = teamWeek({
      people: [
        { id: "p_daniel_a", name: "דניאל כהן", roleGroup: "technician" as const, serviceCategory: "regular" as const },
        { id: "p_daniel_b", name: "דניאל כהן", roleGroup: "technician" as const, serviceCategory: "regular" as const },
      ],
      cells: emptyCells(["p_daniel_a", "p_daniel_b"]),
    });
    render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" peopleFilter="all" viewerPersonId="p_daniel_b" allPeopleFilterHref="/x" />);
    const headers = screen.getAllByRole("columnheader", { name: /דניאל כהן/ });
    expect(headers).toHaveLength(2);
    const selfHeaders = headers.filter((h) => h.textContent?.includes("אני"));
    expect(selfHeaders).toHaveLength(1);
  });

  it("8/9/10. only the viewer's own visible column carries the 'אני' badge and accessible name -- other columns render plainly", () => {
    const view = teamWeek();
    render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" peopleFilter="all" viewerPersonId="p_daniel" allPeopleFilterHref="/x" />);

    const selfHeader = screen.getByRole("columnheader", { name: "דניאל כהן, אני" });
    expect(within(selfHeader).getByText("אני")).toBeInTheDocument();

    const otherHeader = screen.getByRole("columnheader", { name: "איתן דוגמה" });
    expect(within(otherHeader).queryByText("אני")).toBeNull();
    expect(otherHeader.className).not.toContain("team-week-self-column");
  });

  it("11. the self marker (data attribute + class) appears on the header and on all seven body cells -- never more, never fewer", () => {
    const view = teamWeek();
    const { container } = render(
      <TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" peopleFilter="all" viewerPersonId="p_daniel" allPeopleFilterHref="/x" />,
    );
    expect(container.querySelectorAll('[data-team-week-self-header="true"]')).toHaveLength(1);
    expect(container.querySelectorAll(".team-week-self-column")).toHaveLength(1 + DATES.length);
  });

  it("regression: the self column marker never drops the sticky utility from the person-name header -- vertical-scroll stickiness must survive being combined with team-week-self-column", () => {
    const view = teamWeek();
    render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" peopleFilter="all" viewerPersonId="p_daniel" allPeopleFilterHref="/x" />);
    const selfHeader = screen.getByRole("columnheader", { name: "דניאל כהן, אני" });
    // A plain "sticky" match alone would also match "team-week-self-column"
    // if this class were ever renamed to contain that substring -- assert
    // the exact Tailwind utility token instead.
    expect(selfHeader.className.split(/\s+/)).toContain("sticky");
    const otherHeader = screen.getByRole("columnheader", { name: "איתן דוגמה" });
    expect(otherHeader.className.split(/\s+/)).toContain("sticky");
  });

  it("12. the 'איפה אני?' Find Me control renders only when the viewer's own column is currently rendered", () => {
    const view = teamWeek();
    const { rerender } = render(
      <TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" peopleFilter="all" viewerPersonId="p_daniel" allPeopleFilterHref="/x" />,
    );
    expect(screen.getByRole("button", { name: /איפה אני/ })).toBeInTheDocument();

    rerender(
      <TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" peopleFilter="all" viewerPersonId="p_viewer_none" allPeopleFilterHref="/x" />,
    );
    expect(screen.queryByRole("button", { name: /איפה אני/ })).toBeNull();
  });

  it("13. a viewer eligible for Team Week but hidden by the active filter gets a clear fallback link, never a dead Find Me button", () => {
    const view = teamWeek({
      people: [
        { id: "p_eitan", name: "איתן דוגמה", roleGroup: "supervisor" as const, serviceCategory: "reserve" as const },
        { id: "p_daniel", name: "דניאל כהן", roleGroup: "technician" as const, serviceCategory: "regular" as const },
      ],
      cells: {
        ...emptyCells(["p_eitan", "p_daniel"]),
        p_daniel: {
          ...emptyCells(["p_daniel"]).p_daniel,
          "2026-08-11": [item({ key: "a" })],
        },
      },
    });
    // The viewer is Eitan, a RESERVE person with zero events this week --
    // the active filter hides his column entirely, even though he IS
    // eligible. A regular (חובה) viewer would never hit this case, since
    // "active" always keeps regular people visible regardless of activity.
    render(
      <TeamWeekMatrix
        teamWeek={view}
        todayDate="2026-08-09"
        peopleFilter="active"
        viewerPersonId="p_eitan"
        allPeopleFilterHref="/schedule?person=all&view=team-week&week=2026-08-09"
      />,
    );
    expect(screen.queryByRole("columnheader", { name: /איתן דוגמה/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /איפה אני/ })).toBeNull();
    expect(screen.getByText(/אין לך פעילות השבוע/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "הצג את כולם" });
    expect(link).toHaveAttribute("href", "/schedule?person=all&view=team-week&week=2026-08-09");
  });

  it("14. a viewer who isn't part of the Team Week roster at all (e.g. permanent/קבע) gets no Find Me control and no fallback message", () => {
    const view = teamWeek();
    render(
      <TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" peopleFilter="all" viewerPersonId="p_permanent_manager" allPeopleFilterHref="/x" />,
    );
    expect(screen.queryByRole("button", { name: /איפה אני/ })).toBeNull();
    expect(screen.queryByText(/אין לך פעילות השבוע/)).toBeNull();
  });

  it("20. the group divider survives when the viewer happens to be the first technician column", () => {
    const view = teamWeek({
      people: [
        { id: "p_eitan", name: "איתן דוגמה", roleGroup: "supervisor" as const, serviceCategory: "regular" as const },
        { id: "p_daniel", name: "דניאל כהן", roleGroup: "technician" as const, serviceCategory: "regular" as const },
        { id: "p_noa", name: "נועה דוגמה", roleGroup: "technician" as const, serviceCategory: "regular" as const },
      ],
    });
    render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-09" peopleFilter="all" viewerPersonId="p_daniel" allPeopleFilterHref="/x" />);
    const selfHeader = screen.getByRole("columnheader", { name: /דניאל כהן/ });
    expect(selfHeader.className).toContain("border-s-2");
    expect(selfHeader.className).toContain("team-week-self-column");
  });

  it("21. today-row styling and self-column marking coexist at the intersection of today × me", () => {
    const view = teamWeek();
    render(<TeamWeekMatrix teamWeek={view} todayDate="2026-08-11" peopleFilter="all" viewerPersonId="p_daniel" allPeopleFilterHref="/x" />);
    const rowHeaders = screen.getAllByRole("rowheader");
    const todayRow = rowHeaders.find((el) => el.textContent?.includes("היום"))!.closest("tr")!;
    const selfCellInTodayRow = within(todayRow)
      .getAllByRole("cell")
      .find((cell) => cell.className.includes("team-week-self-column"));
    expect(selfCellInTodayRow).toBeDefined();
    expect(selfCellInTodayRow!.className).toContain("bg-primary/[0.06]");
  });
});

describe("TeamWeekMatrix — empty roster", () => {
  it("renders a calm message instead of an empty/broken table when no one is shift-capable", () => {
    render(<TeamWeekMatrix viewerPersonId="p_viewer_none" allPeopleFilterHref="/schedule?person=all&view=team-week" teamWeek={teamWeek({ people: [], cells: {} })} todayDate="2026-08-09" peopleFilter="all" />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/אין אנשי צוות/)).toBeInTheDocument();
  });
});
