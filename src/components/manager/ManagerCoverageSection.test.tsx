import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Event } from "@/lib/domain/event";
import { buildShiftSchedule } from "@/lib/domain/shiftSchedule";
import type { ManagerShiftOverviewEntry } from "@/lib/readModels/managerTypes";
import { buildShiftStaffingOverview } from "@/lib/readModels/managerEventProjections";
import { roleCoverageMessage } from "@/lib/presentation/roleCoverage";
import { ManagerCoverageSection } from "./ManagerCoverageSection";
import type { ManagerRoleCoverageRowView, ManagerShiftDayView, ManagerShiftGroupView } from "./types";

afterEach(() => {
  cleanup();
});

function coverage(overrides: Partial<ManagerRoleCoverageRowView> = {}): ManagerRoleCoverageRowView {
  return { status: "full", message: null, ...overrides };
}

function group(overrides: Partial<ManagerShiftGroupView> = {}): ManagerShiftGroupView {
  return {
    key: "2026-08-13-day",
    dateLabel: "היום",
    periodLabel: "יום",
    emoji: "☀️",
    technicianNames: [],
    supervisorNames: [],
    shadowTechnicianNames: [],
    shadowSupervisorNames: [],
    coverageStatus: "full",
    missingIntervalLabels: [],
    technicianCoverage: coverage(),
    supervisorCoverage: coverage(),
    ...overrides,
  };
}

function dayView(overrides: Partial<ManagerShiftDayView> = {}): ManagerShiftDayView {
  return {
    key: "2026-08-13",
    date: "2026-08-13",
    dateLabel: "היום",
    day: group(),
    night: null,
    genericSupervisorNames: [],
    genericTechnicianNames: [],
    ...overrides,
  };
}

/** A row's own text always reads "<role> — <name>" -- this is how every test below locates ONE assignment row instead of matching loose text anywhere on the card. */
function findRow(name: string): HTMLElement {
  return screen.getByText(name).closest("li")!;
}

describe("ManagerCoverageSection", () => {
  it("shows an empty message when there are no days with shift data", () => {
    render(<ManagerCoverageSection days={[]} />);
    expect(screen.getByText("אין משמרות בטווח שנבחר.")).toBeInTheDocument();
  });

  it("preserves multiple technicians in one period, never collapsed to one", () => {
    render(<ManagerCoverageSection days={[dayView({ day: group({ technicianNames: ["מרטין בדיקה", "נועה דוגמה"] }) })]} />);
    expect(screen.getByText("מרטין בדיקה")).toBeInTheDocument();
    expect(screen.getByText("נועה דוגמה")).toBeInTheDocument();
  });

  it("keeps shadow people in their own visually distinct row", () => {
    render(
      <ManagerCoverageSection
        days={[dayView({ day: group({ technicianNames: ["מרטין בדיקה"], shadowTechnicianNames: ["איתן דוגמה"] }) })]}
      />,
    );
    const shadowRow = findRow("איתן דוגמה");
    expect(shadowRow.textContent).toContain("צל");
    expect(shadowRow.textContent).toContain("טכנאי");
  });

  describe('role presentation order: אחמ"ש before טכנאי (shared with the calendar/selected-day views via inRoleDisplayOrder)', () => {
    it('renders the אחמ"ש row before the טכנאי row, for a period staffed with both', () => {
      render(
        <ManagerCoverageSection
          days={[dayView({ day: group({ technicianNames: ["גדעון פולין"], supervisorNames: ["איתי אוליר"] }) })]}
        />,
      );
      const supervisorRow = findRow("איתי אוליר");
      const technicianRow = findRow("גדעון פולין");
      expect(supervisorRow.textContent).toContain('אחמ"ש');
      expect(technicianRow.textContent).toContain("טכנאי");
      expect(supervisorRow.compareDocumentPosition(technicianRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("renders the shadow אחמ״ש row before the shadow טכנאי row", () => {
      render(
        <ManagerCoverageSection
          days={[
            dayView({
              day: group({ shadowSupervisorNames: ["נועה דוגמה"], shadowTechnicianNames: ["דני בדיקה"] }),
            }),
          ]}
        />,
      );
      const shadowSupervisorRow = findRow("נועה דוגמה");
      const shadowTechnicianRow = findRow("דני בדיקה");
      expect(shadowSupervisorRow.compareDocumentPosition(shadowTechnicianRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("applies the same order to a missing/partial role's note too, not just the full-coverage row", () => {
      render(
        <ManagerCoverageSection
          days={[
            dayView({
              day: group({
                coverageStatus: "missing",
                technicianCoverage: coverage({ status: "missing", message: "חסר טכנאי" }),
                supervisorCoverage: coverage({ status: "missing", message: 'חסר אחמ"ש' }),
              }),
            }),
          ]}
        />,
      );
      const supervisorNote = screen.getByText(/חסר אחמ"ש/).closest("li")!;
      const technicianNote = screen.getByText(/חסר טכנאי/).closest("li")!;
      expect(supervisorNote.compareDocumentPosition(technicianNote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("applies the same order independently to BOTH the day and night columns", () => {
      render(
        <ManagerCoverageSection
          days={[
            dayView({
              day: group({ key: "day", technicianNames: ["טכנאי יום"], supervisorNames: ['אחמ"ש יום'] }),
              night: group({
                key: "night",
                periodLabel: "לילה",
                emoji: "🌙",
                technicianNames: ["טכנאי לילה"],
                supervisorNames: ['אחמ"ש לילה'],
              }),
            }),
          ]}
        />,
      );
      const dayLine = findRow('אחמ"ש יום');
      const dayTechLine = findRow("טכנאי יום");
      expect(dayLine.compareDocumentPosition(dayTechLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      const nightLine = findRow('אחמ"ש לילה');
      const nightTechLine = findRow("טכנאי לילה");
      expect(nightLine.compareDocumentPosition(nightTechLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it('explicitly states "חסר טכנאי" for a fully missing technician role, never inferred from an empty name list', () => {
    render(
      <ManagerCoverageSection
        days={[
          dayView({
            day: group({ coverageStatus: "missing", technicianCoverage: coverage({ status: "missing", message: "חסר טכנאי" }) }),
          }),
        ]}
      />,
    );
    expect(screen.getByText("חסר טכנאי")).toBeInTheDocument();
  });

  it('explicitly states "חסר אחמ״ש" for a fully missing supervisor role', () => {
    render(
      <ManagerCoverageSection
        days={[
          dayView({
            day: group({ coverageStatus: "missing", supervisorCoverage: coverage({ status: "missing", message: "חסר אחמ״ש" }) }),
          }),
        ]}
      />,
    );
    expect(screen.getByText("חסר אחמ״ש")).toBeInTheDocument();
  });

  it("shows the partial interval message in its own note, separate from the names row above it", () => {
    render(
      <ManagerCoverageSection
        days={[
          dayView({
            day: group({
              coverageStatus: "partial",
              technicianCoverage: coverage({ status: "partial", message: "כיסוי טכנאי חלקי · 05:30–07:30" }),
              technicianNames: ["מרטין בדיקה"],
            }),
          }),
        ]}
      />,
    );
    const note = screen.getByText(/כיסוי טכנאי חלקי · 05:30–07:30/).closest("li")!;
    expect(note.textContent).toContain("הערה");
    const nameRow = findRow("מרטין בדיקה");
    expect(note).not.toBe(nameRow);
  });

  it("never claims a role missing when it is not_evaluable -- shows the truthful unknown message instead", () => {
    render(
      <ManagerCoverageSection
        days={[
          dayView({
            day: group({
              coverageStatus: "not_evaluable",
              technicianCoverage: coverage({ status: "not_evaluable", message: "לא ניתן להעריך כיסוי טכנאי" }),
            }),
          }),
        ]}
      />,
    );
    expect(screen.getByText("לא ניתן להעריך כיסוי טכנאי")).toBeInTheDocument();
    expect(screen.queryByText("חסר טכנאי")).toBeNull();
  });

  it("shows a calm names-only row for a fully covered role, no extra note", () => {
    render(<ManagerCoverageSection days={[dayView({ day: group({ supervisorNames: ["דני כהן"] }) })]} />);
    expect(screen.getByText("דני כהן")).toBeInTheDocument();
  });

  it("renders one card per date, with day and night paired inside the same card", () => {
    const { container } = render(
      <ManagerCoverageSection
        days={[
          dayView({ key: "2026-08-13", date: "2026-08-13", day: group(), night: group({ periodLabel: "לילה", emoji: "🌙" }) }),
          dayView({ key: "2026-08-14", date: "2026-08-14", day: group(), night: null }),
        ]}
      />,
    );
    // One card per date (both columns always render, "אין נתוני שיבוץ" for a period with no data).
    expect(container.querySelectorAll('[href^="/schedule?person=all"]').length).toBe(2);
    expect(screen.getAllByText("יום").length).toBe(2);
    expect(screen.getAllByText("לילה").length).toBe(2);
    expect(screen.getAllByText("אין נתוני שיבוץ").length).toBe(1);
  });

  it("a period with no shift data at all reads as 'no data', never a fabricated missing verdict", () => {
    render(<ManagerCoverageSection days={[dayView({ day: group(), night: null })]} />);
    expect(screen.getByText("אין נתוני שיבוץ")).toBeInTheDocument();
  });

  it("a period that DOES have a group but nobody in either role stays quiet, never falling back to the 'no data' message meant for a period with no group at all", () => {
    render(
      <ManagerCoverageSection
        days={[
          dayView({
            day: group({ technicianNames: [], supervisorNames: [] }),
            night: null,
          }),
        ]}
      />,
    );
    // Exactly one "no data" message -- the night column (a real null group)
    // -- never a second one for the day column, which has a real (if
    // empty) group.
    expect(screen.getAllByText("אין נתוני שיבוץ")).toHaveLength(1);
  });

  it("each card links into the real team calendar for that exact date", () => {
    render(<ManagerCoverageSection days={[dayView({ date: "2026-08-19" })]} />);
    expect(screen.getByRole("link", { name: "ללוח ←" })).toHaveAttribute(
      "href",
      "/schedule?person=all&date=2026-08-19",
    );
  });

  it("a problematic date carries a visible accent, a fully-covered date does not", () => {
    const { container } = render(
      <ManagerCoverageSection
        days={[
          dayView({ key: "ok", date: "2026-08-13", day: group({ coverageStatus: "full" }) }),
          dayView({ key: "bad", date: "2026-08-14", day: group({ coverageStatus: "missing" }) }),
        ]}
      />,
    );
    const cards = container.querySelectorAll(".rounded-xl.bg-surface-1");
    const withAccent = [...cards].filter((card) => card.className.includes("border-s-critical"));
    expect(withAccent.length).toBe(1);
  });

  describe("all-day shift leader gets a dedicated, emphasized surface, duplicated into each column it covers", () => {
    it("renders a distinct all-day banner above the day/night columns", () => {
      render(
        <ManagerCoverageSection days={[dayView({ day: null, night: null, genericSupervisorNames: ["רועי לוין"] })]} />,
      );
      const banner = screen.getByText("רועי לוין").closest("div")!;
      expect(banner.textContent).toContain('אחמ"ש');
      expect(banner.textContent).toContain("כל היום");
    });

    it("duplicates the all-day supervisor inside each day/night column it covers, each tagged with an explicit \"all day\" badge", () => {
      render(
        <ManagerCoverageSection
          days={[
            dayView({
              genericSupervisorNames: ["רועי לוין"],
              day: group(),
              night: group({ periodLabel: "לילה", emoji: "🌙" }),
            }),
          ]}
        />,
      );
      const occurrences = screen.getAllByText("רועי לוין");
      // Once in the banner, plus once inside each of day/night.
      expect(occurrences).toHaveLength(3);
      const rowOccurrences = occurrences.filter((el) => el.closest("li") !== null);
      expect(rowOccurrences).toHaveLength(2);
      for (const row of rowOccurrences) {
        expect(row.closest("li")!.textContent).toContain("כל היום");
      }
    });
  });

  describe("a very busy column collapses its overflow into a '+N more details' link rather than growing without bound", () => {
    it("shows every row when a column stays within the visible-row budget", () => {
      render(
        <ManagerCoverageSection
          days={[
            dayView({
              day: group({ supervisorNames: ["רועי לוין"], technicianNames: ["איתן וסרמן"] }),
            }),
          ]}
        />,
      );
      expect(screen.getByText("רועי לוין")).toBeInTheDocument();
      expect(screen.getByText("איתן וסרמן")).toBeInTheDocument();
      expect(screen.queryByText(/פרטים נוספים/)).toBeNull();
    });

    it("truncates a column with many rows and links the overflow into the full schedule view for that date", () => {
      render(
        <ManagerCoverageSection
          days={[
            dayView({
              date: "2026-08-20",
              day: group({
                supervisorNames: ["רועי לוין"],
                technicianNames: ["איתן וסרמן"],
                shadowSupervisorNames: ["דניאל כהן"],
                shadowTechnicianNames: ["יובל ישראלי"],
                technicianCoverage: coverage({ status: "partial", message: "כיסוי טכנאי חלקי · 07:30–15:00" }),
              }),
            }),
          ]}
        />,
      );
      // 2 names + 2 shadow rows + 1 note = 5 rows, one past the 4-row budget.
      const moreLink = screen.getByRole("link", { name: "+1 פרטים נוספים" });
      expect(moreLink).toHaveAttribute("href", "/schedule?person=all&date=2026-08-20");
    });
  });

  describe('regression: a generic (period-unspecified) אחמ"ש assignment renders as covered, and is duplicated (badge-tagged) into every day/night column it covers', () => {
    function toGroupView(entry: ManagerShiftOverviewEntry): ManagerShiftGroupView {
      // Trivial field rename, mirroring app/(app)/manager/page.tsx's private
      // buildManagerShiftGroupView -- deliberately NOT re-implementing any
      // coverage logic here, just reshaping the REAL analyzeUnitShiftCoverage
      // output (via buildShiftStaffingOverview) into this component's props,
      // exactly like the real page does.
      return {
        key: `${entry.date}-${entry.period}`,
        dateLabel: entry.date,
        periodLabel: entry.period === "day" ? "יום" : "לילה",
        emoji: entry.period === "day" ? "☀️" : "🌙",
        technicianNames: entry.technicians.map((p) => p.personName),
        supervisorNames: entry.supervisors.map((p) => p.personName),
        shadowTechnicianNames: entry.shadowTechnicians.map((p) => p.personName),
        shadowSupervisorNames: entry.shadowSupervisors.map((p) => p.personName),
        coverageStatus: entry.coverageStatus,
        missingIntervalLabels: [],
        technicianCoverage: {
          status: entry.roleCoverage.technician.status,
          message: roleCoverageMessage("technician", entry.roleCoverage.technician),
        },
        supervisorCoverage: {
          status: entry.roleCoverage.supervisor.status,
          message: roleCoverageMessage("supervisor", entry.roleCoverage.supervisor),
        },
      };
    }

    function event(overrides: Partial<Event>): Event {
      return {
        personId: "p_default",
        personName: "ברירת מחדל",
        date: "2026-08-12",
        title: "",
        rawValue: "",
        category: "shift",
        certainty: "confirmed",
        role: null,
        period: "unspecified",
        sourceSheet: "משמרות + תורנויות",
        sourceCell: "C2",
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

    it("through the REAL production pipeline (Event[] -> buildShiftStaffingOverview), a date staffed with real technicians and only a generic supervisor shows full coverage on both day and night, with the generic supervisor's name shown once via the shared banner and once more inside each of the day/night columns it covers, each tagged \"כל היום\"", () => {
      const schedule = buildShiftSchedule("07:30");

      const events = [
        event({ personId: "p_tech_day", personName: "טכנאי יום", role: "technician", period: "day" }),
        event({ personId: "p_tech_night", personName: "טכנאי לילה", role: "technician", period: "night" }),
        event({ personId: "p_ilay", personName: "עילאי שפירא", role: "supervisor", period: "unspecified" }),
      ];

      const entries = buildShiftStaffingOverview(events, schedule, new Set(["2026-08-12"]));
      const day = entries.find((e) => e.period === "day")!;
      const night = entries.find((e) => e.period === "night")!;
      const generic = entries.find((e) => e.period === "unspecified")!;

      // Data-structure-level guarantee, independent of rendering: the
      // generic supervisor is NEVER a member of either period's own
      // roster list -- both stay empty -- while roleCoverage still reports
      // "full" on both, because the coverage computation (not the roster)
      // is what folds the generic Event into each period's group.
      expect(day.supervisors).toHaveLength(0);
      expect(night.supervisors).toHaveLength(0);
      expect(day.roleCoverage.supervisor.status).toBe("full");
      expect(night.roleCoverage.supervisor.status).toBe("full");
      expect(day.coverageStatus).toBe("full");
      expect(night.coverageStatus).toBe("full");
      // The assignment's one true roster home: its own native
      // "unspecified" entry, exactly one supervisor, the same personId --
      // never a cloned/second Event.
      expect(generic.supervisors).toHaveLength(1);
      expect(generic.supervisors[0].personId).toBe("p_ilay");

      render(
        <ManagerCoverageSection
          days={[
            {
              key: "2026-08-12",
              date: "2026-08-12",
              dateLabel: "2026-08-12",
              day: toGroupView(day),
              night: toGroupView(night),
              genericSupervisorNames: generic.supervisors.map((p) => p.personName),
              genericTechnicianNames: generic.technicians.map((p) => p.personName),
            },
          ]}
        />,
      );

      // Once in the shared all-day banner, plus once more inside each of
      // day and night -- never as if it were three independent shifts,
      // and never missing.
      const occurrences = screen.getAllByText(/עילאי שפירא/);
      expect(occurrences).toHaveLength(3);
      const rowOccurrences = occurrences.filter((el) => el.closest("li") !== null);
      expect(rowOccurrences).toHaveLength(2);
      for (const row of rowOccurrences) {
        expect(row.closest("li")!.textContent).toContain("כל היום");
      }
      expect(screen.queryByText(/חסר אחמ/)).toBeNull();
      expect(screen.getByText(/טכנאי יום/)).toBeInTheDocument();
      expect(screen.getByText(/טכנאי לילה/)).toBeInTheDocument();
    });

    it("a date staffed ONLY by a generic supervisor (no other shift Events at all) still shows full day+night coverage on the card, with the person's name attributed to neither period's own native role list", () => {
      const schedule = buildShiftSchedule("07:30");
      const events = [event({ personId: "p_ilay", personName: "עילאי שפירא", role: "supervisor", period: "unspecified" })];

      const entries = buildShiftStaffingOverview(events, schedule, new Set(["2026-08-12"]));
      const day = entries.find((e) => e.period === "day")!;
      const night = entries.find((e) => e.period === "night")!;
      const generic = entries.find((e) => e.period === "unspecified")!;

      render(
        <ManagerCoverageSection
          days={[
            {
              key: "2026-08-12",
              date: "2026-08-12",
              dateLabel: "2026-08-12",
              day: toGroupView(day),
              night: toGroupView(night),
              genericSupervisorNames: generic.supervisors.map((p) => p.personName),
              genericTechnicianNames: generic.technicians.map((p) => p.personName),
            },
          ]}
        />,
      );

      const occurrences = screen.getAllByText(/עילאי שפירא/);
      expect(occurrences).toHaveLength(3);
      expect(screen.queryByText(/חסר אחמ/)).toBeNull();
      // Technician is still genuinely missing on both -- the generic
      // supervisor assignment never spills over into covering a
      // DIFFERENT role.
      expect(screen.getAllByText("חסר טכנאי")).toHaveLength(2);
    });
  });
});
