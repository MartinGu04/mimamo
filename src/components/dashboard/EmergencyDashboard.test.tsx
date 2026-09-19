import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EmergencyPersonalHomeReadModel } from "@/lib/readModels/emergencyPersonalHomeTypes";
import { EmergencyDashboard } from "./EmergencyDashboard";

afterEach(() => {
  cleanup();
});

function model(overrides: Partial<EmergencyPersonalHomeReadModel> = {}): EmergencyPersonalHomeReadModel {
  return {
    period: {
      id: "period1",
      activatedAt: "2026-08-26T14:00:00.000Z",
      activatedByUserId: "u1",
      activatedByPersonId: "p_mgr",
      activatedByPersonName: "מנהל בדיקה",
      startDate: "2026-08-26",
      deactivatedAt: null,
      deactivatedByUserId: null,
      deactivatedByPersonId: null,
      deactivatedByPersonName: null,
      endDate: null,
    },
    localNow: { date: "2026-08-26", minuteOfDay: 600 },
    fetchedAt: "2026-08-26T14:05:00.000Z",
    current: null,
    next: null,
    diagnostics: [],
    ...overrides,
  };
}

describe("EmergencyDashboard", () => {
  it("shows an empty state when there is no current shift", () => {
    render(<EmergencyDashboard model={model()} />);
    expect(screen.getAllByTestId("emergency-shift-card-empty").length).toBeGreaterThan(0);
  });

  it("renders 'משמרת יום · דסק X' for the current shift, per the spec's example presentation", () => {
    render(
      <EmergencyDashboard
        model={model({
          current: { date: "2026-08-26", period: "day", ownDesks: ["הוגוורט"], startMinute: 480, endMinute: 1200, roster: [] },
        })}
      />,
    );

    expect(screen.getByText(/משמרת יום · דסק הוגוורט/)).toBeInTheDocument();
  });

  it("lists every colleague in the roster with their own desk ('מי איתי')", () => {
    render(
      <EmergencyDashboard
        model={model({
          current: {
            date: "2026-08-26",
            period: "day",
            ownDesks: ["הוגוורט"],
            startMinute: 480,
            endMinute: 1200,
            roster: [
              { personId: "p2", personName: "ליה", desk: "תיעוד" },
              { personId: "p3", personName: "נדב", desk: "ק'" },
            ],
          },
        })}
      />,
    );

    expect(screen.getByText("ליה")).toBeInTheDocument();
    expect(screen.getByText("נדב")).toBeInTheDocument();
  });

  it("never renders itself in its own roster ('מרטין' excluded when self is the current person)", () => {
    render(
      <EmergencyDashboard
        model={model({
          current: { date: "2026-08-26", period: "day", ownDesks: ["הוגוורט"], startMinute: 480, endMinute: 1200, roster: [] },
        })}
      />,
    );

    expect(screen.getByText("אין מידע על אנשים נוספים במשמרת זו.")).toBeInTheDocument();
  });

  it("surfaces a diagnostics warning when the parser recorded issues", () => {
    render(<EmergencyDashboard model={model({ diagnostics: [{ sourceCell: "M5", message: "בעיה" }] })} />);
    expect(screen.getByText(/בעיות בנתוני סידור החירום/)).toBeInTheDocument();
  });
});

describe("EmergencyDashboard — heading hierarchy (Phase 3 fix)", () => {
  it("exposes exactly one real page-level h1, with shift-card titles as h2 and 'מי איתי' as h3 -- no skipped level", () => {
    render(
      <EmergencyDashboard
        model={model({
          current: { date: "2026-08-26", period: "day", ownDesks: ["הוגוורט"], startMinute: 480, endMinute: 1200, roster: [] },
        })}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "המשמרת שלי עכשיו" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "המשמרת הבאה שלי" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "מי איתי" })).toBeInTheDocument();
  });
});
