import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ScheduledBroadcastView } from "@/lib/notifications/scheduledBroadcastActions";

const listActiveScheduledBroadcastsAction = vi.fn();
const sendScheduledBroadcastNowAction = vi.fn();
const cancelScheduledBroadcastAction = vi.fn();

vi.mock("@/lib/notifications/scheduledBroadcastActions", () => ({
  listActiveScheduledBroadcastsAction: (...args: unknown[]) => listActiveScheduledBroadcastsAction(...args),
  sendScheduledBroadcastNowAction: (...args: unknown[]) => sendScheduledBroadcastNowAction(...args),
  cancelScheduledBroadcastAction: (...args: unknown[]) => cancelScheduledBroadcastAction(...args),
}));

const { ManagerScheduledBroadcastsSection } = await import("./ManagerScheduledBroadcastsSection");

afterEach(() => {
  cleanup();
  listActiveScheduledBroadcastsAction.mockReset();
  sendScheduledBroadcastNowAction.mockReset();
  cancelScheduledBroadcastAction.mockReset();
});

function item(overrides: Partial<ScheduledBroadcastView> = {}): ScheduledBroadcastView {
  return {
    id: "sb_1",
    status: "scheduled",
    audienceKind: "everyone",
    targetPersonIds: ["p_a", "p_b"],
    audienceGroupKeys: [],
    excludedPersonIds: [],
    title: "עדכון חשוב",
    body: "תוכן",
    scheduledFor: "2026-08-23T17:00:00.000Z",
    scheduledLocalDate: "2026-08-23",
    scheduledLocalMinuteOfDay: 20 * 60,
    createdByPersonName: "דני מנהל",
    lastChangedByPersonName: null,
    ...overrides,
  };
}

describe("ManagerScheduledBroadcastsSection", () => {
  it("renders nothing while there are no active scheduled broadcasts", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [] });
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("🕒 התראות מתוזמנות")).toBeNull();
  });

  it("lists an active item with its human-readable moment and audience summary", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item()] });
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("🕒 התראות מתוזמנות")).toBeInTheDocument());
    expect(screen.getByText("עדכון חשוב")).toBeInTheDocument();
    expect(screen.getByText(/כולם/)).toBeInTheDocument();
    expect(screen.getByText(/דני מנהל/)).toBeInTheDocument();
  });

  it("renders '🕒 התראות מתוזמנות' as an h3, not an h4 (Phase 3 heading-hierarchy fix: this now nests under the תזמון tab's own h2)", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item()] });
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 3, name: "🕒 התראות מתוזמנות" })).toBeInTheDocument(),
    );
  });

  it("hides עריכה/שלח עכשיו/ביטול once the item is no longer editable ('claimed')", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item({ status: "claimed" })] });
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("עדכון חשוב")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "עריכה" })).toBeNull();
    expect(screen.queryByRole("button", { name: "שלח עכשיו" })).toBeNull();
  });

  it("hides עריכה/שלח עכשיו/ביטול for the item CURRENTLY being edited, and shows a visible editing indicator instead", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item({ id: "sb_1" })] });
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId="sb_1" onEdit={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("עדכון חשוב")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "עריכה" })).toBeNull();
    expect(screen.queryByRole("button", { name: "שלח עכשיו" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ביטול" })).toBeNull();
    expect(screen.getByText("✏️ בעריכה כעת")).toBeInTheDocument();
    expect(screen.getByText(/שמור\/י או בטל\/י את העריכה/)).toBeInTheDocument();
  });

  it("editing ONE item never disables actions on a DIFFERENT item in the same list", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({
      ok: true,
      items: [item({ id: "sb_1", title: "הראשונה" }), item({ id: "sb_2", title: "השנייה" })],
    });
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId="sb_1" onEdit={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("השנייה")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: "עריכה" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "שלח עכשיו" })).toHaveLength(1);
  });

  it("'עריכה' hands the item up to the parent", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item()] });
    const onEdit = vi.fn();
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={onEdit} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "עריכה" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "עריכה" }));
    expect(onEdit).toHaveBeenCalledWith(item());
  });

  it("'שלח עכשיו' calls the action and refreshes on success", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item()] });
    sendScheduledBroadcastNowAction.mockResolvedValue({ ok: true, batchId: "batch_1", resolvedRecipientCount: 2 });
    const onChanged = vi.fn();
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={onChanged} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "שלח עכשיו" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "שלח עכשיו" }));

    await waitFor(() => expect(sendScheduledBroadcastNowAction).toHaveBeenCalledWith("sb_1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("shows a truthful inline error when send-now races a worker claim", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item()] });
    sendScheduledBroadcastNowAction.mockResolvedValue({ ok: false, error: "already_started" });
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "שלח עכשיו" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "שלח עכשיו" }));

    expect(await screen.findByText("השליחה כבר התחילה, ולא ניתן עוד לפעול על התזמון הזה.")).toBeInTheDocument();
  });

  it("the inline send-now error exposes role=alert", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item()] });
    sendScheduledBroadcastNowAction.mockResolvedValue({ ok: false, error: "already_started" });
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "שלח עכשיו" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "שלח עכשיו" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("'ביטול' requires an explicit confirmation before cancelling", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item()] });
    cancelScheduledBroadcastAction.mockResolvedValue({ ok: true });
    const onChanged = vi.fn();
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={onChanged} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "ביטול" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(cancelScheduledBroadcastAction).not.toHaveBeenCalled();
    expect(screen.getByText("לבטל את התזמון?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "כן, בטל" }));
    await waitFor(() => expect(cancelScheduledBroadcastAction).toHaveBeenCalledWith("sb_1"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("declining the cancel confirmation never calls the action", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item()] });
    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "ביטול" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    fireEvent.click(screen.getByRole("button", { name: "לא" }));

    expect(cancelScheduledBroadcastAction).not.toHaveBeenCalled();
    expect(screen.queryByText("לבטל את התזמון?")).toBeNull();
  });

  it("re-fetches when reloadToken changes", async () => {
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [] });
    const { rerender } = render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1));

    rerender(<ManagerScheduledBroadcastsSection reloadToken={1} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />);
    await waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(2));
  });
});

describe("ManagerScheduledBroadcastsSection -- background polling (spec §7)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports active=true and polls again after ~17s while there is at least one active item", async () => {
    vi.useFakeTimers();
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item()] });
    const onActiveChange = vi.fn();
    render(
      <ManagerScheduledBroadcastsSection
        reloadToken={0}
        editingId={null}
        onEdit={vi.fn()}
        onChanged={vi.fn()}
        onActiveChange={onActiveChange}
      />,
    );

    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);

    // Never polls again before the interval elapses -- no overlapping requests.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(2);
  });

  it("stops polling (and reports active=false) once the list becomes empty", async () => {
    vi.useFakeTimers();
    listActiveScheduledBroadcastsAction.mockResolvedValueOnce({ ok: true, items: [item()] });
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [] });
    const onActiveChange = vi.fn();
    render(
      <ManagerScheduledBroadcastsSection
        reloadToken={0}
        editingId={null}
        onEdit={vi.fn()}
        onChanged={vi.fn()}
        onActiveChange={onActiveChange}
      />,
    );

    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(17_000);
    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(2));
    expect(onActiveChange).toHaveBeenLastCalledWith(false);

    // No further polling once empty -- advancing well past another interval calls nothing more.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(2);
  });

  it("clears the pending poll timer on unmount -- no leaked timer keeps firing after the manager navigates away", async () => {
    vi.useFakeTimers();
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item()] });
    const { unmount } = render(
      <ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />,
    );

    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1));
    unmount();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1);
  });

  it("a poll tick never disrupts the item currently being edited -- editingId/composer state is untouched by a background refresh", async () => {
    vi.useFakeTimers();
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: true, items: [item({ id: "sb_1" })] });
    render(
      <ManagerScheduledBroadcastsSection reloadToken={0} editingId="sb_1" onEdit={vi.fn()} onChanged={vi.fn()} />,
    );

    await vi.waitFor(() => expect(screen.getByText("✏️ בעריכה כעת")).toBeInTheDocument());
    await vi.advanceTimersByTimeAsync(17_000);
    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(2));

    // Still shows the same editing indicator -- the poll re-fetched the list but never reset editingId itself (that's parent-owned).
    expect(screen.getByText("✏️ בעריכה כעת")).toBeInTheDocument();
  });
});

describe("ManagerScheduledBroadcastsSection -- polling survives a transient failure (fix for a resilience bug)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("1 & 5. an active list, then a throw on the next poll, still schedules exactly one retry later -- no overlapping requests", async () => {
    vi.useFakeTimers();
    listActiveScheduledBroadcastsAction
      .mockResolvedValueOnce({ ok: true, items: [item()] })
      .mockRejectedValueOnce(new Error("network hiccup"))
      .mockResolvedValue({ ok: true, items: [item()] });

    render(<ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />);

    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(17_000);
    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(2)); // the throwing poll

    // Never a second concurrent call before the retry interval elapses.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(8_000);
    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(3)); // the recovery retry
  });

  it("2 & 7. a transient failure never calls onActiveChange(false) -- the last known active state (and therefore recent-sends polling) is preserved", async () => {
    vi.useFakeTimers();
    listActiveScheduledBroadcastsAction
      .mockResolvedValueOnce({ ok: true, items: [item()] })
      .mockRejectedValueOnce(new Error("network hiccup"));
    const onActiveChange = vi.fn();

    render(
      <ManagerScheduledBroadcastsSection
        reloadToken={0}
        editingId={null}
        onEdit={vi.fn()}
        onChanged={vi.fn()}
        onActiveChange={onActiveChange}
      />,
    );

    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1));
    expect(onActiveChange).toHaveBeenLastCalledWith(true);

    await vi.advanceTimersByTimeAsync(17_000);
    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(2));

    // Still the last call is "true" -- the throw never downgraded it to false.
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
    expect(onActiveChange).not.toHaveBeenCalledWith(false);
  });

  it("3. after the transient failure, a later successful EMPTY result correctly reports false and stops polling", async () => {
    vi.useFakeTimers();
    listActiveScheduledBroadcastsAction
      .mockResolvedValueOnce({ ok: true, items: [item()] })
      .mockRejectedValueOnce(new Error("network hiccup"))
      .mockResolvedValue({ ok: true, items: [] });
    const onActiveChange = vi.fn();

    render(
      <ManagerScheduledBroadcastsSection
        reloadToken={0}
        editingId={null}
        onEdit={vi.fn()}
        onChanged={vi.fn()}
        onActiveChange={onActiveChange}
      />,
    );

    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(17_000);
    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(2)); // throws
    await vi.advanceTimersByTimeAsync(17_000);
    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(3)); // empty, real answer

    expect(onActiveChange).toHaveBeenLastCalledWith(false);

    // No further polling once genuinely empty.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(3);
  });

  it("4. an INITIAL load failure (nothing has ever succeeded yet) still retries and can recover to an active list without a manual refresh", async () => {
    vi.useFakeTimers();
    listActiveScheduledBroadcastsAction
      .mockRejectedValueOnce(new Error("network hiccup on first load"))
      .mockResolvedValue({ ok: true, items: [item()] });
    const onActiveChange = vi.fn();

    render(
      <ManagerScheduledBroadcastsSection
        reloadToken={0}
        editingId={null}
        onEdit={vi.fn()}
        onChanged={vi.fn()}
        onActiveChange={onActiveChange}
      />,
    );

    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1));
    expect(onActiveChange).not.toHaveBeenCalledWith(false);
    expect(screen.queryByText("🕒 התראות מתוזמנות")).toBeNull();

    await vi.advanceTimersByTimeAsync(17_000);
    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(screen.getByText("🕒 התראות מתוזמנות")).toBeInTheDocument());
    expect(onActiveChange).toHaveBeenLastCalledWith(true);
  });

  it("6. clears the retry timer on unmount just like the normal poll timer", async () => {
    vi.useFakeTimers();
    listActiveScheduledBroadcastsAction.mockRejectedValue(new Error("always fails"));
    const { unmount } = render(
      <ManagerScheduledBroadcastsSection reloadToken={0} editingId={null} onEdit={vi.fn()} onChanged={vi.fn()} />,
    );

    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1));
    unmount();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1);
  });

  it("a typed, permanent ok:false result (e.g. forbidden) still stops polling and reports inactive -- only an unknown/thrown failure is treated as transient", async () => {
    vi.useFakeTimers();
    listActiveScheduledBroadcastsAction.mockResolvedValue({ ok: false, error: "forbidden" });
    const onActiveChange = vi.fn();

    render(
      <ManagerScheduledBroadcastsSection
        reloadToken={0}
        editingId={null}
        onEdit={vi.fn()}
        onChanged={vi.fn()}
        onActiveChange={onActiveChange}
      />,
    );

    await vi.waitFor(() => expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1));
    expect(onActiveChange).toHaveBeenLastCalledWith(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(listActiveScheduledBroadcastsAction).toHaveBeenCalledTimes(1);
  });
});
