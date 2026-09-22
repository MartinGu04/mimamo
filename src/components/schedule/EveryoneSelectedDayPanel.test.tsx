import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ScheduleEveryoneDayView, SchedulePeriodStaffingView } from "@/lib/presentation/scheduleEveryone";
import { EveryoneSelectedDayPanel } from "./EveryoneSelectedDayPanel";
import type { DayMeta } from "./types";

afterEach(() => {
  cleanup();
});

function dayMeta(overrides: Partial<DayMeta> = {}): DayMeta {
  return {
    date: "2026-08-12",
    dayNumber: 12,
    isToday: false,
    isPast: false,
    dateLabel: "יום · 12 באוגוסט",
    holiday: null,
    ...overrides,
  };
}

function periodView(overrides: Partial<SchedulePeriodStaffingView> = {}): SchedulePeriodStaffingView {
  return {
    period: "day",
    label: "יום",
    emoji: "☀️",
    technicians: { people: [], status: "not_evaluable", message: null },
    supervisors: { people: [], status: "not_evaluable", message: null },
    shadowTechnicianNames: [],
    shadowSupervisorNames: [],
    coverageStatus: "not_evaluable",
    ...overrides,
  };
}

function dayView(overrides: Partial<ScheduleEveryoneDayView> = {}): ScheduleEveryoneDayView {
  return { date: "2026-08-12", day: null, night: null, genericSupervisorNames: [], genericTechnicianNames: [], duties: [], absences: [], ...overrides };
}

/** A row's own text always reads "<role> — <name>" -- this is how every test below locates ONE assignment row instead of matching loose text anywhere on the panel. */
function findRow(name: string): HTMLElement {
  return screen.getByText(name).closest("li")!;
}

describe("EveryoneSelectedDayPanel", () => {
  it("renders nothing when there is no day meta at all", () => {
    const { container } = render(<EveryoneSelectedDayPanel dayMeta={null} dayView={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the 'no staffing data' message for a period with no staffing view", () => {
    render(<EveryoneSelectedDayPanel dayMeta={dayMeta()} dayView={null} />);
    expect(screen.getAllByText("אין נתוני שיבוץ לתקופה זו.")).toHaveLength(2); // day + night
  });

  describe('role presentation order: אחמ"ש before טכנאי (never independently reordered per-consumer)', () => {
    it('renders the אחמ"ש row before the טכנאי row, for a period staffed with both', () => {
      render(
        <EveryoneSelectedDayPanel
          dayMeta={dayMeta()}
          dayView={dayView({
            day: periodView({
              technicians: { people: [{ key: "p1", name: "גדעון פולין", tentative: false }], status: "full", message: null },
              supervisors: { people: [{ key: "p2", name: "איתי אוליר", tentative: false }], status: "full", message: null },
              coverageStatus: "full",
            }),
          })}
        />,
      );

      const supervisorRow = findRow("איתי אוליר");
      const technicianRow = findRow("גדעון פולין");
      // Both rows are siblings under the same period's own `<ul>` -- DOM
      // source order IS render order here, so comparing document position
      // directly proves which one actually renders first.
      expect(supervisorRow.compareDocumentPosition(technicianRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(supervisorRow.textContent).toContain('אחמ"ש');
      expect(technicianRow.textContent).toContain("טכנאי");
    });

    it('renders the shadow "צל אחמ"ש" row before the shadow "צל טכנאי" row', () => {
      render(
        <EveryoneSelectedDayPanel
          dayMeta={dayMeta()}
          dayView={dayView({
            night: periodView({
              period: "night",
              label: "לילה",
              emoji: "🌙",
              shadowSupervisorNames: ["נועה דוגמה"],
              shadowTechnicianNames: ["דני בדיקה"],
              coverageStatus: "full",
            }),
          })}
        />,
      );

      const shadowSupervisorRow = findRow("נועה דוגמה");
      const shadowTechnicianRow = findRow("דני בדיקה");
      expect(shadowSupervisorRow.textContent).toContain('אחמ"ש');
      expect(shadowTechnicianRow.textContent).toContain("טכנאי");
      expect(shadowSupervisorRow.compareDocumentPosition(shadowTechnicianRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("applies the SAME order to both day and night periods independently", () => {
      render(
        <EveryoneSelectedDayPanel
          dayMeta={dayMeta()}
          dayView={dayView({
            day: periodView({
              technicians: { people: [{ key: "p1", name: "טכנאי יום", tentative: false }], status: "full", message: null },
              supervisors: { people: [{ key: "p2", name: 'אחמ"ש יום', tentative: false }], status: "full", message: null },
              coverageStatus: "full",
            }),
            night: periodView({
              period: "night",
              label: "לילה",
              emoji: "🌙",
              technicians: { people: [{ key: "p3", name: "טכנאי לילה", tentative: false }], status: "full", message: null },
              supervisors: { people: [{ key: "p4", name: 'אחמ"ש לילה', tentative: false }], status: "full", message: null },
              coverageStatus: "full",
            }),
          })}
        />,
      );

      const dayNames = findRow('אחמ"ש יום');
      const dayTechNames = findRow("טכנאי יום");
      expect(dayNames.compareDocumentPosition(dayTechNames) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      const nightNames = findRow('אחמ"ש לילה');
      const nightTechNames = findRow("טכנאי לילה");
      expect(nightNames.compareDocumentPosition(nightTechNames) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("day/night period identity and shadow membership stay exactly as given -- ordering never moves a name into the wrong role/period/shadow bucket", () => {
      render(
        <EveryoneSelectedDayPanel
          dayMeta={dayMeta()}
          dayView={dayView({
            day: periodView({
              technicians: { people: [{ key: "p1", name: "טכנאי אמיתי", tentative: false }], status: "full", message: null },
              supervisors: { people: [{ key: "p2", name: 'אחמ"ש אמיתי', tentative: false }], status: "full", message: null },
              shadowTechnicianNames: ["צל טכנאי אמיתי"],
              shadowSupervisorNames: ['צל אחמ"ש אמיתי'],
              coverageStatus: "full",
            }),
          })}
        />,
      );

      // Every name still appears exactly once, in its OWN correct bucket --
      // reordering never merges/duplicates/misfiles a person.
      expect(screen.getAllByText("טכנאי אמיתי")).toHaveLength(1);
      expect(screen.getAllByText('אחמ"ש אמיתי')).toHaveLength(1);
      expect(screen.getByText("צל טכנאי אמיתי")).toBeTruthy();
      expect(screen.getByText('צל אחמ"ש אמיתי')).toBeTruthy();
      // The shadow rows are visually distinct from the regular personnel
      // rows -- each carries its own "צל" badge.
      expect(findRow("צל טכנאי אמיתי").textContent).toContain("צל");
      expect(findRow('צל אחמ"ש אמיתי').textContent).toContain("צל");
    });
  });

  describe("never render an empty role label", () => {
    it("shows nothing under a period whose roles are all empty and fully covered, never a bare label with no content", () => {
      render(
        <EveryoneSelectedDayPanel
          dayMeta={dayMeta()}
          dayView={dayView({
            day: periodView({
              technicians: { people: [], status: "full", message: null },
              supervisors: { people: [], status: "full", message: null },
              coverageStatus: "full",
            }),
            night: periodView({
              period: "night",
              label: "לילה",
              emoji: "🌙",
              technicians: { people: [], status: "full", message: null },
              supervisors: { people: [], status: "full", message: null },
              coverageStatus: "full",
            }),
          })}
        />,
      );
      // A real (non-null) period never falls back to the "no staffing data"
      // message either -- that message is reserved for a period with no
      // staffing view at all.
      expect(screen.queryByText("אין נתוני שיבוץ לתקופה זו.")).toBeNull();
    });

    it("keeps a role's coverage note in its own block, headed by which role it's about, distinct from the assignment row above it", () => {
      render(
        <EveryoneSelectedDayPanel
          dayMeta={dayMeta()}
          dayView={dayView({
            day: periodView({
              technicians: {
                people: [],
                status: "partial",
                message: "כיסוי טכנאי חלקי · 07:30–15:00",
              },
              supervisors: { people: [{ key: "p1", name: "רועי לוין", tentative: false }], status: "full", message: null },
              coverageStatus: "partial",
            }),
          })}
        />,
      );

      const note = screen.getByText(/כיסוי טכנאי חלקי · 07:30–15:00/).closest("li")!;
      expect(note.textContent).toContain("טכנאי");
      expect(note.textContent).toContain("הערה");
      // The note is its own list item, never inside the shift leader's row.
      const leaderRow = findRow("רועי לוין");
      expect(note).not.toBe(leaderRow);
      expect(leaderRow.textContent).not.toContain("כיסוי טכנאי חלקי");
    });
  });

  describe("all-day shift leader gets a dedicated, emphasized surface", () => {
    it('renders a distinct all-day banner for a generic supervisor assignment, above the day/night sections', () => {
      render(
        <EveryoneSelectedDayPanel
          dayMeta={dayMeta()}
          dayView={dayView({ genericSupervisorNames: ["רועי לוין"] })}
        />,
      );
      const banner = screen.getByText("רועי לוין").closest("div")!;
      expect(banner.textContent).toContain('אחמ"ש');
      expect(banner.textContent).toContain("כל היום");
    });

    it("duplicates the all-day supervisor inside each day/night section it covers, each time tagged with an explicit \"all day\" badge -- a little duplication rather than a section that looks unstaffed", () => {
      render(
        <EveryoneSelectedDayPanel
          dayMeta={dayMeta()}
          dayView={dayView({
            genericSupervisorNames: ["רועי לוין"],
            day: periodView({ coverageStatus: "full" }),
            night: periodView({ period: "night", label: "לילה", emoji: "🌙", coverageStatus: "full" }),
          })}
        />,
      );

      const occurrences = screen.getAllByText("רועי לוין");
      // Once in the emphasized banner, plus once inside each of day/night.
      expect(occurrences).toHaveLength(3);
      const rowOccurrences = occurrences.filter((el) => el.closest("li") !== null);
      expect(rowOccurrences).toHaveLength(2);
      for (const row of rowOccurrences) {
        expect(row.closest("li")!.textContent).toContain("כל היום");
      }
    });
  });

  describe('regression: a generic (period-unspecified) אחמ"ש assignment renders as covered, never "חסר אחמ״ש", and is duplicated (badge-tagged) into every day/night section it covers', () => {
    it("through the REAL production pipeline (Event[] -> buildShiftStaffingOverview -> buildScheduleEveryoneDayViews), a date staffed with real technicians and only a generic supervisor shows full coverage on both day and night, with the generic supervisor's name shown once via the shared all-day banner and once more inside each of the day/night sections it covers, each tagged \"כל היום\"", async () => {
      const { buildShiftSchedule } = await import("@/lib/domain/shiftSchedule");
      const { buildShiftStaffingOverview } = await import("@/lib/readModels/managerEventProjections");
      const { buildScheduleEveryoneDayViews } = await import("@/lib/presentation/scheduleEveryone");
      const schedule = buildShiftSchedule("07:30");

      function event(overrides: Partial<import("@/lib/domain/event").Event>): import("@/lib/domain/event").Event {
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

      const events = [
        event({ personId: "p_tech_day", personName: "טכנאי יום", role: "technician", period: "day" }),
        event({ personId: "p_tech_night", personName: "טכנאי לילה", role: "technician", period: "night" }),
        event({ personId: "p_ilay", personName: "עילאי שפירא", role: "supervisor", period: "unspecified" }),
      ];

      const overview = buildShiftStaffingOverview(events, schedule, new Set(["2026-08-12"]));
      const views = buildScheduleEveryoneDayViews(["2026-08-12"], overview, [], []);

      render(<EveryoneSelectedDayPanel dayMeta={dayMeta({ date: "2026-08-12" })} dayView={views["2026-08-12"]} />);

      // Once in the emphasized all-day banner, plus once more inside each
      // of day and night -- never as if it were three independent shifts,
      // and never missing.
      const occurrences = screen.getAllByText(/עילאי שפירא/);
      expect(occurrences).toHaveLength(3);
      const rowOccurrences = occurrences.filter((el) => el.closest("li") !== null);
      expect(rowOccurrences).toHaveLength(2);
      for (const row of rowOccurrences) {
        expect(row.closest("li")!.textContent).toContain("כל היום");
      }
      expect(screen.queryByText(/חסר אחמ/)).toBeNull();
      expect(screen.getByText("טכנאי יום")).toBeTruthy();
      expect(screen.getByText("טכנאי לילה")).toBeTruthy();
    });
  });

  describe("selected-day change announcement (Phase 5 remediation)", () => {
    it("announces the new date via a restrained, polite (role=status) sr-only region", () => {
      render(<EveryoneSelectedDayPanel dayMeta={dayMeta()} dayView={null} />);
      const status = screen.getByRole("status");
      expect(status).toHaveClass("sr-only");
      expect(status.textContent).toContain("יום · 12 באוגוסט");
    });

    it("mentions duties/absences in the announcement when there are any", () => {
      render(
        <EveryoneSelectedDayPanel
          dayMeta={dayMeta()}
          dayView={dayView({
            duties: [{ key: "d1", title: "שומר 1", personName: "דני בדיקה", emoji: "💂" }],
            absences: [],
          })}
        />,
      );
      expect(screen.getByRole("status").textContent).toContain("1 תורנויות והיעדרויות");
    });

    it("produces exactly one status announcement", () => {
      render(<EveryoneSelectedDayPanel dayMeta={dayMeta()} dayView={null} />);
      expect(screen.getAllByRole("status")).toHaveLength(1);
    });
  });
});
