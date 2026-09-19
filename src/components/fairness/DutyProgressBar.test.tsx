import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DutyProgressBar } from "./DutyProgressBar";

afterEach(() => {
  cleanup();
});

describe("DutyProgressBar -- ARIA value validity", () => {
  it("under target: aria-valuenow is the real rounded percentage, within the declared 0-100 range", () => {
    render(<DutyProgressBar ratio={0.42} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("REGRESSION: over target, aria-valuenow is clamped to aria-valuemax, never exceeding it", () => {
    render(<DutyProgressBar ratio={1.16} />);
    const bar = screen.getByRole("progressbar");
    // Previously this rendered aria-valuenow="116" with aria-valuemax="100" --
    // an invalid ARIA state. It must now stay within [0, 100].
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(Number(bar.getAttribute("aria-valuemax")));
  });

  it("exactly at target (100%): aria-valuenow is 100, not treated as overflow", () => {
    render(<DutyProgressBar ratio={1} />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "100%");
  });

  it("a zero ratio never goes negative", () => {
    render(<DutyProgressBar ratio={0} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("clamps a negative ratio (should never happen in practice) to 0, never a negative aria-valuenow", () => {
    render(<DutyProgressBar ratio={-0.2} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});

describe("DutyProgressBar -- the real over-target percentage is still available, via aria-valuetext", () => {
  it("under target: aria-valuetext is just the plain percentage, matching the visible progressPercentLabel formatting", () => {
    render(<DutyProgressBar ratio={0.42} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "42%");
  });

  it("over target: aria-valuetext carries the real percentage past 100, with a 'past target' note -- never silently capped", () => {
    render(<DutyProgressBar ratio={1.16} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "116%, מעבר ליעד");
  });
});

describe("DutyProgressBar -- meaningful accessible name", () => {
  it("has a real Hebrew accessible name by default, not just a bare percentage", () => {
    render(<DutyProgressBar ratio={0.42} />);
    expect(screen.getByRole("progressbar", { name: "התקדמות מול היעד" })).toBeInTheDocument();
  });

  it("accepts a caller-supplied label override", () => {
    render(<DutyProgressBar ratio={0.42} label="התקדמות נועה מול היעד" />);
    expect(screen.getByRole("progressbar", { name: "התקדמות נועה מול היעד" })).toBeInTheDocument();
  });
});

describe("DutyProgressBar -- visual overflow segment (unchanged appearance/behavior)", () => {
  it("renders only the normal-tone segment under target", () => {
    const { container } = render(<DutyProgressBar ratio={0.42} />);
    expect(container.querySelector(".bg-status-balanced")).not.toBeNull();
    expect(container.querySelector(".bg-status-above")).toBeNull();
  });

  it("renders both the normal-tone and overflow-tone segments over target", () => {
    const { container } = render(<DutyProgressBar ratio={1.16} />);
    expect(container.querySelector(".bg-status-balanced")).not.toBeNull();
    expect(container.querySelector(".bg-status-above")).not.toBeNull();
  });
});
