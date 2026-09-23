import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type {
  PersonalAdjacentShiftContext,
  PersonalAssignmentView,
  PersonalEventView,
  PersonalNextAssignmentGroup,
  PersonalShiftContext,
} from "@/lib/readModels/types";
import { Hero } from "./Hero";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
});

function baseAssignment(overrides: Partial<PersonalAssignmentView> = {}): PersonalAssignmentView {
  return {
    date: "2026-08-12",
    title: "טכנאי יום",
    rawValue: "טכנאי יום",
    category: "shift",
    certainty: "confirmed",
    role: "technician",
    period: "day",
    slot: null,
    shadow: false,
    startTimeOverride: null,
    endTimeOverride: null,
    dutyFamily: null,
    absenceKind: null,
    changeNote: null,
    temporalState: "current",
    timing: { status: "not_evaluable" },
    ...overrides,
  };
}

function dutyAssignment(overrides: Partial<PersonalAssignmentView> = {}): PersonalAssignmentView {
  return baseAssignment({
    category: "duty",
    role: null,
    period: "unspecified",
    dutyFamily: "guard",
    slot: 1,
    title: "שומר 1",
    rawValue: "שומר 1",
    ...overrides,
  });
}

function nextGroup(events: PersonalAssignmentView[]): PersonalNextAssignmentGroup {
  return { date: events[0].date, events };
}

function absenceEvent(overrides: Partial<PersonalEventView> = {}): PersonalEventView {
  return {
    date: "2026-08-12",
    title: "חופש",
    rawValue: "חופש",
    category: "absence",
    certainty: "confirmed",
    role: null,
    period: "unspecified",
    slot: null,
    shadow: false,
    startTimeOverride: null,
    endTimeOverride: null,
    dutyFamily: null,
    absenceKind: "vacation",
    changeNote: null,
    timing: { status: "not_evaluable" },
    ...overrides,
  };
}

function shiftContext(overrides: Partial<PersonalShiftContext> = {}): PersonalShiftContext {
  return {
    date: "2026-08-12",
    period: "day",
    role: "technician",
    coverageStatus: "full",
    missingIntervals: [],
    primaryCounterparts: [],
    shadowCounterparts: [],
    ...overrides,
  };
}

function adjacentShiftContext(overrides: Partial<PersonalAdjacentShiftContext> = {}): PersonalAdjacentShiftContext {
  return {
    date: "2026-08-12",
    period: "day",
    role: "technician",
    previous: null,
    next: null,
    ...overrides,
  };
}

const defaultProps = {
  currentAssignments: [] as PersonalAssignmentView[],
  nextAssignmentGroup: null as PersonalNextAssignmentGroup | null,
  currentShiftContexts: [] as PersonalShiftContext[],
  nextShiftContexts: [] as PersonalShiftContext[],
  currentAdjacentShiftContexts: [] as PersonalAdjacentShiftContext[],
  vacationEvent: null as PersonalEventView | null,
  otherTodayEvents: [] as PersonalEventView[],
  fetchedAt: "2026-08-12T08:00:00.000Z",
  localNowDate: "2026-08-12",
};

describe("Hero — current state", () => {
  it("11. a current shift becomes the hero when present", () => {
    render(<Hero {...defaultProps} currentAssignments={[baseAssignment()]} />);
    expect(screen.getByText("פעיל עכשיו")).toBeInTheDocument();
    expect(screen.getByText("טכנאי יום")).toBeInTheDocument();
  });

  it("12. a current duty becomes the hero when there is no current shift", () => {
    render(<Hero {...defaultProps} currentAssignments={[dutyAssignment()]} />);
    expect(screen.getByText("פעיל עכשיו")).toBeInTheDocument();
    expect(screen.getByText("שומר 1")).toBeInTheDocument();
  });

  it("13. multiple current assignments are preserved (shift leads, duty shown as secondary)", () => {
    render(<Hero {...defaultProps} currentAssignments={[baseAssignment(), dutyAssignment()]} />);
    expect(screen.getByText("טכנאי יום")).toBeInTheDocument();
    expect(screen.getByText("שומר 1")).toBeInTheDocument();
  });

  it("19. the active pulse is tied only to the current state", () => {
    const { container } = render(<Hero {...defaultProps} currentAssignments={[baseAssignment()]} />);
    expect(container.querySelector(".animate-pulse-dot")).not.toBeNull();
  });

  it("current state never shows starts-in copy", () => {
    render(<Hero {...defaultProps} currentAssignments={[baseAssignment()]} />);
    expect(screen.queryByText(/מתחיל בעוד/)).toBeNull();
  });
});

describe("Hero — next state", () => {
  it("14. nextAssignmentGroup renders every grouped Event, not just one", () => {
    const group = nextGroup([
      dutyAssignment({ temporalState: "upcoming", dutyFamily: "guard", slot: 1, title: "שומר 1" }),
      dutyAssignment({ temporalState: "upcoming", dutyFamily: "reserve", slot: 2, title: "עתודה 2" }),
    ]);
    render(<Hero {...defaultProps} nextAssignmentGroup={group} />);
    expect(screen.getByText("שומר 1")).toBeInTheDocument();
    expect(screen.getByText("עתודה 2")).toBeInTheDocument();
  });

  it("20. no active pulse appears for the upcoming state", () => {
    const group = nextGroup([dutyAssignment({ temporalState: "upcoming" })]);
    const { container } = render(<Hero {...defaultProps} nextAssignmentGroup={group} />);
    expect(screen.getByText("הבא שלך")).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse-dot")).toBeNull();
  });

  it("never invents an hour for a date-level duty", () => {
    const group = nextGroup([dutyAssignment({ temporalState: "upcoming", date: "2026-08-20" })]);
    render(<Hero {...defaultProps} nextAssignmentGroup={group} localNowDate="2026-08-12" />);
    expect(screen.getByText("השעה טרם מוגדרת")).toBeInTheDocument();
  });
});

describe("Hero — live event progress", () => {
  // `EventLiveProgress` advances from `fetchedAt` using the real wall clock
  // (`Date.now()` inside its own effect) -- pin the system clock to
  // `fetchedAt` itself so these fixtures' fixed 2026 dates aren't compared
  // against whatever the real "now" happens to be when this suite runs.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(defaultProps.fetchedAt));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a countdown + progressbar for a next shift starting within 24h", () => {
    // fetchedAt is 2026-08-12T08:00:00Z = 11:00 Asia/Jerusalem (IDT, +3); the
    // shift starts at 13:00 local the same day, 2h later -- well within the
    // 24h countdown window.
    const shiftEvent = baseAssignment({
      date: "2026-08-12",
      temporalState: "upcoming",
      timing: {
        status: "resolved",
        startLocalTime: "13:00",
        endLocalTime: "19:30",
        durationMinutes: 390,
        elapsedMinutesAtLoad: 0,
        remainingMinutesAtLoad: 390,
        progressPercentAtLoad: 0,
        minutesUntilStartAtLoad: 120,
      },
    });
    render(<Hero {...defaultProps} nextAssignmentGroup={nextGroup([shiftEvent])} />);
    expect(screen.getByText(/מתחיל בעוד/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("shows nothing extra for a next shift starting more than 24h away", () => {
    const shiftEvent = baseAssignment({
      date: "2026-08-20",
      temporalState: "upcoming",
      timing: {
        status: "resolved",
        startLocalTime: "08:00",
        endLocalTime: "20:00",
        durationMinutes: 720,
        elapsedMinutesAtLoad: 0,
        remainingMinutesAtLoad: 720,
        progressPercentAtLoad: 0,
        minutesUntilStartAtLoad: 0,
      },
    });
    render(<Hero {...defaultProps} nextAssignmentGroup={nextGroup([shiftEvent])} />);
    expect(screen.queryByText(/מתחיל בעוד/)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows live remaining-time progress for a current shift", () => {
    // Shift started at 07:30 local (fetchedAt is 11:00 local), still running.
    const shiftEvent = baseAssignment({
      date: "2026-08-12",
      timing: {
        status: "resolved",
        startLocalTime: "07:30",
        endLocalTime: "19:30",
        durationMinutes: 720,
        elapsedMinutesAtLoad: 210,
        remainingMinutesAtLoad: 510,
        progressPercentAtLoad: 29,
        minutesUntilStartAtLoad: 0,
      },
    });
    render(<Hero {...defaultProps} currentAssignments={[shiftEvent]} />);
    expect(screen.getByText(/נשארו/)).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeLessThan(100);
  });
});

describe("Hero — empty state", () => {
  it("shows a calm, non-alarming empty state, not a bare 'no data' message", () => {
    render(<Hero {...defaultProps} />);
    expect(screen.getByText("הכול שקט כרגע")).toBeInTheDocument();
    expect(screen.queryByText("אין נתונים")).toBeNull();
  });
});

describe("Hero — vacation/leave state", () => {
  it("a vacation day with nothing else today reads as genuinely free", () => {
    render(<Hero {...defaultProps} vacationEvent={absenceEvent()} otherTodayEvents={[]} />);
    expect(screen.getByText("חופש")).toBeInTheDocument();
    expect(screen.getByText("היום שלך פנוי")).toBeInTheDocument();
  });

  it("never claims the day is free when other today Events also exist", () => {
    const other = dutyAssignment({ title: "עתודה 2" });
    render(<Hero {...defaultProps} vacationEvent={absenceEvent()} otherTodayEvents={[other]} />);
    expect(screen.queryByText("היום שלך פנוי")).toBeNull();
    expect(screen.getByText("אין לך שיבוץ פעיל כרגע")).toBeInTheDocument();
    expect(screen.getByText("עתודה 2")).toBeInTheDocument();
  });

  it("takes priority over an upcoming next-assignment group", () => {
    const group = nextGroup([dutyAssignment({ temporalState: "upcoming", date: "2026-08-20" })]);
    render(<Hero {...defaultProps} vacationEvent={absenceEvent()} nextAssignmentGroup={group} />);
    expect(screen.getByText("חופש")).toBeInTheDocument();
    expect(screen.queryByText("הבא שלך")).toBeNull();
  });

  it("never renders when there is a current assignment (handled by Dashboard, but Hero itself also never shows both)", () => {
    render(
      <Hero {...defaultProps} currentAssignments={[baseAssignment()]} vacationEvent={absenceEvent()} />,
    );
    expect(screen.getByText("פעיל עכשיו")).toBeInTheDocument();
    expect(screen.queryByText("היום שלך פנוי")).toBeNull();
  });
});

describe("Hero — semantic assignment emoji", () => {
  it("shows a sun emoji for a day shift lead", () => {
    const { container } = render(<Hero {...defaultProps} currentAssignments={[baseAssignment()]} />);
    expect(container.textContent).toContain("☀️");
  });

  it("shows a moon emoji for a night shift lead", () => {
    const nightShift = baseAssignment({ period: "night", title: "טכנאי לילה" });
    const { container } = render(<Hero {...defaultProps} currentAssignments={[nightShift]} />);
    expect(container.textContent).toContain("🌙");
  });

  it("shows a guard emoji for a guard duty lead", () => {
    const { container } = render(<Hero {...defaultProps} currentAssignments={[dutyAssignment()]} />);
    expect(container.textContent).toContain("💂");
  });

  it("shows no emoji for an unspecified-period shift -- never guesses", () => {
    const unspecified = baseAssignment({ period: "unspecified", role: null, title: "משמרת" });
    const { container } = render(<Hero {...defaultProps} currentAssignments={[unspecified]} />);
    expect(container.textContent).not.toContain("☀️");
    expect(container.textContent).not.toContain("🌙");
  });
});

describe("Hero — counterpart context embedding", () => {
  it("embeds a matching currentShiftContext connected to the current hero", () => {
    const context = shiftContext({
      primaryCounterparts: [
        {
          personId: "p_2",
          personName: "נועה דוגמה",
          role: "supervisor",
          certainty: "confirmed",
          shadow: false,
          period: "day",
          startTimeOverride: null,
          endTimeOverride: null,
        },
      ],
    });
    render(
      <Hero {...defaultProps} currentAssignments={[baseAssignment()]} currentShiftContexts={[context]} />,
    );
    expect(screen.getByText("מי איתי?")).toBeInTheDocument();
    expect(screen.getByText("נועה דוגמה")).toBeInTheDocument();
  });

  it("does not render a counterpart section when there is no shift context", () => {
    render(<Hero {...defaultProps} currentAssignments={[dutyAssignment()]} currentShiftContexts={[]} />);
    expect(screen.queryByText("מי איתי?")).toBeNull();
  });

  it("a duty-only next group never gets a later shift's counterpart context (the reported bug)", () => {
    // next group = duty on the 13th; the only available shift context belongs to a shift on the 15th.
    const group = nextGroup([
      dutyAssignment({ temporalState: "upcoming", date: "2026-08-13" }),
    ]);
    const laterShiftContext = shiftContext({ date: "2026-08-15", period: "day", role: "technician" });
    render(
      <Hero
        {...defaultProps}
        nextAssignmentGroup={group}
        nextShiftContexts={[laterShiftContext]}
        localNowDate="2026-08-12"
      />,
    );
    expect(screen.getByText("הבא שלך")).toBeInTheDocument();
    expect(screen.queryByText("מי איתי?")).toBeNull();
  });

  it("a next group containing a matching same-date shift renders its counterpart context normally", () => {
    const shiftEvent = baseAssignment({
      date: "2026-08-15",
      period: "day",
      role: "technician",
      temporalState: "upcoming",
      timing: {
        status: "resolved",
        startLocalTime: "07:30",
        endLocalTime: "19:30",
        durationMinutes: 720,
        elapsedMinutesAtLoad: 0,
        remainingMinutesAtLoad: 720,
        progressPercentAtLoad: 0,
        minutesUntilStartAtLoad: 0,
      },
    });
    const group = nextGroup([shiftEvent]);
    const matchingContext = shiftContext({
      date: "2026-08-15",
      period: "day",
      role: "technician",
      primaryCounterparts: [
        {
          personId: "p_2",
          personName: "נועה דוגמה",
          role: "supervisor",
          certainty: "confirmed",
          shadow: false,
          period: "day",
          startTimeOverride: null,
          endTimeOverride: null,
        },
      ],
    });
    render(
      <Hero
        {...defaultProps}
        nextAssignmentGroup={group}
        nextShiftContexts={[matchingContext]}
        localNowDate="2026-08-12"
      />,
    );
    expect(screen.getByText("מי איתי?")).toBeInTheDocument();
    expect(screen.getByText("נועה דוגמה")).toBeInTheDocument();
  });

  it("picks the matching context out of several current-shift contexts, not index 0", () => {
    const lead = baseAssignment({ date: "2026-08-12", period: "day", role: "technician" });
    const wrongContext = shiftContext({ date: "2026-08-12", period: "night", role: "technician" });
    const rightContext = shiftContext({
      date: "2026-08-12",
      period: "day",
      role: "technician",
      primaryCounterparts: [
        {
          personId: "p_3",
          personName: "משה כהן",
          role: "supervisor",
          certainty: "confirmed",
          shadow: false,
          period: "day",
          startTimeOverride: null,
          endTimeOverride: null,
        },
      ],
    });
    render(
      <Hero {...defaultProps} currentAssignments={[lead]} currentShiftContexts={[wrongContext, rightContext]} />,
    );
    expect(screen.getByText("משה כהן")).toBeInTheDocument();
  });
});

describe("Hero — מי לפניי / מי אחריי", () => {
  const lead = baseAssignment({ date: "2026-08-12", period: "day", role: "technician" });
  const context = shiftContext({ date: "2026-08-12", period: "day", role: "technician" });

  it("shows previous shift staffing when resolved", () => {
    const adjacent = adjacentShiftContext({
      date: "2026-08-12",
      period: "day",
      role: "technician",
      previous: {
        date: "2026-08-11",
        period: "night",
        people: [
          {
            personId: "p_2",
            personName: "עילאי לילי",
            role: "technician",
            certainty: "confirmed",
            shadow: false,
            period: "night",
            startTimeOverride: null,
            endTimeOverride: null,
          },
        ],
      },
    });
    render(
      <Hero
        {...defaultProps}
        currentAssignments={[lead]}
        currentShiftContexts={[context]}
        currentAdjacentShiftContexts={[adjacent]}
      />,
    );
    expect(screen.getByText("מי לפניי")).toBeInTheDocument();
    expect(screen.getByText("עילאי לילי")).toBeInTheDocument();
    expect(screen.queryByText("מי אחריי")).toBeNull();
  });

  it("shows next shift staffing when resolved, across a calendar-date boundary", () => {
    const adjacent = adjacentShiftContext({
      date: "2026-08-12",
      period: "night",
      role: "technician",
      next: {
        date: "2026-08-13",
        period: "day",
        people: [
          {
            personId: "p_3",
            personName: "רוני שדה",
            role: "technician",
            certainty: "confirmed",
            shadow: false,
            period: "day",
            startTimeOverride: null,
            endTimeOverride: null,
          },
        ],
      },
    });
    const nightLead = baseAssignment({ date: "2026-08-12", period: "night", role: "technician" });
    const nightContext = shiftContext({ date: "2026-08-12", period: "night", role: "technician" });
    render(
      <Hero
        {...defaultProps}
        currentAssignments={[nightLead]}
        currentShiftContexts={[nightContext]}
        currentAdjacentShiftContexts={[adjacent]}
      />,
    );
    expect(screen.getByText("מי אחריי")).toBeInTheDocument();
    expect(screen.getByText("רוני שדה")).toBeInTheDocument();
  });

  it("renders nothing for missing adjacent staffing -- no empty 'מי לפניי — אין מידע' block", () => {
    const adjacent = adjacentShiftContext({ date: "2026-08-12", period: "day", role: "technician" });
    render(
      <Hero
        {...defaultProps}
        currentAssignments={[lead]}
        currentShiftContexts={[context]}
        currentAdjacentShiftContexts={[adjacent]}
      />,
    );
    expect(screen.queryByText("מי לפניי")).toBeNull();
    expect(screen.queryByText("מי אחריי")).toBeNull();
  });

  it("never renders when there is no matching adjacent context at all", () => {
    render(
      <Hero {...defaultProps} currentAssignments={[lead]} currentShiftContexts={[context]} currentAdjacentShiftContexts={[]} />,
    );
    expect(screen.queryByText("מי לפניי")).toBeNull();
    expect(screen.queryByText("מי אחריי")).toBeNull();
  });

  it("never renders for the upcoming (NextHero) state -- adjacency is current-shift only", () => {
    const shiftEvent = baseAssignment({
      date: "2026-08-15",
      period: "day",
      role: "technician",
      temporalState: "upcoming",
      timing: {
        status: "resolved",
        startLocalTime: "07:30",
        endLocalTime: "19:30",
        durationMinutes: 720,
        elapsedMinutesAtLoad: 0,
        remainingMinutesAtLoad: 720,
        progressPercentAtLoad: 0,
        minutesUntilStartAtLoad: 0,
      },
    });
    const group = nextGroup([shiftEvent]);
    const matchingContext = shiftContext({ date: "2026-08-15", period: "day", role: "technician" });
    render(
      <Hero
        {...defaultProps}
        nextAssignmentGroup={group}
        nextShiftContexts={[matchingContext]}
        localNowDate="2026-08-12"
      />,
    );
    expect(screen.getByText("מי איתי?")).toBeInTheDocument();
    expect(screen.queryByText("מי לפניי")).toBeNull();
    expect(screen.queryByText("מי אחריי")).toBeNull();
  });

  it("existing מי איתי rendering is unaffected by the new adjacent-context prop", () => {
    render(
      <Hero
        {...defaultProps}
        currentAssignments={[lead]}
        currentShiftContexts={[context]}
        currentAdjacentShiftContexts={[]}
      />,
    );
    expect(screen.getByText("מי איתי?")).toBeInTheDocument();
    expect(screen.getByText("אין מידע על אנשים נוספים במשמרת זו.")).toBeInTheDocument();
  });
});

describe("Hero — no redundant role/period line beneath a shift title (UX cleanup pass)", () => {
  it("a current shift never repeats its role · period beneath the title -- the title already says it", () => {
    render(<Hero {...defaultProps} currentAssignments={[baseAssignment()]} />);
    expect(screen.getByText("טכנאי יום")).toBeInTheDocument();
    expect(screen.queryByText("טכנאי · יום")).toBeNull();
  });

  it("an upcoming shift never repeats its role · period beneath the title either", () => {
    const shiftEvent = baseAssignment({ temporalState: "upcoming", date: "2026-08-20" });
    render(<Hero {...defaultProps} nextAssignmentGroup={nextGroup([shiftEvent])} localNowDate="2026-08-12" />);
    expect(screen.queryByText("טכנאי · יום")).toBeNull();
  });

  it("a tentative current shift still shows משוער, even with the role/period line gone", () => {
    const tentative = baseAssignment({ certainty: "tentative" });
    render(<Hero {...defaultProps} currentAssignments={[tentative]} />);
    expect(screen.getByText("משוער")).toBeInTheDocument();
    expect(screen.queryByText("טכנאי · יום")).toBeNull();
  });

  it("a tentative upcoming shift still shows משוער", () => {
    const tentative = baseAssignment({ certainty: "tentative", temporalState: "upcoming", date: "2026-08-20" });
    render(<Hero {...defaultProps} nextAssignmentGroup={nextGroup([tentative])} localNowDate="2026-08-12" />);
    expect(screen.getByText("משוער")).toBeInTheDocument();
  });

  it("duty presentation is unchanged -- a tentative current duty still shows no role/period line (it never had one)", () => {
    const tentativeDuty = dutyAssignment({ certainty: "tentative" });
    render(<Hero {...defaultProps} currentAssignments={[tentativeDuty]} />);
    expect(screen.getByText("שומר 1")).toBeInTheDocument();
    expect(screen.queryByText("משוער")).toBeNull();
  });

  it("still preserves the shift's time range beneath the title", () => {
    const shiftEvent = baseAssignment({
      timing: { status: "resolved", startLocalTime: "07:30", endLocalTime: "19:30", durationMinutes: 720, elapsedMinutesAtLoad: 0, remainingMinutesAtLoad: 720, progressPercentAtLoad: 0, minutesUntilStartAtLoad: 0 },
    });
    render(<Hero {...defaultProps} currentAssignments={[shiftEvent]} />);
    expect(screen.getByText("07:30 — 19:30")).toBeInTheDocument();
  });
});
