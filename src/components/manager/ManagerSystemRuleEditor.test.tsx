import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SystemRuleView } from "@/lib/notifications/ruleActions";
import type { ManagerAdoptionPersonView, ManagerPersonSummary } from "@/lib/readModels/managerTypes";

const updateSystemRuleAction = vi.fn();

vi.mock("@/lib/notifications/ruleActions", () => ({
  updateSystemRuleAction: (...args: unknown[]) => updateSystemRuleAction(...args),
}));

const { ManagerSystemRuleEditor } = await import("./ManagerSystemRuleEditor");

afterEach(() => {
  cleanup();
  updateSystemRuleAction.mockReset();
});

const ROSTER: ManagerPersonSummary[] = [
  { id: "p_dana", name: "דנה", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null },
];
const ADOPTION: ManagerAdoptionPersonView[] = [];

function dynamicRule(overrides: Partial<SystemRuleView> = {}): SystemRuleView {
  return {
    kind: "system",
    id: "rule-1",
    systemKey: "tomorrow_shift",
    enabled: true,
    localHour: 20,
    localMinute: 0,
    name: "תזכורת למשמרת מחר",
    trigger: "היום לפני משמרת -- מי שמשובץ למשמרת מחר",
    audience: "מי שמשובץ למשמרת למחר",
    copyNote: "",
    revision: 1,
    titleOverride: null,
    bodyOverride: null,
    audienceMode: "all_eligible",
    targetPersonIds: [],
    audienceGroupKeys: [],
    excludedPersonIds: [],
    bodyKind: "dynamic_details_required",
    defaultTitle: "⏰ המשמרת שלך מחר",
    defaultBody: null,
    audienceFilterNote: "ההתראה עדיין תישלח רק למי שיש לו משמרת מחר בפועל.",
    ...overrides,
  };
}

function staticRule(overrides: Partial<SystemRuleView> = {}): SystemRuleView {
  return dynamicRule({
    systemKey: "constraints_sunday",
    name: "תזכורת לאילוצים -- יום ראשון",
    bodyKind: "static_editable",
    defaultTitle: "📌 תזכורת לאילוצים",
    defaultBody: "יש אילוץ לשבוע הבא? אפשר לשלוח עד מחר.",
    audienceFilterNote: "קבע מוחרגים תמיד, גם אם נבחרו ברשימה.",
    ...overrides,
  });
}

describe("ManagerSystemRuleEditor -- fields + submission", () => {
  it("submits enabled/time/copy/audience exactly as entered, defaulting to the rule's own current values", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: true, rule: dynamicRule() });
    const onSaved = vi.fn();

    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("שמירת שינויים"));

    await waitFor(() =>
      expect(updateSystemRuleAction).toHaveBeenCalledWith("rule-1", {
        enabled: true,
        localHour: 20,
        localMinute: 0,
        titleOverride: null,
        bodyOverride: null,
        audienceMode: "all_eligible",
        targetPersonIds: [],
        audienceGroupKeys: [],
        excludedPersonIds: [],
        expectedRevision: 1,
      }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("[mandatory 7] submits the rule's OWN loaded revision as expectedRevision, not a hardcoded value", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: true, rule: dynamicRule() });

    render(<ManagerSystemRuleEditor rule={dynamicRule({ revision: 7 })} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("שמירת שינויים"));

    await waitFor(() =>
      expect(updateSystemRuleAction).toHaveBeenCalledWith("rule-1", expect.objectContaining({ expectedRevision: 7 })),
    );
  });

  it("a 'conflict' error shows the truthful stale-edit message, distinct from other errors", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: false, error: "conflict" });

    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("שמירת שינויים"));

    await waitFor(() => expect(screen.getByText("ההתראה השתנתה מאז שפתחת אותה. טען/י מחדש ונסה/י שוב.")).toBeTruthy());
  });

  it("editing title/body sends the trimmed override text", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: true, rule: dynamicRule() });

    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("⏰ המשמרת שלך מחר"), { target: { value: "  כותרת חדשה  " } });
    fireEvent.click(screen.getByText("שמירת שינויים"));

    await waitFor(() =>
      expect(updateSystemRuleAction).toHaveBeenCalledWith("rule-1", expect.objectContaining({ titleOverride: "כותרת חדשה" })),
    );
  });

  it("dynamic-body rule: a body without {details} disables submit and shows the validation error", () => {
    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);

    const bodyInput = screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA")!;
    fireEvent.change(bodyInput, { target: { value: "תוכן בלי הפרטים" } });

    expect(screen.getByText(/חייב להכיל את/)).toBeTruthy();
    expect(screen.getByText("שמירת שינויים")).toBeDisabled();
  });

  it("dynamic-body rule: a body containing {details} exactly once is accepted", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: true, rule: dynamicRule() });

    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const bodyInput = screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA")!;
    fireEvent.change(bodyInput, { target: { value: "תזכורת חשובה 👀 {details}" } });
    fireEvent.click(screen.getByText("שמירת שינויים"));

    await waitFor(() =>
      expect(updateSystemRuleAction).toHaveBeenCalledWith("rule-1", expect.objectContaining({ bodyOverride: "תזכורת חשובה 👀 {details}" })),
    );
  });

  it("static-body rule: free text with no {details} is accepted -- no placeholder requirement", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: true, rule: staticRule() });

    render(<ManagerSystemRuleEditor rule={staticRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const bodyInput = screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA")!;
    fireEvent.change(bodyInput, { target: { value: "תוכן חופשי לגמרי" } });

    expect(screen.getByText("שמירת שינויים")).not.toBeDisabled();
    fireEvent.click(screen.getByText("שמירת שינויים"));

    await waitFor(() =>
      expect(updateSystemRuleAction).toHaveBeenCalledWith("rule-1", expect.objectContaining({ bodyOverride: "תוכן חופשי לגמרי" })),
    );
  });

  it("איפוס לברירת מחדל clears title/body only, leaving audience untouched", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: true, rule: dynamicRule() });
    const rule = dynamicRule({ titleOverride: "ישן", bodyOverride: "ישן {details}", audienceMode: "selected", targetPersonIds: ["p_dana"] });

    render(<ManagerSystemRuleEditor rule={rule} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("איפוס לברירת מחדל"));
    fireEvent.click(screen.getByText("שמירת שינויים"));

    await waitFor(() =>
      expect(updateSystemRuleAction).toHaveBeenCalledWith(
        "rule-1",
        expect.objectContaining({ titleOverride: null, bodyOverride: null, audienceMode: "selected", targetPersonIds: ["p_dana"] }),
      ),
    );
  });

  it("switching to 'אנשים ספציפיים' with nothing selected disables submit; selecting a roster person enables it and reuses RosterPersonPicker", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: true, rule: dynamicRule() });

    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("אנשים ספציפיים"));
    expect(screen.getByText("שמירת שינויים")).toBeDisabled();

    fireEvent.click(screen.getByText("דנה"));
    expect(screen.getByText("שמירת שינויים")).not.toBeDisabled();

    fireEvent.click(screen.getByText("שמירת שינויים"));
    await waitFor(() =>
      expect(updateSystemRuleAction).toHaveBeenCalledWith(
        "rule-1",
        expect.objectContaining({ audienceMode: "selected", targetPersonIds: ["p_dana"] }),
      ),
    );
  });

  it("shows the rule's own audienceFilterNote -- explicit that selection is a restriction, never an override", () => {
    render(<ManagerSystemRuleEditor rule={staticRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(staticRule().audienceFilterNote)).toBeTruthy();
  });

  it("cancel calls onCancel without submitting", () => {
    const onCancel = vi.fn();
    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByText("ביטול"));

    expect(onCancel).toHaveBeenCalled();
    expect(updateSystemRuleAction).not.toHaveBeenCalled();
  });

  it("a server-side rejection shows a truthful error, never a silent failure", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: false, error: "invalid_body_details_placeholder" });

    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("שמירת שינויים"));

    await waitFor(() => expect(screen.getByText(/פעם אחת בדיוק/)).toBeTruthy());
  });
});

describe("ManagerSystemRuleEditor -- accessible status announcements and field validation", () => {
  it("a server-side rejection exposes role=alert", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: false, error: "conflict" });

    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("שמירת שינויים"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("the client-side {details}-placeholder violation exposes role=alert and marks the body field invalid", () => {
    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);

    const bodyInput = screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA")!;
    fireEvent.change(bodyInput, { target: { value: "תוכן בלי הפרטים" } });

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(bodyInput).toHaveAttribute("aria-invalid", "true");
    expect(bodyInput).toHaveAttribute("aria-describedby", alert.id);
  });

  it("an invalid_title server error marks the title field invalid", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: false, error: "invalid_title" });

    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("שמירת שינויים"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("⏰ המשמרת שלך מחר")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("ManagerSystemRuleEditor -- 'לא לשלוח ל' expand/collapse toggle", () => {
  // `dynamicRule()`'s default audienceMode is "all_eligible", so no audience
  // RosterPersonPicker is on screen -- "דנה"/checkbox queries stay
  // unambiguous with only the exclusions picker rendered.
  it("starts collapsed; clicking the toggle expands it and shows the picker", () => {
    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText("+ לא לשלוח ל")).toBeTruthy();
    expect(screen.queryByLabelText("חיפוש איש/אשת צוות")).toBeNull();

    fireEvent.click(screen.getByText("+ לא לשלוח ל"));

    expect(screen.getByText("− הסתר לא לשלוח ל")).toBeTruthy();
    expect(screen.getByLabelText("חיפוש איש/אשת צוות")).toBeTruthy();
  });

  it("clicking the toggle again while expanded collapses it and hides the picker", () => {
    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText("+ לא לשלוח ל"));
    expect(screen.getByLabelText("חיפוש איש/אשת צוות")).toBeTruthy();

    fireEvent.click(screen.getByText("− הסתר לא לשלוח ל"));

    expect(screen.getByText("+ לא לשלוח ל")).toBeTruthy();
    expect(screen.queryByLabelText("חיפוש איש/אשת צוות")).toBeNull();
  });

  it("collapsing keeps a selected exclusion selected -- reopening shows it still checked, and it is still saved on submit", async () => {
    updateSystemRuleAction.mockResolvedValue({ ok: true, rule: dynamicRule() });

    render(<ManagerSystemRuleEditor rule={dynamicRule()} roster={ROSTER} adoptionPeople={ADOPTION} onSaved={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText("+ לא לשלוח ל"));
    fireEvent.click(screen.getByText("דנה"));
    expect((screen.getByRole("checkbox", { name: /דנה/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByText("− הסתר לא לשלוח ל"));
    expect(screen.queryByLabelText("חיפוש איש/אשת צוות")).toBeNull();

    fireEvent.click(screen.getByText("+ לא לשלוח ל"));
    expect((screen.getByRole("checkbox", { name: /דנה/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByText("שמירת שינויים"));
    await waitFor(() =>
      expect(updateSystemRuleAction).toHaveBeenCalledWith("rule-1", expect.objectContaining({ excludedPersonIds: ["p_dana"] })),
    );
  });
});
