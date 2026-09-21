"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Smartphone } from "lucide-react";
import {
  listNotificationDevicesAction,
  removeNotificationDeviceAction,
} from "@/lib/notifications/actions";
import type { OwnedPushDevice } from "@/lib/notifications/deviceTypes";
import { buildPushDeviceLabel } from "@/lib/notifications/deviceLabel";
import { formatRecentChangeRelativeTime } from "@/lib/presentation/relativeChangeTime";
import { EXPAND_HIT_AREA_CLASS } from "@/components/ui/hitArea";
import { usePushDevice } from "./PushDeviceProvider";

/**
 * `"idle"` doubles as "loading" on purpose. The alternative -- a
 * synchronous `setStatus("loading")` at the top of `load()` -- would be a
 * `setState` inside an effect body, which this project's stricter React
 * Hooks lint rules reject (and `usePushSubscription` already avoids the
 * same way: never touch state before the first `await`). A reload after
 * a removal deliberately keeps the already-rendered rows in place; the
 * row being acted on shows its own pending state.
 */
type LoadStatus = "idle" | "ready" | "error";

/**
 * "המכשירים שלי" -- the device-management subsection of the bell's
 * existing Notification Settings view.
 *
 * Collapsed by default and loaded only when opened, deliberately: the
 * bell popover is a small surface, not an admin dashboard, and most
 * visits to Settings are about this device's on/off switch rather than
 * the fleet. Opening it is also the only thing that triggers the server
 * round trip, so the common path costs nothing.
 *
 * What it can show, and what it structurally cannot: every row comes
 * from `listNotificationDevicesAction`, which returns coarse enum
 * metadata plus an opaque `deviceRef` handle. There is no endpoint, no
 * `p256dh`/`auth` key, no row id, and no raw User-Agent anywhere in this
 * component's props, state, or DOM -- not hidden, not in a `title`, not
 * in a `data-` attribute. The labels are built by the shared pure
 * `buildPushDeviceLabel`, so this surface and any future one can never
 * describe the same device differently.
 *
 * Removing THIS device and removing ANOTHER device are genuinely
 * different operations and are wired to different code paths on purpose:
 *
 *   * The current device reuses the existing local disable flow
 *     (`usePushDevice().disable()`) -- which records the device-local
 *     "disabled" preference, revokes the server row, and unsubscribes
 *     the browser best-effort -- so the UI ends up truthfully disabled
 *     and the global banner stays suppressed, exactly as pressing
 *     "כבה התראות" does. Removing it through the remote path instead
 *     would revoke the row while leaving this browser still subscribed
 *     and still remembering "enabled", which is the inconsistent state
 *     this whole feature exists to eliminate.
 *
 *   * Another device goes through `removeNotificationDeviceAction`,
 *     which revokes rather than deletes -- see that action's docstring
 *     for why a deleted row would simply be recreated by the removed
 *     device's own auto-restore the next time it was opened.
 */
export function NotificationDevicesSection() {
  const { endpoint, state: pushState, disable } = usePushDevice();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [devices, setDevices] = useState<OwnedPushDevice[]>([]);
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const listId = useId();

  // `.then()/.catch()` rather than async/await + try/catch, and no
  // synchronous `setStatus("loading")` before the first await -- the same
  // two constraints `useNotificationInbox.refresh` documents: this exact
  // function is called straight from the effect below, and this
  // project's react-compiler-based lint cannot see past a try/catch (or
  // a pre-await setState) to confirm the contained updates are safely
  // gated.
  const load = useCallback(() => {
    return listNotificationDevicesAction(endpoint)
      .then((result) => {
        setDevices(result.devices);
        setStatus("ready");
      })
      .catch(() => {
        setStatus("error");
      });
  }, [endpoint]);

  useEffect(() => {
    if (!expanded) return;
    // A fresh read every time the section is opened -- another device may
    // have registered or been removed since last time. Same "no polling,
    // refresh on open" convention the inbox itself already follows.
    load();
  }, [expanded, load]);

  const handleRemove = useCallback(
    async (device: OwnedPushDevice) => {
      setPendingRef(device.deviceRef);
      try {
        if (device.isCurrent) {
          // The existing local disable flow, unchanged -- see this
          // component's docstring for why the current device must not go
          // through the remote-removal path.
          await disable();
        } else {
          await removeNotificationDeviceAction(device.deviceRef);
        }
      } catch {
        // Falls through to the reload below, which re-derives the real
        // state rather than assuming either outcome.
      } finally {
        setPendingRef(null);
        await load();
        // No extra `refresh()` for the current device: `disable()`
        // already re-derives the shared push state from scratch in its
        // own `finally` (see `usePushSubscription`), so calling it again
        // here would be a second, pointless status round trip on an
        // action the user just took.
      }
    },
    [disable, load],
  );

  // Nothing here is meaningful for a browser that cannot do Push at all;
  // the existing `UnsupportedPanel` already says so truthfully.
  if (pushState === "unsupported") return null;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setExpanded((previous) => !previous)}
        aria-expanded={expanded}
        aria-controls={listId}
        className={`relative flex w-full items-center justify-between gap-2 rounded-lg text-start transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${EXPAND_HIT_AREA_CLASS}`}
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-2">
          <Smartphone className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.75} />
          המכשירים שלי
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted" aria-hidden="true" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden="true" strokeWidth={2} />
        )}
      </button>

      {expanded ? (
        <div id={listId} className="mt-2">
          {status === "idle" ? (
            <div className="flex items-center gap-2 py-3 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" strokeWidth={1.75} />
              טוען מכשירים...
            </div>
          ) : null}

          {status === "error" ? <p className="py-3 text-xs text-muted">לא ניתן לטעון כרגע את רשימת המכשירים</p> : null}

          {status === "ready" && devices.length === 0 ? (
            <p className="py-3 text-xs text-muted">אין מכשירים פעילים להתראות</p>
          ) : null}

          {status === "ready" && devices.length > 0 ? (
            <ul className="space-y-2">
              {devices.map((device) => (
                <DeviceRow
                  key={device.deviceRef}
                  device={device}
                  pending={pendingRef === device.deviceRef}
                  onRemove={handleRemove}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * `now` is captured per render rather than taken as a prop: these labels
 * are coarse ("עכשיו", "לפני 3 ימים") and the popover is short-lived, so
 * there is no meaningful drift to manage and nothing to keep ticking.
 * This component only ever renders client-side (inside an already-open
 * popover), so there is no server/client clock mismatch to hydrate
 * around either.
 */
function DeviceRow({
  device,
  pending,
  onRemove,
}: {
  device: OwnedPushDevice;
  pending: boolean;
  onRemove: (device: OwnedPushDevice) => void;
}) {
  const label = buildPushDeviceLabel(device.descriptor);
  const now = new Date();

  return (
    <li className="rounded-xl bg-overlay-faint p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {label.primary}
            {label.secondary ? <span className="text-muted"> · {label.secondary}</span> : null}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            נראה לאחרונה: {formatRecentChangeRelativeTime(device.lastSeenAt, now)}
          </p>
          {/* Deliberately worded as "התקבלה" (received), never "נקראה"
              (read): a receipt proves the Service Worker processed and
              displayed the push, never that anyone saw it. */}
          <p className="mt-0.5 text-[11px] text-muted-2">
            {device.lastReceivedAt === null
              ? "התראה התקבלה לאחרונה: טרם"
              : `התראה התקבלה לאחרונה: ${formatRecentChangeRelativeTime(device.lastReceivedAt, now)}`}
          </p>
        </div>
        {device.isCurrent ? (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            המכשיר הזה
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onRemove(device)}
        disabled={pending}
        className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted transition-colors duration-150 hover:text-critical focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-critical disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" strokeWidth={2} /> : null}
        {device.isCurrent ? "כבה במכשיר הזה" : "הסר מכשיר"}
      </button>
    </li>
  );
}
