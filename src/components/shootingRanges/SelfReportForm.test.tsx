import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const submitSelfReportShootingRangeAction = vi.fn();

vi.mock("@/lib/shootingRanges/actions", () => ({
  submitSelfReportShootingRangeAction: (...args: unknown[]) => submitSelfReportShootingRangeAction(...args),
}));

const { SelfReportForm } = await import("./SelfReportForm");

afterEach(() => {
  cleanup();
  submitSelfReportShootingRangeAction.mockReset();
});

function openForm() {
  render(<SelfReportForm />);
  fireEvent.click(screen.getByRole("button", { name: "ביצעתי מטווח" }));
}

function fillDateAndSubmit(date = "2026-01-01") {
  const dateInput = screen.getByLabelText("תאריך ביצוע") as HTMLInputElement;
  fireEvent.change(dateInput, { target: { value: date } });
  fireEvent.click(screen.getByRole("button", { name: "שלח דיווח" }));
  return dateInput;
}

describe("SelfReportForm -- accessible status announcements", () => {
  it("the success message exposes role=status", async () => {
    submitSelfReportShootingRangeAction.mockResolvedValue({ ok: true });
    openForm();
    fillDateAndSubmit();

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("הדיווח נשלח וממתין לאישור מנהל.");
  });

  it("an error message exposes role=alert", async () => {
    submitSelfReportShootingRangeAction.mockResolvedValue({ ok: false, error: "invalid_notes" });
    openForm();
    fillDateAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("ההערה ארוכה מדי.");
  });
});

describe("SelfReportForm -- date field validation wiring", () => {
  it("a date-specific server error marks the date field invalid and associates the error message", async () => {
    submitSelfReportShootingRangeAction.mockResolvedValue({ ok: false, error: "date_in_future" });
    openForm();
    const dateInput = fillDateAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(dateInput).toHaveAttribute("aria-invalid", "true");
    const describedBy = dateInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveAttribute("id", describedBy!);
  });

  it("a non-date server error never marks the date field invalid", async () => {
    submitSelfReportShootingRangeAction.mockResolvedValue({ ok: false, error: "unmapped" });
    openForm();
    const dateInput = fillDateAndSubmit();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(dateInput).not.toHaveAttribute("aria-invalid");
    expect(dateInput).not.toHaveAttribute("aria-describedby");
  });

  it("the date field starts valid with no aria-invalid/aria-describedby", () => {
    openForm();
    const dateInput = screen.getByLabelText("תאריך ביצוע");
    expect(dateInput).not.toHaveAttribute("aria-invalid");
    expect(dateInput).not.toHaveAttribute("aria-describedby");
  });
});

describe("SelfReportForm -- unchanged submission behavior", () => {
  it("שלח דיווח is disabled until a date is entered", () => {
    openForm();
    expect(screen.getByRole("button", { name: "שלח דיווח" })).toBeDisabled();
  });

  it("ביטול closes the form without submitting", () => {
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));

    expect(screen.getByRole("button", { name: "ביצעתי מטווח" })).toBeInTheDocument();
    expect(submitSelfReportShootingRangeAction).not.toHaveBeenCalled();
  });
});
