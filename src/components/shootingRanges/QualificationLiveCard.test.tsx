import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QualificationLiveCard, type QualificationLiveCardProps } from "./QualificationLiveCard";

function props(overrides: Partial<QualificationLiveCardProps> = {}): QualificationLiveCardProps {
  return {
    status: "valid",
    baselineDateLabel: "01/03/2026",
    expiryDateLabel: "01/09/2026",
    startInstantIso: "2026-03-01T00:00:00.000Z",
    expiryInstantIso: "2026-09-01T00:00:00.000Z",
    initialDaysRemaining: 5,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("QualificationLiveCard", () => {
  it("shows the seconds figure ticking upward every second without a page reload -- reproduces the reported 'looks frozen' bug", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00.500Z"));
    render(<QualificationLiveCard {...props({ expiryInstantIso: "2026-08-30T00:00:00.000Z" })} />);

    const before = screen.getByText(/שניות/).textContent;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const after = screen.getByText(/שניות/).textContent;

    expect(after).not.toBe(before);
  });

  it("still ticks every second under prefers-reduced-motion: reduce -- reduced motion must never freeze/slow the numeric clock", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
    render(<QualificationLiveCard {...props({ expiryInstantIso: "2026-08-30T00:00:00.000Z" })} />);

    const before = screen.getByText(/שניות/).textContent;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const after = screen.getByText(/שניות/).textContent;

    expect(after).not.toBe(before);
    vi.unstubAllGlobals();
  });

  it("derives the displayed remaining time from the target expiry instant and the current clock, not from decrementing a stored counter -- jumping the clock forward by an hour is reflected exactly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
    render(<QualificationLiveCard {...props({ expiryInstantIso: "2026-08-30T00:00:00.000Z" })} />);

    vi.setSystemTime(new Date("2026-08-25T01:00:00.000Z"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // 5 days minus 1 hour and 1 second remaining -> 4 days, 22h 59m 59s.
    expect(screen.getByText("22 שעות · 59 דקות · 59 שניות")).toBeInTheDocument();
  });

  it("resyncs immediately when the tab becomes visible again after being backgrounded, without requiring a refresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
    render(<QualificationLiveCard {...props({ expiryInstantIso: "2026-08-30T00:00:00.000Z" })} />);

    // Simulate 10 minutes passing in the background with no timer firing
    // (throttled background tab), then the tab becomes visible again.
    vi.setSystemTime(new Date("2026-08-25T00:10:00.000Z"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // 5 days minus the 10 minutes that passed in the background, resynced
    // immediately on visibilitychange rather than waiting for the (possibly
    // throttled) next interval tick.
    expect(screen.getByText("23 שעות · 50 דקות · 00 שניות")).toBeInTheDocument();
  });

  it("counts UPWARD for an expired qualification, live", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    render(
      <QualificationLiveCard
        {...props({ status: "expired", expiryInstantIso: "2026-08-30T00:00:00.000Z", initialDaysRemaining: -2 })}
      />,
    );

    const before = screen.getByText(/שניות/).textContent;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const after = screen.getByText(/שניות/).textContent;

    expect(after).not.toBe(before);
    expect(screen.getByText("מאז פקיעת הכשירות")).toBeInTheDocument();
  });

  it("gives every hours/minutes/seconds figure an explicit visible unit -- never an unexplained bare HH:MM:SS", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
    const { container } = render(<QualificationLiveCard {...props({ expiryInstantIso: "2026-08-30T00:00:00.000Z" })} />);

    expect(screen.getByText(/שעות/)).toBeInTheDocument();
    expect(screen.getByText(/דקות/)).toBeInTheDocument();
    expect(screen.getByText(/שניות/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\b\d{2}:\d{2}:\d{2}\b/);
  });

  describe("progress ring visualizes REMAINING qualification, not elapsed", () => {
    function arcDashOffset(container: HTMLElement) {
      const arc = container.querySelectorAll("circle")[1];
      return { offset: Number(arc.getAttribute("stroke-dashoffset")), circumference: Number(arc.getAttribute("stroke-dasharray")) };
    }

    it("shows a nearly-full ring immediately after a fresh baseline, matching the reported 10/08/2026 -> 10/02/2027 example viewed in late August 2026", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
      const { container } = render(
        <QualificationLiveCard
          {...props({ startInstantIso: "2026-08-10T00:00:00.000Z", expiryInstantIso: "2027-02-10T00:00:00.000Z" })}
        />,
      );

      expect(screen.getByText("169")).toBeInTheDocument();
      const { offset, circumference } = arcDashOffset(container);
      // A nearly-full remaining ring means a SMALL dash-offset (the arc is drawn almost all the way around).
      expect(offset / circumference).toBeLessThan(0.1);
    });

    it("shows a roughly half-full ring at the midpoint of the qualification window", () => {
      vi.useFakeTimers();
      const start = new Date("2026-01-01T00:00:00.000Z").getTime();
      const expiry = new Date("2026-07-01T00:00:00.000Z").getTime();
      vi.setSystemTime(new Date(start + (expiry - start) / 2));
      const { container } = render(
        <QualificationLiveCard {...props({ startInstantIso: new Date(start).toISOString(), expiryInstantIso: new Date(expiry).toISOString() })} />,
      );

      const { offset, circumference } = arcDashOffset(container);
      expect(offset / circumference).toBeCloseTo(0.5, 1);
    });

    it("empties the ring as expiry approaches, and holds it fully empty once expired -- never a misleadingly full/green ring past expiry", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z")); // one day after the expiry below
      const { container } = render(
        <QualificationLiveCard
          {...props({ status: "expired", startInstantIso: "2026-03-01T00:00:00.000Z", expiryInstantIso: "2026-09-01T00:00:00.000Z", initialDaysRemaining: -1 })}
        />,
      );

      const { offset, circumference } = arcDashOffset(container);
      expect(offset).toBeCloseTo(circumference, 5);
    });

    it("never increases progress (never re-fills the ring) as time advances during a valid qualification", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
      const { container } = render(
        <QualificationLiveCard {...props({ startInstantIso: "2026-08-10T00:00:00.000Z", expiryInstantIso: "2027-02-10T00:00:00.000Z" })} />,
      );
      const before = arcDashOffset(container);

      act(() => {
        vi.advanceTimersByTime(30 * 86_400_000); // 30 days later
      });
      const after = arcDashOffset(container);

      // Less remaining -> a SMALLER drawn arc -> a LARGER dash-offset.
      expect(after.offset).toBeGreaterThan(before.offset);
    });
  });

  describe("live marker replaces the old standalone pulse indicator beside the countdown", () => {
    it("no longer renders the old pulse-beside-the-timer indicator (its distinctive expanding-ring class)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
      const { container } = render(<QualificationLiveCard {...props({ expiryInstantIso: "2026-08-30T00:00:00.000Z" })} />);

      expect(container.querySelector(".animate-pulse-ring")).toBeNull();
    });

    it("shows a live marker on the ring once mounted with remaining progress above 0", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
      const { container } = render(<QualificationLiveCard {...props({ expiryInstantIso: "2026-08-30T00:00:00.000Z" })} />);

      expect(container.querySelector('[data-testid="progress-ring-live-marker"]')).not.toBeNull();
    });

    it("hides the marker for an expired qualification (remaining progress is 0) rather than showing it at a meaningless point", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
      const { container } = render(
        <QualificationLiveCard
          {...props({ status: "expired", startInstantIso: "2026-03-01T00:00:00.000Z", expiryInstantIso: "2026-09-01T00:00:00.000Z", initialDaysRemaining: -1 })}
        />,
      );

      expect(container.querySelector('[data-testid="progress-ring-live-marker"]')).toBeNull();
    });

  });

  describe("progressbar accessibility (Phase 5 remediation)", () => {
    it("exposes the ring as a labeled progressbar with a 0-100 value matching the visual arc", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
      render(
        <QualificationLiveCard
          {...props({ startInstantIso: "2026-08-10T00:00:00.000Z", expiryInstantIso: "2027-02-10T00:00:00.000Z" })}
        />,
      );

      const bar = screen.getByRole("progressbar", { name: "כשירות מטווח" });
      expect(bar).toHaveAttribute("aria-valuemin", "0");
      expect(bar).toHaveAttribute("aria-valuemax", "100");
      const valueNow = Number(bar.getAttribute("aria-valuenow"));
      expect(valueNow).toBeGreaterThanOrEqual(0);
      expect(valueNow).toBeLessThanOrEqual(100);
    });

    it("gives the progressbar an aria-valuetext matching the visible days-remaining readout exactly, not a generic percentage", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
      render(<QualificationLiveCard {...props({ expiryInstantIso: "2026-08-30T00:00:00.000Z" })} />);

      expect(screen.getByText("5")).toBeInTheDocument(); // the visible days figure
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "5 ימים עד לפקיעת הכשירות");
    });

    it("reflects an expired qualification's aria-valuetext distinctly from a valid one's", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-02T00:00:00.000Z"));
      render(
        <QualificationLiveCard
          {...props({ status: "expired", startInstantIso: "2026-03-01T00:00:00.000Z", expiryInstantIso: "2026-09-01T00:00:00.000Z", initialDaysRemaining: -1 })}
        />,
      );

      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", expect.stringContaining("מאז פקיעת הכשירות"));
    });
  });

  describe("reduced motion leaves the ring value and numeric clock unaffected", () => {
    it("still shows the correct remaining-progress ring and a per-second-ticking clock, with the marker still present and accurate", () => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
      );
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
      const { container } = render(
        <QualificationLiveCard {...props({ startInstantIso: "2026-08-10T00:00:00.000Z", expiryInstantIso: "2027-02-10T00:00:00.000Z" })} />,
      );

      expect(screen.getByText("169")).toBeInTheDocument();
      expect(container.querySelector('[data-testid="progress-ring-live-marker"]')).not.toBeNull();

      const before = screen.getByText(/שניות/).textContent;
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByText(/שניות/).textContent).not.toBe(before);

      vi.unstubAllGlobals();
    });
  });
});
