import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReportOneDraft } from "@/lib/domain/reportOne";

const setReserveInclusionPreferenceAction = vi.fn();
vi.mock("@/lib/reportOne/actions", () => ({
  setReserveInclusionPreferenceAction: (...args: unknown[]) => setReserveInclusionPreferenceAction(...args),
}));

const { ReportOneEditorOverlay } = await import("./ReportOneEditorOverlay");

function draft(): ReportOneDraft {
  return {
    targetDate: "2026-08-26",
    sections: [
      { section: "permanent", label: "אנשי קבע💛:", people: [{ personId: "p_1", name: "עמנואל צגה", section: "permanent", generatedStatus: "?" }] },
      { section: "reserve", label: "מילואים😍:", people: [] },
      {
        section: "regular_manager",
        label: 'סדיר - אחמשים🧑🏻‍💻:',
        people: [{ personId: "p_2", name: "עילאי שפירא", section: "regular_manager", generatedStatus: 'נוכח, אחמ"ש יום' }],
      },
      { section: "regular_technician", label: 'סדיר - טכנאים🧑🏻‍🔧:', people: [] },
    ],
  };
}

/** A draft with a populated reserve section covering every meaningful/not-meaningful status shape the reserve-inclusion toggle needs to distinguish. */
function reserveDraft(): ReportOneDraft {
  return {
    targetDate: "2026-08-26",
    sections: [
      { section: "permanent", label: "אנשי קבע💛:", people: [{ personId: "p_perm", name: "עמנואל צגה", section: "permanent", generatedStatus: "?" }] },
      {
        section: "reserve",
        label: "מילואים😍:",
        people: [
          { personId: "p_night", name: "רועי לוין", section: "reserve", generatedStatus: 'נוכח, אחמ"ש לילה' },
          { personId: "p_day", name: "הילה גלבוע", section: "reserve", generatedStatus: "נוכח, טכנאית יום" },
          { personId: "p_duty", name: "דור תורן", section: "reserve", generatedStatus: "?, כונן פינויים" },
          { personId: "p_none", name: "אלמוני מילואים", section: "reserve", generatedStatus: "?" },
        ],
      },
      { section: "regular_manager", label: 'סדיר - אחמשים🧑🏻‍💻:', people: [] },
      { section: "regular_technician", label: 'סדיר - טכנאים🧑🏻‍🔧:', people: [] },
    ],
  };
}

beforeEach(() => {
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  setReserveInclusionPreferenceAction.mockReset();
  setReserveInclusionPreferenceAction.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ReportOneEditorOverlay", () => {
  it("renders every person's name and generated status as an editable row", () => {
    render(<ReportOneEditorOverlay draft={draft()} onClose={() => {}} />);
    expect(screen.getByText("עמנואל צגה")).toBeInTheDocument();
    expect(screen.getByDisplayValue("?")).toBeInTheDocument();
    expect(screen.getByDisplayValue('נוכח, אחמ"ש יום')).toBeInTheDocument();
  });

  it("23. manual edits remain in the field until Reset", () => {
    render(<ReportOneEditorOverlay draft={draft()} onClose={() => {}} />);
    const input = screen.getByLabelText("סטטוס עבור עמנואל צגה");
    fireEvent.change(input, { target: { value: "נוכח, מגיע בערב" } });
    expect(screen.getByDisplayValue("נוכח, מגיע בערב")).toBeInTheDocument();
  });

  it("24. Reset restores the generated value after a manual edit, with an inline confirm since edits exist", () => {
    render(<ReportOneEditorOverlay draft={draft()} onClose={() => {}} />);
    const input = screen.getByLabelText("סטטוס עבור עמנואל צגה");
    fireEvent.change(input, { target: { value: "נוכח, מגיע בערב" } });

    fireEvent.click(screen.getByRole("button", { name: /איפוס לטיוטה האוטומטית/ }));
    expect(screen.getByText(/קיימים שינויים ידניים/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(screen.getByLabelText("סטטוס עבור עמנואל צגה")).toHaveValue("?");
  });

  it("reset with no unsaved edits skips the confirmation entirely", () => {
    render(<ReportOneEditorOverlay draft={draft()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /איפוס לטיוטה האוטומטית/ }));
    expect(screen.queryByText(/קיימים שינויים ידניים/)).toBeNull();
  });

  it("copying writes the formatted report (including any manual edits) to the clipboard and shows feedback", async () => {
    render(<ReportOneEditorOverlay draft={draft()} onClose={() => {}} />);
    const input = screen.getByLabelText("סטטוס עבור עמנואל צגה");
    fireEvent.change(input, { target: { value: "נוכח, מגיע בערב" } });

    fireEvent.click(screen.getByRole("button", { name: /העתק דוח/ }));

    await waitFor(() => expect(screen.getByText("הדוח הועתק")).toBeInTheDocument());
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("עמנואל צגה - נוכח, מגיע בערב"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("דוח 1: 26/08/2026🛰️"));
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<ReportOneEditorOverlay draft={draft()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

// --- Reserve-inclusion toggle -----------------------------------------------

describe("ReportOneEditorOverlay — reserve inclusion checkbox", () => {
  it("1. defaults to checked when no preference is passed at all", () => {
    render(<ReportOneEditorOverlay draft={reserveDraft()} onClose={() => {}} />);
    expect(screen.getByLabelText("כלול בדוח 1: רועי לוין")).toBeChecked();
  });

  it("4. no checkbox is rendered for permanent/regular sections", () => {
    render(<ReportOneEditorOverlay draft={reserveDraft()} onClose={() => {}} />);
    expect(screen.queryByLabelText("כלול בדוח 1: עמנואל צגה")).toBeNull();
  });

  it("2. a checked reserve person is included in the copied report", async () => {
    render(<ReportOneEditorOverlay draft={reserveDraft()} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /העתק דוח/ }));
    await waitFor(() => expect(screen.getByText("הדוח הועתק")).toBeInTheDocument());
    const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('רועי לוין - נוכח, אחמ"ש לילה'));
  });

  it("3/16. an explicitly excluded reserve person is unchecked and omitted from the copied report until rechecked", async () => {
    render(
      <ReportOneEditorOverlay
        draft={reserveDraft()}
        reserveInclusionByPersonId={{ p_none: false }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByLabelText("כלול בדוח 1: אלמוני מילואים")).not.toBeChecked();

    // Same button element throughout -- its accessible name flips to "הדוח הועתק" after a click, so it must never be re-queried by the "העתק דוח" name.
    const copyButton = screen.getByRole("button", { name: /העתק דוח/ });
    fireEvent.click(copyButton);
    await waitFor(() => expect(screen.getByText("הדוח הועתק")).toBeInTheDocument());
    let writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining("אלמוני מילואים"));

    // Re-checking persists immediately (no confirmation needed) and the next copy includes them.
    fireEvent.click(screen.getByLabelText("כלול בדוח 1: אלמוני מילואים"));
    await waitFor(() => expect(setReserveInclusionPreferenceAction).toHaveBeenCalledWith("p_none", true));

    fireEvent.click(copyButton);
    await waitFor(() => {
      writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
      expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("אלמוני מילואים - ?"));
    });
  });

  it("7. unchecking a reserve person with no meaningful tomorrow event persists immediately, no confirmation shown", async () => {
    render(<ReportOneEditorOverlay draft={reserveDraft()} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("כלול בדוח 1: אלמוני מילואים"));

    expect(screen.queryByText("הסר בכל זאת")).toBeNull();
    await waitFor(() => expect(setReserveInclusionPreferenceAction).toHaveBeenCalledWith("p_none", false));
  });

  it("8. unchecking a reserve person with a day shift requires confirmation before persisting", async () => {
    render(<ReportOneEditorOverlay draft={reserveDraft()} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("כלול בדוח 1: הילה גלבוע"));

    expect(screen.getByRole("button", { name: "הסר בכל זאת" })).toBeInTheDocument();
    expect(setReserveInclusionPreferenceAction).not.toHaveBeenCalled();
  });

  it("9. unchecking a reserve person with a night shift requires confirmation before persisting", async () => {
    render(<ReportOneEditorOverlay draft={reserveDraft()} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("כלול בדוח 1: רועי לוין"));

    expect(screen.getByRole("button", { name: "הסר בכל זאת" })).toBeInTheDocument();
    expect(setReserveInclusionPreferenceAction).not.toHaveBeenCalled();
  });

  it("10. unchecking a reserve person with an additive duty (כונן פינויים) requires confirmation before persisting", async () => {
    render(<ReportOneEditorOverlay draft={reserveDraft()} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("כלול בדוח 1: דור תורן"));

    expect(screen.getByRole("button", { name: "הסר בכל זאת" })).toBeInTheDocument();
    expect(setReserveInclusionPreferenceAction).not.toHaveBeenCalled();
  });

  it("11. cancelling the removal warning keeps the person included and never persists", async () => {
    render(<ReportOneEditorOverlay draft={reserveDraft()} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("כלול בדוח 1: הילה גלבוע"));
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));

    expect(screen.queryByRole("button", { name: "הסר בכל זאת" })).toBeNull();
    expect(screen.getByLabelText("כלול בדוח 1: הילה גלבוע")).toBeChecked();
    expect(setReserveInclusionPreferenceAction).not.toHaveBeenCalled();
  });

  it("12. confirming removal persists the exclusion and leaves the checkbox unchecked", async () => {
    render(<ReportOneEditorOverlay draft={reserveDraft()} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("כלול בדוח 1: הילה גלבוע"));
    fireEvent.click(screen.getByRole("button", { name: "הסר בכל זאת" }));

    await waitFor(() => expect(setReserveInclusionPreferenceAction).toHaveBeenCalledWith("p_day", false));
    expect(screen.getByLabelText("כלול בדוח 1: הילה גלבוע")).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "הסר בכל זאת" })).toBeNull();
  });

  it("13. a previously excluded person with no meaningful tomorrow event shows no warning", () => {
    render(
      <ReportOneEditorOverlay draft={reserveDraft()} reserveInclusionByPersonId={{ p_none: false }} onClose={() => {}} />,
    );
    expect(screen.queryByText("⚠️ יש שיבוץ מחר אך האדם לא כלול בדוח")).toBeNull();
  });

  it("14/15. a previously excluded person who now has a meaningful tomorrow event shows the stale-exclusion warning, and is never silently re-enabled", () => {
    render(
      <ReportOneEditorOverlay draft={reserveDraft()} reserveInclusionByPersonId={{ p_day: false }} onClose={() => {}} />,
    );
    expect(screen.getByText("⚠️ יש שיבוץ מחר אך האדם לא כלול בדוח")).toBeInTheDocument();
    expect(screen.getByLabelText("כלול בדוח 1: הילה גלבוע")).not.toBeChecked();
    expect(setReserveInclusionPreferenceAction).not.toHaveBeenCalled();
  });

  it("6. reset (איפוס לטיוטה האוטומטית) never touches reserve-inclusion state", async () => {
    render(<ReportOneEditorOverlay draft={reserveDraft()} onClose={() => {}} />);

    // Uncheck someone with no meaningful event (persists immediately, no confirm).
    fireEvent.click(screen.getByLabelText("כלול בדוח 1: אלמוני מילואים"));
    await waitFor(() => expect(setReserveInclusionPreferenceAction).toHaveBeenCalledWith("p_none", false));

    // Make a manual status edit so reset needs its own confirmation.
    const statusInput = screen.getByLabelText("סטטוס עבור עמנואל צגה");
    fireEvent.change(statusInput, { target: { value: "נוכח, מגיע בערב" } });
    fireEvent.click(screen.getByRole("button", { name: /איפוס לטיוטה האוטומטית/ }));
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));

    expect(statusInput).toHaveValue("?");
    expect(screen.getByLabelText("כלול בדוח 1: אלמוני מילואים")).not.toBeChecked();
  });

  it("reverts the optimistic checkbox state when persisting fails", async () => {
    setReserveInclusionPreferenceAction.mockResolvedValue({ ok: false, error: "forbidden" });
    render(<ReportOneEditorOverlay draft={reserveDraft()} onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("כלול בדוח 1: אלמוני מילואים"));

    await waitFor(() => expect(screen.getByLabelText("כלול בדוח 1: אלמוני מילואים")).toBeChecked());
  });
});

/** True whether the fallback (`aria-hidden`) or real native `inert` marked this element hidden/non-interactive. */
function isMarkedInert(element: Element): boolean {
  return element.hasAttribute("inert") || element.getAttribute("aria-hidden") === "true";
}

describe("ReportOneEditorOverlay — modal background isolation (Phase 3, useModalInertBackground)", () => {
  it("makes background app content (RTL's own render container) inert while open", () => {
    const { container } = render(<ReportOneEditorOverlay draft={draft()} onClose={() => {}} />);
    expect(isMarkedInert(container)).toBe(true);
  });

  it("never marks the dialog itself inert", () => {
    render(<ReportOneEditorOverlay draft={draft()} onClose={() => {}} />);
    expect(isMarkedInert(screen.getByRole("dialog"))).toBe(false);
  });

  it("restores the background once unmounted -- no inert state leaks after closing", () => {
    const { container, unmount } = render(<ReportOneEditorOverlay draft={draft()} onClose={() => {}} />);
    expect(isMarkedInert(container)).toBe(true);
    unmount();
    expect(isMarkedInert(container)).toBe(false);
  });

  it("existing focus-trap behavior remains intact alongside background isolation", () => {
    render(<ReportOneEditorOverlay draft={draft()} onClose={() => {}} />);
    // Focus still moves into the dialog (the close button) on mount.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "סגירה" }));
  });
});
