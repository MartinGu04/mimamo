import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MoreSheet } from "./MoreSheet";

afterEach(() => {
  cleanup();
});

function Harness({ isManager = true }: { isManager?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        פתח עוד
      </button>
      <MoreSheet open={open} onClose={() => setOpen(false)} isManager={isManager} />
    </div>
  );
}

function trigger() {
  return screen.getByRole("button", { name: "פתח עוד" });
}

function closeButton() {
  return screen.getByRole("button", { name: "סגירה" });
}

function sheet() {
  return screen.getByRole("dialog", { name: "עוד" });
}

describe("MoreSheet -- modal focus behavior", () => {
  it("moves focus inside on open, defaulting to the close button", () => {
    render(<Harness />);
    fireEvent.click(trigger());

    expect(sheet()).toBeInTheDocument();
    expect(document.activeElement).toBe(closeButton());
  });

  it("Escape closes the sheet", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    expect(sheet()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closing returns focus to the trigger that opened it", () => {
    render(<Harness />);
    const openButton = trigger();
    openButton.focus();
    fireEvent.click(openButton);
    expect(sheet()).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(openButton);
  });

  it("Tab wraps from the LAST focusable link back to the close button", () => {
    render(<Harness isManager={true} />);
    fireEvent.click(trigger());

    const lastLink = screen.getByRole("link", { name: "מרכז התראות" });
    lastLink.focus();
    expect(document.activeElement).toBe(lastLink);

    fireEvent.keyDown(lastLink, { key: "Tab" });

    expect(document.activeElement).toBe(closeButton());
  });

  it("Shift+Tab wraps from the close button back to the LAST focusable link", () => {
    render(<Harness isManager={true} />);
    fireEvent.click(trigger());
    expect(document.activeElement).toBe(closeButton());

    const lastLink = screen.getByRole("link", { name: "מרכז התראות" });
    fireEvent.keyDown(closeButton(), { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(lastLink);
  });

  it("never renders manager-only links for a non-manager, and the trap still wraps correctly with the shorter list", () => {
    render(<Harness isManager={false} />);
    fireEvent.click(trigger());

    expect(screen.queryByRole("link", { name: "אזור מנהל" })).toBeNull();
    expect(screen.queryByRole("link", { name: "מרכז התראות" })).toBeNull();

    const lastLink = screen.getByRole("link", { name: "עד מתי???" });
    lastLink.focus();
    fireEvent.keyDown(lastLink, { key: "Tab" });

    expect(document.activeElement).toBe(closeButton());
  });

  it("clicking a nav link closes the sheet (via its own onClose) and returns focus to the trigger", () => {
    render(<Harness />);
    const openButton = trigger();
    openButton.focus();
    fireEvent.click(openButton);

    fireEvent.click(screen.getByRole("link", { name: "מטווחים" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(openButton);
  });

  it("clicking the scrim closes the sheet without leaving a keyboard trap behind", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    expect(sheet()).toBeInTheDocument();

    fireEvent.click(screen.getByRole("presentation", { hidden: true }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("MoreSheet -- unchanged visual/semantic behavior", () => {
  it("still exposes real dialog semantics", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    expect(sheet()).toHaveAttribute("aria-modal", "true");
  });

  it("renders nothing when closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
