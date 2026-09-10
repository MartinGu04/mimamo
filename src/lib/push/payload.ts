import "server-only";
import { APP_NAME } from "@/lib/config/productName";
import { resolveSafeNotificationPath } from "./notificationPath";

/**
 * The one notification payload shape every Push send in this app goes
 * through -- so future notification-rule PRs build outgoing pushes from
 * this contract instead of hand-assembling arbitrary JSON at each call
 * site. Mirrors exactly what `public/sw.js`'s "push" handler already
 * expects (title/body/icon/badge/tag/path -- see its own docstring).
 * Deliberately minimal: notifications may surface on a lock screen, so no
 * field here should ever carry confidential operational detail.
 */
export interface NotificationPayload {
  title: string;
  body: string;
  /** A safe, same-origin, in-app path to open on tap. Always run through `resolveSafeNotificationPath` -- never trusted as-is. */
  path: string;
  /** Optional de-duplication/grouping identifier (maps to the Notification API's own `tag`). */
  tag?: string;
  icon: string;
  badge: string;
}

export interface BuildNotificationPayloadInput {
  title: string;
  body: string;
  path?: string;
  tag?: string;
}

const DEFAULT_ICON = "/icons/icon-192.png";
const DEFAULT_BADGE = "/icons/icon-192.png";

/**
 * Builds a safe, complete payload from the minimal fields a caller
 * actually needs to specify -- `path` is always normalized through
 * `resolveSafeNotificationPath`, so a caller can never accidentally send
 * an unsafe/external destination even by mistake.
 */
export function buildNotificationPayload(input: BuildNotificationPayloadInput): NotificationPayload {
  return {
    title: input.title,
    body: input.body,
    path: resolveSafeNotificationPath(input.path),
    tag: input.tag,
    icon: DEFAULT_ICON,
    badge: DEFAULT_BADGE,
  };
}

/** The exact JSON string sent as the Web Push message body. */
export function serializeNotificationPayload(payload: NotificationPayload): string {
  return JSON.stringify(payload);
}

/**
 * PR #29's own "does the whole pipeline work" test notification -- title
 * and body are the exact copy specified for it; never anything from real
 * operational scheduling data.
 */
export const TEST_NOTIFICATION_PAYLOAD: BuildNotificationPayloadInput = {
  title: `${APP_NAME} 🐮`,
  body: "ההתראות עובדות כמו שצריך 🎉",
  path: "/",
  tag: "test-notification",
};
