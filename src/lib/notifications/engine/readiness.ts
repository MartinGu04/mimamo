import "server-only";
import type { Person } from "@/lib/domain/types";
import {
  fetchAllSubscribedUserIds,
  fetchAllUserIdsByEmail,
  resolvePersonIdentity,
  type AuthAccountLookup,
} from "./recipients";

/**
 * PR #40 -- every deterministic state a roster person can resolve to when
 * asking "can Hamachlava currently target a personal push notification to
 * this person, all the way to at least one registered device?". This is a
 * STRICTLY stronger question than `resolveNotificationRecipients`'
 * identity mapping (personnel person -> unique email -> matching auth
 * user): that alone does NOT prove push delivery is possible -- a mapped
 * account with zero rows in `push_subscriptions` still gets its
 * notification job marked `skipped` by `delivery.ts`. `no_push_subscription`
 * is the state that makes that gap visible instead of silently absorbed.
 *
 * Precedence is evaluated in this exact order (see `resolvePersonReadiness`)
 * so every person lands in EXACTLY ONE state, never two:
 * missing_email > ambiguous_email > unmapped_account > no_push_subscription
 * > ready. No finer state is ever invented -- these five are everything
 * the system can actually prove from `כ"א` + Supabase auth + push_subscriptions.
 */
export type PersonNotificationReadiness =
  | "ready"
  | "missing_email"
  | "ambiguous_email"
  | "unmapped_account"
  | "no_push_subscription";

export interface PersonReadinessResult {
  personId: string;
  status: PersonNotificationReadiness;
  /**
   * The SAME presentation-only Google avatar `resolvePersonIdentity` already
   * carries for a `mapped` identity (see `recipients.ts`) -- set only for
   * `ready`/`no_push_subscription` (a real matched account), always `null`
   * otherwise. Never a new lookup: it rides along on the exact same bulk
   * `fetchAllUserIdsByEmail()` call this function already makes.
   */
  avatarUrl: string | null;
}

/**
 * Computes every roster person's `PersonNotificationReadiness` in one
 * bulk pass -- never `getActiveSubscriptionsForUser()` per person (that
 * would be one `push_subscriptions` query per roster member). Identity
 * mapping (`fetchAllUserIdsByEmail`, the Supabase Admin API) and push-
 * subscription membership (`fetchAllSubscribedUserIds`, a single bulk
 * `push_subscriptions` select) are fetched CONCURRENTLY via `Promise.all`
 * -- they're independent reads with no data dependency on each other.
 *
 * Reuses `resolvePersonIdentity` -- the EXACT SAME per-person identity
 * resolution `resolveNotificationRecipients` (the worker's own recipient
 * resolution) now shares -- so the manager-facing readiness view and the
 * worker's actual targeting logic can never quietly drift apart. This
 * function does NOT change or duplicate `resolveNotificationRecipients`'s
 * own aggregate counting behavior (its PII-safe worker logs are untouched)
 * -- it's a separate, per-person projection built from the same underlying
 * primitives.
 */
export async function computeNotificationReadiness(
  people: readonly Person[],
): Promise<PersonReadinessResult[]> {
  const [emailToAccount, subscribedUserIds] = await Promise.all([
    fetchAllUserIdsByEmail(),
    fetchAllSubscribedUserIds(),
  ]);
  const subscribed = new Set(subscribedUserIds);

  return people.map((person) => ({
    personId: person.id,
    ...resolvePersonReadiness(person, people, emailToAccount, subscribed),
  }));
}

function resolvePersonReadiness(
  person: Person,
  people: readonly Person[],
  emailToAccount: ReadonlyMap<string, AuthAccountLookup>,
  subscribedUserIds: ReadonlySet<string>,
): { status: PersonNotificationReadiness; avatarUrl: string | null } {
  const identity = resolvePersonIdentity(person, people, emailToAccount);

  if (identity.status === "no_email" || identity.status === "not_found") {
    return { status: "missing_email", avatarUrl: null }; // not_found is unreachable: person.email is itself a member of `people`
  }
  if (identity.status === "ambiguous") return { status: "ambiguous_email", avatarUrl: null };
  if (identity.status === "unmapped") return { status: "unmapped_account", avatarUrl: null };

  const status = subscribedUserIds.has(identity.userId) ? "ready" : "no_push_subscription";
  return { status, avatarUrl: identity.avatarUrl };
}
