import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReportOneDraft } from "@/lib/domain/reportOne";
import { ReportOneQuickAction } from "./ReportOneQuickAction";

vi.mock("@/lib/reportOne/actions", () => ({ setReserveInclusionPreferenceAction: vi.fn().mockResolvedValue({ ok: true }) }));

function draft(): ReportOneDraft {
  return { targetDate: "2026-08-26", sections: [] };
}

afterEach(() => {
  cleanup();
});

describe("ReportOneQuickAction", () => {
  it("shows the report title and the zero-padded target date", () => {
    render(<ReportOneQuickAction draft={draft()} />);
    expect(screen.getByText("🛰️ דוח 1 למחר")).toBeInTheDocument();
    expect(screen.getByText("מוכן עבור 26.08")).toBeInTheDocument();
  });

  it("opens the editor overlay on click", () => {
    render(<ReportOneQuickAction draft={draft()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /דוח 1 למחר/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("is a single whole-card button, not a nested control", () => {
    render(<ReportOneQuickAction draft={draft()} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
