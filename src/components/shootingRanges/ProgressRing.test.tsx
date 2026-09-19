import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProgressRing } from "./ProgressRing";

// This file previously only ever asserted against each render's own
// `container`, so the lack of cleanup between tests went unnoticed --
// `screen`-based queries (used by the progressbar tests below) search the
// whole document, so leftover DOM from earlier tests in this file would
// otherwise make them ambiguous.
afterEach(() => {
  cleanup();
});

function circles(container: HTMLElement) {
  return Array.from(container.querySelectorAll("circle"));
}

describe("ProgressRing", () => {
  it("draws the arc's stroke-dashoffset from progress -- 1 (full) has offset 0, 0 (empty) has offset the full circumference", () => {
    const { container: full } = render(<ProgressRing progress={1} toneClassName="text-success" />);
    const { container: empty } = render(<ProgressRing progress={0} toneClassName="text-success" />);

    const [, fullArc] = circles(full);
    const [, emptyArc] = circles(empty);
    expect(Number(fullArc.getAttribute("stroke-dashoffset"))).toBeCloseTo(0, 5);
    expect(Number(emptyArc.getAttribute("stroke-dashoffset"))).toBeCloseTo(Number(emptyArc.getAttribute("stroke-dasharray")), 5);
  });

  describe("live marker", () => {
    it("is absent by default (showLiveMarker not passed)", () => {
      const { container } = render(<ProgressRing progress={0.5} toneClassName="text-success" />);
      expect(container.querySelector('[data-testid="progress-ring-live-marker"]')).toBeNull();
    });

    it("is absent when progress is exactly 0, even if showLiveMarker is requested -- nothing meaningful to mark at an empty ring", () => {
      const { container } = render(<ProgressRing progress={0} toneClassName="text-critical" showLiveMarker />);
      expect(container.querySelector('[data-testid="progress-ring-live-marker"]')).toBeNull();
    });

    it("renders when showLiveMarker is true and progress is above 0", () => {
      const { container } = render(<ProgressRing progress={0.5} toneClassName="text-success" showLiveMarker />);
      expect(container.querySelector('[data-testid="progress-ring-live-marker"]')).not.toBeNull();
    });

    it("uses the exact same tone class as the ring's own arc -- always visually matching", () => {
      const { container } = render(<ProgressRing progress={0.5} toneClassName="text-warning" showLiveMarker />);
      const marker = container.querySelector('[data-testid="progress-ring-live-marker"]');
      expect(marker?.getAttribute("class")).toContain("text-warning");
    });

    it("derives its position from the SAME progress fraction that draws the visible arc -- a different progress value moves the marker to a different point", () => {
      const { container: quarter } = render(<ProgressRing progress={0.25} toneClassName="text-success" showLiveMarker size={200} strokeWidth={10} />);
      const { container: threeQuarters } = render(<ProgressRing progress={0.75} toneClassName="text-success" showLiveMarker size={200} strokeWidth={10} />);

      const quarterMarker = quarter.querySelector('[data-testid="progress-ring-live-marker"]');
      const threeQuartersMarker = threeQuarters.querySelector('[data-testid="progress-ring-live-marker"]');
      expect(quarterMarker?.getAttribute("cx")).not.toBe(threeQuartersMarker?.getAttribute("cx"));
      expect(quarterMarker?.getAttribute("cy")).not.toBe(threeQuartersMarker?.getAttribute("cy"));

      // The marker sits exactly `radius` away from the ring's own center, for any progress value.
      const size = 200;
      const strokeWidth = 10;
      const center = size / 2;
      const radius = (size - strokeWidth) / 2;
      for (const marker of [quarterMarker, threeQuartersMarker]) {
        const cx = Number(marker?.getAttribute("cx"));
        const cy = Number(marker?.getAttribute("cy"));
        const distanceFromCenter = Math.hypot(cx - center, cy - center);
        expect(distanceFromCenter).toBeCloseTo(radius, 5);
      }
    });

    it("reuses the existing shared pulse animation class -- disabled globally under prefers-reduced-motion via globals.css, no bespoke reduced-motion handling here", () => {
      const { container } = render(<ProgressRing progress={0.5} toneClassName="text-success" showLiveMarker />);
      const marker = container.querySelector('[data-testid="progress-ring-live-marker"]');
      expect(marker?.getAttribute("class")).toContain("animate-pulse-dot");
    });
  });

  describe("progressbar semantics (Phase 5 remediation)", () => {
    it("carries no progressbar role at all when no accessibleLabel is given -- never silently promising a value with no name", () => {
      const { container } = render(<ProgressRing progress={0.5} toneClassName="text-success" />);
      expect(container.querySelector('[role="progressbar"]')).toBeNull();
    });

    it("exposes role=progressbar with a 0-100 value derived from progress, once a label is given", () => {
      render(<ProgressRing progress={0.5} toneClassName="text-success" accessibleLabel="כשירות מטווח" />);
      const bar = screen.getByRole("progressbar", { name: "כשירות מטווח" });
      expect(bar).toHaveAttribute("aria-valuemin", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "100");
      expect(bar).toHaveAttribute("aria-valuenow", "50");
    });

    it("never exposes a value outside the declared 0-100 range, even for an out-of-bounds progress input", () => {
      const { rerender } = render(<ProgressRing progress={-3} toneClassName="text-success" accessibleLabel="label" />);
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

      rerender(<ProgressRing progress={7} toneClassName="text-success" accessibleLabel="label" />);
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    });

    it("overrides the spoken value with aria-valuetext when given, so it matches the ring's own visible center readout exactly", () => {
      render(
        <ProgressRing progress={0.5} toneClassName="text-success" accessibleLabel="כשירות מטווח" accessibleValueText="45 ימים עד לפקיעת הכשירות">
          <span>45</span>
        </ProgressRing>,
      );
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "45 ימים עד לפקיעת הכשירות");
    });

    it("hides the visual center readout from assistive tech once the progressbar role already announces an equivalent value -- never doubled up", () => {
      render(
        <ProgressRing progress={0.5} toneClassName="text-success" accessibleLabel="כשירות מטווח">
          <span>45</span>
        </ProgressRing>,
      );
      // `getByText` doesn't itself respect `aria-hidden` (it reads the raw
      // DOM), so the real proof this is excluded from the accessibility
      // tree is the attribute on its containing wrapper, not absence from
      // a text query -- the "45" is still visually present underneath.
      const readout = screen.getByText("45");
      expect(readout.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(screen.getByRole("progressbar").textContent).toContain("45");
    });

    it("keeps the center readout NOT wrapped in aria-hidden when there's no progressbar role to conflict with", () => {
      render(
        <ProgressRing progress={0.5} toneClassName="text-success">
          <span>45</span>
        </ProgressRing>,
      );
      expect(screen.getByText("45").closest('[aria-hidden="true"]')).toBeNull();
    });
  });
});
