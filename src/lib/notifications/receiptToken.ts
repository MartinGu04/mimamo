import "server-only";
import { createHmac, createHash } from "node:crypto";

/**
 * The delivery-receipt token: the single-purpose bearer credential that
 * lets one Service Worker prove it actually received ONE specific
 * `notification_deliveries` row's push -- while the PWA is closed, with
 * no page open, and with no Supabase session available.
 *
 * DERIVED, not stored. `token = HMAC-SHA256(receiptKey, deliveryId)`,
 * where `receiptKey` is itself `HMAC-SHA256(NOTIFICATION_WORKER_SECRET,
 * <fixed domain-separation label>)`. Three properties fall out of that
 * shape, and all three matter:
 *
 *  1. STABLE ACROSS RETRIES. A random per-attempt token would rotate
 *     every time the worker retried a transiently-failed delivery, and a
 *     receipt that arrived from the FIRST attempt (which the device may
 *     genuinely have received despite the server seeing a transient
 *     error) would then no longer match anything -- producing exactly
 *     the duplicate send this feature exists to prevent. A derived token
 *     is the same token forever for a given delivery.
 *
 *  2. NOTHING REVERSIBLE IS PERSISTED. Only `sha256(token)` is written
 *     to `notification_deliveries.receipt_token_hash`; the token itself
 *     exists only in memory and inside that one device's ENCRYPTED Web
 *     Push payload. Even full read access to the database yields no
 *     usable receipt credential.
 *
 *  3. UNGUESSABLE WITHOUT THE SECRET. Knowing a delivery's id (or a
 *     million of them) reveals nothing: forging a token requires the
 *     worker secret. This is what makes "never trust a caller merely
 *     because it supplies a delivery_id" enforceable rather than
 *     aspirational -- the receipt endpoint accepts a token and has no
 *     way to be handed a delivery id at all.
 *
 * Domain separation (rather than using `NOTIFICATION_WORKER_SECRET`
 * directly) means the receipt key is cryptographically unrelated to the
 * worker-authorization secret: possessing one never yields the other, so
 * a leaked receipt token can never be replayed as worker authorization.
 * Reusing the existing secret as the ROOT of that derivation -- instead
 * of introducing another required environment variable -- keeps the
 * deployment surface unchanged; receipt tokens are only ever generated
 * inside the worker, which cannot run at all without that secret.
 *
 * Never logged. Never returned to any client. Never put in
 * `notification.data` (where `notificationclick` could later read it).
 */

const RECEIPT_KEY_LABEL = "hamachlava:notification-delivery-receipt:v1";

/** The exact shape a valid token has on the wire -- 32 bytes of HMAC output, lowercase hex. Used to reject obvious junk before it ever reaches the database. */
export const RECEIPT_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function readReceiptKey(): Buffer | null {
  const secret = process.env.NOTIFICATION_WORKER_SECRET;
  if (!secret || secret.trim() === "") return null;
  return createHmac("sha256", secret).update(RECEIPT_KEY_LABEL).digest();
}

/**
 * The receipt token for one delivery, or `null` when no worker secret is
 * configured. `null` degrades gracefully and silently: the outgoing push
 * simply carries no `receiptToken`, the Service Worker skips the ACK
 * entirely, and deliveries are recorded exactly as they were before this
 * feature existed. It is never an error -- a deployment without receipt
 * tracking must still deliver notifications.
 */
export function deriveDeliveryReceiptToken(deliveryId: string): string | null {
  if (typeof deliveryId !== "string" || deliveryId === "") return null;
  const key = readReceiptKey();
  if (key === null) return null;
  return createHmac("sha256", key).update(deliveryId).digest("hex");
}

/**
 * The stored verifier for a token -- `sha256(token)`, lowercase hex.
 *
 * Computed in Node rather than in PL/pgSQL on purpose: `digest()` comes
 * from pgcrypto, which on a real Supabase project is installed into the
 * `extensions` schema and would therefore not resolve inside a function
 * whose `search_path` is pinned to `public` (the required hardening for
 * every SECURITY DEFINER function here). Hashing on this side keeps the
 * database function dependency-free and its `search_path` pinned.
 */
export function hashReceiptToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
