import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalendarSyncSection } from "./CalendarSyncSection";

const enableCalendarSyncAction = vi.fn();
const resetCalendarSyncAction = vi.fn();
const disableCalendarSyncAction = vi.fn();
vi.mock("@/lib/calendar/actions", () => ({
  enableCalendarSyncAction: () => enableCalendarSyncAction(),
  resetCalendarSyncAction: () => resetCalendarSyncAction(),
  disableCalendarSyncAction: () => disableCalendarSyncAction(),
}));

const LINKS = {
  url: "https://mi-ma-mo.app/calendar/tok-1.ics",
  googleUrl: "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fmi-ma-mo.app%2Fcalendar%2Ftok-1.ics",
  appleUrl: "webcal://mi-ma-mo.app/calendar/tok-1.ics",
};

const NEW_LINKS = {
  url: "https://mi-ma-mo.app/calendar/tok-2.ics",
  googleUrl: "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fmi-ma-mo.app%2Fcalendar%2Ftok-2.ics",
  appleUrl: "webcal://mi-ma-mo.app/calendar/tok-2.ics",
};

beforeEach(() => {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("CalendarSyncSection — not enabled", () => {
  it("shows the enable button and never the raw token/links as visible text", () => {
    render(<CalendarSyncSection initialEnabled={false} initialLinks={null} />);
    expect(screen.getByRole("button", { name: /הפעלת סנכרון ליומן/ })).toBeInTheDocument();
    expect(screen.queryByText(/mi-ma-mo\.app\/calendar/)).toBeNull();
  });

  it("enabling calls the action and renders the returned links", async () => {
    enableCalendarSyncAction.mockResolvedValue({ ok: true, links: LINKS });
    render(<CalendarSyncSection initialEnabled={false} initialLinks={null} />);

    fireEvent.click(screen.getByRole("button", { name: /הפעלת סנכרון ליומן/ }));

    await waitFor(() => expect(screen.getByText("סנכרון ליומן פעיל")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "הוספה ליומן Google" })).toHaveAttribute("href", LINKS.googleUrl);
    expect(screen.getByRole("link", { name: "הוספה ליומן Apple" })).toHaveAttribute("href", LINKS.appleUrl);
  });

  it("shows a generic error message when enabling fails, and stays in the not-enabled state", async () => {
    enableCalendarSyncAction.mockResolvedValue({ ok: false, error: "persist_failed" });
    render(<CalendarSyncSection initialEnabled={false} initialLinks={null} />);

    fireEvent.click(screen.getByRole("button", { name: /הפעלת סנכרון ליומן/ }));

    await waitFor(() => expect(screen.getByText(/משהו השתבש/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /הפעלת סנכרון ליומן/ })).toBeInTheDocument();
  });
});

describe("CalendarSyncSection — enabled", () => {
  it("copy link writes the plain URL to the clipboard and shows transient confirmation", async () => {
    render(<CalendarSyncSection initialEnabled={true} initialLinks={LINKS} />);

    fireEvent.click(screen.getByRole("button", { name: /העתקת קישור/ }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINKS.url));
    expect(await screen.findByText("הקישור הועתק")).toBeInTheDocument();
  });

  it("reset requires a second confirming tap before calling the action", async () => {
    resetCalendarSyncAction.mockResolvedValue({ ok: true, links: NEW_LINKS });
    render(<CalendarSyncSection initialEnabled={true} initialLinks={LINKS} />);

    fireEvent.click(screen.getByRole("button", { name: /יצירת קישור חדש/ }));
    expect(resetCalendarSyncAction).not.toHaveBeenCalled();
    expect(screen.getByText(/הקישור הקיים יפסיק לעבוד/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "אישור" }));

    await waitFor(() => expect(resetCalendarSyncAction).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "הוספה ליומן Google" })).toHaveAttribute("href", NEW_LINKS.googleUrl),
    );
  });

  it("canceling the reset confirmation never calls the action", () => {
    render(<CalendarSyncSection initialEnabled={true} initialLinks={LINKS} />);

    fireEvent.click(screen.getByRole("button", { name: /יצירת קישור חדש/ }));
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));

    expect(resetCalendarSyncAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /יצירת קישור חדש/ })).toBeInTheDocument();
  });

  it("disable requires a second confirming tap, then reverts to the not-enabled state", async () => {
    disableCalendarSyncAction.mockResolvedValue({ ok: true });
    render(<CalendarSyncSection initialEnabled={true} initialLinks={LINKS} />);

    fireEvent.click(screen.getByRole("button", { name: /ביטול סנכרון/ }));
    expect(disableCalendarSyncAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "אישור" }));

    await waitFor(() => expect(disableCalendarSyncAction).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: /הפעלת סנכרון ליומן/ })).toBeInTheDocument());
    expect(screen.queryByText("סנכרון ליומן פעיל")).toBeNull();
  });
});

describe("CalendarSyncSection — accessible status announcements", () => {
  it("an enable failure exposes role=alert", async () => {
    enableCalendarSyncAction.mockResolvedValue({ ok: false, error: "persist_failed" });
    render(<CalendarSyncSection initialEnabled={false} initialLinks={null} />);

    fireEvent.click(screen.getByRole("button", { name: /הפעלת סנכרון ליומן/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("a successful copy announces via role=status, for screen readers as well as the visible confirmation", async () => {
    render(<CalendarSyncSection initialEnabled={true} initialLinks={LINKS} />);

    fireEvent.click(screen.getByRole("button", { name: /העתקת קישור/ }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("הקישור הועתק."));
  });
});

describe("CalendarSyncSection — confirm-reveal focus management", () => {
  it("moves focus to the confirm button when opening the reset confirmation", () => {
    render(<CalendarSyncSection initialEnabled={true} initialLinks={LINKS} />);

    fireEvent.click(screen.getByRole("button", { name: /יצירת קישור חדש/ }));

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "אישור" }));
  });

  it("moves focus to the confirm button when opening the disable confirmation", () => {
    render(<CalendarSyncSection initialEnabled={true} initialLinks={LINKS} />);

    fireEvent.click(screen.getByRole("button", { name: /ביטול סנכרון/ }));

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "אישור" }));
  });

  it("canceling the reset confirmation returns focus to the trigger that opened it", () => {
    render(<CalendarSyncSection initialEnabled={true} initialLinks={LINKS} />);
    const resetTrigger = screen.getByRole("button", { name: /יצירת קישור חדש/ });
    resetTrigger.focus();
    fireEvent.click(resetTrigger);

    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));

    expect(document.activeElement).toBe(screen.getByRole("button", { name: /יצירת קישור חדש/ }));
  });

  it("after a successful disable removes its own trigger button, focus falls back to the section heading, never <body>", async () => {
    disableCalendarSyncAction.mockResolvedValue({ ok: true });
    render(<CalendarSyncSection initialEnabled={true} initialLinks={LINKS} />);

    fireEvent.click(screen.getByRole("button", { name: /ביטול סנכרון/ }));
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /הפעלת סנכרון ליומן/ })).toBeInTheDocument());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "סנכרון ליומן" }));
    expect(document.activeElement).not.toBe(document.body);
  });
});
