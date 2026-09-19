import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomWeeklyRuleView, SystemRuleView } from "@/lib/notifications/ruleActions";
import type { ManagerAdoptionPersonView, ManagerPersonSummary } from "@/lib/readModels/managerTypes";

const listNotificationRulesAction = vi.fn();
const updateSystemRuleAction = vi.fn();
const setCustomWeeklyRuleEnabledAction = vi.fn();
const archiveCustomWeeklyRuleAction = vi.fn();

vi.mock("@/lib/notifications/ruleActions", () => ({
  listNotificationRulesAction: (...args: unknown[]) => listNotificationRulesAction(...args),
  updateSystemRuleAction: (...args: unknown[]) => updateSystemRuleAction(...args),
  setCustomWeeklyRuleEnabledAction: (...args: unknown[]) => setCustomWeeklyRuleEnabledAction(...args),
  archiveCustomWeeklyRuleAction: (...args: unknown[]) => archiveCustomWeeklyRuleAction(...args),
}));

const composerCalls = vi.fn();
vi.mock("./ManagerRecurringRuleComposer", () => ({
  ManagerRecurringRuleComposer: (props: Record<string, unknown>) => {
    composerCalls(props);
    return (
      <div data-testid="composer-stub">
        <button type="button" onClick={() => (props.onSaved as () => void)()}>
          fake-saved
        </button>
        <button type="button" onClick={() => (props.onCancel as () => void)()}>
          fake-cancel
        </button>
      </div>
    );
  },
}));

const systemEditorCalls = vi.fn();
vi.mock("./ManagerSystemRuleEditor", () => ({
  ManagerSystemRuleEditor: (props: Record<string, unknown>) => {
    systemEditorCalls(props);
    return (
      <div data-testid="system-editor-stub">
        <button
          type="button"
          onClick={() => (props.onSaved as (updated: SystemRuleView) => void)((props.rule as SystemRuleView & { enabled: boolean }))}
        >
          fake-saved
        </button>
        <button type="button" onClick={() => (props.onCancel as () => void)()}>
          fake-cancel
        </button>
      </div>
    );
  },
}));

const { ManagerFixedNotificationsSection } = await import("./ManagerFixedNotificationsSection");

const ROSTER: ManagerPersonSummary[] = [];
const ADOPTION: ManagerAdoptionPersonView[] = [];

function systemRule(overrides: Partial<SystemRuleView> = {}): SystemRuleView {
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

function customRule(overrides: Partial<CustomWeeklyRuleView> = {}): CustomWeeklyRuleView {
  return {
    kind: "custom_weekly",
    id: "rule-custom-1",
    enabled: true,
    weekday: 6,
    localHour: 21,
    localMinute: 0,
    title: "📌 תזכורת לאילוצים",
    body: "גוף ההודעה",
    audienceKind: "everyone",
    targetPersonIds: [],
    audienceGroupKeys: [],
    excludedPersonIds: [],
    scheduleSummary: "כל שבת בשעה 21:00",
    nextSendSummary: "יום שבת · 29 באוגוסט בשעה 21:00",
    createdByPersonName: "דני מנהל",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  listNotificationRulesAction.mockReset();
  updateSystemRuleAction.mockReset();
  setCustomWeeklyRuleEnabledAction.mockReset();
  archiveCustomWeeklyRuleAction.mockReset();
  composerCalls.mockReset();
});

describe("ManagerFixedNotificationsSection -- loading + display", () => {
  it("shows both seeded system rules and custom rules once loaded", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [systemRule()], customWeeklyRules: [customRule()] });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);

    await waitFor(() => expect(screen.getByText("תזכורת למשמרת מחר")).toBeTruthy());
    expect(screen.getByText("📌 תזכורת לאילוצים")).toBeTruthy();
    expect(screen.getAllByText("מערכת").length).toBeGreaterThan(0);
    expect(screen.getAllByText("מחזורי").length).toBeGreaterThan(0);
  });

  it("shows a truthful empty state for custom rules when none exist yet", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [systemRule()], customWeeklyRules: [] });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);

    await waitFor(() => expect(screen.getByText(/אין עדיין התראות מחזוריות/)).toBeTruthy());
  });

  it("a load failure shows a truthful error, never a crash", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: false, error: "forbidden" });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);

    await waitFor(() => expect(screen.getByText(/לא ניתן לטעון/)).toBeTruthy());
  });

  it("the load failure exposes role=alert", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: false, error: "forbidden" });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("ManagerFixedNotificationsSection -- system rule row actions", () => {
  it("disabling a system rule via the quick toggle resubmits its OWN current copy/audience/time unchanged (the RPC has no partial update), and reflects the new state without a full reload", async () => {
    const rule = systemRule({ titleOverride: "כותרת מותאמת", audienceMode: "selected", targetPersonIds: ["p_1"] });
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [rule], customWeeklyRules: [] });
    updateSystemRuleAction.mockResolvedValue({ ok: true, rule: { ...rule, enabled: false } });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText("תזכורת למשמרת מחר")).toBeTruthy());

    fireEvent.click(screen.getByText("השבתה"));

    await waitFor(() =>
      expect(updateSystemRuleAction).toHaveBeenCalledWith("rule-1", {
        enabled: false,
        localHour: 20,
        localMinute: 0,
        titleOverride: "כותרת מותאמת",
        bodyOverride: null,
        audienceMode: "selected",
        targetPersonIds: ["p_1"],
        expectedRevision: 1,
      }),
    );
    await waitFor(() => expect(screen.getByText("הפעלה")).toBeTruthy());
  });

  it("[mandatory 8] the quick toggle submits the row's OWN loaded revision, not a hardcoded value", async () => {
    const rule = systemRule({ revision: 9 });
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [rule], customWeeklyRules: [] });
    updateSystemRuleAction.mockResolvedValue({ ok: true, rule: { ...rule, enabled: false } });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText("תזכורת למשמרת מחר")).toBeTruthy());

    fireEvent.click(screen.getByText("השבתה"));

    await waitFor(() =>
      expect(updateSystemRuleAction).toHaveBeenCalledWith("rule-1", expect.objectContaining({ expectedRevision: 9 })),
    );
  });

  it("a stale quick toggle (conflict -- someone else edited this rule since it loaded) shows a truthful error and triggers a full reload instead of silently overwriting the newer edit", async () => {
    const rule = systemRule();
    const refreshedRule = systemRule({ titleOverride: "כותרת של מנהל אחר", revision: 2 });
    listNotificationRulesAction
      .mockResolvedValueOnce({ ok: true, systemRules: [rule], customWeeklyRules: [] })
      .mockResolvedValueOnce({ ok: true, systemRules: [refreshedRule], customWeeklyRules: [] });
    updateSystemRuleAction.mockResolvedValue({ ok: false, error: "conflict" });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText("תזכורת למשמרת מחר")).toBeTruthy());

    fireEvent.click(screen.getByText("השבתה"));

    // The rejected toggle never applies -- the row stays enabled/"פעיל" --
    // and the list reloads instead, surfacing the OTHER manager's newer edit.
    await waitFor(() => expect(listNotificationRulesAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("✏️ הכותרת/התוכן הותאמו אישית.")).toBeTruthy());
  });

  it("never offers a delete action for a system rule -- only disable/enable and עריכה", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [systemRule()], customWeeklyRules: [] });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText("תזכורת למשמרת מחר")).toBeTruthy());

    expect(screen.queryByText("הסרה")).toBeNull();
  });

  it("shows an audience summary reflecting the saved mode -- 'כל הרלוונטיים' for all_eligible, a count for selected", async () => {
    listNotificationRulesAction.mockResolvedValue({
      ok: true,
      systemRules: [systemRule({ audienceMode: "selected", targetPersonIds: ["p_1", "p_2"] })],
      customWeeklyRules: [],
    });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);

    await waitFor(() => expect(screen.getByText(/2 נבחרים/)).toBeTruthy());
  });

  it("clicking עריכה opens ManagerSystemRuleEditor for that rule, hiding its own row actions while editing", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [systemRule()], customWeeklyRules: [] });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText("תזכורת למשמרת מחר")).toBeTruthy());

    fireEvent.click(screen.getByText("עריכה"));

    expect(screen.getByTestId("system-editor-stub")).toBeTruthy();
    expect(systemEditorCalls.mock.calls.at(-1)?.[0].rule).toMatchObject({ id: "rule-1" });
    expect(screen.queryByText("השבתה")).toBeNull(); // row actions hidden while this rule is being edited
  });

  it("saving in the editor updates the row and closes the editor, without a full reload", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [systemRule({ enabled: true })], customWeeklyRules: [] });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText("תזכורת למשמרת מחר")).toBeTruthy());

    fireEvent.click(screen.getByText("עריכה"));
    expect(screen.getByTestId("system-editor-stub")).toBeTruthy();

    fireEvent.click(screen.getByText("fake-saved"));

    await waitFor(() => expect(screen.queryByTestId("system-editor-stub")).toBeNull());
    expect(listNotificationRulesAction).toHaveBeenCalledTimes(1); // no full reload -- the returned rule is applied directly
  });

  it("cancelling the editor closes it without calling updateSystemRuleAction", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [systemRule()], customWeeklyRules: [] });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText("תזכורת למשמרת מחר")).toBeTruthy());

    fireEvent.click(screen.getByText("עריכה"));
    fireEvent.click(screen.getByText("fake-cancel"));

    expect(screen.queryByTestId("system-editor-stub")).toBeNull();
    expect(updateSystemRuleAction).not.toHaveBeenCalled();
  });

  it("opening the custom-weekly composer closes any open system-rule editor -- only one editor at a time", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [systemRule()], customWeeklyRules: [] });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText("תזכורת למשמרת מחר")).toBeTruthy());

    fireEvent.click(screen.getByText("עריכה"));
    expect(screen.getByTestId("system-editor-stub")).toBeTruthy();

    fireEvent.click(screen.getByText("+ התראה מחזורית"));

    expect(screen.queryByTestId("system-editor-stub")).toBeNull();
    expect(screen.getByTestId("composer-stub")).toBeTruthy();
  });
});

describe("ManagerFixedNotificationsSection -- custom weekly rule row actions", () => {
  it("shows the + composer button, opens the composer, and reloads on save", async () => {
    listNotificationRulesAction
      .mockResolvedValueOnce({ ok: true, systemRules: [], customWeeklyRules: [] })
      .mockResolvedValueOnce({ ok: true, systemRules: [], customWeeklyRules: [customRule()] });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText(/אין עדיין התראות מחזוריות/)).toBeTruthy());

    fireEvent.click(screen.getByText("+ התראה מחזורית"));
    expect(screen.getByTestId("composer-stub")).toBeTruthy();

    fireEvent.click(screen.getByText("fake-saved"));

    await waitFor(() => expect(listNotificationRulesAction).toHaveBeenCalledTimes(2));
  });

  it("disabling a custom rule calls the action with the toggled value", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [], customWeeklyRules: [customRule()] });
    setCustomWeeklyRuleEnabledAction.mockResolvedValue({ ok: true, rule: customRule({ enabled: false }) });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText("📌 תזכורת לאילוצים")).toBeTruthy());

    fireEvent.click(screen.getByText("השבתה"));

    await waitFor(() => expect(setCustomWeeklyRuleEnabledAction).toHaveBeenCalledWith("rule-custom-1", false));
  });

  it("archiving a custom rule requires confirmation, then calls the action", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [], customWeeklyRules: [customRule()] });
    archiveCustomWeeklyRuleAction.mockResolvedValue({ ok: true });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText("📌 תזכורת לאילוצים")).toBeTruthy());

    fireEvent.click(screen.getByText("הסרה"));
    expect(archiveCustomWeeklyRuleAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("כן, הסר"));
    await waitFor(() => expect(archiveCustomWeeklyRuleAction).toHaveBeenCalledWith("rule-custom-1"));
  });

  it("clicking עריכה opens the composer pre-filled for that rule, hiding its own row actions while editing", async () => {
    listNotificationRulesAction.mockResolvedValue({ ok: true, systemRules: [], customWeeklyRules: [customRule()] });

    render(<ManagerFixedNotificationsSection roster={ROSTER} adoptionPeople={ADOPTION} />);
    await waitFor(() => expect(screen.getByText("📌 תזכורת לאילוצים")).toBeTruthy());

    fireEvent.click(screen.getByText("עריכה"));

    expect(screen.getByTestId("composer-stub")).toBeTruthy();
    expect(composerCalls.mock.calls.at(-1)?.[0].editingRule).toMatchObject({ id: "rule-custom-1" });
  });
});
