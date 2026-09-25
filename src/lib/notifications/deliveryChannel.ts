import "server-only";

/**
 * Which channel(s) carry a notification job to its recipient -- THE one
 * place this is decided (`resolveNotificationDeliveryChannel` below);
 * never an allowlist/preference check scattered through notification
 * code. The worker (`engine/delivery.ts`) asks once per claimed job and
 * follows the resulting plan.
 *
 * - `direct`  -- this app's own Web Push + inbox pipeline only. The
 *                existing behavior, and the default for everyone.
 * - `takshal` -- TAKSHAL CTRL's notification hub only (the inbox still
 *                shows the job; no direct push is sent).
 * - `both`    -- both channels. Duplication is intentional here.
 *
 * The inbox never depends on the channel: it is a read model over
 * `notification_jobs` itself (see `engine/store.ts`'s inbox section), so
 * every job appears there whichever channel(s) carried the push.
 */
export type NotificationDeliveryChannel = "direct" | "takshal" | "both";

export const DEFAULT_DELIVERY_CHANNEL: NotificationDeliveryChannel = "direct";

export interface DeliveryChannelPlan {
  readonly direct: boolean;
  readonly takshal: boolean;
}

const PLANS: Record<NotificationDeliveryChannel, DeliveryChannelPlan> = {
  direct: { direct: true, takshal: false },
  takshal: { direct: false, takshal: true },
  both: { direct: true, takshal: true },
};

export function planDeliveryChannels(channel: NotificationDeliveryChannel): DeliveryChannelPlan {
  return PLANS[channel];
}

/**
 * What a channel decision may know about a recipient -- all of it
 * server-side: the job's own `recipient_user_id`, and the address
 * Supabase Auth verified for that account (null when it has none).
 * Never anything a browser supplied.
 */
export interface DeliveryRecipient {
  readonly userId: string;
  readonly verifiedEmail: string | null;
}

/**
 * Where a recipient's channel comes from. Phase 2 of the TAKSHAL CTRL
 * integration uses `testRecipientAllowlistPolicy` (a temporary
 * server-side rollout list); a persisted per-user preference replaces it
 * later by implementing this same interface -- nothing else changes.
 */
export interface DeliveryChannelPolicy {
  channelFor(recipient: DeliveryRecipient): NotificationDeliveryChannel;
}

/**
 * The temporary rollout policy: allowlisted verified addresses get
 * `both` (direct + TAKSHAL CTRL), everyone else stays `direct`. An empty
 * allowlist therefore changes nothing for anyone. `testRecipients` must
 * already be normalized (see `lib/notifications/takshal/config.ts`).
 */
export function testRecipientAllowlistPolicy(testRecipients: ReadonlySet<string>): DeliveryChannelPolicy {
  return {
    channelFor: (recipient) =>
      recipient.verifiedEmail !== null && testRecipients.has(recipient.verifiedEmail) ? "both" : "direct",
  };
}

const CHANNELS: ReadonlySet<string> = new Set<NotificationDeliveryChannel>(["direct", "takshal", "both"]);

/**
 * Resolves one recipient's channel. Always fails SAFE toward the existing
 * direct behavior -- a notification is never dropped by this decision:
 *
 * - no policy (TAKSHAL CTRL not configured, or nobody rolled out) -> `direct`
 * - a channel that includes TAKSHAL CTRL needs a verified email to address
 *   the recipient there; without one -> `direct`
 * - a policy that throws or returns anything unexpected -> `direct`
 */
export function resolveNotificationDeliveryChannel(
  recipient: DeliveryRecipient,
  policy: DeliveryChannelPolicy | null,
): NotificationDeliveryChannel {
  if (!policy) return DEFAULT_DELIVERY_CHANNEL;

  let channel: unknown;
  try {
    channel = policy.channelFor(recipient);
  } catch {
    return DEFAULT_DELIVERY_CHANNEL;
  }
  if (typeof channel !== "string" || !CHANNELS.has(channel)) return DEFAULT_DELIVERY_CHANNEL;
  if (channel !== "direct" && recipient.verifiedEmail === null) return DEFAULT_DELIVERY_CHANNEL;
  return channel as NotificationDeliveryChannel;
}
