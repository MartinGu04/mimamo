import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ManagerShootingRangeRow, ManagerShootingRangeSummary } from "@/lib/readModels/buildShootingRangeManagerReadModel";

const approveSelfReportShootingRangeAction = vi.fn();
const confirmPlannedShootingRangeAction = vi.fn();
const createPlannedShootingRangeAction = vi.fn();
const rejectSelfReportShootingRangeAction = vi.fn();

vi.mock("@/lib/shootingRanges/actions", () => ({
  approveSelfReportShootingRangeAction: (...args: unknown[]) => approveSelfReportShootingRangeAction(...args),
  confirmPlannedShootingRangeAction: (...args: unknown[]) => confirmPlannedShootingRangeAction(...args),
  createPlannedShootingRangeAction: (...args: unknown[]) => createPlannedShootingRangeAction(...args),
  rejectSelfReportShootingRangeAction: (...args: unknown[]) => rejectSelfReportShootingRangeAction(...args),
}));

const { ShootingRangeManagerPanel } = await import("./ShootingRangeManagerPanel");

const SUMMARY: ManagerShootingRangeSummary = {
  qualifiedCount: 0,
  nearingExpiryCount: 0,
  notQualifiedCount: 0,
  notRelevantCount: 0,
  totalCount: 0,
};

function row(overrides: Partial<ManagerShootingRangeRow> = {}): ManagerShootingRangeRow {
  return {
    personId: "p1",
    personName: "בדיקה",
    avatarUrl: null,
    roleGroup: "technician",
    status: "valid",
    baselineDate: "2026-06-01",
    expiryDate: "2026-12-01",
    notRelevantReason: null,
    plannedRange: null,
    hasPendingSelfReport: false,
    requiresAttention: false,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("ShootingRangeManagerPanel -- personnel grouping", () => {
  it("renders a permanent (קבע) person under the 'קבע' group, never under אחמ״שים/טכנאים", () => {
    const rows = [
      row({ personId: "p_perm", personName: "קבע בדיקה", roleGroup: "permanent" }),
      row({ personId: "p_sup", personName: "אחמש בדיקה", roleGroup: "supervisor" }),
      row({ personId: "p_tech", personName: "טכנאי בדיקה", roleGroup: "technician" }),
    ];

    render(
      <ShootingRangeManagerPanel
        summary={{ ...SUMMARY, totalCount: 3 }}
        rows={rows}
        pendingSelfReports={[]}
        roster={[]}
        unresolvedSheetRowCount={0}
        unresolvedSheetRowNames={[]}
      />,
    );

    const permanentHeading = screen.getByRole("heading", { name: "קבע" });
    const supervisorHeading = screen.getByRole("heading", { name: "אחמ״שים" });
    const technicianHeading = screen.getByRole("heading", { name: "טכנאים" });

    // "קבע בדיקה" appears under the "קבע" group section, not under אחמ״שים/טכנאים.
    const permanentSection = permanentHeading.parentElement as HTMLElement;
    const supervisorSection = supervisorHeading.parentElement as HTMLElement;
    const technicianSection = technicianHeading.parentElement as HTMLElement;

    expect(within(permanentSection).getByText("קבע בדיקה")).toBeInTheDocument();
    expect(within(supervisorSection).queryByText("קבע בדיקה")).not.toBeInTheDocument();
    expect(within(technicianSection).queryByText("קבע בדיקה")).not.toBeInTheDocument();

    expect(within(supervisorSection).getByText("אחמש בדיקה")).toBeInTheDocument();
    expect(within(technicianSection).getByText("טכנאי בדיקה")).toBeInTheDocument();
  });

  it("the 'קבע' group renders ABOVE אחמ״שים/טכנאים in document order", () => {
    const rows = [
      row({ personId: "p_perm", personName: "קבע בדיקה", roleGroup: "permanent" }),
      row({ personId: "p_sup", personName: "אחמש בדיקה", roleGroup: "supervisor" }),
      row({ personId: "p_tech", personName: "טכנאי בדיקה", roleGroup: "technician" }),
    ];

    render(
      <ShootingRangeManagerPanel
        summary={{ ...SUMMARY, totalCount: 3 }}
        rows={rows}
        pendingSelfReports={[]}
        roster={[]}
        unresolvedSheetRowCount={0}
        unresolvedSheetRowNames={[]}
      />,
    );

    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["קבע", "אחמ״שים", "טכנאים"]);
  });

  it("never renders the 'קבע' group heading when there are no permanent staff -- same as the existing empty-group behavior", () => {
    const rows = [row({ personId: "p_tech", personName: "טכנאי בדיקה", roleGroup: "technician" })];

    render(
      <ShootingRangeManagerPanel
        summary={{ ...SUMMARY, totalCount: 1 }}
        rows={rows}
        pendingSelfReports={[]}
        roster={[]}
        unresolvedSheetRowCount={0}
        unresolvedSheetRowNames={[]}
      />,
    );

    expect(screen.queryByRole("heading", { name: "קבע" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "טכנאים" })).toBeInTheDocument();
  });
});

describe("ShootingRangeManagerPanel -- accessible status announcements", () => {
  afterEach(() => {
    confirmPlannedShootingRangeAction.mockReset();
    createPlannedShootingRangeAction.mockReset();
  });

  it("confirming a pending planned range's outcome exposes role=status", async () => {
    confirmPlannedShootingRangeAction.mockResolvedValue(undefined);
    const rows = [
      row({
        personId: "p1",
        personName: "בדיקה",
        plannedRange: { rangeDate: "2026-09-01", status: "pending_confirmation" },
      }),
    ];

    render(
      <ShootingRangeManagerPanel
        summary={{ ...SUMMARY, totalCount: 1 }}
        rows={rows}
        pendingSelfReports={[]}
        roster={[]}
        unresolvedSheetRowCount={0}
        unresolvedSheetRowNames={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /אשר ביצוע ל-/ }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("אושר עבור 1 אנשים.");
  });

  it("scheduling a new planned range's outcome exposes role=status", async () => {
    createPlannedShootingRangeAction.mockResolvedValue({ ok: true, scheduledCount: 1 });

    render(
      <ShootingRangeManagerPanel
        summary={SUMMARY}
        rows={[]}
        pendingSelfReports={[]}
        roster={[{ id: "p1", name: "בדיקה" }]}
        unresolvedSheetRowCount={0}
        unresolvedSheetRowNames={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "שיבוץ מטווח חדש" }));
    fireEvent.change(screen.getByLabelText("תאריך מטווח"), { target: { value: "2026-09-01" } });
    fireEvent.click(screen.getByText("בדיקה"));
    fireEvent.click(screen.getByRole("button", { name: /^שבץ/ }));

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("שובצו 1 אנשים.");
  });
});

describe("ShootingRangeManagerPanel — heading hierarchy (Phase 3 fix: pending-confirmation panel was h1 -> h3)", () => {
  it("renders the pending-confirmation panel's title as an h2, alongside the other top-level h2 sections", () => {
    const rows = [
      row({
        personId: "p1",
        personName: "בדיקה",
        plannedRange: { rangeDate: "2026-09-01", status: "pending_confirmation" },
      }),
    ];

    render(
      <ShootingRangeManagerPanel
        summary={{ ...SUMMARY, totalCount: 1 }}
        rows={rows}
        pendingSelfReports={[
          { id: "sr1", personId: "p1", personName: "בדיקה", performedOn: "2026-08-01", notes: null, createdAt: "2026-08-01T00:00:00.000Z" },
        ]}
        roster={[]}
        unresolvedSheetRowCount={0}
        unresolvedSheetRowNames={[]}
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: /🎯 מטווח/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "דיווחים ממתינים לאישור" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "אנשי צוות" })).toBeInTheDocument();
    // "קבע"/"אחמ״שים"/"טכנאים" role-group subheadings stay h3, correctly
    // nested under "אנשי צוות" -- never promoted alongside the h2s above.
    expect(screen.getByRole("heading", { level: 3, name: "טכנאים" })).toBeInTheDocument();
  });
});
