import type { ComponentProps, ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { A11yPreferencesProvider } from "@/lib/a11y/A11yPreferencesProvider";
import { formatHebrewWeekdayAndDate } from "@/lib/presentation/hebrewDate";
import { APP_NAME } from "@/lib/config/productName";
import type { PersonalProfile } from "@/lib/readModels/types";

function renderWithTheme(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <A11yPreferencesProvider>{ui}</A11yPreferencesProvider>
    </ThemeProvider>,
  );
}

const getRequestPersonalSchedule = vi.fn();
const getRequestSearchReadModel = vi.fn();
const resolveOperationalMode = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("@/lib/readModels/getRequestPersonalSchedule", () => ({ getRequestPersonalSchedule }));
vi.mock("@/lib/readModels/getRequestSearchReadModel", () => ({ getRequestSearchReadModel }));
vi.mock("@/lib/emergencyMode/state", () => ({ resolveOperationalMode }));
vi.mock("next/navigation", () => ({
  redirect,
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { default: ProtectedLayout } = await import("./layout");
const { AppShell } = await import("@/components/layout/AppShell");

/**
 * `ProtectedLayout` returns a Fragment wrapping AppRevalidator and
 * AppShell (PR #34), with AppShell itself now nested inside
 * SearchPaletteProvider (PR #35) -- not AppShell directly, and not even a
 * direct child. Tests that need to inspect the resolved AppShell element's
 * own type/props dig it out by walking the returned element tree instead
 * of assuming any particular nesting depth.
 */
function findAppShellElement(element: ReactElement): ReactElement<ComponentProps<typeof AppShell>> {
  if (element.type === AppShell) return element as ReactElement<ComponentProps<typeof AppShell>>;

  const children = (element.props as { children?: ReactElement | ReactElement[] }).children;
  const childArray = Array.isArray(children) ? children : children ? [children] : [];
  for (const child of childArray) {
    if (!child || typeof child !== "object" || !("type" in child)) continue;
    try {
      return findAppShellElement(child);
    } catch {
      // Not found in this branch -- keep searching siblings.
    }
  }

  throw new Error("AppShell element not found in ProtectedLayout's output");
}

function profile(overrides: Partial<PersonalProfile> = {}): PersonalProfile {
  return {
    id: "p_1",
    name: "דני בדיקה",
    isManager: false,
    isTechnician: true,
    isSupervisor: false,
    personnelType: null,
    ...overrides,
  };
}

function okResult(person: PersonalProfile, avatarUrl: string | null = null) {
  return {
    status: "ok" as const,
    avatarUrl,
    model: {
      person,
      fetchedAt: "2026-08-12T08:00:00.000Z",
      localNow: { date: "2026-08-12", minuteOfDay: 600 },
      todayEvents: [],
      upcomingEvents: [],
      calendarEvents: [],
      currentAssignments: [],
      nextAssignmentGroup: null,
      currentShiftContexts: [],
      nextShiftContexts: [],
      issues: [],
      dutyBlocks: [],
      dutyActions: [],
    },
  };
}

beforeEach(() => {
  redirect.mockClear();
  getRequestPersonalSchedule.mockReset();
  getRequestSearchReadModel.mockReset();
  resolveOperationalMode.mockReset();
  // Most tests here don't exercise search at all -- default to "unavailable"
  // (no search trigger renders) so they don't each need a full SearchReadModel fixture.
  getRequestSearchReadModel.mockResolvedValue({ status: "configuration_error" });
  // Most tests here aren't about Emergency Mode -- default to regular so
  // they don't each need their own resolveOperationalMode fixture.
  resolveOperationalMode.mockResolvedValue({ kind: "regular" });
});

afterEach(() => {
  cleanup();
});

describe("(app) layout — server-side auth gating", () => {
  it("redirects to /login for an unauthenticated visitor, without rendering children", async () => {
    getRequestPersonalSchedule.mockResolvedValue({ status: "unauthenticated" });

    await expect(
      ProtectedLayout({ children: <div>SECRET_DASHBOARD_CONTENT</div> }),
    ).rejects.toThrow("REDIRECT:/login");
  });

  it("20. does not render protected content for an authenticated-but-unmapped user", async () => {
    getRequestPersonalSchedule.mockResolvedValue({ status: "unmapped" });

    const element = await ProtectedLayout({ children: <div>SECRET_DASHBOARD_CONTENT</div> });
    renderWithTheme(element);

    expect(screen.queryByText("SECRET_DASHBOARD_CONTENT")).toBeNull();
    expect(screen.getByText(`אין לך הרשאה ל-${APP_NAME}`)).toBeInTheDocument();
  });

  it("does not reveal personnel names/emails/workbook details on the unmapped-denial screen", async () => {
    getRequestPersonalSchedule.mockResolvedValue({ status: "unmapped" });

    const element = await ProtectedLayout({ children: <div>x</div> });
    const { container } = renderWithTheme(element);

    expect(container.textContent).not.toContain("stranger@example.invalid");
    expect(container.textContent).not.toContain("@");
  });

  it("offers a sign-out affordance on the unmapped-denial screen", async () => {
    getRequestPersonalSchedule.mockResolvedValue({ status: "unmapped" });

    const element = await ProtectedLayout({ children: <div>x</div> });
    renderWithTheme(element);

    expect(screen.getByRole("button", { name: "התנתקות" })).toBeInTheDocument();
  });

  it("renders children and the resolved identity for a mapped user", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(profile()));

    const element = await ProtectedLayout({ children: <div>SECRET_DASHBOARD_CONTENT</div> });
    renderWithTheme(element);

    expect(screen.getByText("SECRET_DASHBOARD_CONTENT")).toBeInTheDocument();
    expect(screen.getAllByText("דני בדיקה").length).toBeGreaterThan(0);
  });

  it("6. a missing-email authenticated user is NOT redirected to /login (would loop)", async () => {
    getRequestPersonalSchedule.mockResolvedValue({ status: "missing_email" });

    await expect(
      ProtectedLayout({ children: <div>SECRET_DASHBOARD_CONTENT</div> }),
    ).resolves.not.toThrow();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("7. a missing-email user never reaches AppShell/protected content -- same generic denial screen", async () => {
    getRequestPersonalSchedule.mockResolvedValue({ status: "missing_email" });

    const element = await ProtectedLayout({ children: <div>SECRET_DASHBOARD_CONTENT</div> });
    renderWithTheme(element);

    expect(screen.queryByText("SECRET_DASHBOARD_CONTENT")).toBeNull();
    expect(screen.getByText(`אין לך הרשאה ל-${APP_NAME}`)).toBeInTheDocument();
  });

  it("an ambiguous-identity user is denied the same way, never redirected, never reaching AppShell", async () => {
    getRequestPersonalSchedule.mockResolvedValue({ status: "ambiguous_identity" });

    const element = await ProtectedLayout({ children: <div>SECRET_DASHBOARD_CONTENT</div> });
    renderWithTheme(element);

    expect(redirect).not.toHaveBeenCalled();
    expect(screen.queryByText("SECRET_DASHBOARD_CONTENT")).toBeNull();
    expect(screen.getByText(`אין לך הרשאה ל-${APP_NAME}`)).toBeInTheDocument();
  });

  it("the denial screen text is identical for unmapped, missing_email, and ambiguous_identity", async () => {
    const denialStates = [
      { status: "unmapped" },
      { status: "missing_email" },
      { status: "ambiguous_identity" },
    ];

    const renderedTexts: string[] = [];
    for (const state of denialStates) {
      getRequestPersonalSchedule.mockResolvedValue(state);
      const element = await ProtectedLayout({ children: <div>x</div> });
      const { container } = renderWithTheme(element);
      renderedTexts.push(container.textContent ?? "");
      cleanup();
    }

    expect(new Set(renderedTexts).size).toBe(1);
  });

  it("a configuration_error still renders the app shell with the resolved identity (authorized, just a broken schedule config)", async () => {
    getRequestPersonalSchedule.mockResolvedValue({
      status: "configuration_error",
      message: "Missing shift start time configuration.",
      person: profile({ name: "נועה דוגמה" }),
    });

    const element = await ProtectedLayout({ children: <div>DASHBOARD_CONTENT_AREA</div> });
    renderWithTheme(element);

    expect(screen.getByText("DASHBOARD_CONTENT_AREA")).toBeInTheDocument();
    expect(screen.getAllByText("נועה דוגמה").length).toBeGreaterThan(0);
  });

  it("derives the shell's live clock initial time from the SAME already-resolved localNow -- no extra Google/request-loader call", async () => {
    // minuteOfDay: 600 === 10:00, per okResult()'s fixture localNow.
    getRequestPersonalSchedule.mockResolvedValue(okResult(profile()));

    const element = await ProtectedLayout({ children: <div>x</div> });
    const appShellElement = findAppShellElement(element);

    expect(appShellElement.type).toBe(AppShell);
    expect(appShellElement.props.initialClockTime).toBe("10:00:00");
    expect(getRequestPersonalSchedule).toHaveBeenCalledTimes(1);
  });

  it("a configuration_error render has no localNow to derive a clock from -- passes null, never throws, never a client-only Date.now() guess", async () => {
    getRequestPersonalSchedule.mockResolvedValue({
      status: "configuration_error",
      message: "Missing shift start time configuration.",
      person: profile(),
    });

    const element = await ProtectedLayout({ children: <div>x</div> });
    const appShellElement = findAppShellElement(element);

    expect(appShellElement.type).toBe(AppShell);
    expect(appShellElement.props.initialClockTime).toBeNull();
    expect(() => renderWithTheme(element)).not.toThrow();
  });

  it("derives the shell's date label from the SAME already-resolved localNow.date, pre-formatted server-side", async () => {
    // localNow.date: "2026-08-12", per okResult()'s fixture.
    getRequestPersonalSchedule.mockResolvedValue(okResult(profile()));

    const element = await ProtectedLayout({ children: <div>x</div> });
    const appShellElement = findAppShellElement(element);

    expect(appShellElement.props.dateLabel).toBe(formatHebrewWeekdayAndDate("2026-08-12"));
    expect(appShellElement.props.dateLabel).not.toBeNull();
  });

  it("a configuration_error render has no localNow to derive a date label from either -- passes null, never throws", async () => {
    getRequestPersonalSchedule.mockResolvedValue({
      status: "configuration_error",
      message: "Missing shift start time configuration.",
      person: profile(),
    });

    const element = await ProtectedLayout({ children: <div>x</div> });
    const appShellElement = findAppShellElement(element);

    expect(appShellElement.props.dateLabel).toBeNull();
  });

  it("never renders the raw configuration_error message text", async () => {
    getRequestPersonalSchedule.mockResolvedValue({
      status: "configuration_error",
      message: 'Missing shift start time configuration ("תחילת משמרת יום").',
      person: profile(),
    });

    const element = await ProtectedLayout({ children: <div>x</div> });
    const { container } = renderWithTheme(element);

    expect(container.textContent).not.toContain("תחילת משמרת יום");
    expect(container.textContent).not.toContain("Missing shift start time");
  });
});

describe("(app) layout — concurrent data loading (PR #38 navigation performance)", () => {
  it("starts getRequestPersonalSchedule and getRequestSearchReadModel CONCURRENTLY, not one after the other", async () => {
    // Both mocks stay pending until released below -- if the layout awaited
    // them sequentially, getRequestSearchReadModel would not even be
    // CALLED until getRequestPersonalSchedule's promise had already
    // resolved. Asserting the call happens before that resolution proves
    // the two loaders were started together (Promise.all), not chained.
    let resolvePersonal!: (value: unknown) => void;
    getRequestPersonalSchedule.mockReturnValue(new Promise((resolve) => (resolvePersonal = resolve)));
    getRequestSearchReadModel.mockResolvedValue({ status: "configuration_error" });

    const pending = ProtectedLayout({ children: <div>x</div> });

    // Let already-queued microtasks run without resolving getRequestPersonalSchedule.
    await Promise.resolve();
    await Promise.resolve();

    expect(getRequestSearchReadModel).toHaveBeenCalledTimes(1);

    resolvePersonal(okResult(profile()));
    await pending;
  });
});

describe("(app) layout — avatarUrl (presentation-only Google account photo)", () => {
  it("passes the read model's avatarUrl straight through to AppShell's person prop for an 'ok' result", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(profile(), "https://lh3.googleusercontent.com/a/photo.jpg"));

    const element = await ProtectedLayout({ children: <div>x</div> });
    const appShellElement = findAppShellElement(element);

    expect(appShellElement.type).toBe(AppShell);
    expect(appShellElement.props.person!.avatarUrl).toBe("https://lh3.googleusercontent.com/a/photo.jpg");
  });

  it("passes null through (not undefined/crash) when the read model has no avatarUrl", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(profile(), null));

    const element = await ProtectedLayout({ children: <div>x</div> });
    const appShellElement = findAppShellElement(element);

    expect(appShellElement.type).toBe(AppShell);
    expect(appShellElement.props.person!.avatarUrl).toBeNull();
  });

  it("also flows through for a configuration_error result, alongside the resolved identity", async () => {
    getRequestPersonalSchedule.mockResolvedValue({
      status: "configuration_error",
      message: "Missing shift start time configuration.",
      person: profile({ name: "נועה דוגמה" }),
      avatarUrl: "https://lh3.googleusercontent.com/a/noa.jpg",
    });

    const element = await ProtectedLayout({ children: <div>x</div> });
    const appShellElement = findAppShellElement(element);

    expect(appShellElement.type).toBe(AppShell);
    expect(appShellElement.props.person!.avatarUrl).toBe("https://lh3.googleusercontent.com/a/noa.jpg");
  });

  it("renders an actual <img> for a real avatarUrl and reaches both the desktop and mobile Avatar instances", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(profile(), "https://lh3.googleusercontent.com/a/photo.jpg"));

    const element = await ProtectedLayout({ children: <div>x</div> });
    const { container } = renderWithTheme(element);

    // Scoped to `data-testid="avatar-photo"` -- the shell also renders the
    // product's own BrandMark <img> (Sidebar + mobile header), which is a
    // brand asset, not a user avatar, and must never be confused with one.
    const images = container.querySelectorAll('[data-testid="avatar-photo"]');
    expect(images.length).toBeGreaterThanOrEqual(2);
    for (const img of images) {
      expect(img).toHaveAttribute("src", "https://lh3.googleusercontent.com/a/photo.jpg");
    }
  });

  it("never renders an email or any raw user_metadata-shaped content anywhere in the shell", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(profile(), "https://lh3.googleusercontent.com/a/photo.jpg"));

    const element = await ProtectedLayout({ children: <div>x</div> });
    const { container } = renderWithTheme(element);

    expect(container.textContent).not.toContain("@");
    expect(container.innerHTML).not.toContain("user_metadata");
  });
});

describe("(app) layout — global Emergency Mode banner (spec section 3)", () => {
  it("is absent for every authenticated user while Emergency Mode is regular", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(profile()));
    resolveOperationalMode.mockResolvedValue({ kind: "regular" });

    const element = await ProtectedLayout({ children: <div>x</div> });
    renderWithTheme(element);

    expect(screen.queryByTestId("emergency-mode-banner")).toBeNull();
  });

  it("is present for every authenticated user while Emergency Mode is active", async () => {
    getRequestPersonalSchedule.mockResolvedValue(okResult(profile()));
    resolveOperationalMode.mockResolvedValue({
      kind: "emergency",
      period: {
        id: "period1",
        activatedAt: "2026-08-26T14:00:00.000Z",
        activatedByUserId: "u1",
        activatedByPersonId: "p1",
        activatedByPersonName: "מנהל בדיקה",
        startDate: "2026-08-26",
        deactivatedAt: null,
        deactivatedByUserId: null,
        deactivatedByPersonId: null,
        deactivatedByPersonName: null,
        endDate: null,
      },
    });

    const element = await ProtectedLayout({ children: <div>x</div> });
    renderWithTheme(element);

    expect(screen.getByTestId("emergency-mode-banner")).toBeInTheDocument();
    expect(screen.getByText(/מצב חירום פעיל/)).toBeInTheDocument();
    expect(screen.getByTestId("emergency-mode-banner")).toHaveAttribute("role", "alert");
  });

  it("is present even for a configuration_error render (authorized user, broken schedule config)", async () => {
    getRequestPersonalSchedule.mockResolvedValue({
      status: "configuration_error",
      message: "Missing shift start time configuration.",
      person: profile(),
    });
    resolveOperationalMode.mockResolvedValue({
      kind: "emergency",
      period: {
        id: "period1",
        activatedAt: "2026-08-26T14:00:00.000Z",
        activatedByUserId: "u1",
        activatedByPersonId: "p1",
        activatedByPersonName: "מנהל בדיקה",
        startDate: "2026-08-26",
        deactivatedAt: null,
        deactivatedByUserId: null,
        deactivatedByPersonId: null,
        deactivatedByPersonName: null,
        endDate: null,
      },
    });

    const element = await ProtectedLayout({ children: <div>x</div> });
    renderWithTheme(element);

    expect(screen.getByTestId("emergency-mode-banner")).toBeInTheDocument();
  });

  it("starts resolveOperationalMode CONCURRENTLY with the other request loaders, not chained after them", async () => {
    let resolvePersonal!: (value: unknown) => void;
    getRequestPersonalSchedule.mockReturnValue(new Promise((resolve) => (resolvePersonal = resolve)));
    getRequestSearchReadModel.mockResolvedValue({ status: "configuration_error" });

    const pending = ProtectedLayout({ children: <div>x</div> });

    await Promise.resolve();
    await Promise.resolve();

    expect(resolveOperationalMode).toHaveBeenCalledTimes(1);

    resolvePersonal(okResult(profile()));
    await pending;
  });
});
