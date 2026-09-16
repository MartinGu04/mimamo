import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const getRequestDischargeCountdown = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/readModels/dischargeCountdown", () => ({ getRequestDischargeCountdown }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/components/discharge/DischargeCountdownScreen", () => ({
  DischargeCountdownScreen: (props: {
    dischargeDateLabel: string;
    dischargeInstantIso: string;
    dischargeDayEndInstantIso: string;
    enlistmentInstantIso: string | null;
  }) => <div data-testid="countdown-screen">{JSON.stringify(props)}</div>,
}));

vi.mock("@/components/discharge/DischargeEveryoneOverview", () => ({
  DischargeEveryoneOverview: (props: { people: { personName: string }[] }) => (
    <div data-testid="everyone-overview">{props.people.map((p) => p.personName).join("|")}</div>
  ),
}));
vi.mock("@/components/discharge/DischargeViewToggle", () => ({
  DischargeViewToggle: (props: { active: string }) => <div data-testid="view-toggle">{props.active}</div>,
}));

const { default: CountdownPage } = await import("./page");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CountdownPage — access control", () => {
  it("redirects to /login for an unauthenticated visitor", async () => {
    getRequestDischargeCountdown.mockResolvedValue({ status: "unauthenticated" });
    await expect(CountdownPage()).rejects.toThrow("REDIRECT:/login");
  });

  it.each(["missing_email", "unmapped", "ambiguous_identity"] as const)(
    "shows the access-denied screen for %s, never the countdown screen",
    async (status) => {
      getRequestDischargeCountdown.mockResolvedValue({ status });
      render(await CountdownPage());
      expect(screen.queryByTestId("countdown-screen")).toBeNull();
    },
  );
});

describe("CountdownPage — a discharge date is on record", () => {
  it("renders the countdown screen with the formatted label and both resolved instants", async () => {
    getRequestDischargeCountdown.mockResolvedValue({
      status: "ok",
      view: {
        personName: "דני בדיקה",
        dischargeDate: "2027-01-24",
        dischargeInstantIso: "2027-01-23T22:00:00.000Z",
        dischargeDayEndInstantIso: "2027-01-24T21:59:59.999Z",
        enlistmentInstantIso: "2024-01-23T22:00:00.000Z",
      },
    });

    render(await CountdownPage());
    const props = JSON.parse(screen.getByTestId("countdown-screen").textContent ?? "{}");

    expect(props).toEqual({
      dischargeDateLabel: "24.01.2027",
      dischargeInstantIso: "2027-01-23T22:00:00.000Z",
      dischargeDayEndInstantIso: "2027-01-24T21:59:59.999Z",
      enlistmentInstantIso: "2024-01-23T22:00:00.000Z",
    });
  });

  it("passes null enlistmentInstantIso through untouched when כ\"א has no enlistment date for this person", async () => {
    getRequestDischargeCountdown.mockResolvedValue({
      status: "ok",
      view: {
        personName: "דני בדיקה",
        dischargeDate: "2027-01-24",
        dischargeInstantIso: "2027-01-23T22:00:00.000Z",
        dischargeDayEndInstantIso: "2027-01-24T21:59:59.999Z",
        enlistmentInstantIso: null,
      },
    });

    render(await CountdownPage());
    const props = JSON.parse(screen.getByTestId("countdown-screen").textContent ?? "{}");
    expect(props.enlistmentInstantIso).toBeNull();
  });
});

describe("CountdownPage — no discharge date on record", () => {
  it("renders a clean empty state instead of the countdown screen", async () => {
    getRequestDischargeCountdown.mockResolvedValue({
      status: "ok",
      view: {
        personName: "דני בדיקה",
        dischargeDate: null,
        dischargeInstantIso: null,
        dischargeDayEndInstantIso: null,
        enlistmentInstantIso: null,
      },
    });

    render(await CountdownPage());

    expect(screen.queryByTestId("countdown-screen")).toBeNull();
    expect(screen.getByText("עד מתי???")).toBeInTheDocument();
    expect(screen.getByText(/לא נמצא תאריך שחרור/)).toBeInTheDocument();
  });
});


describe('CountdownPage — the "כולם" view', () => {
  const SELF = {
    personName: "דני בדיקה",
    dischargeDate: "2027-01-24",
    dischargeInstantIso: "2027-01-23T22:00:00.000Z",
    dischargeDayEndInstantIso: "2027-01-24T21:59:59.999Z",
    enlistmentInstantIso: "2024-01-23T22:00:00.000Z",
    resolvedAtIso: "2026-09-16T00:00:00.000Z",
  };

  const NOA = {
    personId: "p_noa",
    personName: "נועה דוגמה",
    dischargeDate: "2026-11-02",
    dischargeInstantIso: "2026-11-01T22:00:00.000Z",
    dischargeDayEndInstantIso: "2026-11-02T21:59:59.999Z",
    enlistmentInstantIso: "2024-11-01T22:00:00.000Z",
  };

  function mockView(overrides: Record<string, unknown>) {
    getRequestDischargeCountdown.mockResolvedValue({ status: "ok", view: { ...SELF, ...overrides } });
  }

  const params = (search: Record<string, string>) => Promise.resolve(search);

  it("offers no toggle at all to a viewer the read model withheld the roster from", async () => {
    mockView({ everyone: null });
    render(await CountdownPage());
    expect(screen.queryByTestId("view-toggle")).toBeNull();
    expect(screen.getByTestId("countdown-screen")).toBeInTheDocument();
  });

  it("shows the toggle on the personal view once the roster is allowed", async () => {
    mockView({ everyone: [NOA] });
    render(await CountdownPage());
    expect(screen.getByTestId("view-toggle")).toHaveTextContent("personal");
    expect(screen.getByTestId("countdown-screen")).toBeInTheDocument();
  });

  it("switches to the overview on ?view=everyone", async () => {
    mockView({ everyone: [NOA] });
    render(await CountdownPage({ searchParams: params({ view: "everyone" }) }));
    expect(screen.getByTestId("view-toggle")).toHaveTextContent("everyone");
    expect(screen.getByTestId("everyone-overview")).toHaveTextContent("נועה דוגמה");
    expect(screen.queryByTestId("countdown-screen")).toBeNull();
  });

  it("opens the selected person's full countdown, reusing the personal countdown screen", async () => {
    mockView({ everyone: [NOA] });
    render(await CountdownPage({ searchParams: params({ view: "everyone", person: "p_noa" }) }));

    const props = JSON.parse(screen.getByTestId("countdown-screen").textContent ?? "{}");
    expect(props).toEqual({
      personName: "נועה דוגמה",
      dischargeDateLabel: "02.11.2026",
      dischargeInstantIso: NOA.dischargeInstantIso,
      dischargeDayEndInstantIso: NOA.dischargeDayEndInstantIso,
      enlistmentInstantIso: NOA.enlistmentInstantIso,
    });
    expect(screen.queryByTestId("everyone-overview")).toBeNull();
  });

  it("offers a way back to the overview from a person's countdown", async () => {
    mockView({ everyone: [NOA] });
    render(await CountdownPage({ searchParams: params({ view: "everyone", person: "p_noa" }) }));
    expect(screen.getByRole("link", { name: /חזרה לכולם/ })).toHaveAttribute("href", "/countdown?view=everyone");
  });

  it("ignores ?view=/?person= entirely for a viewer without the roster, rather than only hiding the toggle", async () => {
    // The gate is the absent roster, not the missing control -- a hand-written
    // URL must not reach another person's countdown.
    mockView({ everyone: null });
    render(await CountdownPage({ searchParams: params({ view: "everyone", person: "p_noa" }) }));

    const props = JSON.parse(screen.getByTestId("countdown-screen").textContent ?? "{}");
    expect(props.personName).toBeUndefined();
    expect(props.dischargeInstantIso).toBe(SELF.dischargeInstantIso);
    expect(screen.queryByTestId("everyone-overview")).toBeNull();
  });

  it("falls back to the overview when ?person= names somebody off the roster", async () => {
    // e.g. a permanent or reserve person's id: they are not on the roster, so
    // the selection resolves to nobody rather than rendering them.
    mockView({ everyone: [NOA] });
    render(await CountdownPage({ searchParams: params({ view: "everyone", person: "p_kavua" }) }));
    expect(screen.getByTestId("everyone-overview")).toBeInTheDocument();
    expect(screen.queryByTestId("countdown-screen")).toBeNull();
  });

  it("keeps the toggle on the empty state, so having no date of your own never strands you", async () => {
    mockView({ everyone: [NOA], dischargeDate: null, dischargeInstantIso: null, dischargeDayEndInstantIso: null });
    render(await CountdownPage());
    expect(screen.getByTestId("view-toggle")).toHaveTextContent("personal");
    expect(screen.getByText(/לא נמצא תאריך שחרור עבורך/)).toBeInTheDocument();
  });

  it("handles a selected person who has no discharge date without breaking the page", async () => {
    mockView({
      everyone: [{ ...NOA, dischargeDate: null, dischargeInstantIso: null, dischargeDayEndInstantIso: null }],
    });
    render(await CountdownPage({ searchParams: params({ view: "everyone", person: "p_noa" }) }));
    expect(screen.getByText(/לא נמצא תאריך שחרור עבור אדם זה/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /חזרה לכולם/ })).toBeInTheDocument();
  });
});
