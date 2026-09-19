import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const activateEmergencyModeAction = vi.fn();
const deactivateEmergencyModeAction = vi.fn();

vi.mock("@/lib/emergencyMode/actions", () => ({
  activateEmergencyModeAction: (...args: unknown[]) => activateEmergencyModeAction(...args),
  deactivateEmergencyModeAction: (...args: unknown[]) => deactivateEmergencyModeAction(...args),
}));

const { EmergencyModeControlClient } = await import("./EmergencyModeControlClient");

afterEach(() => {
  cleanup();
  activateEmergencyModeAction.mockReset();
  deactivateEmergencyModeAction.mockReset();
});

describe("EmergencyModeControlClient -- regular mode", () => {
  it("renders the inactive title/description/button copy exactly as specified", () => {
    render(<EmergencyModeControlClient mode={{ kind: "regular" }} />);

    expect(screen.getByText("מצב חירום")).toBeInTheDocument();
    expect(screen.getByText("מעביר את המערכת לסידור משמרות חירום ומשהה תורנויות.")).toBeInTheDocument();
    expect(screen.getByText("הפעל מצב חירום")).toBeInTheDocument();
  });

  it("the first click never activates anything -- it only reveals the confirmation step", () => {
    render(<EmergencyModeControlClient mode={{ kind: "regular" }} />);

    fireEvent.click(screen.getByText("הפעל מצב חירום"));

    expect(activateEmergencyModeAction).not.toHaveBeenCalled();
    expect(screen.getByText("להפעיל מצב חירום?")).toBeInTheDocument();
    expect(screen.getByText("המערכת תעבור לסידור החירום. משמרות רגילות לא יוצגו ותורנויות יושהו.")).toBeInTheDocument();
  });

  it("ביטול on the confirmation step dismisses it without ever calling the action", () => {
    render(<EmergencyModeControlClient mode={{ kind: "regular" }} />);
    fireEvent.click(screen.getByText("הפעל מצב חירום"));

    fireEvent.click(screen.getByText("ביטול"));

    expect(activateEmergencyModeAction).not.toHaveBeenCalled();
    expect(screen.queryByText("להפעיל מצב חירום?")).toBeNull();
  });

  it("only the explicit confirm button performs the activation", async () => {
    activateEmergencyModeAction.mockResolvedValue({ ok: true, status: "activated" });
    render(<EmergencyModeControlClient mode={{ kind: "regular" }} />);
    fireEvent.click(screen.getByText("הפעל מצב חירום"));

    fireEvent.click(screen.getByText("כן, הפעל מצב חירום"));

    await waitFor(() => expect(activateEmergencyModeAction).toHaveBeenCalledTimes(1));
  });

  it("surfaces an error and keeps the confirm step open when the action fails", async () => {
    activateEmergencyModeAction.mockResolvedValue({ ok: false, error: "forbidden" });
    render(<EmergencyModeControlClient mode={{ kind: "regular" }} />);
    fireEvent.click(screen.getByText("הפעל מצב חירום"));

    fireEvent.click(screen.getByText("כן, הפעל מצב חירום"));

    await waitFor(() => expect(screen.getByText("משהו השתבש. נסה/י שוב.")).toBeInTheDocument());
  });
});

describe("EmergencyModeControlClient -- active emergency mode", () => {
  const ACTIVE_MODE = {
    kind: "emergency" as const,
    activatedAtDisplay: "26/08/2026, 14:00",
    activatedByPersonName: "מנהל בדיקה",
  };

  it("renders the impossible-to-miss active banner copy and who/when it was activated", () => {
    render(<EmergencyModeControlClient mode={ACTIVE_MODE} />);

    expect(screen.getByText("🚨 מצב חירום פעיל")).toBeInTheDocument();
    expect(screen.getByText("המערכת פועלת לפי סידור משמרות החירום. תורנויות מושהות.")).toBeInTheDocument();
    expect(screen.getByText(/26\/08\/2026, 14:00/)).toBeInTheDocument();
    expect(screen.getByText(/מנהל בדיקה/)).toBeInTheDocument();
    expect(screen.getByText("סיים מצב חירום")).toBeInTheDocument();
  });

  it("the first click never deactivates anything -- it only reveals the confirmation step", () => {
    render(<EmergencyModeControlClient mode={ACTIVE_MODE} />);

    fireEvent.click(screen.getByText("סיים מצב חירום"));

    expect(deactivateEmergencyModeAction).not.toHaveBeenCalled();
    expect(screen.getByText("לסיים מצב חירום?")).toBeInTheDocument();
    expect(screen.getByText("המערכת תחזור לסידור הרגיל ותורנויות יחזרו לפעילות.")).toBeInTheDocument();
  });

  it("only the explicit confirm button performs the deactivation", async () => {
    deactivateEmergencyModeAction.mockResolvedValue({ ok: true, status: "deactivated" });
    render(<EmergencyModeControlClient mode={ACTIVE_MODE} />);
    fireEvent.click(screen.getByText("סיים מצב חירום"));

    fireEvent.click(screen.getByText("כן, סיים מצב חירום"));

    await waitFor(() => expect(deactivateEmergencyModeAction).toHaveBeenCalledTimes(1));
  });
});

describe("EmergencyModeControlClient -- accessible error announcements", () => {
  it("an activation failure exposes role=alert", async () => {
    activateEmergencyModeAction.mockResolvedValue({ ok: false, error: "forbidden" });
    render(<EmergencyModeControlClient mode={{ kind: "regular" }} />);
    fireEvent.click(screen.getByText("הפעל מצב חירום"));

    fireEvent.click(screen.getByText("כן, הפעל מצב חירום"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("a deactivation failure exposes role=alert", async () => {
    deactivateEmergencyModeAction.mockResolvedValue({ ok: false, error: "forbidden" });
    const ACTIVE_MODE = { kind: "emergency" as const, activatedAtDisplay: "26/08/2026, 14:00", activatedByPersonName: "מנהל בדיקה" };
    render(<EmergencyModeControlClient mode={ACTIVE_MODE} />);
    fireEvent.click(screen.getByText("סיים מצב חירום"));

    fireEvent.click(screen.getByText("כן, סיים מצב חירום"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("EmergencyModeControlClient -- confirm-reveal focus management", () => {
  it("moves focus to the confirmation heading when the activate confirmation is revealed", () => {
    render(<EmergencyModeControlClient mode={{ kind: "regular" }} />);
    fireEvent.click(screen.getByText("הפעל מצב חירום"));

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "להפעיל מצב חירום?" }));
  });

  it("canceling the activate confirmation returns focus to the trigger that opened it", () => {
    render(<EmergencyModeControlClient mode={{ kind: "regular" }} />);
    const trigger = screen.getByText("הפעל מצב חירום");
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByText("ביטול"));

    expect(document.activeElement).toBe(screen.getByText("הפעל מצב חירום"));
  });

  it("a successful activation collapses the confirmation and never leaves focus on <body>", async () => {
    activateEmergencyModeAction.mockResolvedValue({ ok: true, status: "activated" });
    render(<EmergencyModeControlClient mode={{ kind: "regular" }} />);
    fireEvent.click(screen.getByText("הפעל מצב חירום"));

    fireEvent.click(screen.getByText("כן, הפעל מצב חירום"));

    await waitFor(() => expect(screen.queryByText("להפעיל מצב חירום?")).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
  });

  it("moves focus to the confirmation heading when the deactivate confirmation is revealed", () => {
    const ACTIVE_MODE = { kind: "emergency" as const, activatedAtDisplay: "26/08/2026, 14:00", activatedByPersonName: "מנהל בדיקה" };
    render(<EmergencyModeControlClient mode={ACTIVE_MODE} />);
    fireEvent.click(screen.getByText("סיים מצב חירום"));

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "לסיים מצב חירום?" }));
  });

  it("canceling the deactivate confirmation returns focus to the trigger that opened it", () => {
    const ACTIVE_MODE = { kind: "emergency" as const, activatedAtDisplay: "26/08/2026, 14:00", activatedByPersonName: "מנהל בדיקה" };
    render(<EmergencyModeControlClient mode={ACTIVE_MODE} />);
    const trigger = screen.getByText("סיים מצב חירום");
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByText("ביטול"));

    expect(document.activeElement).toBe(screen.getByText("סיים מצב חירום"));
  });
});
