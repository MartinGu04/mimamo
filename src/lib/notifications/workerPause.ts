/**
 * Emergency production containment for the 2026-09-13 notification flood.
 *
 * This remains as a deliberately centralized kill switch for future emergency
 * containment. Both worker routes check it only after authenticating the
 * caller, so the internal endpoints do not expose worker state publicly.
 */
export const NOTIFICATION_WORKERS_PAUSED = false;
