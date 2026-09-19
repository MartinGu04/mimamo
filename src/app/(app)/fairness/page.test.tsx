import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { COMPLETE_FAIRNESS_DATA, fairnessDataCompleteness } from "@/lib/domain/fairnessFoundation";
import { APP_NAME } from "@/lib/config/productName";
import type { DutyFairnessPersonRowView, DutyFairnessReadModel } from "@/lib/readModels/dutyFairnessTypes";
import type { ShiftFairnessPersonRowView, ShiftFairnessReadModel } from "@/lib/readModels/shiftFairnessTypes";

const getRequestShiftFairness = vi.fn();
const getRequestDutyFairness = vi.fn();
const getRequestEmergencyFairness = vi.fn();
const resolveOperationalMode = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
const routerPush = vi.fn();

vi.mock("@/lib/readModels/getRequestShiftFairness", () => ({ getRequestShiftFairness }));
vi.mock("@/lib/readModels/getRequestDutyFairness", () => ({ getRequestDutyFairness }));
vi.mock("@/lib/readModels/getRequestEmergencyFairness", () => ({ getRequestEmergencyFairness }));
vi.mock("@/lib/emergencyMode/state", () => ({ resolveOperationalMode }));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ push: routerPush }) }));
vi.mock("@/components/ui/DataFreshnessStatus", () => ({
  DataFreshnessStatus: ({ fetchedAt }: { fetchedAt: string }) => <div data-testid="freshness">{fetchedAt}</div>,
}));

const { default: FairnessPage } = await import("./page");

function searchParams(params: Record<string, string> = {}) {
  return Promise.resolve(params);
}

async function renderFairnessPage(params: Record<string, string> = {}) {
  const element = await FairnessPage({ searchParams: searchParams(params) });
  return render(element as React.ReactElement);
}

/**
 * The Shift-mode view (`renderShiftFairnessView`, `page.tsx`) calls
 * `getJerusalemLocalNow()` with NO argument -- i.e. the REAL system clock
 * -- to decide `isOnCurrentMonth` (whether `model.month`, the loader's
 * OWN resolved month, is the actual real-world current Asia/Jerusalem
 * month). That's correct production behavior: it's what lets the page
 * tell a genuinely-current month apart from a merely-not-yet-closed
 * future one (`periodStatus: "current"` alone can't, see the "FUTURE
 * month" test below). But every fixture in this file (`shiftModel`'s
 * `month: "2026-08"`/`fetchedAt: "2026-08-15T10:00:00.000Z"`, `dutyModel`
 * likewise) was written assuming "now" IS mid-August 2026 -- so this
 * suite must freeze the real clock there too, or `isOnCurrentMonth`
 * silently flips to `false` the moment the real calendar moves past
 * August 2026, and every test whose behavior depends on it (the "עד
 * היום" label, and the SAME `isOnCurrentMonth` signal `buildTargetPeriodLabel`/
 * `buildShiftStatusExplanationLabel` in `fairnessCards.ts` use for their
 * own "עד היום"/"בתקופה זו" wording) starts exercising the wrong branch.
 *
 * `getJerusalemLocalNow` (`lib/time/jerusalemClock.ts`) converts an
 * instant to Asia/Jerusalem civil time via `Intl.DateTimeFormat` with an
 * explicit `timeZone` -- independent of the *host* machine's own TZ, so
 * freezing `Date` via `vi.setSystemTime` here is the only piece that
 * needs pinning; no `process.env.TZ` juggling. The frozen instant
 * (10:00 UTC = 13:00 Asia/Jerusalem in August's DST) sits mid-day,
 * mid-month -- nowhere near a day/month boundary in Jerusalem local
 * time, so this can never flip to a different calendar date depending on
 * which TZ the test runner's own OS happens to use.
 */
const FROZEN_NOW = "2026-08-15T10:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FROZEN_NOW));
  getRequestShiftFairness.mockReset();
  getRequestDutyFairness.mockReset();
  getRequestEmergencyFairness.mockReset();
  redirect.mockClear();
  routerPush.mockClear();
  resolveOperationalMode.mockReset();
  // Default: Emergency Mode inactive -- the common case, and the one every
  // pre-existing test (which never mocked this) implicitly assumed.
  resolveOperationalMode.mockResolvedValue({ kind: "regular" });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function shiftRow(overrides: Partial<ShiftFairnessPersonRowView> = {}): ShiftFairnessPersonRowView {
  return {
    personId: "p_tech",
    personName: "טל טכנאי",
    serviceCategory: "regular",
    actualShifts: 4,
    target: 4.3,
    deviation: -0.3,
    status: "balanced",
    weekendActualShifts: 1,
    weekendTarget: 1.2,
    weekendDeviation: -0.2,
    weekendStatus: "balanced",
    weekendsWorked: 1,
    dataCompleteness: COMPLETE_FAIRNESS_DATA,
    expectationFactors: null,
    ...overrides,
  };
}

function shiftModel(overrides: Partial<ShiftFairnessReadModel> = {}): ShiftFairnessReadModel {
  return {
    fetchedAt: "2026-08-15T10:00:00.000Z",
    month: "2026-08",
    periodStartDate: "2026-08-01",
    periodEndDate: "2026-08-15",
    periodStatus: "current",
    groups: [
      { role: "supervisor", rows: [] },
      { role: "technician", rows: [shiftRow()] },
    ],
    ...overrides,
  };
}

function dutyRow(overrides: Partial<DutyFairnessPersonRowView> = {}): DutyFairnessPersonRowView {
  return {
    key: "p_tech-0",
    personId: "p_tech",
    sourceName: "נועה טכנאית",
    allocationLabel: "טכנאי",
    previousScore: 5,
    currentScore: 6,
    delta: 1,
    comparisonTarget: 8,
    gapToTarget: -2,
    normalizedLoad: 0.75,
    status: "below",
    weekendCount: 2,
    completedAllocationTotal: 5,
    personalTargetTotal: 8,
    targetProgressRatio: 0.625,
    remainingToTarget: 3,
    paceStatus: null,
    liveDuty: null,
    exemptions: [],
    dataCompleteness: COMPLETE_FAIRNESS_DATA,
    ...overrides,
  };
}

function dutyModel(overrides: Partial<DutyFairnessReadModel> = {}): DutyFairnessReadModel {
  return {
    fetchedAt: "2026-08-15T10:00:00.000Z",
    fairnessModelVersion: 1,
    period: { key: "h2", year: 2026, label: "7–12/2026", status: "current" },
    targets: { supervisorTarget: 4, technicianTarget: 8 },
    groups: [{ key: "technician", rows: [dutyRow()] }],
    totals: null,
    ...overrides,
  };
}

describe("/fairness — auth failure states", () => {
  it("unauthenticated redirects to /login", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "unauthenticated" });
    await expect(FairnessPage({ searchParams: searchParams() })).rejects.toThrow("REDIRECT:/login");
  });

  it.each(["missing_email", "unmapped", "ambiguous_identity"])("%s shows the generic access-denied screen", async (status) => {
    getRequestShiftFairness.mockResolvedValue({ status });
    await renderFairnessPage();
    expect(screen.getByText(`אין לך הרשאה ל-${APP_NAME}`)).toBeInTheDocument();
  });

  it("a mapped normal (non-manager) user reaches the real page -- no manager requirement anywhere", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage();
    expect(screen.getByRole("heading", { name: "טבלת צדק", level: 1 })).toBeInTheDocument();
  });
});

describe("/fairness — C. mode params", () => {
  it("default (no ?mode=) resolves to Shift mode", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage();
    expect(getRequestShiftFairness).toHaveBeenCalled();
    expect(getRequestDutyFairness).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "משמרות" })).toHaveAttribute("aria-current", "page");
  });

  it("?mode=duties resolves to Duty mode, calling ONLY the duty loader", async () => {
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: dutyModel() });
    await renderFairnessPage({ mode: "duties" });
    expect(getRequestDutyFairness).toHaveBeenCalled();
    expect(getRequestShiftFairness).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "תורנויות" })).toHaveAttribute("aria-current", "page");
  });

  it("an invalid ?mode= falls back to the safe default (shifts)", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage({ mode: "combined" });
    expect(getRequestShiftFairness).toHaveBeenCalled();
    expect(getRequestDutyFairness).not.toHaveBeenCalled();
  });

  it("an H1/H2-only ?period= never leaks into Shift mode's own loader call", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage({ period: "h1" });
    expect(getRequestShiftFairness).toHaveBeenCalledWith(null);
  });
});

describe("/fairness — Shift calculation-period label", () => {
  it("the current (open) month's label includes 'עד היום'", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({ month: "2026-08", periodStatus: "current" }),
    });
    await renderFairnessPage();
    expect(screen.getByText("תקופת החישוב: אוגוסט 2026 · עד היום")).toBeInTheDocument();
  });

  it("a closed historical month's label does NOT include 'עד היום'", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({ month: "2026-07", periodStatus: "closed" }),
    });
    await renderFairnessPage();
    expect(screen.getByText("תקופת החישוב: יולי 2026")).toBeInTheDocument();
    expect(screen.queryByText(/עד היום/)).toBeNull();
  });

  it("a FUTURE month's label does NOT include 'עד היום', even though the Shift Fairness domain also classifies a future month's periodStatus as \"current\" (meaning only \"not closed yet\", not \"is today's month\")", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      // A far-future month: `periodStatus: "current"` here mirrors the real
      // engine's own classification for any not-yet-closed month -- the
      // page must still tell it apart from the ACTUAL current month via
      // `isOnCurrentMonth`, never `periodStatus` alone.
      model: shiftModel({ month: "2027-07", periodStatus: "current" }),
    });
    await renderFairnessPage();
    expect(screen.getByText("תקופת החישוב: יולי 2027")).toBeInTheDocument();
    expect(screen.queryByText(/עד היום/)).toBeNull();
  });
});

describe("/fairness — F. Shift cards", () => {
  it("a fully modelable row renders real, clearly-labeled actual/expected numbers as a whole-shift fair RANGE, and a human-readable status (never a raw fractional target or signed gap)", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage();
    expect(screen.getByText("טל טכנאי")).toBeInTheDocument();
    expect(screen.getByTestId("metric-shift-actual").textContent).toContain("משמרות שביצעת");
    expect(screen.getByTestId("metric-shift-actual").textContent).toContain("4");
    expect(screen.getByTestId("metric-shift-target").textContent).toContain("צפי הוגן");
    // Whole-shift fair range: raw target is 4.3 -> floor 4, ceil 5 -> "4–5", never a rounded single number like "4.5".
    expect(screen.getByTestId("metric-shift-target").textContent).toContain("4–5");
    expect(screen.getByTestId("metric-shift-target").textContent).not.toContain("4.5");
    expect(screen.getByTestId("metric-shift-status-state").textContent).toContain("מצב");
    // Badge (short word) and the "מצב" row (descriptive wording) are
    // deliberately DIFFERENT text -- no duplicated status on the card.
    expect(screen.getByTestId("metric-shift-status-state").textContent).toContain("בתוך הטווח ההוגן");
    expect(screen.getByText("בטווח הצפי")).toBeInTheDocument();
    expect(screen.getByText("בתוך הטווח ההוגן")).toBeInTheDocument();
  });

  it("weekends render as a plain factual count on the main card, never a comparative figure", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage();
    expect(screen.getByTestId("metric-shift-weekend-actual").textContent).toContain('סופ"שים');
    expect(screen.getByTestId("metric-shift-weekend-actual").textContent).toContain("1");
    expect(screen.queryByTestId("metric-shift-weekend-target")).toBeNull();
  });

  it("C. an unmodelable target never renders 0/מאוזן -- shows the honest target-specific note plus the generic status badge, actual work stays visible", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          { role: "supervisor", rows: [] },
          {
            role: "technician",
            rows: [
              shiftRow({
                target: null,
                deviation: null,
                status: null,
                weekendTarget: null,
                weekendDeviation: null,
                weekendStatus: null,
                dataCompleteness: fairnessDataCompleteness(["shift_target_unmodelable_evidence_only"]),
              }),
            ],
          },
        ],
      }),
    });
    await renderFairnessPage();
    expect(screen.getByText(/משמרות שביצעת/).textContent).toContain("4");
    expect(screen.getByText("לא ניתן לחשב יעד מלא לתקופה זו", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("לא ניתן להשוות")).toBeInTheDocument();
    expect(screen.queryByText("בטווח הצפי")).toBeNull();
    expect(screen.queryByTestId("metric-shift-target")).toBeNull();
  });

  it("an empty group is omitted entirely -- never an empty אחמ״שים section", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage();
    expect(screen.queryByText(/אחמ״שים/)).toBeNull();
    expect(screen.getByText(/טכנאים/)).toBeInTheDocument();
  });
});

describe("/fairness — Shift card-level info control", () => {
  it("exactly one info/help affordance exists per Shift card, even with multiple cards on the page", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          { role: "supervisor", rows: [] },
          {
            role: "technician",
            rows: [
              shiftRow({ personId: "p_a", personName: "אדם א" }),
              shiftRow({ personId: "p_b", personName: "אדם ב" }),
            ],
          },
        ],
      }),
    });
    await renderFairnessPage();
    expect(screen.getAllByRole("button", { name: "הסבר על מדדי הכרטיס" })).toHaveLength(2);
  });

  it("opening the info explanation never triggers the card's own person-detail navigation", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage();

    fireEvent.click(screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" }));

    // The explanation popover itself opened...
    expect(screen.getByRole("dialog", { name: "הסבר על מדדי הכרטיס" })).toBeInTheDocument();
    // ...but the person-detail overlay (a differently-named dialog) did NOT.
    expect(screen.queryByRole("dialog", { name: "טל טכנאי" })).toBeNull();
  });

  it("the info control is keyboard-focusable and its content is reachable without a pointer", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage();

    const trigger = screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" });
    trigger.focus();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger); // native <button> semantics fire the same click handler for Enter/Space activation
    expect(screen.getByRole("dialog", { name: "הסבר על מדדי הכרטיס" })).toBeInTheDocument();
  });

  it("the info button is NEVER a descendant of the person-detail link -- no invalid nested interactive markup", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage();

    const personLink = screen.getByRole("link", { name: "טל טכנאי" });
    expect(within(personLink).queryByRole("button", { name: "הסבר על מדדי הכרטיס" })).toBeNull();

    // Conversely, the link is not nested inside the info control's own subtree either -- true siblings.
    const infoButton = screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" });
    expect(infoButton.closest("a")).toBeNull();
  });

  it("the normal card area is still a real, independently focusable link to the person detail", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage();

    const personLink = screen.getByRole("link", { name: "טל טכנאי" });
    expect(personLink).toHaveAttribute("href", "/fairness?month=2026-08&person=p_tech");
    // A real <a href>, not tabindex="-1" or a non-interactive lookalike.
    expect(personLink.getAttribute("tabindex")).not.toBe("-1");

    const infoButton = screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" });
    infoButton.focus();
    expect(infoButton).toHaveFocus();
    personLink.focus();
    expect(personLink).toHaveFocus();
  });
});

describe("/fairness — hide zero/irrelevant Shift rows (presentation filter only)", () => {
  it("a row with zero actual work AND a known zero target (and no meaningful weekend actual/target) is not rendered as a card", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          { role: "supervisor", rows: [] },
          {
            role: "technician",
            rows: [
              shiftRow({
                personId: "p_nonparticipant",
                personName: "לא השתתף החודש",
                actualShifts: 0,
                target: 0,
                deviation: 0,
                status: "balanced",
                weekendActualShifts: 0,
                weekendTarget: 0,
                weekendDeviation: 0,
                weekendStatus: "balanced",
              }),
            ],
          },
        ],
      }),
    });
    await renderFairnessPage();
    expect(screen.queryByText("לא השתתף החודש")).toBeNull();
    // With the ONLY row filtered out, the whole role section (and the page) reads as empty.
    expect(screen.getByText("אין נתוני משמרות זמינים לתקופה שנבחרה.")).toBeInTheDocument();
  });

  it("actual = 0 with a POSITIVE target still renders -- a real gap, not a non-participant", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          { role: "supervisor", rows: [] },
          {
            role: "technician",
            rows: [shiftRow({ personId: "p_gap", personName: "פער אמיתי", actualShifts: 0, target: 3, deviation: -3 })],
          },
        ],
      }),
    });
    await renderFairnessPage();
    expect(screen.getByText("פער אמיתי")).toBeInTheDocument();
  });

  it("actual > 0 always renders, even with a zero target", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          { role: "supervisor", rows: [] },
          {
            role: "technician",
            rows: [shiftRow({ personId: "p_did_work", personName: "עבד בפועל", actualShifts: 2, target: 0, deviation: 2 })],
          },
        ],
      }),
    });
    await renderFairnessPage();
    expect(screen.getByText("עבד בפועל")).toBeInTheDocument();
  });

  it("a null (unmodelable, NOT zero) target with zero actual is never hidden -- unknown is not zero", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          { role: "supervisor", rows: [] },
          {
            role: "technician",
            rows: [
              shiftRow({
                personId: "p_unknown_target",
                personName: "יעד לא ידוע",
                actualShifts: 0,
                target: null,
                deviation: null,
                status: null,
                weekendTarget: null,
                weekendDeviation: null,
                weekendStatus: null,
                dataCompleteness: fairnessDataCompleteness(["shift_target_unmodelable_evidence_only"]),
              }),
            ],
          },
        ],
      }),
    });
    await renderFairnessPage();
    expect(screen.getByText("יעד לא ידוע")).toBeInTheDocument();
  });

  it("role section heading count and service subgroup counts reflect only the VISIBLE rows after filtering", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          { role: "supervisor", rows: [] },
          {
            role: "technician",
            rows: [
              shiftRow({ personId: "p_visible_1", personName: "נראה 1", serviceCategory: "regular", actualShifts: 3, target: 3 }),
              shiftRow({ personId: "p_visible_2", personName: "נראה 2", serviceCategory: "permanent", actualShifts: 2, target: 2 }),
              shiftRow({
                personId: "p_hidden",
                personName: "מוסתר",
                serviceCategory: "permanent",
                actualShifts: 0,
                target: 0,
                deviation: 0,
                weekendActualShifts: 0,
                weekendTarget: 0,
                weekendDeviation: 0,
              }),
            ],
          },
        ],
      }),
    });
    await renderFairnessPage();

    expect(screen.getByRole("heading", { level: 2, name: /טכנאים/ }).textContent).toContain("2");
    expect(screen.getByRole("heading", { level: 3, name: /^קבע/ }).textContent).toContain("1");
    expect(screen.getByText("נראה 1")).toBeInTheDocument();
    expect(screen.getByText("נראה 2")).toBeInTheDocument();
    expect(screen.queryByText("מוסתר")).toBeNull();
  });

  it("an empty service subgroup after filtering is omitted -- never an empty heading", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          { role: "supervisor", rows: [] },
          {
            role: "technician",
            rows: [
              shiftRow({ personId: "p_visible", personName: "נראה", serviceCategory: "regular", actualShifts: 3, target: 3 }),
              shiftRow({
                personId: "p_hidden_reserve",
                personName: "מילואים מוסתר",
                serviceCategory: "reserve",
                actualShifts: 0,
                target: 0,
                deviation: 0,
                weekendActualShifts: 0,
                weekendTarget: 0,
                weekendDeviation: 0,
              }),
            ],
          },
        ],
      }),
    });
    await renderFairnessPage();

    expect(screen.getByRole("heading", { level: 3, name: /סדיר/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: /מילואים/ })).toBeNull();
  });
});

describe("/fairness — Shift service-type subgrouping (PR #4 follow-up, Shift Fairness only)", () => {
  it("the supervisor section subdivides into סדיר / קבע / מילואים subgroup headings", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          {
            role: "supervisor",
            rows: [
              shiftRow({ personId: "p_regular", personName: "רגילה סדירה", serviceCategory: "regular" }),
              shiftRow({ personId: "p_permanent", personName: "קבועה", serviceCategory: "permanent" }),
              shiftRow({ personId: "p_reserve", personName: "מילואימניקית", serviceCategory: "reserve" }),
            ],
          },
          { role: "technician", rows: [] },
        ],
      }),
    });

    await renderFairnessPage();

    expect(screen.getByRole("heading", { level: 3, name: /סדיר/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /קבע/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /מילואים/ })).toBeInTheDocument();
    expect(screen.getByText("רגילה סדירה")).toBeInTheDocument();
    expect(screen.getByText("קבועה")).toBeInTheDocument();
    expect(screen.getByText("מילואימניקית")).toBeInTheDocument();
  });

  it("the technician section ALSO subdivides into סדיר / קבע / מילואים, independently of the supervisor section", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          { role: "supervisor", rows: [] },
          {
            role: "technician",
            rows: [
              shiftRow({ personId: "p_regular", personName: "טכנאי סדיר", serviceCategory: "regular" }),
              shiftRow({ personId: "p_permanent", personName: "טכנאי קבע", serviceCategory: "permanent" }),
              shiftRow({ personId: "p_reserve", personName: "טכנאי מילואים", serviceCategory: "reserve" }),
            ],
          },
        ],
      }),
    });

    await renderFairnessPage();

    const technicianSection = screen.getByRole("heading", { level: 2, name: /טכנאים/ }).closest("section");
    expect(technicianSection).not.toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: /סדיר/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /קבע/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /מילואים/ })).toBeInTheDocument();
    expect(screen.getByText("טכנאי סדיר")).toBeInTheDocument();
    expect(screen.getByText("טכנאי קבע")).toBeInTheDocument();
    expect(screen.getByText("טכנאי מילואים")).toBeInTheDocument();
  });

  it("an empty service subgroup is omitted -- a role with only סדיר people never shows קבע/מילואים headings", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });

    await renderFairnessPage();

    expect(screen.getByRole("heading", { level: 3, name: /סדיר/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: /קבע/ })).toBeNull();
    expect(screen.queryByRole("heading", { level: 3, name: /מילואים/ })).toBeNull();
  });

  it("subgrouping never changes the underlying Shift Fairness numbers -- actual/expected/status values render exactly as the read model provided them", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage();
    expect(screen.getByTestId("metric-shift-actual").textContent).toContain("4");
    expect(screen.getByTestId("metric-shift-target").textContent).toContain("4–5");
    expect(screen.getByTestId("metric-shift-status-state").textContent).toContain("בתוך הטווח ההוגן");
    expect(screen.getByText("בטווח הצפי")).toBeInTheDocument();
    expect(screen.getByText("בתוך הטווח ההוגן")).toBeInTheDocument();
  });
});

describe("/fairness — G. Duty cards", () => {
  it("the workbook's own role-based comparison target never appears anywhere -- not the below/balanced/above badge, not a second 'target' stat, not a gap figure, not a normalized-load percentage -- even one interaction deeper in the detail overlay", async () => {
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: dutyModel() });
    await renderFairnessPage({ mode: "duties", person: "p_tech" });
    // The row's fixture (comparisonTarget: 8, status: "below") would have
    // rendered "מתחת ליעד" here before this fix -- personalTargetTotal (8,
    // matching the fixture default) is the only target-shaped figure shown.
    expect(screen.queryByText("מתחת ליעד")).toBeNull();
    expect(screen.queryByText("מאוזן")).toBeNull();
    expect(screen.queryByText("מעל היעד")).toBeNull();
    expect(screen.queryByText("יעד השוואה")).toBeNull();
    expect(screen.queryByText("פער מהיעד")).toBeNull();
    expect(screen.queryByText(/עומס יחסי/)).toBeNull();
  });

  it("Duty Fairness remains UNCHANGED -- no service-type (סדיר/קבע/מילואים) subgrouping applied, no h3 subgroup headings at all", async () => {
    getRequestDutyFairness.mockResolvedValue({
      status: "ok",
      model: dutyModel({
        groups: [
          { key: "supervisor", rows: [dutyRow({ personId: "p_sup", sourceName: 'אחמ"ש בדיקה', allocationLabel: 'אחמ"ש' })] },
          { key: "technician", rows: [dutyRow({ personId: "p_tech2", sourceName: "טכנאי בדיקה" })] },
        ],
      }),
    });
    await renderFairnessPage({ mode: "duties" });

    // The role headings are still real h2 sections, exactly as before.
    expect(screen.getByRole("heading", { level: 2, name: /אחמ״שים/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /טכנאים/ })).toBeInTheDocument();
    // No h3-level service-type subgroup headings were introduced for Duty mode.
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(screen.queryByText("סדיר")).toBeNull();
    expect(screen.queryByText("קבע")).toBeNull();
    expect(screen.queryByText("מילואים")).toBeNull();
  });

  it("clearly-labeled completed/target/progress render on the main card, and duty rows are never filtered by the Shift-only visibility rule", async () => {
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: dutyModel() });
    await renderFairnessPage({ mode: "duties" });
    expect(screen.getByTestId("metric-duty-points").textContent).toContain("5");
    expect(screen.getByTestId("metric-duty-points").textContent).toContain("8");
    expect(screen.getByTestId("metric-duty-progress-percent").textContent).toContain("63%");
    expect(screen.getByTestId("metric-duty-remaining").textContent).toContain("3");
    expect(screen.getByText("נועה טכנאית")).toBeInTheDocument();
  });

  it("previous/current score and the change from the last period remain visible one interaction deeper, in the detail overlay", async () => {
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: dutyModel() });
    await renderFairnessPage({ mode: "duties", person: "p_tech" });
    expect(screen.getByText("ניקוד נוכחי")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText("שינוי")).toBeInTheDocument();
    expect(screen.getByText("+1.00")).toBeInTheDocument();
  });

  function noTargetModel() {
    return dutyModel({
      groups: [
        {
          key: "other",
          rows: [
            dutyRow({
              allocationLabel: "הסמכה",
              comparisonTarget: null,
              gapToTarget: null,
              status: null,
              personalTargetTotal: 0,
              targetProgressRatio: null,
              remainingToTarget: null,
              paceStatus: null,
            }),
          ],
        },
      ],
    });
  }

  it("B. null target -> no fake progress bar/percentage, a calm no-target note, real completed-allocation total still visible", async () => {
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: noTargetModel() });
    await renderFairnessPage({ mode: "duties" });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByTestId("metric-duty-progress-percent")).toBeNull();
    expect(screen.getByTestId("metric-duty-allocation").textContent).toContain("5");
    expect(screen.getByText("אין תורנויות משובצות לפוטנציאל המפורסם בתקופה זו.")).toBeInTheDocument();
  });

  it("B. null target -> the detail overlay never shows the workbook's own status badge/target stat either -- personalTargetTotal is the only duty target anywhere", async () => {
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: noTargetModel() });
    await renderFairnessPage({ mode: "duties", person: "p_tech" });
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByText("לא ניתן להשוות")).toBeNull();
    expect(dialog.queryByText("יעד השוואה")).toBeNull();
    expect(dialog.getByText("אין תורנויות משובצות לפוטנציאל המפורסם בתקופה זו.")).toBeInTheDocument();
  });

  it("exemptions are visible without hover", async () => {
    getRequestDutyFairness.mockResolvedValue({
      status: "ok",
      model: dutyModel({
        groups: [{ key: "technician", rows: [dutyRow({ exemptions: [{ raw: "מטבח", affectedDutyFamilies: ["daily_kitchen"] }] })] }],
      }),
    });
    await renderFairnessPage({ mode: "duties" });
    expect(screen.getByText("🚫 מטבח")).toBeInTheDocument();
  });

  it("weekend count is preserved, under a self-explanatory label", async () => {
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: dutyModel() });
    await renderFairnessPage({ mode: "duties" });
    expect(screen.getByTestId("metric-duty-weekend").textContent).toContain('סופ"שים');
    expect(screen.getByTestId("metric-duty-weekend").textContent).toContain("2");
  });

  it("A. an unavailable currentScore never blocks the personal duty target from rendering on the main card, and the detail overlay stays free of the workbook's own status vocabulary", async () => {
    getRequestDutyFairness.mockResolvedValue({
      status: "ok",
      model: dutyModel({
        groups: [{ key: "technician", rows: [dutyRow({ currentScore: null, comparisonTarget: 8, status: null })] }],
      }),
    });
    await renderFairnessPage({ mode: "duties" });
    expect(screen.getByTestId("metric-duty-points").textContent).toContain("8");
    expect(screen.queryByText(/לחשב יעד/)).toBeNull();

    cleanup();
    getRequestDutyFairness.mockResolvedValue({
      status: "ok",
      model: dutyModel({
        groups: [{ key: "technician", rows: [dutyRow({ currentScore: null, comparisonTarget: 8, status: null })] }],
      }),
    });
    await renderFairnessPage({ mode: "duties", person: "p_tech" });
    expect(screen.queryByText("לא ניתן להשוות")).toBeNull();
    expect(screen.queryByText("יעד השוואה")).toBeNull();
  });

  it("REGRESSION: the workbook's role-based comparisonTarget (8) and this person's own published-potential personalTargetTotal (5.4) never both appear as competing targets, anywhere on the page", async () => {
    const model = dutyModel({
      groups: [
        {
          key: "technician",
          rows: [
            dutyRow({
              comparisonTarget: 8,
              currentScore: 6,
              status: "below",
              completedAllocationTotal: 2.4,
              personalTargetTotal: 5.4,
              targetProgressRatio: 2.4 / 5.4,
              remainingToTarget: 5.4 - 2.4,
            }),
          ],
        },
      ],
    });

    getRequestDutyFairness.mockResolvedValue({ status: "ok", model });
    await renderFairnessPage({ mode: "duties" });
    // Main card: only the personal target (5.4) appears, never the workbook's 8.
    expect(screen.getByTestId("metric-duty-points").textContent).toContain("5.4");
    expect(screen.getByTestId("metric-duty-points").textContent).not.toContain("8");
    expect(screen.queryByText("מתחת ליעד")).toBeNull();

    cleanup();
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model });
    await renderFairnessPage({ mode: "duties", person: "p_tech" });
    // Detail overlay: still only the personal target -- the workbook's own
    // score (6) and previous score are real facts, never framed as targets,
    // and its role-based 8/status/gap/normalized-load are never rendered.
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/5\.4/)).toBeInTheDocument();
    expect(dialog.queryByText("מתחת ליעד")).toBeNull();
    expect(dialog.queryByText("מאוזן")).toBeNull();
    expect(dialog.queryByText("מעל היעד")).toBeNull();
    expect(dialog.queryByText("יעד השוואה")).toBeNull();
    expect(dialog.queryByText("פער מהיעד")).toBeNull();
    expect(dialog.queryByText(/עומס יחסי/)).toBeNull();
  });

  it("BIDI REGRESSION: completed=0 / target=4.7 reads '0 / 4.7', never '4.7 / 0', both on the main card and one interaction deeper in the detail overlay", async () => {
    const model = dutyModel({
      groups: [
        {
          key: "technician",
          rows: [
            dutyRow({
              completedAllocationTotal: 0,
              personalTargetTotal: 4.7,
              targetProgressRatio: 0,
              remainingToTarget: 4.7,
            }),
          ],
        },
      ],
    });

    getRequestDutyFairness.mockResolvedValue({ status: "ok", model });
    await renderFairnessPage({ mode: "duties" });
    const points = screen.getByTestId("metric-duty-points");
    const isolatedRatioOnCard = points.querySelector('[dir="ltr"]');
    expect(isolatedRatioOnCard).not.toBeNull();
    expect(isolatedRatioOnCard?.textContent?.trim()).toBe("0 / 4.7");

    cleanup();
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model });
    await renderFairnessPage({ mode: "duties", person: "p_tech" });
    const dialog = screen.getByRole("dialog");
    const isolatedRatioInDialog = dialog.querySelector('[dir="ltr"]');
    expect(isolatedRatioInDialog).not.toBeNull();
    expect(isolatedRatioInDialog?.textContent?.trim()).toBe("0 / 4.7");
  });

  it("ZERO STATE REGRESSION: 0 completed points with a valid target shows 'טרם בוצעו תורנויות' -- never 'מתחת לצפי' -- on both the main card and the detail overlay", async () => {
    const model = dutyModel({
      groups: [
        {
          key: "technician",
          rows: [
            dutyRow({
              completedAllocationTotal: 0,
              personalTargetTotal: 6,
              targetProgressRatio: 0,
              remainingToTarget: 6,
              paceStatus: "below_pace", // the raw pace math would say "below" -- must never surface as such here
            }),
          ],
        },
      ],
    });

    getRequestDutyFairness.mockResolvedValue({ status: "ok", model });
    await renderFairnessPage({ mode: "duties" });
    expect(screen.getByTestId("metric-duty-pace")).toHaveTextContent("טרם בוצעו תורנויות");
    expect(screen.queryByText("מתחת לצפי")).toBeNull();

    cleanup();
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model });
    await renderFairnessPage({ mode: "duties", person: "p_tech" });
    const dialogText = screen.getByRole("dialog").textContent ?? "";
    expect(dialogText).toContain("טרם בוצעו תורנויות");
    expect(dialogText).not.toContain("מתחת לצפי");
  });

  it("STATUS PRECEDENCE REGRESSION: reaching the target exactly shows 'היעד הושלם', exceeding it shows 'מעבר ליעד' -- both take priority over the underlying pace comparison, on the main card and one interaction deeper", async () => {
    const reachedModel = dutyModel({
      groups: [
        {
          key: "technician",
          rows: [
            dutyRow({
              personId: "p_reached",
              sourceName: "הגיע ליעד",
              completedAllocationTotal: 6,
              personalTargetTotal: 6,
              targetProgressRatio: 1,
              remainingToTarget: 0,
              paceStatus: "below_pace",
            }),
          ],
        },
      ],
    });
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: reachedModel });
    await renderFairnessPage({ mode: "duties" });
    expect(screen.getByTestId("metric-duty-pace")).toHaveTextContent("היעד הושלם");

    cleanup();
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: reachedModel });
    await renderFairnessPage({ mode: "duties", person: "p_reached" });
    expect(screen.getByRole("dialog").textContent).toContain("היעד הושלם");

    cleanup();
    const exceededModel = dutyModel({
      groups: [
        {
          key: "technician",
          rows: [
            dutyRow({
              personId: "p_exceeded",
              sourceName: "מעבר ליעד",
              completedAllocationTotal: 7.2,
              personalTargetTotal: 6.2,
              targetProgressRatio: 7.2 / 6.2,
              remainingToTarget: 6.2 - 7.2,
              paceStatus: "on_pace",
            }),
          ],
        },
      ],
    });
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: exceededModel });
    await renderFairnessPage({ mode: "duties" });
    expect(screen.getByTestId("metric-duty-pace")).toHaveTextContent("מעבר ליעד");

    cleanup();
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: exceededModel });
    await renderFairnessPage({ mode: "duties", person: "p_exceeded" });
    expect(screen.getByRole("dialog").textContent).toContain("מעבר ליעד");
  });

  it("the no-target state remains unchanged by this refinement -- no status badge renders when there is no valid target", async () => {
    const model = dutyModel({
      groups: [
        {
          key: "technician",
          rows: [
            dutyRow({
              personalTargetTotal: null,
              targetProgressRatio: null,
              remainingToTarget: null,
              paceStatus: null,
            }),
          ],
        },
      ],
    });
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model });
    await renderFairnessPage({ mode: "duties" });
    expect(screen.queryByTestId("metric-duty-pace")).toBeNull();
  });

  it('a ר"צ row appears in the supervisor section with a null target -- real completed-allocation total visible, no progress bar, and a null-comparison badge one interaction deeper', async () => {
    function ratzModel() {
      return dutyModel({
        groups: [
          {
            key: "supervisor",
            rows: [
              dutyRow({
                personId: "p_ratz",
                sourceName: "רוני רצ",
                allocationLabel: 'ר"צ',
                comparisonTarget: null,
                gapToTarget: null,
                status: null,
                personalTargetTotal: 0,
                targetProgressRatio: null,
                remainingToTarget: null,
                paceStatus: null,
              }),
            ],
          },
        ],
      });
    }

    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: ratzModel() });
    await renderFairnessPage({ mode: "duties" });
    expect(screen.getByText(/אחמ״שים/)).toBeInTheDocument();
    expect(screen.getByText("רוני רצ")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();

    cleanup();
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: ratzModel() });
    await renderFairnessPage({ mode: "duties", person: "p_ratz" });
    expect(screen.queryByText("לא ניתן להשוות")).toBeNull();
    expect(screen.queryByText("יעד השוואה")).toBeNull();
  });
});

describe("/fairness — H. person detail", () => {
  it("a valid ?person= for a real loaded row opens the detail overlay with the right name", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage({ person: "p_tech" });
    expect(screen.getByRole("dialog", { name: "טל טכנאי" })).toBeInTheDocument();
  });

  it("an invalid/unknown ?person= is ignored safely -- no overlay, no crash", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel() });
    await renderFairnessPage({ person: "p_does_not_exist" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cannot select a person absent from the loaded result merely by editing the URL", async () => {
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: dutyModel() });
    // "p_tech" only exists in the SHIFT fixture, not this duty one.
    await renderFairnessPage({ mode: "duties", person: "p_nonexistent_in_duty_model" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a person hidden from the visible card list (§5 filter) is still reachable via a direct ?person= link", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          { role: "supervisor", rows: [] },
          {
            role: "technician",
            rows: [
              shiftRow({
                personId: "p_hidden",
                personName: "מוסתר מהרשימה",
                actualShifts: 0,
                target: 0,
                deviation: 0,
                weekendActualShifts: 0,
                weekendTarget: 0,
                weekendDeviation: 0,
              }),
            ],
          },
        ],
      }),
    });
    await renderFairnessPage({ person: "p_hidden" });
    expect(screen.getByRole("dialog", { name: "מוסתר מהרשימה" })).toBeInTheDocument();
  });

  it("the detail overlay's close control preserves mode/month (a real, href-bearing link back to /fairness)", async () => {
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel({ month: "2026-06" }) });
    await renderFairnessPage({ month: "2026-06", person: "p_tech" });
    const closeLink = screen.getByRole("link", { name: "סגירה" });
    expect(closeLink).toHaveAttribute("href", "/fairness?month=2026-06");
  });

  it("duty mode's close control preserves the period", async () => {
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: dutyModel({ period: { key: "h1", year: 2026, label: "1–6/2026", status: "closed" } }) });
    await renderFairnessPage({ mode: "duties", period: "h1", person: "p_tech" });
    const closeLink = screen.getByRole("link", { name: "סגירה" });
    expect(closeLink).toHaveAttribute("href", "/fairness?mode=duties&period=h1");
  });
});

describe("/fairness — I. privacy", () => {
  it("no email, sourceSheet, sourceCell, or raw workbook markers ever reach rendered output", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({
        groups: [
          { role: "supervisor", rows: [] },
          { role: "technician", rows: [shiftRow({ personName: "טל טכנאי" })] },
        ],
      }),
    });
    const { container } = await renderFairnessPage({ person: "p_tech" });
    expect(container.innerHTML).not.toContain("@");
    expect(container.innerHTML).not.toContain("sourceSheet");
    expect(container.innerHTML).not.toContain("sourceCell");
  });
});

describe("/fairness — empty states", () => {
  it("no Fairness rows at all -> a calm empty message, not a crash/blank page", async () => {
    getRequestShiftFairness.mockResolvedValue({
      status: "ok",
      model: shiftModel({ groups: [{ role: "supervisor", rows: [] }, { role: "technician", rows: [] }] }),
    });
    await renderFairnessPage();
    expect(screen.getByText("אין נתוני משמרות זמינים לתקופה שנבחרה.")).toBeInTheDocument();
  });
});

describe("FairnessPage — Emergency Mode (mode=emergency)", () => {
  it("renders the emergency fairness groups with assignment counts", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "emergency" });
    getRequestEmergencyFairness.mockResolvedValue({
      status: "ok",
      model: {
        activePeriod: null,
        fetchedAt: "2026-08-26T14:05:00.000Z",
        groups: [
          {
            label: "טבלת צדק - קבע",
            rows: [{ personId: "p1", personName: "אליס בדיקה", total: 3, day: 2, night: 1 }],
          },
        ],
      },
    });

    await renderFairnessPage({ mode: "emergency" });

    expect(screen.getByTestId("emergency-fairness-section")).toBeInTheDocument();
    expect(screen.getByText("אליס בדיקה")).toBeInTheDocument();
    expect(screen.getByText(/סה״כ 3 · יום 2 · לילה 1/)).toBeInTheDocument();
  });

  it("shows a graceful unavailable state (not an auth-failure screen) when the emergency workbook is unconfigured", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "emergency" });
    getRequestEmergencyFairness.mockResolvedValue({ status: "unavailable" });

    await renderFairnessPage({ mode: "emergency" });

    expect(screen.getByText("אין עדיין נתוני חירום זמינים.")).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to login for an unauthenticated visitor, same as the other modes", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "emergency" });
    getRequestEmergencyFairness.mockResolvedValue({ status: "unauthenticated" });

    await expect(renderFairnessPage({ mode: "emergency" })).rejects.toThrow("REDIRECT:/login");
  });

  it("never calls the regular shift/duty fairness loaders while in emergency mode", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "emergency" });
    getRequestEmergencyFairness.mockResolvedValue({
      status: "ok",
      model: { activePeriod: null, fetchedAt: "2026-08-26T14:05:00.000Z", groups: [] },
    });

    await renderFairnessPage({ mode: "emergency" });

    expect(getRequestShiftFairness).not.toHaveBeenCalled();
    expect(getRequestDutyFairness).not.toHaveBeenCalled();
  });
});

describe("FairnessPage — emergency tab visibility follows Emergency Mode's own active state", () => {
  it("1. hides the חירום tab on the default (shifts) view while Emergency Mode is inactive", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "regular" });
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel({ groups: [] }) });

    await renderFairnessPage();

    expect(screen.queryByRole("link", { name: "חירום" })).toBeNull();
  });

  it("2. shows the חירום tab on the default (shifts) view while Emergency Mode is active", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "emergency" });
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel({ groups: [] }) });

    await renderFairnessPage();

    expect(screen.getByRole("link", { name: "חירום" })).toBeInTheDocument();
  });

  it("3. a direct visit to the emergency view while Emergency Mode is inactive redirects to the default Shift tab, never rendering an unavailable/empty emergency view", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "regular" });

    await expect(renderFairnessPage({ mode: "emergency" })).rejects.toThrow("REDIRECT:/fairness");
    expect(getRequestEmergencyFairness).not.toHaveBeenCalled();
  });

  it("4. the משמרות/תורנויות tabs are unaffected by Emergency Mode state, active or inactive", async () => {
    resolveOperationalMode.mockResolvedValue({ kind: "regular" });
    getRequestShiftFairness.mockResolvedValue({ status: "ok", model: shiftModel({ groups: [] }) });
    const { unmount } = await renderFairnessPage();
    expect(screen.getByRole("link", { name: "משמרות" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "תורנויות" })).toBeInTheDocument();
    unmount();

    resolveOperationalMode.mockResolvedValue({ kind: "emergency" });
    getRequestDutyFairness.mockResolvedValue({ status: "ok", model: dutyModel({ groups: [] }) });
    await renderFairnessPage({ mode: "duties" });
    expect(screen.getByRole("link", { name: "משמרות" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "תורנויות" })).toBeInTheDocument();
  });
});
