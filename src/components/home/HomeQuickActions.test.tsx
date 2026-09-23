import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReportOneDraft } from "@/lib/domain/reportOne";
import { HomeQuickActions } from "./HomeQuickActions";

vi.mock("@/lib/reportOne/actions", () => ({ setReserveInclusionPreferenceAction: vi.fn().mockResolvedValue({ ok: true }) }));

function draft(): ReportOneDraft {
  return { targetDate: "2026-08-26", sections: [] };
}

afterEach(() => {
  cleanup();
});

describe("HomeQuickActions", () => {
  it("renders both quick-action cards when a Report 1 draft is present", () => {
    render(<HomeQuickActions reportOneDraft={draft()} />);
    expect(screen.getByRole("button", { name: /דוח 1 למחר/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /צוות השבוע/ })).toBeInTheDocument();
  });

  it("renders only the Team Week card when there is no Report 1 draft", () => {
    render(<HomeQuickActions reportOneDraft={null} />);
    expect(screen.queryByRole("button", { name: /דוח 1 למחר/ })).toBeNull();
    expect(screen.getByRole("link", { name: /צוות השבוע/ })).toBeInTheDocument();
  });

  it("renders only the Team Week card when reportOneDraft is omitted entirely", () => {
    render(<HomeQuickActions />);
    expect(screen.queryByRole("button", { name: /דוח 1 למחר/ })).toBeNull();
    expect(screen.getByRole("link", { name: /צוות השבוע/ })).toBeInTheDocument();
  });
});
