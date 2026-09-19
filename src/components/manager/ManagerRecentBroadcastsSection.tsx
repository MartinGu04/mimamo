"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Panel } from "@/components/ui/Panel";
import { formatDeliveryDurationSeconds, formatJerusalemDateTime } from "@/lib/notifications/broadcastTiming";
import { getRecentManagerBroadcastsAction, type RecentManagerBroadcastView } from "@/lib/notifications/manualBroadcastActions";

interface ManagerRecentBroadcastsSectionProps {
  /** Bumped by the parent after any dispatch (immediate send, or a scheduled broadcast's "שלח עכשיו"/worker dispatch) so this list stays current. */
  reloadToken: number;
  /**
   * Whether there is currently at least one active (not-yet-dispatched)
   * scheduled broadcast -- this section only polls while that's true (spec
   * §7: "while there are active scheduled broadcasts"), since a background
   * worker dispatch is the only kind of change that could land here WITHOUT
   * this manager's own action already bumping `reloadToken`. The caller
   * decides how it knows this: inside the standalone Notification Center
   * ("מרכז התראות"), `ManagerScheduledBroadcastsSection` lives on a
   * DIFFERENT URL section ("תזמון", never mounted alongside "היסטוריה"), so
   * `NotificationHistorySection` (`components/notifications/`) derives this
   * itself via the SAME underlying `listActiveScheduledBroadcastsAction()`
   * signal rather than reading it off a live sibling component.
   */
  pollWhileActive: boolean;
}

/** Same ~15-20s cadence as `ManagerScheduledBroadcastsSection`'s own poll (spec §7). */
const POLL_INTERVAL_MS = 17_000;

/**
 * The eventual-consistency follow-up: after PR #85, a manual "Send Now"
 * Server Action returns as soon as the batch/jobs are durably created,
 * kicking `runDelivery()` in the background via `after()` -- so a
 * `reloadToken` bump from that same send can land HERE a fraction of a
 * second before `notification_deliveries.status = 'sent'` exists yet. Without
 * this, the manager would see "ממתין לשליחה" and have to wait for the
 * next ~17s poll (or manually refresh) to see it flip to "נשלח". Instead,
 * a `reloadToken` change (never the initial mount, never a bare
 * `pollWhileActive` flip) arms a SHORT, BOUNDED quick-retry window: as long
 * as we're still inside it AND at least one push-capable item is still
 * `deliveryState: "pending"`, the next poll fires at this fast interval
 * instead of the normal ~17s one. The window self-expires
 * (`QUICK_FOLLOW_UP_WINDOW_MS`) regardless of outcome -- this can NEVER
 * become permanent rapid polling; once it ends (resolved or timed out) this
 * falls straight back to the normal `pollWhileActive`-gated cadence, same
 * as before this feature existed.
 */
const QUICK_FOLLOW_UP_INTERVAL_MS = 1_500;
/** Hard stop for the quick-retry window -- see `QUICK_FOLLOW_UP_INTERVAL_MS`'s own docstring. */
const QUICK_FOLLOW_UP_WINDOW_MS = 12_000;

/** Whether `item` is one the quick follow-up window should keep chasing -- a push-capable recipient set whose delivery hasn't resolved (sent, permanently failed, or never had a push-capable recipient to begin with) yet. */
function isUnresolvedPushCapable(item: RecentManagerBroadcastView): boolean {
  return item.pushCapableCount > 0 && item.deliveryState === "pending";
}

/** Cards shown by default before "הצג עוד (N)" is needed -- presentation-only, never affects how much the server returns. */
const COMPACT_VISIBLE_COUNT = 3;

/**
 * Namespaced so it can never collide with an unrelated key -- deliberately
 * a single scalar ISO cutoff, not an ever-growing list of hidden ids (see
 * `readClearedBeforeIso`/`writeClearedBeforeIso` below for the exact
 * semantics). Device/browser-local only, V1 -- no backend table/migration
 * to sync this visual preference across devices.
 */
const CLEARED_BEFORE_STORAGE_KEY = "mi-ma-mo:manager-recent-broadcasts:cleared-before";

/**
 * Reads the "נקה מהתצוגה" cutoff, if any. Fails safe on every possible way
 * this can go wrong (no `window`/SSR, storage unavailable -- private mode,
 * quota, disabled -- or a malformed/garbage stored value that doesn't even
 * parse as a date): all of these return `null`, which means "no cutoff,
 * show normal history" -- never a thrown error, never an accidental
 * over-hide from garbage input.
 *
 * Re-canonicalizes a valid stored value through `Date.parse` ->
 * `new Date(ms).toISOString()` before returning it, so downstream
 * comparisons never need to re-derive this -- see this file's own
 * "chronological, not lexicographic" note above `parseCreatedAtMs`.
 */
function readClearedBeforeIso(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CLEARED_BEFORE_STORAGE_KEY);
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const parsedMs = Date.parse(raw);
    if (Number.isNaN(parsedMs)) return null;
    return new Date(parsedMs).toISOString();
  } catch {
    return null;
  }
}

/** Best-effort persistence -- a write failure (private mode, quota) must never break the page; the clear still applies to this render via React state, it just won't survive a reload. */
function writeClearedBeforeIso(iso: string): void {
  try {
    window.localStorage.setItem(CLEARED_BEFORE_STORAGE_KEY, iso);
  } catch {
    // Intentionally ignored -- see docstring above.
  }
}

/**
 * CHRONOLOGICAL, not lexicographic. `createdAt` (both from the server and
 * from a stored cutoff) is a valid ISO-8601 timestamp, but two valid ISO
 * timestamps can use different textual representations for the SAME or a
 * differently-ordered instant -- e.g. "2026-08-21T10:00:00+03:00" (07:00Z)
 * sorts AFTER "2026-08-21T08:00:00.000Z" (08:00Z) as plain strings despite
 * being chronologically EARLIER. Every cutoff comparison in this file goes
 * through this parser (epoch milliseconds) rather than `>`/`<` on the raw
 * strings, specifically to avoid that class of bug. Returns `null` for
 * anything that doesn't parse -- callers fail OPEN on that (never hide a
 * row merely because ITS OWN timestamp happens to be malformed; only a
 * malformed STORED CUTOFF fails closed to "no cutoff" -- see
 * `readClearedBeforeIso`).
 */
function parseCreatedAtMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function audienceLabel(item: RecentManagerBroadcastView): string {
  if (item.audienceKind === "everyone") return "כולם";
  return `${item.resolvedRecipientCount} אנשי צוות`;
}

/** A small, truthful fallback for the timing row's last segment when `firstSuccessfulPushAt` is null -- see `RecentManagerBroadcastView.deliveryState`'s own docstring for exactly what each state proves. Never invents a "sent" time. */
function fallbackDeliveryLabel(deliveryState: RecentManagerBroadcastView["deliveryState"] | undefined): string {
  switch (deliveryState) {
    case "no_push_recipients":
      return "ללא Push";
    case "failed":
      return "שליחת Push נכשלה";
    default:
      // Covers "pending" and any unexpected/undefined value -- fails open
      // toward "still working on it" rather than ever claiming a terminal
      // outcome (success OR failure) that hasn't actually been proven.
      return "ממתין לשליחה";
  }
}

/**
 * The compact second row: "נוצר DD/MM HH:mm · [תוכנן ל־DD/MM HH:mm ·] נשלח
 * DD/MM HH:mm · Ns" for a resolved delivery, or the same "נוצר"/"תוכנן ל"
 * prefix plus a truthful fallback label when nothing has successfully
 * delivered yet. Every timestamp includes the calendar date (never just a
 * bare clock time) so a broadcast crossing midnight -- created one day,
 * scheduled/sent the next -- is never misread as same-day. `נוצר` displays
 * `scheduleCreatedAt` when this batch came from a scheduled broadcast (the
 * ORIGINAL schedule-creation instant, per the spec's own worked examples),
 * falling back to the batch's own `createdAt` for an immediate broadcast --
 * see `RecentManagerBroadcastView.createdAt`'s own docstring for why that
 * field's SORTING/clear-cutoff semantics are never touched by this swap.
 * The latency DURATION (`formatDeliveryDurationSeconds`) is a pure elapsed
 * span, not an instant -- it never carries a date, and is deliberately
 * untouched by this date/time formatting.
 *
 * Each `formatJerusalemDateTime` result ("DD/MM HH:mm") is two adjacent
 * numeric groups with no strong-direction character of its own -- inside
 * this RTL row the bidi algorithm can reorder them against each other (same
 * class of risk `TimeRange`/`IssueRow` isolate elsewhere in this app), so
 * every one of those chunks renders inside its own `dir="ltr"` span. This
 * returns `ReactNode`, not a plain string, specifically to carry those
 * isolated spans -- the concatenated text content is byte-identical to the
 * old plain-string result, so this is a pure rendering change.
 */
function TimingLine({ item }: { item: RecentManagerBroadcastView }): ReactNode {
  const createdDisplayIso = item.scheduleCreatedAt ?? item.createdAt;
  const segments: ReactNode[] = [
    <span key="created">
      {"נוצר "}
      <span dir="ltr">{formatJerusalemDateTime(createdDisplayIso)}</span>
    </span>,
  ];
  if (item.scheduledFor) {
    segments.push(
      <span key="scheduled">
        {"תוכנן ל־"}
        <span dir="ltr">{formatJerusalemDateTime(item.scheduledFor)}</span>
      </span>,
    );
  }

  // Loose (`!=`) nullish checks, deliberately: an item shaped by an older
  // caller/fixture that PREDATES these fields has them as `undefined`
  // (missing), not `null` -- must be treated identically to "no data",
  // never mistaken for a truthy `firstSuccessfulPushAt` value.
  if (item.firstSuccessfulPushAt != null && item.deliveryLatencySeconds != null) {
    segments.push(
      <span key="sent">
        {"נשלח "}
        <span dir="ltr">{formatJerusalemDateTime(item.firstSuccessfulPushAt)}</span>
      </span>,
    );
    segments.push(<span key="duration">{formatDeliveryDurationSeconds(item.deliveryLatencySeconds)}</span>);
  } else {
    segments.push(<span key="fallback">{fallbackDeliveryLabel(item.deliveryState)}</span>);
  }

  const nodes: ReactNode[] = [];
  segments.forEach((segment, index) => {
    if (index > 0) nodes.push(" · ");
    nodes.push(segment);
  });
  return nodes;
}

/**
 * "נשלחו לאחרונה" -- reuses PR #78's own `getRecentManagerBroadcastsAction`
 * (a small, bounded read of `manager_notification_batches`, already
 * manager-gated and already tested) rather than building a second
 * history/archive system (spec §6). A scheduled broadcast that has
 * dispatched becomes an ordinary batch row here automatically -- nothing
 * scheduling-specific needs to be added to this query.
 *
 * PR #81 adds purely PRESENTATIONAL cleanup on top of that same bounded
 * server list (still capped at `RECENT_MANAGER_BROADCASTS_LIMIT` = 10,
 * never a second page/fetch):
 * - shows only the latest `COMPACT_VISIBLE_COUNT` by default, with a
 *   "הצג עוד (N)" / "הצג פחות" toggle over whatever is already loaded;
 * - "נקה מהתצוגה" hides everything currently loaded from THIS view,
 *   persisted as a single ISO cutoff in localStorage (`readClearedBeforeIso`/
 *   `writeClearedBeforeIso`) -- visual only, NEVER a write/delete against
 *   `manager_notification_batches` or any other table. A later poll that
 *   returns a genuinely newer batch (`createdAt` after the cutoff)
 *   reappears automatically; anything at or before the cutoff stays
 *   hidden even after a poll re-fetches it.
 */
export function ManagerRecentBroadcastsSection({ reloadToken, pollWhileActive }: ManagerRecentBroadcastsSectionProps) {
  const [items, setItems] = useState<RecentManagerBroadcastView[] | null>(null);
  // Mirrors `items` for synchronous reads inside the poll effect below
  // (never itself read for rendering) -- a `ref`, so reading it inside the
  // effect body never needs to appear in that effect's own dependency
  // array (unlike the `items` state variable, which triggers on every
  // `setItems` call and would defeat the whole point of a chained-timeout
  // poll if it were a dependency).
  const itemsRef = useRef<RecentManagerBroadcastView[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Lazy initializer -- `typeof window === "undefined"` during any SSR
  // pass (returns null there), the real stored value on the client's
  // first render. Never a hydration mismatch: `items` is still `null` at
  // that exact same first render regardless (the fetch below only
  // resolves after mount), so this section renders nothing on both the
  // server and the client's first pass no matter what this value is.
  const [clearedBeforeIso, setClearedBeforeIso] = useState<string | null>(() => readClearedBeforeIso());

  // Always loads once on mount / whenever `reloadToken` bumps (a manager's
  // own action elsewhere). The chained setTimeout re-fetch beyond that is
  // gated entirely on `pollWhileActive` -- re-armed after each successful
  // load only while it's still true, so this stops polling the instant
  // `ManagerScheduledBroadcastsSection` reports no active items left
  // (spec §7's "pause when there are no active schedules"). Chaining
  // (never setInterval) keeps overlapping requests structurally
  // impossible, same reasoning as the scheduled section's own poll.
  //
  // A THROWN failure (network hiccup, transient 5xx, ...) is deliberately
  // NOT treated as "stop polling" while `pollWhileActive` is true -- same
  // reasoning as `ManagerScheduledBroadcastsSection`'s own fix: "unknown"
  // is not "empty", so this retries on the next normal interval rather
  // than dying silently until an unrelated `reloadToken`/`pollWhileActive`
  // change happens to resurrect it. Only a typed `result.ok === false`
  // (a genuinely permanent manager-auth state -- see
  // `loadManagerPersonnelContext`'s own docs for why that union can never
  // include a transient `configuration_error`) stops scheduling further
  // polls. Whenever `pollWhileActive` is false, no retry is ever
  // scheduled either way -- this section simply stays quiet until the
  // scheduled section reports active items again.
  //
  // Neither `expanded` nor `clearedBeforeIso` is ever touched by this
  // effect -- a poll can only ever change WHICH raw rows `items` holds,
  // never the manager's own view/clear preferences layered on top.
  //
  // Tracks the LAST `reloadToken` this effect actually ran for, across
  // renders -- distinct from React state, since it must never itself
  // trigger a re-render. `undefined` only on this component's very first
  // ever effect run (initial mount, not "a manager action").
  const previousReloadTokenRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Armed (a real deadline, not null) only when THIS effect run was
    // caused by `reloadToken` actually changing -- never the initial
    // mount, and never a bare `pollWhileActive` flip with `reloadToken`
    // unchanged. See `QUICK_FOLLOW_UP_INTERVAL_MS`'s own module-level
    // docstring for why this exists and how it stays bounded.
    const isReloadTriggeredByAction =
      previousReloadTokenRef.current !== undefined && previousReloadTokenRef.current !== reloadToken;
    previousReloadTokenRef.current = reloadToken;
    let quickFollowUpDeadlineMs: number | null = isReloadTriggeredByAction ? Date.now() + QUICK_FOLLOW_UP_WINDOW_MS : null;
    // The most recently loaded items WITHIN this effect's own chain --
    // seeded from `itemsRef` (never the `items` state variable itself,
    // which would be a stale closure across chained `setTimeout`/`load()`
    // calls -- `setItems` doesn't update this effect's captured binding),
    // so a transient failure on the very FIRST call of a fresh chain still
    // has last-known data to fall back on.
    let latestItemsSnapshot: RecentManagerBroadcastView[] | null = itemsRef.current;

    // Chooses the next poll delay after a successful (or failed-but-
    // recoverable) load: the fast quick-follow-up interval while still
    // inside an armed window AND something genuinely unresolved remains,
    // otherwise the normal cadence (or none at all, matching this
    // section's existing `pollWhileActive` gating exactly). Always a
    // single chained `setTimeout` -- never a second concurrent timer --
    // so a quick-follow-up retry and the normal poll can never overlap.
    function scheduleNextLoad(latestItems: RecentManagerBroadcastView[] | null) {
      const stillUnresolved = latestItems !== null && latestItems.some(isUnresolvedPushCapable);
      const inQuickWindow = quickFollowUpDeadlineMs !== null && Date.now() < quickFollowUpDeadlineMs;

      if (inQuickWindow && stillUnresolved) {
        timeoutId = setTimeout(load, QUICK_FOLLOW_UP_INTERVAL_MS);
        return;
      }
      quickFollowUpDeadlineMs = null;
      if (pollWhileActive) {
        timeoutId = setTimeout(load, POLL_INTERVAL_MS);
      }
    }

    async function load() {
      try {
        const result = await getRecentManagerBroadcastsAction();
        if (cancelled) return;
        if (result.ok) {
          setItems(result.items);
          itemsRef.current = result.items;
          latestItemsSnapshot = result.items;
          scheduleNextLoad(result.items);
        } else {
          // A typed `result.ok === false` is a genuinely PERMANENT
          // manager-auth state (`forbidden`, `unauthenticated`,
          // `unmapped`, `ambiguous_identity`, `missing_email` -- the
          // only statuses `loadManagerPersonnelContext` can ever
          // return), unlike a thrown failure. Fails closed: any
          // previously-loaded items are cleared rather than left
          // showing stale data the caller may no longer be authorized to
          // see, and no retry is scheduled -- retrying wouldn't change a
          // permanent state anyway (this also ends any in-progress quick
          // follow-up window, same as a genuine resolution would).
          setItems(null);
          itemsRef.current = null;
        }
      } catch {
        if (!cancelled) {
          // Deliberately no early return / state wipe here -- `items`
          // (if anything was already loaded) is left completely
          // untouched, so a transient failure never makes an already-
          // visible "נשלחו לאחרונה" list disappear. Reuses the SAME
          // `scheduleNextLoad` as a success, from `latestItemsSnapshot`
          // (this effect's own last-known-good items, never the possibly-
          // stale `items` React state closure) -- so a transient hiccup
          // DURING an armed quick-follow-up window still retries at the
          // fast interval (still bounded by the same deadline) instead of
          // silently falling back to the slow cadence.
          scheduleNextLoad(latestItemsSnapshot);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [reloadToken, pollWhileActive]);

  function handleClear() {
    if (!items || items.length === 0) return;
    // The newest createdAt among what's CURRENTLY LOADED (never the
    // client's own clock -- clock drift must not accidentally hide a
    // genuinely future/just-created broadcast), compared CHRONOLOGICALLY
    // (see `parseCreatedAtMs`'s own docstring) -- never assumes the
    // store's own newest-first ordering, and never assumes every
    // timestamp shares one textual representation.
    const maxMs = items.reduce((max, item) => {
      const ms = parseCreatedAtMs(item.createdAt);
      return ms !== null && ms > max ? ms : max;
    }, Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(maxMs)) return; // every loaded item had an unparseable createdAt -- nothing sane to cut off, fail safe by doing nothing
    const cutoffIso = new Date(maxMs).toISOString();
    writeClearedBeforeIso(cutoffIso);
    setClearedBeforeIso(cutoffIso);
  }

  // A transient background-poll failure must never hide already-loaded
  // items (see the effect's own docstring above) -- there is no error
  // state to gate on here at all, deliberately. `items === null`
  // (nothing has ever loaded successfully yet, including right after an
  // initial failure) and a genuine successful empty result both still
  // render nothing, exactly as before.
  if (items === null) return null;

  // Hide anything at or before the cutoff (spec: `createdAt <= cutoff` is
  // hidden) -- purely a client-side view filter over the same bounded
  // server list, never a second fetch/page. Compared CHRONOLOGICALLY, not
  // as strings (see `parseCreatedAtMs`) -- an item whose OWN `createdAt`
  // fails to parse fails OPEN (stays visible) rather than being silently
  // hidden by a bad comparison.
  const cutoffMs = clearedBeforeIso === null ? null : parseCreatedAtMs(clearedBeforeIso);
  const visibleItems =
    cutoffMs === null
      ? items
      : items.filter((item) => {
          const itemMs = parseCreatedAtMs(item.createdAt);
          return itemMs === null || itemMs > cutoffMs;
        });

  if (visibleItems.length === 0) return null;

  const displayedItems = expanded ? visibleItems : visibleItems.slice(0, COMPACT_VISIBLE_COUNT);
  const remainingCount = visibleItems.length - COMPACT_VISIBLE_COUNT;

  return (
    <Panel variant="compact" data-testid="manager-recent-broadcasts">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">נשלחו לאחרונה</h3>
        <button
          type="button"
          onClick={handleClear}
          title="הסתרה מהתצוגה במכשיר זה בלבד -- ההיסטוריה בשרת לא נמחקת"
          className="rounded-full bg-overlay-soft px-2.5 py-1 text-xs font-medium text-muted ring-1 ring-border hover:bg-overlay-strong"
        >
          נקה מהתצוגה
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {displayedItems.map((item) => (
          <li key={item.id} className="rounded-lg bg-overlay-faint p-2.5 ring-1 ring-border">
            <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
            <p className="mt-0.5 text-xs text-muted">
              {audienceLabel(item)} · נשלח ע״י {item.createdByPersonName}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              <TimingLine item={item} />
            </p>
          </li>
        ))}
      </ul>
      {!expanded && remainingCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-xs font-medium text-primary hover:underline"
        >
          {`הצג עוד (${remainingCount})`}
        </button>
      ) : expanded && visibleItems.length > COMPACT_VISIBLE_COUNT ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-2 text-xs font-medium text-primary hover:underline"
        >
          הצג פחות
        </button>
      ) : null}
    </Panel>
  );
}
