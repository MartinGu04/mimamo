import type { PushDeviceDescriptor } from "@/lib/push/deviceDescriptor";

/**
 * The shape "המכשירים שלי" receives for one ACTIVE Push-capable
 * installation.
 *
 * Its own module (rather than living beside the query in
 * `subscriptionStore.ts`) for the same reason
 * `readModels/notificationInboxTypes.ts` exists: the client component
 * that renders these rows must be able to import the type without
 * importing a `server-only` module's graph at all.
 *
 * Note what is NOT here, and never will be: `endpoint`, `p256dh`,
 * `auth`, the row's `id`, and any raw User-Agent string. `deviceRef` is
 * an opaque per-row handle generated independently of the primary key,
 * and exists solely so the UI can name a device to remove.
 */
export interface OwnedPushDevice {
  deviceRef: string;
  /** Coarse, closed-enum device description -- see `lib/push/deviceDescriptor.ts` for why this is deliberately too low-entropy to be a fingerprint. */
  descriptor: PushDeviceDescriptor;
  /** Last time this installation actively checked in while being used (the heartbeat). NOT a delivery fact. */
  lastSeenAt: string;
  /** Last time this installation's Service Worker acknowledged actually receiving and displaying a push. `null` = never (including every delivery predating receipt tracking). Never means "read". */
  lastReceivedAt: string | null;
  createdAt: string;
  /** Whether this row is the device the request came from -- decided SERVER-side, so the endpoint never has to reach the client for the comparison. */
  isCurrent: boolean;
}
