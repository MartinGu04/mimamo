import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readSupabasePublicConfig } from "@/lib/supabase/config";

/**
 * The delivery-receipt ACK's one database call.
 *
 * Deliberately does NOT use the privileged, RLS-bypassing client. A receipt arrives
 * from a Service Worker whose PWA may be closed, so it cannot carry a
 * usable Supabase session -- but that is an argument for a narrow
 * token-authorized entry point, NOT for handing an unauthenticated
 * endpoint an RLS-bypassing credential. This module therefore builds a
 * plain `anon` client from the same public config the browser already
 * holds, and its entire reachable surface is one SECURITY DEFINER
 * function (`record_notification_delivery_receipt`) that takes a token
 * verifier and returns `void`:
 *
 *   * `notification_deliveries` itself stays RLS default-deny with zero
 *     policies -- `anon` can read and write exactly nothing on it
 *     directly, before and after this change alike.
 *   * The function cannot be addressed by delivery id, user id, or
 *     device id; only by a verifier the caller could only have obtained
 *     from that one device's encrypted push payload.
 *   * It returns nothing, so it leaks nothing -- a valid receipt, a
 *     replayed one, and pure nonsense are indistinguishable.
 *
 * The existing service-role architecture guard
 * (`src/app/notificationServiceRoleBoundary.test.ts`) is consequently
 * untouched by this feature: no new file references the privileged
 * RLS-bypassing client factory, and the new route handler holds no
 * privileged credential of any kind.
 *
 * No session persistence/refresh machinery: this client is never an
 * end-user session client, same reasoning as `serviceRoleClient.ts`.
 */
function createReceiptClient() {
  const { url, publishableKey } = readSupabasePublicConfig();
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Records one delivery receipt, identified solely by `sha256(token)`.
 * Idempotent and side-effect-free for an unknown verifier (the function
 * simply matches no row). Never returns whether anything matched --
 * neither this function nor its caller may become an oracle for which
 * deliveries, users, or devices exist.
 *
 * Errors propagate to the caller, which swallows them: a failed receipt
 * must never change what the Service Worker did (the notification was
 * already displayed) nor produce a distinguishable response.
 */
export async function recordDeliveryReceipt(tokenHash: string): Promise<void> {
  const supabase = createReceiptClient();
  const { error } = await supabase.rpc("record_notification_delivery_receipt", { p_token_hash: tokenHash });
  if (error) throw error;
}
