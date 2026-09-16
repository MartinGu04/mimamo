import { describe, expect, it } from "vitest";
import {
  formatDischargeDateLabel,
  resolveDischargeCountdownState,
  resolveDischargeMilestoneCopy,
} from "./dischargeCountdown";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("formatDischargeDateLabel", () => {
  it("formats a valid calendar date as zero-padded day.month.year", () => {
    expect(formatDischargeDateLabel("2027-01-24")).toBe("24.01.2027");
    expect(formatDischargeDateLabel("2027-12-03")).toBe("03.12.2027");
  });

  it("returns null for an unparseable date", () => {
    expect(formatDischargeDateLabel("not-a-date")).toBeNull();
    expect(formatDischargeDateLabel("2027-13-40")).toBeNull();
  });
});

describe("resolveDischargeCountdownState — counting_down phase", () => {
  const dischargeInstantMs = Date.parse("2027-01-24T00:00:00.000Z");
  const dischargeDayEndInstantMs = Date.parse("2027-01-24T23:59:59.999Z");

  it("computes whole days remaining and the H/M/S remainder", () => {
    // 143 days, 8h17m42s before the discharge instant.
    const nowMs =
      dischargeInstantMs - (143 * DAY_MS + 8 * 60 * 60 * 1000 + 17 * 60 * 1000 + 42 * 1000);
    const state = resolveDischargeCountdownState(nowMs, dischargeInstantMs, dischargeDayEndInstantMs, null);

    expect(state.phase).toBe("counting_down");
    if (state.phase !== "counting_down") throw new Error("unreachable");
    expect(state.daysRemaining).toBe(143);
    expect(state.clock).toEqual({ hours: 8, minutes: 17, seconds: 42 });
  });

  it.each([
    [200, "none"],
    [101, "none"],
    [100, "hundred"],
    [99, "none"],
    [51, "none"],
    [50, "fifty"],
    [49, "none"],
    [31, "none"],
    [30, "thirty"],
    [29, "none"],
    [8, "none"],
    [7, "week"],
    [6, "none"],
    [2, "none"],
    [1, "tomorrow"],
    [0, "none"],
  ] as const)("day %i remaining resolves to milestone %s -- an exact match only, never a range", (daysRemaining, expected) => {
    const nowMs = dischargeInstantMs - daysRemaining * DAY_MS - 1000;
    const state = resolveDischargeCountdownState(nowMs, dischargeInstantMs, dischargeDayEndInstantMs, null);

    expect(state.phase).toBe("counting_down");
    if (state.phase !== "counting_down") throw new Error("unreachable");
    expect(state.daysRemaining).toBe(daysRemaining);
    expect(state.milestone).toBe(expected);
  });

  it("returns no service progress when there is no enlistment instant", () => {
    const state = resolveDischargeCountdownState(
      dischargeInstantMs - 10 * DAY_MS,
      dischargeInstantMs,
      dischargeDayEndInstantMs,
      null,
    );
    expect(state.phase).toBe("counting_down");
    if (state.phase !== "counting_down") throw new Error("unreachable");
    expect(state.serviceProgress).toBeNull();
  });

  it("computes service progress from days served vs. total service days", () => {
    const enlistmentInstantMs = dischargeInstantMs - 1000 * DAY_MS; // 1000-day total service.
    const nowMs = dischargeInstantMs - 180 * DAY_MS; // 820 served, 180 remaining.
    const state = resolveDischargeCountdownState(nowMs, dischargeInstantMs, dischargeDayEndInstantMs, enlistmentInstantMs);

    expect(state.phase).toBe("counting_down");
    if (state.phase !== "counting_down") throw new Error("unreachable");
    expect(state.serviceProgress).toEqual({ daysServed: 820, daysRemaining: 180, percentServed: 82 });
  });
});

describe("resolveDischargeCountdownState — discharge_day phase", () => {
  const dischargeInstantMs = Date.parse("2027-01-24T00:00:00.000Z");
  const dischargeDayEndInstantMs = Date.parse("2027-01-24T23:59:59.999Z");

  it("is active from the exact discharge instant through the end of that civil day", () => {
    for (const nowMs of [dischargeInstantMs, dischargeInstantMs + 12 * 60 * 60 * 1000, dischargeDayEndInstantMs]) {
      const state = resolveDischargeCountdownState(nowMs, dischargeInstantMs, dischargeDayEndInstantMs, null);
      expect(state.phase).toBe("discharge_day");
    }
  });

  it("reports 100% service progress on discharge day when an enlistment instant is known", () => {
    const enlistmentInstantMs = dischargeInstantMs - 500 * DAY_MS;
    const state = resolveDischargeCountdownState(
      dischargeInstantMs + 1000,
      dischargeInstantMs,
      dischargeDayEndInstantMs,
      enlistmentInstantMs,
    );
    expect(state.phase).toBe("discharge_day");
    if (state.phase !== "discharge_day") throw new Error("unreachable");
    expect(state.serviceProgress?.percentServed).toBe(100);
    expect(state.serviceProgress?.daysRemaining).toBe(0);
  });
});

describe("resolveDischargeMilestoneCopy", () => {
  it("gives 'none' no badge", () => {
    expect(resolveDischargeMilestoneCopy("none").badge).toBeNull();
  });

  it("gives every other milestone a non-empty Hebrew badge and a theme-token accent", () => {
    for (const milestone of ["hundred", "fifty", "thirty", "week", "tomorrow"] as const) {
      const copy = resolveDischargeMilestoneCopy(milestone);
      expect(copy.badge).toBeTruthy();
      // A token, never a fixed hex -- the countdown sits on the ordinary
      // page background now, so the accent has to follow the active theme.
      expect(copy.accentColor).toMatch(/^var\(--[a-z-]+\)$/);
    }
  });

  it("never phrases the 50-day badge as 'חצי דרך' -- 50 days remaining isn't necessarily halfway through this person's service", () => {
    expect(resolveDischargeMilestoneCopy("fifty").badge).not.toMatch(/חצי דרך/);
  });
});

describe("resolveDischargeCountdownState — post_discharge phase", () => {
  const dischargeInstantMs = Date.parse("2027-01-24T00:00:00.000Z");
  const dischargeDayEndInstantMs = Date.parse("2027-01-24T23:59:59.999Z");

  it("never shows a negative countdown -- the day after discharge reads as 1 day since release", () => {
    const state = resolveDischargeCountdownState(
      dischargeDayEndInstantMs + 1,
      dischargeInstantMs,
      dischargeDayEndInstantMs,
      null,
    );
    expect(state).toEqual({ phase: "post_discharge", daysSinceDischarge: 1 });
  });

  it("counts whole additional civil days since discharge", () => {
    const state = resolveDischargeCountdownState(
      dischargeDayEndInstantMs + DAY_MS + 1,
      dischargeInstantMs,
      dischargeDayEndInstantMs,
      null,
    );
    expect(state).toEqual({ phase: "post_discharge", daysSinceDischarge: 2 });
  });
});
