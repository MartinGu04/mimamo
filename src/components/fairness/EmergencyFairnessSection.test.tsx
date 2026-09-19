import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { EmergencyFairnessReadModel } from "@/lib/readModels/emergencyFairnessTypes";
import { EmergencyFairnessSection } from "./EmergencyFairnessSection";

afterEach(() => {
  cleanup();
});

function model(overrides: Partial<EmergencyFairnessReadModel> = {}): EmergencyFairnessReadModel {
  return {
    activePeriod: null,
    fetchedAt: "2026-08-26T14:05:00.000Z",
    groups: [
      { label: "אחמ״שים", rows: [{ personId: "p1", personName: "דנה", total: 4, day: 3, night: 1 }] },
    ],
    ...overrides,
  };
}

describe("EmergencyFairnessSection — heading hierarchy (Phase 3 fix, /fairness page h1 -> h2, not h1 -> h3)", () => {
  it("renders each group's title as an h2, not an h3", () => {
    render(<EmergencyFairnessSection model={model()} />);
    expect(screen.getByRole("heading", { level: 2, name: "אחמ״שים" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("renders one h2 per non-empty group", () => {
    render(
      <EmergencyFairnessSection
        model={model({
          groups: [
            { label: "אחמ״שים", rows: [{ personId: "p1", personName: "דנה", total: 4, day: 3, night: 1 }] },
            { label: "טכנאים", rows: [{ personId: "p2", personName: "עומר", total: 2, day: 2, night: 0 }] },
          ],
        })}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
  });
});
