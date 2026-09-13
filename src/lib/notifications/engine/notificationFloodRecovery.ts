import type { BaselineStateSnapshot } from "./store";

/**
 * The 2026-09-13 rollover first left an incomplete seed after a timeout. The
 * initial repair then exposed a second issue: Postgres jsonb key reordering
 * made 41 identical seeded facts look changed. This fixed cutoff forces one
 * final silent reseed after both fixes. These bounds identify only this
 * incident and can never quarantine a later legitimate change notification.
 */
export const NOTIFICATION_FLOOD_INCIDENT = {
  weekStart: "2026-09-13",
  jobsCreatedFrom: "2026-09-12T21:00:00.000Z",
  // The old 21:50 tick remained in flight for ~17 seconds even after the
  // paused deployment became READY, so include its complete creation window.
  jobsCreatedThrough: "2026-09-12T21:51:00.000Z",
  incompleteBaselineUpdatedBefore: "2026-09-13T07:41:00.000Z",
} as const;

export function requiresNotificationFloodRecovery(
  state: BaselineStateSnapshot,
  currentWeekStart: string,
): boolean {
  if (currentWeekStart !== NOTIFICATION_FLOOD_INCIDENT.weekStart) return false;
  if (state.currentWeekStart !== NOTIFICATION_FLOOD_INCIDENT.weekStart) return false;
  if (!state.updatedAt) return true;
  const updatedAtMs = Date.parse(state.updatedAt);
  return !Number.isFinite(updatedAtMs) || updatedAtMs < Date.parse(NOTIFICATION_FLOOD_INCIDENT.incompleteBaselineUpdatedBefore);
}
