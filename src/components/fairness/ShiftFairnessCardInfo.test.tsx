import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShiftFairnessCardInfo } from "./ShiftFairnessCardInfo";

afterEach(() => {
  cleanup();
});

describe("ShiftFairnessCardInfo", () => {
  it("renders exactly ONE info affordance, closed by default", () => {
    render(<ShiftFairnessCardInfo />);
    expect(screen.getAllByRole("button", { name: "הסבר על מדדי הכרטיס" })).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a real, natively keyboard-focusable <button> -- not a div/span with synthetic key handlers", () => {
    render(<ShiftFairnessCardInfo />);
    const trigger = screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
  });

  it("clicking the trigger opens a panel explaining completed shifts / fair expectation / status / weekend, matching the card's own labels", () => {
    render(<ShiftFairnessCardInfo />);
    fireEvent.click(screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" }));

    const dialog = screen.getByRole("dialog", { name: "הסבר על מדדי הכרטיס" });
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain("משמרות שביצעת");
    expect(dialog.textContent).toContain("צפי הוגן");
    expect(dialog.textContent).toContain("מצב");
    expect(dialog.textContent).toContain('סופ"שים');
    // Explanatory only -- no raw formulas/opportunity-count implementation details.
    expect(dialog.textContent).not.toMatch(/הזדמנות תואמת|opportunit/i);
  });

  it("explains that the expectation reflects recorded availability/absences/constraints, never an unexplained bare decimal", () => {
    render(<ShiftFairnessCardInfo />);
    fireEvent.click(screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" }));

    const dialog = screen.getByRole("dialog", { name: "הסבר על מדדי הכרטיס" });
    expect(dialog.textContent).toContain("זמינות");
    expect(dialog.textContent).toContain("היעדרויות");
    // Explicitly reassures this is not a fixed monthly quota.
    expect(dialog.textContent).toContain("לא יעד חודשי קבוע");
  });

  it("explains WHY the internal expectation can be fractional, and that a whole-shift range is shown instead", () => {
    render(<ShiftFairnessCardInfo />);
    fireEvent.click(screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" }));

    const dialog = screen.getByRole("dialog", { name: "הסבר על מדדי הכרטיס" });
    expect(dialog.textContent).toContain("מספר חלקי");
    expect(dialog.textContent).toContain("טווח המשמרות");
    expect(dialog.textContent).toContain("חצי משמרת");
  });

  it("never calls the expectation a personal target ('יעד אישי') -- it's an adjusted expectation, not a quota", () => {
    render(<ShiftFairnessCardInfo />);
    fireEvent.click(screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" }));

    const dialog = screen.getByRole("dialog", { name: "הסבר על מדדי הכרטיס" });
    expect(dialog.textContent).not.toContain("יעד אישי");
  });

  it("clicking the trigger again closes the panel", () => {
    render(<ShiftFairnessCardInfo />);
    const trigger = screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Escape closes the panel and returns focus to the trigger", () => {
    render(<ShiftFairnessCardInfo />);
    const trigger = screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("a pointerdown outside the control closes the panel", () => {
    render(
      <div>
        <ShiftFairnessCardInfo />
        <div data-testid="outside">מחוץ לבקרה</div>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("aria-expanded and aria-haspopup correctly reflect open state", () => {
    render(<ShiftFairnessCardInfo />);
    const trigger = screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("clicking the trigger never bubbles to an ancestor click handler and always prevents the native default action -- so it cannot trigger the surrounding card's own navigation", () => {
    const ancestorClick = vi.fn();
    render(
      <div onClick={ancestorClick}>
        <ShiftFairnessCardInfo />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" });
    const notPrevented = fireEvent.click(trigger);

    expect(notPrevented).toBe(false); // fireEvent returns false when preventDefault() was called.
    expect(ancestorClick).not.toHaveBeenCalled();
  });

  it("keeps its visible 28px size and gets a fully expanded invisible hit area (Phase 6)", () => {
    render(<ShiftFairnessCardInfo />);
    const trigger = screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" });
    expect(trigger.className).toContain("h-7 w-7");
    expect(trigger.className).toContain("after:-inset-1.5");
  });

  it("clicking inside the open panel also never bubbles to an ancestor click handler", () => {
    const ancestorClick = vi.fn();
    render(
      <div onClick={ancestorClick}>
        <ShiftFairnessCardInfo />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "הסבר על מדדי הכרטיס" }));
    ancestorClick.mockClear();

    fireEvent.click(screen.getByRole("dialog"));
    expect(ancestorClick).not.toHaveBeenCalled();
  });
});
