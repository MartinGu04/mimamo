import "server-only";
import type { Person } from "@/lib/domain/types";
import { extractAvatarUrl } from "@/lib/auth/currentUser";
import { findPersonByEmail } from "@/lib/auth/resolveCurrentPerson";
import { classifyPersonnelType } from "@/lib/domain/personnelType";
import { getNotificationServiceClient } from "./serviceClient";

export interface ResolvedRecipient {
  personId: string;
  email: string;
  userId: string;
}

/**
 * PII-safe counts only -- see PR #30 spec section 5 ("record only a
 * PII-safe diagnostic/count") and section 25 (never log names/emails).
 * `resolved` itself carries emails/ids because it is consumed
 * server-side by the same worker request, never logged as a whole.
 */
export interface RecipientResolution {
  resolved: Map<string, ResolvedRecipient>;
  unmappedCount: number;
  ambiguousEmailCount: number;
  noEmailCount: number;
}

const MAX_LIST_USERS_PAGES = 50;
const LIST_USERS_PER_PAGE = 1000;

/** Trimmed + lowercased -- the ONE normalization rule every email comparison in the notification engine (recipient resolution, readiness) shares. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** One Supabase auth account, as much of it as any caller here is allowed to touch -- the id for identity mapping, plus the SAME presentation-only avatar `lib/auth/currentUser.ts` already extracts for the current session (never a login timestamp -- `listUsers()` returns `last_sign_in_at`/`created_at` too, but nothing here reads them; login recency stays a possible future enhancement). */
export interface AuthAccountLookup {
  userId: string;
  avatarUrl: string | null;
}

/**
 * Every Supabase auth user's normalized email -> account, via the Admin
 * API (service-role only). Exported (PR #40) so `readiness.ts` can reuse
 * the exact same live account lookup for the manager notification-
 * readiness view instead of re-querying/re-implementing it -- one shared
 * identity source of truth, never two. The avatar is read from the SAME
 * already-fetched page of `listUsers()` results (every entry is a full
 * `User`, `user_metadata` included) -- never a second, per-user Admin API
 * call just to get a photo.
 */
export async function fetchAllUserIdsByEmail(): Promise<Map<string, AuthAccountLookup>> {
  const supabase = getNotificationServiceClient();
  const emailToAccount = new Map<string, AuthAccountLookup>();

  for (let page = 1; page <= MAX_LIST_USERS_PAGES; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: LIST_USERS_PER_PAGE });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email) emailToAccount.set(normalizeEmail(user.email), { userId: user.id, avatarUrl: extractAvatarUrl(user) });
    }
    if (data.users.length < LIST_USERS_PER_PAGE) break;
  }

  return emailToAccount;
}

/**
 * One person's resolved standing against `emailToUserId`, purely from
 * already-fetched data (no I/O of its own) -- `no_email`/`ambiguous`/
 * `not_found` never reach a userId at all; `unmapped` has a normalized
 * email but no matching Supabase account; `mapped` has both.
 */
export type PersonIdentityLookup =
  | { status: "no_email" }
  | { status: "ambiguous" }
  | { status: "not_found" }
  | { status: "unmapped"; normalizedEmail: string }
  | { status: "mapped"; normalizedEmail: string; userId: string; avatarUrl: string | null };

/**
 * The ONE per-person identity resolution step `resolveNotificationRecipients`
 * (the worker's own recipient targeting) and `computeNotificationReadiness`
 * (PR #40's manager-facing readiness view, `readiness.ts`) both build on --
 * "does this person have a usable email, is it unambiguous within this
 * roster (`findPersonByEmail`, fail-closed-on-ambiguity, no fuzzy/display-
 * name matching), and if so does it match a real Supabase auth user
 * (`emailToAccount`, from `fetchAllUserIdsByEmail`)?". A person whose email
 * collides (case/whitespace aside) with another כ"א record resolves
 * `ambiguous` for BOTH, never a silent first-match.
 *
 * Deliberately does NOT touch push-subscription membership and does NOT
 * decide any aggregate-counting policy -- `resolveNotificationRecipients`
 * counts once per DISTINCT email, `computeNotificationReadiness` once per
 * PERSON; each caller keeps its own counting semantics on top of this
 * shared, purely per-person lookup.
 */
export function resolvePersonIdentity(
  person: Person,
  people: readonly Person[],
  emailToAccount: ReadonlyMap<string, AuthAccountLookup>,
): PersonIdentityLookup {
  if (!person.email) return { status: "no_email" };

  const lookup = findPersonByEmail(people, person.email);
  if (lookup.status === "ambiguous") return { status: "ambiguous" };
  if (lookup.status === "not_found") return { status: "not_found" }; // unreachable: person.email is itself a member of `people`

  const normalizedEmail = normalizeEmail(person.email);
  const account = emailToAccount.get(normalizedEmail);
  if (!account) return { status: "unmapped", normalizedEmail };

  return { status: "mapped", normalizedEmail, userId: account.userId, avatarUrl: account.avatarUrl };
}

/**
 * Maps every כ"א `Person` with a usable, unambiguous email to their
 * Supabase auth user id -- the ONLY recipient-resolution path the
 * notification engine uses (PR #30 spec section 5: "prefer the existing
 * normalized email/person identifier... never target by display-name
 * guessing... if a person cannot be mapped reliably, skip delivery").
 *
 * Delegates the per-person identity question to `resolvePersonIdentity`
 * (PR #40) rather than re-deriving the matching rule here -- but keeps its
 * OWN aggregate-counting policy exactly as before: each DISTINCT normalized
 * email is considered (and, if ambiguous/unmapped, counted) exactly once,
 * regardless of how many כ"א rows share it.
 */
export async function resolveNotificationRecipients(
  people: readonly Person[],
): Promise<RecipientResolution> {
  const emailToAccount = await fetchAllUserIdsByEmail();

  const resolved = new Map<string, ResolvedRecipient>();
  let unmappedCount = 0;
  let ambiguousEmailCount = 0;
  let noEmailCount = 0;
  const consideredEmails = new Set<string>();

  for (const person of people) {
    if (!person.email) {
      noEmailCount++;
      continue;
    }

    const normalized = normalizeEmail(person.email);
    if (consideredEmails.has(normalized)) continue;
    consideredEmails.add(normalized);

    const identity = resolvePersonIdentity(person, people, emailToAccount);
    if (identity.status === "no_email" || identity.status === "not_found") continue; // unreachable here: person.email already checked above / self-match guaranteed
    if (identity.status === "ambiguous") {
      ambiguousEmailCount++;
      continue;
    }
    if (identity.status === "unmapped") {
      unmappedCount++;
      continue;
    }

    resolved.set(person.id, { personId: person.id, email: identity.normalizedEmail, userId: identity.userId });
  }

  return { resolved, unmappedCount, ambiguousEmailCount, noEmailCount };
}

/** Resolved recipients who are managers per `Person.isManager` -- no separate hardcoded manager list, per PR #30 spec section 5. */
export function filterManagerRecipients(
  people: readonly Person[],
  resolution: RecipientResolution,
): ResolvedRecipient[] {
  const recipients: ResolvedRecipient[] = [];
  for (const person of people) {
    if (!person.isManager) continue;
    const recipient = resolution.resolved.get(person.id);
    if (recipient) recipients.push(recipient);
  }
  return recipients;
}

/**
 * Every distinct Supabase user id with at least one active push
 * subscription. Reused (PR #40) as the ONE bulk subscription query the
 * manager notification-readiness view needs, instead of calling
 * `getActiveSubscriptionsForUser()` once per roster person.
 *
 * NEVER the recipient source for a logical `notification_job` -- push
 * subscription state is a DELIVERY-channel concern only (see
 * `resolveNonPermanentConstraintsRecipients` below, the weekly
 * constraints reminders' own recipient source, which never gates on
 * this either).
 */
export async function fetchAllSubscribedUserIds(): Promise<string[]> {
  const supabase = getNotificationServiceClient();
  // `revoked_at is null` mirrors `getActiveSubscriptionsForUser`'s own
  // filter exactly -- the manager-facing readiness view must answer the
  // same question the worker's targeting actually asks, so a person
  // whose only device was removed/permanently failed reads as
  // `no_push_subscription` rather than a misleading `ready`.
  const { data, error } = await supabase.from("push_subscriptions").select("user_id").is("revoked_at", null);
  if (error) throw error;

  const userIds = new Set<string>();
  for (const row of (data ?? []) as { user_id: string }[]) {
    userIds.add(row.user_id);
  }
  return [...userIds];
}

/** One non-permanent, roster-mapped constraints-reminder recipient -- both ids are always available together, so a caller can filter by the stable `personId` (e.g. a manager's system-rule audience selection) BEFORE ever touching `userId` (the actual `notification_jobs.recipient_user_id`). */
export interface NonPermanentConstraintsRecipient {
  personId: string;
  userId: string;
}

/**
 * The weekly constraints reminders' recipient source (system rules
 * `constraints_sunday`/`constraints_monday`, `reminders.ts`) -- every
 * currently-rostered person who is NOT `classifyPersonnelType(...) ===
 * "permanent"` (קבע), paired with their real Supabase auth user id.
 * Permanent staff never submit weekly אילוצים, so they must never
 * receive either constraints reminder -- see this codebase's own
 * `classifyPersonnelType` docstring for the exact "קבע"/"חובה"/"מילואים"
 * classification this reuses (never a raw Hebrew string comparison here).
 *
 * Deliberately narrower than the OLD "every real Supabase auth account"
 * source this replaces in two ways at once: (1) roster-derived, not
 * "every real auth account" -- an auth account with no כ"א mapping at
 * all can never be proven non-permanent, so it is correctly excluded
 * (fails CONSERVATIVE, never accidentally includes an unmappable
 * account); (2) even a mapped,
 * roster-derived person is excluded when their OWN personnelType resolves
 * to "permanent". `resolvePersonIdentity`'s existing `no_email`/
 * `not_found`/`ambiguous`/`unmapped` non-"mapped" states are all treated
 * identically here -- skip, never guess.
 *
 * A permanent person is never even a CANDIDATE here -- their `personId`
 * never reaches the returned list at all. This is what makes a manager's
 * `system_target_person_ids` selection a safe FILTER on top of this list
 * (`isSystemRulePersonAllowed`, `ruleConfig.ts`): even if a permanent
 * person's id somehow ended up in stored configuration, they could never
 * receive a constraints reminder, because they are never in the base
 * eligible set this function returns to begin with.
 */
export async function resolveNonPermanentConstraintsRecipients(
  people: readonly Person[],
): Promise<NonPermanentConstraintsRecipient[]> {
  const emailToAccount = await fetchAllUserIdsByEmail();
  const seenPersonIds = new Set<string>();
  const recipients: NonPermanentConstraintsRecipient[] = [];

  for (const person of people) {
    if (classifyPersonnelType(person.personnelType) === "permanent") continue;
    if (seenPersonIds.has(person.id)) continue;

    const identity = resolvePersonIdentity(person, people, emailToAccount);
    if (identity.status !== "mapped") continue;

    seenPersonIds.add(person.id);
    recipients.push({ personId: person.id, userId: identity.userId });
  }

  return recipients;
}
