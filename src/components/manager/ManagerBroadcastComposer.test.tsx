import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ManagerAdoptionPersonView, ManagerPersonSummary } from "@/lib/readModels/managerTypes";

const sendManagerBroadcastAction = vi.fn();

vi.mock("@/lib/notifications/manualBroadcastActions", () => ({
  sendManagerBroadcastAction: (...args: unknown[]) => sendManagerBroadcastAction(...args),
}));

const { ManagerBroadcastComposer } = await import("./ManagerBroadcastComposer");

afterEach(() => {
  cleanup();
  sendManagerBroadcastAction.mockReset();
});

const ROSTER: ManagerPersonSummary[] = [
  { id: "p_dana", name: "דנה", isManager: false, isTechnician: true, isSupervisor: false, personnelType: null },
  { id: "p_noa", name: "נועה", isManager: false, isTechnician: false, isSupervisor: true, personnelType: null },
];

const ADOPTION: ManagerAdoptionPersonView[] = [
  { personId: "p_dana", personName: "דנה", avatarUrl: null, loginStatus: "logged_in", notificationStatus: "ready", dataIssue: null, needsNudge: false },
  { personId: "p_noa", personName: "נועה", avatarUrl: null, loginStatus: "logged_in", notificationStatus: "not_enabled", dataIssue: null, needsNudge: true },
];

function renderComposer() {
  return render(<ManagerBroadcastComposer mode="now" roster={ROSTER} adoptionPeople={ADOPTION} />);
}

describe("ManagerBroadcastComposer", () => {
  it("renders the audience selector, person picker, and disables send until a recipient + title + body exist", () => {
    renderComposer();
    expect(screen.getByText("📣 שליחת התראה")).toBeInTheDocument();
    const sendButton = screen.getByRole("button", { name: "שלח התראה" });
    expect(sendButton).toBeDisabled();
  });

  it("shows readiness badges next to each person in the picker, reusing the existing adoption data", () => {
    renderComposer();
    expect(screen.getByText("Push")).toBeInTheDocument();
    expect(screen.getByText("התראה בלבד")).toBeInTheDocument();
  });

  it("filters the picker by search query", () => {
    renderComposer();
    const search = screen.getByLabelText("חיפוש איש/אשת צוות");
    fireEvent.change(search, { target: { value: "דנה" } });
    expect(screen.getByText("דנה")).toBeInTheDocument();
    expect(screen.queryByText("נועה")).toBeNull();
  });

  it("selecting a person enables send once title/body are also filled, and updates the live audience summary", () => {
    renderComposer();
    fireEvent.click(screen.getByText("דנה"));
    expect(screen.getByText(/יקבלו גם Push/).parentElement?.textContent).toContain("1");

    fireEvent.change(screen.getByPlaceholderText("לדוגמה: עדכון חשוב"), { target: { value: "כותרת" } });
    fireEvent.change(screen.getByPlaceholderText("תוכן ההתראה שיוצג לאנשי הצוות"), { target: { value: "תוכן ההודעה" } });

    expect(screen.getByRole("button", { name: "שלח התראה" })).not.toBeDisabled();
  });

  it("'person' mode replaces the previous selection when a second person is clicked, never accumulating", () => {
    renderComposer();
    fireEvent.click(screen.getByText("דנה"));
    fireEvent.click(screen.getByText("נועה"));
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const checkedCount = checkboxes.filter((box) => box.checked).length;
    expect(checkedCount).toBe(1);
  });

  it("'כמה אנשים' mode accumulates multiple selections", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("radio", { name: "כמה אנשים" }));
    fireEvent.click(screen.getByText("דנה"));
    fireEvent.click(screen.getByText("נועה"));
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.filter((box) => box.checked)).toHaveLength(2);
  });

  it("'כולם' mode hides the picker and enables send without any manual selection once title/body are filled", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("radio", { name: "כולם" }));
    expect(screen.queryByLabelText("חיפוש איש/אשת צוות")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("לדוגמה: עדכון חשוב"), { target: { value: "כותרת" } });
    fireEvent.change(screen.getByPlaceholderText("תוכן ההתראה שיוצג לאנשי הצוות"), { target: { value: "תוכן" } });

    expect(screen.getByRole("button", { name: "שלח התראה" })).not.toBeDisabled();
  });

  it("submits with the same idempotencyKey shape the action expects, and shows the truthful post-send summary -- never claims Push was sent", async () => {
    sendManagerBroadcastAction.mockResolvedValue({
      ok: true,
      batchId: "batch_1",
      resolvedRecipientCount: 1,
      pushCapableCount: 1,
      inboxOnlyCount: 0,
      unresolved: [],
    });
    renderComposer();
    fireEvent.click(screen.getByText("דנה"));
    fireEvent.change(screen.getByPlaceholderText("לדוגמה: עדכון חשוב"), { target: { value: "כותרת" } });
    fireEvent.change(screen.getByPlaceholderText("תוכן ההתראה שיוצג לאנשי הצוות"), { target: { value: "תוכן" } });

    fireEvent.click(screen.getByRole("button", { name: "שלח התראה" }));

    await waitFor(() => expect(sendManagerBroadcastAction).toHaveBeenCalledTimes(1));
    const call = sendManagerBroadcastAction.mock.calls[0][0];
    expect(call).toMatchObject({ audienceKind: "person", targetPersonIds: ["p_dana"], title: "כותרת", body: "תוכן" });
    expect(typeof call.idempotencyKey).toBe("string");
    expect(call.idempotencyKey.length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getByText(/נוצרה התראה ל־1 משתמשים/)).toBeInTheDocument());
    expect(screen.queryByText(/Push נשלח/)).toBeNull();
  });

  it("after a successful send, clears title/body but preserves the selected audience so the manager can quickly resend to the same group", async () => {
    sendManagerBroadcastAction.mockResolvedValue({
      ok: true,
      batchId: "batch_1",
      resolvedRecipientCount: 1,
      pushCapableCount: 1,
      inboxOnlyCount: 0,
      unresolved: [],
    });
    renderComposer();
    fireEvent.click(screen.getByRole("radio", { name: "כמה אנשים" }));
    fireEvent.click(screen.getByText("דנה"));
    fireEvent.click(screen.getByText("נועה"));
    fireEvent.change(screen.getByPlaceholderText("לדוגמה: עדכון חשוב"), { target: { value: "כותרת" } });
    fireEvent.change(screen.getByPlaceholderText("תוכן ההתראה שיוצג לאנשי הצוות"), { target: { value: "תוכן" } });

    fireEvent.click(screen.getByRole("button", { name: "שלח התראה" }));
    await waitFor(() => expect(sendManagerBroadcastAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/נוצרה התראה ל־1 משתמשים/)).toBeInTheDocument());

    // Title/body cleared...
    expect(screen.getByPlaceholderText("לדוגמה: עדכון חשוב")).toHaveValue("");
    expect(screen.getByPlaceholderText("תוכן ההתראה שיוצג לאנשי הצוות")).toHaveValue("");
    // ...but the audience mode and both selected people are still checked.
    expect(screen.getByRole("radio", { name: "כמה אנשים" })).toHaveAttribute("aria-checked", "true");
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.filter((box) => box.checked)).toHaveLength(2);

    // Sending again reuses the SAME audience with a fresh idempotency key.
    fireEvent.change(screen.getByPlaceholderText("לדוגמה: עדכון חשוב"), { target: { value: "כותרת 2" } });
    fireEvent.change(screen.getByPlaceholderText("תוכן ההתראה שיוצג לאנשי הצוות"), { target: { value: "תוכן 2" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "שלח התראה" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "שלח התראה" }));
    await waitFor(() => expect(sendManagerBroadcastAction).toHaveBeenCalledTimes(2));
    const firstKey = sendManagerBroadcastAction.mock.calls[0][0].idempotencyKey;
    const secondCall = sendManagerBroadcastAction.mock.calls[1][0];
    expect(secondCall).toMatchObject({ audienceKind: "people", targetPersonIds: ["p_dana", "p_noa"], title: "כותרת 2" });
    expect(secondCall.idempotencyKey).not.toBe(firstKey);
  });

  it("shows a Hebrew error message and never clears the form when the action fails", async () => {
    sendManagerBroadcastAction.mockResolvedValue({ ok: false, error: "no_targets" });
    renderComposer();
    fireEvent.click(screen.getByText("דנה"));
    fireEvent.change(screen.getByPlaceholderText("לדוגמה: עדכון חשוב"), { target: { value: "כותרת" } });
    fireEvent.change(screen.getByPlaceholderText("תוכן ההתראה שיוצג לאנשי הצוות"), { target: { value: "תוכן" } });

    fireEvent.click(screen.getByRole("button", { name: "שלח התראה" }));

    await waitFor(() => expect(sendManagerBroadcastAction).toHaveBeenCalledTimes(1));
    expect(within(screen.getByTestId("manager-broadcast-composer")).getByPlaceholderText("לדוגמה: עדכון חשוב")).toHaveValue(
      "כותרת",
    );
  });
});

describe("ManagerBroadcastComposer -- 'לא לשלוח ל' expand/collapse toggle", () => {
  // Selects "כולם" first so the audience picker itself is hidden -- keeps
  // "דנה"/checkbox queries unambiguous while only the exclusions picker is
  // on screen, exactly like the existing "'כולם' mode hides the picker" test.
  function renderWithEveryoneAudience() {
    renderComposer();
    fireEvent.click(screen.getByRole("radio", { name: "כולם" }));
  }

  it("starts collapsed; clicking the toggle expands it and shows the picker", () => {
    renderWithEveryoneAudience();

    expect(screen.getByText("+ לא לשלוח ל")).toBeInTheDocument();
    expect(screen.queryByLabelText("חיפוש איש/אשת צוות")).toBeNull();

    fireEvent.click(screen.getByText("+ לא לשלוח ל"));

    expect(screen.getByText("− הסתר לא לשלוח ל")).toBeInTheDocument();
    expect(screen.getByLabelText("חיפוש איש/אשת צוות")).toBeInTheDocument();
  });

  it("clicking the toggle again while expanded collapses it and hides the picker", () => {
    renderWithEveryoneAudience();

    fireEvent.click(screen.getByText("+ לא לשלוח ל"));
    expect(screen.getByLabelText("חיפוש איש/אשת צוות")).toBeInTheDocument();

    fireEvent.click(screen.getByText("− הסתר לא לשלוח ל"));

    expect(screen.getByText("+ לא לשלוח ל")).toBeInTheDocument();
    expect(screen.queryByLabelText("חיפוש איש/אשת צוות")).toBeNull();
  });

  it("collapsing keeps a selected exclusion selected -- reopening shows it still checked, and it is still sent on submit", async () => {
    sendManagerBroadcastAction.mockResolvedValue({
      ok: true,
      batchId: "batch_1",
      resolvedRecipientCount: 1,
      pushCapableCount: 1,
      inboxOnlyCount: 0,
      unresolved: [],
    });
    renderWithEveryoneAudience();

    fireEvent.click(screen.getByText("+ לא לשלוח ל"));
    fireEvent.click(screen.getByText("דנה"));
    expect((screen.getByRole("checkbox", { name: /דנה/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByText("− הסתר לא לשלוח ל"));
    expect(screen.queryByLabelText("חיפוש איש/אשת צוות")).toBeNull();

    fireEvent.click(screen.getByText("+ לא לשלוח ל"));
    expect((screen.getByRole("checkbox", { name: /דנה/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("לדוגמה: עדכון חשוב"), { target: { value: "כותרת" } });
    fireEvent.change(screen.getByPlaceholderText("תוכן ההתראה שיוצג לאנשי הצוות"), { target: { value: "תוכן" } });
    fireEvent.click(screen.getByRole("button", { name: "שלח התראה" }));

    await waitFor(() => expect(sendManagerBroadcastAction).toHaveBeenCalledTimes(1));
    expect(sendManagerBroadcastAction.mock.calls[0][0]).toMatchObject({ audienceKind: "everyone", excludedPersonIds: ["p_dana"] });
  });
});

describe("ManagerBroadcastComposer -- '↺ איפוס טופס' explicit reset action", () => {
  it("is a secondary button, visually subordinate to 'שלח התראה'", () => {
    renderComposer();
    const resetButton = screen.getByRole("button", { name: "↺ איפוס טופס" });
    const sendButton = screen.getByRole("button", { name: "שלח התראה" });
    expect(resetButton).toBeInTheDocument();
    expect(resetButton.className).not.toContain("bg-primary");
    expect(sendButton.className).toContain("bg-primary");
  });

  it("clears title/body and the selected individual person, and restores the default 'אדם מסוים' audience mode", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("radio", { name: "כמה אנשים" }));
    fireEvent.click(screen.getByText("דנה"));
    fireEvent.click(screen.getByText("נועה"));
    fireEvent.change(screen.getByPlaceholderText("לדוגמה: עדכון חשוב"), { target: { value: "כותרת" } });
    fireEvent.change(screen.getByPlaceholderText("תוכן ההתראה שיוצג לאנשי הצוות"), { target: { value: "תוכן" } });

    fireEvent.click(screen.getByRole("button", { name: "↺ איפוס טופס" }));

    expect(screen.getByPlaceholderText("לדוגמה: עדכון חשוב")).toHaveValue("");
    expect(screen.getByPlaceholderText("תוכן ההתראה שיוצג לאנשי הצוות")).toHaveValue("");
    expect(screen.getByRole("radio", { name: "אדם מסוים" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "כמה אנשים" })).toHaveAttribute("aria-checked", "false");
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.every((box) => !box.checked)).toBe(true);
    expect(sendManagerBroadcastAction).not.toHaveBeenCalled();
  });

  it("clears selected groups and switches back out of 'לפי קבוצות' mode", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("radio", { name: "לפי קבוצות" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "טכנאים" }));
    expect(screen.getByRole("checkbox", { name: "טכנאים" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "↺ איפוס טופס" }));

    expect(screen.getByRole("radio", { name: "אדם מסוים" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("checkbox", { name: "טכנאים" })).toBeNull(); // group picker no longer shown
  });

  it("clears a search query and an exclusion, and never calls the send action", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("radio", { name: "כולם" }));
    fireEvent.change(screen.getByPlaceholderText("לדוגמה: עדכון חשוב"), { target: { value: "כותרת" } });
    fireEvent.click(screen.getByText("+ לא לשלוח ל"));
    fireEvent.click(screen.getByText("דנה"));
    const excludeSearch = screen.getByLabelText("חיפוש איש/אשת צוות");
    fireEvent.change(excludeSearch, { target: { value: "דנה" } });

    fireEvent.click(screen.getByRole("button", { name: "↺ איפוס טופס" }));

    // Back to the default audience mode -- the exclude picker (and its
    // search query) is gone along with the "everyone" audience it belonged to.
    expect(screen.getByRole("radio", { name: "אדם מסוים" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("+ לא לשלוח ל")).toBeInTheDocument(); // collapsed again
    expect(screen.queryByText("− הסתר לא לשלוח ל")).toBeNull();
    expect(sendManagerBroadcastAction).not.toHaveBeenCalled();
  });

  it("clears a previously-shown error banner", async () => {
    sendManagerBroadcastAction.mockResolvedValue({ ok: false, error: "no_targets" });
    renderComposer();
    fireEvent.click(screen.getByText("דנה"));
    fireEvent.change(screen.getByPlaceholderText("לדוגמה: עדכון חשוב"), { target: { value: "כותרת" } });
    fireEvent.change(screen.getByPlaceholderText("תוכן ההתראה שיוצג לאנשי הצוות"), { target: { value: "תוכן" } });
    fireEvent.click(screen.getByRole("button", { name: "שלח התראה" }));
    await waitFor(() => expect(screen.getByText("לא נבחרו אנשי צוות תקפים לשליחה.")).toBeInTheDocument());
    // Wait for the pending send to fully settle -- the reset button is
    // disabled while `isPending`, same as the send button.
    await waitFor(() => expect(screen.getByRole("button", { name: "↺ איפוס טופס" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "↺ איפוס טופס" }));

    expect(screen.queryByText("לא נבחרו אנשי צוות תקפים לשליחה.")).toBeNull();
  });
});
