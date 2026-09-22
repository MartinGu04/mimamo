import { NextResponse, type NextRequest } from "next/server";
import { recordDeliveryReceipt } from "@/lib/notifications/receiptStore";
import { RECEIPT_TOKEN_PATTERN, hashReceiptToken } from "@/lib/notifications/receiptToken";

/**
 * The Service Worker's delivery-receipt ACK -- the narrow same-origin
 * entry point `public/sw.js` POSTs to immediately after
 * `showNotification()` resolves.
 *
 * WHAT AN ACK PROVES: the target Service Worker received that exact Push
 * payload and successfully reached the notification-display step. It is
 * NOT a read receipt and must never be described as one anywhere in this
 * codebase or its UI.
 *
 * Placed alongside the existing worker routes under `/internal/` (never
 * `src/app/api`, which `apiSurface.test.ts` asserts does not exist), but
 * it is a fundamentally different kind of endpoint from its two
 * neighbours and is built accordingly:
 *
 *   * It holds NO secret. It never reads the worker-authorization
 *     secret, never touches the privileged RLS-bypassing client, and
 *     cannot -- a receipt arrives from a closed PWA and could not
 *     present either.
 *   * Its ONLY authority is the receipt token in the body, which is
 *     derived per delivery and delivered exclusively inside that one
 *     device's encrypted Web Push payload (see `receiptToken.ts`).
 *     Supplying a delivery id is not merely insufficient, it is
 *     impossible -- this endpoint has no parameter for one.
 *   * It sends only `sha256(token)` onward, to a single SECURITY
 *     DEFINER function that returns `void` (see `receiptStore.ts`).
 *
 * The response is ALWAYS a flat `{ ok: true }` with status 200 --
 * malformed JSON, a missing/oddly-shaped token, a token matching no
 * delivery, a replayed token, and a database failure are all completely
 * indistinguishable from a first successful receipt. This is deliberate:
 * a distinguishable response would turn the endpoint into an oracle for
 * which tokens (and therefore which deliveries, users, and devices)
 * exist, and the Service Worker has nothing useful to do with a failure
 * either way -- the notification was already displayed by the time this
 * is called.
 *
 * Nothing here is logged. The token is a bearer credential; the request
 * body, the token, and its hash never reach a log line, an error
 * message, or the response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const acknowledged = NextResponse.json({ ok: true }, { status: 200 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return acknowledged;
  }

  if (typeof body !== "object" || body === null) return acknowledged;
  const token = (body as { token?: unknown }).token;

  // Shape-checked before the database is touched at all, so junk/probing
  // traffic costs a regex rather than a query.
  if (typeof token !== "string" || !RECEIPT_TOKEN_PATTERN.test(token)) return acknowledged;

  try {
    await recordDeliveryReceipt(hashReceiptToken(token));
  } catch {
    // Swallowed on purpose -- see this route's docstring. A lost receipt
    // degrades to "no `received_at` recorded", exactly the state a
    // device that never acknowledged would be in, and never changes the
    // response.
  }

  return acknowledged;
}
