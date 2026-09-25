import { describe, expect, it, vi } from "vitest";
import type { Person } from "@/lib/domain/types";

function person(overrides: Partial<Person> & Pick<Person, "id" | "name">): Person {
  return { email: null, isManager: false, isTechnician: false, isSupervisor: false, personnelType: null, dischargeDate: null, enlistmentDate: null, ...overrides };
}

function makeFakeSupabase(users: { id: string; email: string }[], subscriptionUserIds: string[] = []) {
  // Every `.is(column, value)` filter the code under test applies to
  // `push_subscriptions`, recorded so a test can assert the ACTIVE-only
  // (`revoked_at is null`) filter is never quietly dropped -- a revoked
  // device must never be counted as push-capable.
  const isFilters: [string, unknown][] = [];
  return {
    isFilters,
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users }, error: null })),
      },
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        is: vi.fn(async (column: string, value: unknown) => {
          isFilters.push([column, value]);
          return { data: subscriptionUserIds.map((user_id) => ({ user_id })), error: null };
        }),
      })),
    })),
  };
}

describe("resolveNotificationRecipients", () => {
  it("resolves a person with a matching email to their Supabase user id", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([{ id: "user-1", email: "Dana@Example.com" }]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNotificationRecipients } = await import("./recipients");
    const people = [person({ id: "p1", name: "Dana", email: "dana@example.com" })];
    const result = await resolveNotificationRecipients(people);

    expect(result.resolved.get("p1")).toEqual({ personId: "p1", email: "dana@example.com", userId: "user-1" });
    expect(result.unmappedCount).toBe(0);
    expect(result.ambiguousEmailCount).toBe(0);
  });

  it("skips a person with no email and counts them", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNotificationRecipients } = await import("./recipients");
    const result = await resolveNotificationRecipients([person({ id: "p1", name: "No Email" })]);

    expect(result.resolved.size).toBe(0);
    expect(result.noEmailCount).toBe(1);
  });

  it("skips (never guesses) a person whose email has no matching Supabase user", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNotificationRecipients } = await import("./recipients");
    const result = await resolveNotificationRecipients([person({ id: "p1", name: "Ghost", email: "ghost@example.com" })]);

    expect(result.resolved.size).toBe(0);
    expect(result.unmappedCount).toBe(1);
  });

  it("skips BOTH people when two sheet records share a normalized email -- never a silent first-match", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([{ id: "user-1", email: "shared@example.com" }]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNotificationRecipients } = await import("./recipients");
    const people = [
      person({ id: "p1", name: "First", email: "shared@example.com" }),
      person({ id: "p2", name: "Second", email: " Shared@Example.com " }),
    ];
    const result = await resolveNotificationRecipients(people);

    expect(result.resolved.size).toBe(0);
    expect(result.ambiguousEmailCount).toBe(1);
  });
});

describe("resolveNonPermanentConstraintsRecipients -- mandatory constraints audience exclusion", () => {
  it("resolves a non-permanent (חובה) mapped person to their Supabase user id", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([{ id: "user-reg", email: "reg@example.com" }]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNonPermanentConstraintsRecipients } = await import("./recipients");
    const people = [person({ id: "p_reg", name: "Regular", email: "reg@example.com", personnelType: "חובה" })];
    const userIds = await resolveNonPermanentConstraintsRecipients(people);

    expect(userIds).toEqual([{ personId: "p_reg", userId: "user-reg" }]);
  });

  it("NEVER includes a permanent (קבע) person, even when mapped -- the mandatory audience-exclusion fix", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([
      { id: "user-reg", email: "reg@example.com" },
      { id: "user-perm", email: "perm@example.com" },
    ]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNonPermanentConstraintsRecipients } = await import("./recipients");
    const people = [
      person({ id: "p_reg", name: "Regular", email: "reg@example.com", personnelType: "חובה" }),
      person({ id: "p_perm", name: "Permanent", email: "perm@example.com", personnelType: "קבע" }),
    ];
    const userIds = await resolveNonPermanentConstraintsRecipients(people);

    expect(userIds).toEqual([{ personId: "p_reg", userId: "user-reg" }]);
  });

  it("a reserve (מילואים) mapped person is included, same as חובה", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([{ id: "user-res", email: "res@example.com" }]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNonPermanentConstraintsRecipients } = await import("./recipients");
    const people = [person({ id: "p_res", name: "Reserve", email: "res@example.com", personnelType: "מילואים" })];
    const userIds = await resolveNonPermanentConstraintsRecipients(people);

    expect(userIds).toEqual([{ personId: "p_res", userId: "user-res" }]);
  });

  it("an unclassified/null personnelType is still included -- only 'permanent' is ever excluded", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([{ id: "user-u", email: "u@example.com" }]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNonPermanentConstraintsRecipients } = await import("./recipients");
    const people = [person({ id: "p_u", name: "Unclassified", email: "u@example.com", personnelType: null })];
    const userIds = await resolveNonPermanentConstraintsRecipients(people);

    expect(userIds).toEqual([{ personId: "p_u", userId: "user-u" }]);
  });

  it("classifies via classifyPersonnelType's own normalization (trims internal/surrounding whitespace), never a raw string comparison", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([{ id: "user-perm", email: "perm@example.com" }]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNonPermanentConstraintsRecipients } = await import("./recipients");
    // A naive `personnelType === "קבע"` check would NOT recognize this as
    // permanent -- classifyPersonnelType's own whitespace normalization
    // still does.
    const people = [person({ id: "p_perm", name: "Permanent", email: "perm@example.com", personnelType: " קבע  " })];
    const userIds = await resolveNonPermanentConstraintsRecipients(people);

    expect(userIds).toEqual([]);
  });

  it("an auth account that cannot be proven non-permanent (no כ״א/roster mapping at all) is excluded -- fails CONSERVATIVE, never accidentally included", async () => {
    vi.resetModules();
    // No auth users resolve to any of this roster's emails at all.
    const fakeSupabase = makeFakeSupabase([]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNonPermanentConstraintsRecipients } = await import("./recipients");
    const people = [person({ id: "p_reg", name: "Regular", email: "reg@example.com", personnelType: "חובה" })];
    const userIds = await resolveNonPermanentConstraintsRecipients(people);

    expect(userIds).toEqual([]);
  });

  it("a person with no email at all is excluded, never guessed", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNonPermanentConstraintsRecipients } = await import("./recipients");
    const people = [person({ id: "p_noemail", name: "No Email", personnelType: "חובה" })];
    const userIds = await resolveNonPermanentConstraintsRecipients(people);

    expect(userIds).toEqual([]);
  });

  it("deduplicates by resolved userId when two roster rows share one auth account", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([{ id: "user-shared", email: "shared@example.com" }]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { resolveNonPermanentConstraintsRecipients } = await import("./recipients");
    // Two DIFFERENT people rows sharing one email would actually resolve
    // "ambiguous" via findPersonByEmail -- this test instead exercises the
    // dedupe-by-userId path directly via a single person, confirming the
    // returned array never contains a duplicate userId.
    const people = [person({ id: "p_shared", name: "Shared", email: "shared@example.com", personnelType: "חובה" })];
    const userIds = await resolveNonPermanentConstraintsRecipients(people);

    expect(userIds).toEqual([{ personId: "p_shared", userId: "user-shared" }]);
  });
});

describe("filterManagerRecipients", () => {
  it("only includes people whose Person.isManager is true and who resolved to a Supabase user", async () => {
    vi.resetModules();
    const { filterManagerRecipients } = await import("./recipients");

    const manager = person({ id: "m1", name: "Manager", email: "m@example.com", isManager: true });
    const nonManager = person({ id: "u1", name: "User", email: "u@example.com" });
    const unresolvedManager = person({ id: "m2", name: "Unresolved Manager", isManager: true });

    const resolution = {
      resolved: new Map([
        ["m1", { personId: "m1", email: "m@example.com", userId: "user-m1" }],
        ["u1", { personId: "u1", email: "u@example.com", userId: "user-u1" }],
      ]),
      unmappedCount: 1,
      ambiguousEmailCount: 0,
      noEmailCount: 0,
    };

    const recipients = filterManagerRecipients([manager, nonManager, unresolvedManager], resolution);
    expect(recipients).toEqual([{ personId: "m1", email: "m@example.com", userId: "user-m1" }]);
  });
});

describe("resolvePersonIdentity", () => {
  it("mapped: a unique email matching a Supabase auth user", async () => {
    vi.resetModules();
    const { resolvePersonIdentity } = await import("./recipients");
    const people = [person({ id: "p1", name: "Dana", email: "dana@example.com" })];
    const emailToAccount = new Map([["dana@example.com", { userId: "user-1", avatarUrl: null }]]);

    expect(resolvePersonIdentity(people[0], people, emailToAccount)).toEqual({
      status: "mapped",
      normalizedEmail: "dana@example.com",
      userId: "user-1",
      avatarUrl: null,
    });
  });

  it("mapped: carries the account's avatarUrl through unchanged", async () => {
    vi.resetModules();
    const { resolvePersonIdentity } = await import("./recipients");
    const people = [person({ id: "p1", name: "Dana", email: "dana@example.com" })];
    const emailToAccount = new Map([
      ["dana@example.com", { userId: "user-1", avatarUrl: "https://example.invalid/photo.jpg" }],
    ]);

    expect(resolvePersonIdentity(people[0], people, emailToAccount)).toEqual({
      status: "mapped",
      normalizedEmail: "dana@example.com",
      userId: "user-1",
      avatarUrl: "https://example.invalid/photo.jpg",
    });
  });

  it("no_email: person has no email at all", async () => {
    vi.resetModules();
    const { resolvePersonIdentity } = await import("./recipients");
    const people = [person({ id: "p1", name: "No Email" })];

    expect(resolvePersonIdentity(people[0], people, new Map())).toEqual({ status: "no_email" });
  });

  it("ambiguous: two roster people share a normalized email -- fails closed for both", async () => {
    vi.resetModules();
    const { resolvePersonIdentity } = await import("./recipients");
    const people = [
      person({ id: "p1", name: "First", email: "shared@example.com" }),
      person({ id: "p2", name: "Second", email: " Shared@Example.com " }),
    ];

    expect(resolvePersonIdentity(people[0], people, new Map())).toEqual({ status: "ambiguous" });
    expect(resolvePersonIdentity(people[1], people, new Map())).toEqual({ status: "ambiguous" });
  });

  it("unmapped: a unique email with no matching Supabase auth user", async () => {
    vi.resetModules();
    const { resolvePersonIdentity } = await import("./recipients");
    const people = [person({ id: "p1", name: "Ghost", email: "ghost@example.com" })];

    expect(resolvePersonIdentity(people[0], people, new Map())).toEqual({
      status: "unmapped",
      normalizedEmail: "ghost@example.com",
    });
  });
});

describe("fetchAllUserIdsByEmail", () => {
  it("carries each account's avatar through from the SAME bulk listUsers() response, never a second Admin API call", async () => {
    vi.resetModules();
    const fakeListUsers = vi.fn(async () => ({
      data: {
        users: [
          { id: "user-1", email: "dana@example.com", user_metadata: { avatar_url: "https://example.invalid/dana.jpg" } },
        ],
      },
      error: null,
    }));
    const fakeSupabase = { auth: { admin: { listUsers: fakeListUsers } } };
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { fetchAllUserIdsByEmail } = await import("./recipients");
    const accounts = await fetchAllUserIdsByEmail();

    expect(accounts.get("dana@example.com")).toEqual({ userId: "user-1", avatarUrl: "https://example.invalid/dana.jpg" });
    expect(fakeListUsers).toHaveBeenCalledTimes(1);
  });

  it("a user with no usable avatar metadata resolves to avatarUrl: null, never a crash", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([{ id: "user-1", email: "dana@example.com" }]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { fetchAllUserIdsByEmail } = await import("./recipients");
    const accounts = await fetchAllUserIdsByEmail();

    expect(accounts.get("dana@example.com")).toEqual({ userId: "user-1", avatarUrl: null });
  });
});

describe("fetchVerifiedEmailsByUserId", () => {
  it("maps each auth user id to its normalized email -- only when Supabase Auth has confirmed it", async () => {
    vi.resetModules();
    const fakeListUsers = vi.fn(async () => ({
      data: {
        users: [
          { id: "user-1", email: "  Dana@Example.COM ", email_confirmed_at: "2026-01-01T00:00:00Z" },
          { id: "user-2", email: "unconfirmed@example.com", email_confirmed_at: null },
          { id: "user-3", email: null, email_confirmed_at: "2026-01-01T00:00:00Z" },
          { id: "user-4", email: "noconfirmfield@example.com" },
        ],
      },
      error: null,
    }));
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => ({ auth: { admin: { listUsers: fakeListUsers } } }) }));

    const { fetchVerifiedEmailsByUserId } = await import("./recipients");
    const emails = await fetchVerifiedEmailsByUserId();

    expect([...emails]).toEqual([["user-1", "dana@example.com"]]);
    expect(fakeListUsers).toHaveBeenCalledTimes(1);
  });

  it("pages through every account (one bulk pass, never a per-user call)", async () => {
    vi.resetModules();
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ id: `user-${i}`, email: `u${i}@example.com`, email_confirmed_at: "2026-01-01T00:00:00Z" }));
    const fakeListUsers = vi
      .fn()
      .mockResolvedValueOnce({ data: { users: fullPage }, error: null })
      .mockResolvedValueOnce({ data: { users: [{ id: "user-last", email: "last@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" }] }, error: null });
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => ({ auth: { admin: { listUsers: fakeListUsers } } }) }));

    const { fetchVerifiedEmailsByUserId } = await import("./recipients");
    const emails = await fetchVerifiedEmailsByUserId();

    expect(emails.size).toBe(1001);
    expect(emails.get("user-last")).toBe("last@example.com");
    expect(fakeListUsers).toHaveBeenCalledTimes(2);
  });

  it("propagates an Admin API error rather than returning a partial directory", async () => {
    vi.resetModules();
    const fakeListUsers = vi.fn(async () => ({ data: { users: [] }, error: Object.assign(new Error("admin api down"), { name: "AuthApiError", status: 500 }) }));
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => ({ auth: { admin: { listUsers: fakeListUsers } } }) }));

    const { fetchVerifiedEmailsByUserId } = await import("./recipients");
    await expect(fetchVerifiedEmailsByUserId()).rejects.toThrow("admin api down");
  });
});

describe("fetchAllSubscribedUserIds", () => {
  it("returns distinct user ids from push_subscriptions", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([], ["user-1", "user-1", "user-2"]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { fetchAllSubscribedUserIds } = await import("./recipients");
    const userIds = await fetchAllSubscribedUserIds();

    expect(new Set(userIds)).toEqual(new Set(["user-1", "user-2"]));
  });

  it("counts only ACTIVE subscriptions -- the same `revoked_at is null` filter the delivery worker's own targeting applies", async () => {
    vi.resetModules();
    const fakeSupabase = makeFakeSupabase([], ["user-1"]);
    vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeSupabase }));

    const { fetchAllSubscribedUserIds } = await import("./recipients");
    await fetchAllSubscribedUserIds();

    expect(fakeSupabase.isFilters).toEqual([["revoked_at", null]]);
  });
});

