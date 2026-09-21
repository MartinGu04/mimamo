import { describe, expect, it, vi } from "vitest";
import type { Person } from "@/lib/domain/types";

function person(overrides: Partial<Person> & Pick<Person, "id" | "name">): Person {
  return { email: null, isManager: false, isTechnician: false, isSupervisor: false, personnelType: null, dischargeDate: null, enlistmentDate: null, ...overrides };
}

function makeFakeSupabase(
  users: { id: string; email: string; user_metadata?: Record<string, unknown> }[],
  subscriptionUserIds: string[] = [],
) {
  return {
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users }, error: null })),
      },
    },
    from: vi.fn(() => ({
      // `.select(...).is("revoked_at", null)` -- readiness must ask the
      // SAME "active devices only" question the delivery worker's own
      // targeting asks, so a person whose only device was removed or
      // permanently failed reads as `no_push_subscription`.
      select: vi.fn(() => ({
        is: vi.fn(async () => ({
          data: subscriptionUserIds.map((user_id) => ({ user_id })),
          error: null,
        })),
      })),
    })),
  };
}

async function loadWithFakeSupabase(
  users: { id: string; email: string; user_metadata?: Record<string, unknown> }[],
  subscriptionUserIds: string[] = [],
) {
  vi.resetModules();
  const fakeSupabase = makeFakeSupabase(users, subscriptionUserIds);
  vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));
  return import("./readiness");
}

function statusFor(results: { personId: string; status: string }[], personId: string): string | undefined {
  return results.find((result) => result.personId === personId)?.status;
}

function avatarFor(results: { personId: string; avatarUrl: string | null }[], personId: string): string | null | undefined {
  return results.find((result) => result.personId === personId)?.avatarUrl;
}

describe("computeNotificationReadiness", () => {
  it("ready -- unique email + matching auth user + at least one push subscription", async () => {
    const { computeNotificationReadiness } = await loadWithFakeSupabase(
      [{ id: "user-1", email: "dana@example.com" }],
      ["user-1"],
    );
    const people = [person({ id: "p1", name: "Dana", email: "dana@example.com" })];

    const results = await computeNotificationReadiness(people);

    expect(statusFor(results, "p1")).toBe("ready");
  });

  it("ready -- multiple push subscriptions for the same user still resolve to exactly one ready status", async () => {
    const { computeNotificationReadiness } = await loadWithFakeSupabase(
      [{ id: "user-1", email: "dana@example.com" }],
      ["user-1", "user-1"],
    );
    const people = [person({ id: "p1", name: "Dana", email: "dana@example.com" })];

    const results = await computeNotificationReadiness(people);

    expect(results).toHaveLength(1);
    expect(statusFor(results, "p1")).toBe("ready");
  });

  it("missing_email -- no usable email in personnel data", async () => {
    const { computeNotificationReadiness } = await loadWithFakeSupabase([]);
    const people = [person({ id: "p1", name: "No Email" })];

    const results = await computeNotificationReadiness(people);

    expect(statusFor(results, "p1")).toBe("missing_email");
  });

  it("ambiguous_email -- a normalized email shared by two people fails closed for BOTH, never a silent first-match", async () => {
    const { computeNotificationReadiness } = await loadWithFakeSupabase(
      [{ id: "user-1", email: "shared@example.com" }],
      ["user-1"],
    );
    const people = [
      person({ id: "p1", name: "First", email: "shared@example.com" }),
      person({ id: "p2", name: "Second", email: " Shared@Example.com " }),
    ];

    const results = await computeNotificationReadiness(people);

    expect(statusFor(results, "p1")).toBe("ambiguous_email");
    expect(statusFor(results, "p2")).toBe("ambiguous_email");
  });

  it("unmapped_account -- unique email exists, but no matching Supabase auth user", async () => {
    const { computeNotificationReadiness } = await loadWithFakeSupabase([]);
    const people = [person({ id: "p1", name: "Ghost", email: "ghost@example.com" })];

    const results = await computeNotificationReadiness(people);

    expect(statusFor(results, "p1")).toBe("unmapped_account");
  });

  it("no_push_subscription -- identity mapping succeeds, but zero registered push subscriptions", async () => {
    const { computeNotificationReadiness } = await loadWithFakeSupabase(
      [{ id: "user-1", email: "dana@example.com" }],
      [],
    );
    const people = [person({ id: "p1", name: "Dana", email: "dana@example.com" })];

    const results = await computeNotificationReadiness(people);

    expect(statusFor(results, "p1")).toBe("no_push_subscription");
  });

  it("a subscribed user id with no matching roster person doesn't magically map anyone else", async () => {
    const { computeNotificationReadiness } = await loadWithFakeSupabase(
      [{ id: "user-1", email: "dana@example.com" }],
      ["user-1", "user-stray-not-in-roster"],
    );
    const people = [person({ id: "p1", name: "Dana", email: "dana@example.com" })];

    const results = await computeNotificationReadiness(people);

    expect(results).toHaveLength(1);
    expect(statusFor(results, "p1")).toBe("ready");
  });

  it("ready -- carries the account's avatarUrl through, reusing the same bulk listUsers() response (never a second Admin API call)", async () => {
    const { computeNotificationReadiness } = await loadWithFakeSupabase(
      [{ id: "user-1", email: "dana@example.com", user_metadata: { avatar_url: "https://example.invalid/dana.jpg" } }],
      ["user-1"],
    );
    const people = [person({ id: "p1", name: "Dana", email: "dana@example.com" })];

    const results = await computeNotificationReadiness(people);

    expect(avatarFor(results, "p1")).toBe("https://example.invalid/dana.jpg");
  });

  it("no_push_subscription -- still carries the account's avatarUrl (a mapped account, just not push-ready)", async () => {
    const { computeNotificationReadiness } = await loadWithFakeSupabase(
      [{ id: "user-1", email: "dana@example.com", user_metadata: { avatar_url: "https://example.invalid/dana.jpg" } }],
      [],
    );
    const people = [person({ id: "p1", name: "Dana", email: "dana@example.com" })];

    const results = await computeNotificationReadiness(people);

    expect(avatarFor(results, "p1")).toBe("https://example.invalid/dana.jpg");
  });

  it("unmapped_account/missing_email/ambiguous_email -- avatarUrl is always null (no account to read a photo from)", async () => {
    const { computeNotificationReadiness } = await loadWithFakeSupabase([]);
    const people = [
      person({ id: "p-unmapped", name: "Ghost", email: "ghost@example.com" }),
      person({ id: "p-no-email", name: "NoEmail" }),
    ];

    const results = await computeNotificationReadiness(people);

    expect(avatarFor(results, "p-unmapped")).toBeNull();
    expect(avatarFor(results, "p-no-email")).toBeNull();
  });

  it("every person lands in exactly one status across a mixed roster, deterministic precedence", async () => {
    const { computeNotificationReadiness } = await loadWithFakeSupabase(
      [
        { id: "user-ready", email: "ready@example.com" },
        { id: "user-no-push", email: "nopush@example.com" },
      ],
      ["user-ready"],
    );
    const people = [
      person({ id: "p-ready", name: "Ready", email: "ready@example.com" }),
      person({ id: "p-no-push", name: "NoPush", email: "nopush@example.com" }),
      person({ id: "p-unmapped", name: "Unmapped", email: "unmapped@example.com" }),
      person({ id: "p-no-email", name: "NoEmail" }),
      person({ id: "p-dupe-1", name: "Dupe1", email: "dupe@example.com" }),
      person({ id: "p-dupe-2", name: "Dupe2", email: "dupe@example.com" }),
    ];

    const results = await computeNotificationReadiness(people);

    expect(results).toHaveLength(people.length);
    expect(new Set(results.map((result) => result.personId)).size).toBe(people.length);
    expect(statusFor(results, "p-ready")).toBe("ready");
    expect(statusFor(results, "p-no-push")).toBe("no_push_subscription");
    expect(statusFor(results, "p-unmapped")).toBe("unmapped_account");
    expect(statusFor(results, "p-no-email")).toBe("missing_email");
    expect(statusFor(results, "p-dupe-1")).toBe("ambiguous_email");
    expect(statusFor(results, "p-dupe-2")).toBe("ambiguous_email");
  });
});
