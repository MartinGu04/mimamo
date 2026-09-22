import { describe, expect, it, vi } from "vitest";
import type { RawPushSubscription } from "@/lib/push/subscriptionValidation";
import { UNKNOWN_DEVICE_DESCRIPTOR } from "@/lib/push/deviceDescriptor";

const rpcMock = vi.fn();
const deleteEqMock = vi.fn();
const selectMaybeSingleMock = vi.fn();

function makeFakeSupabaseClient() {
  return {
    rpc: (fn: string, params: Record<string, unknown>) => {
      rpcMock(fn, params);
      return { single: () => rpcMock.mock.results.at(-1)?.value ?? Promise.resolve({ data: null, error: null }) };
    },
    from: (table: string) => ({
      delete: () => ({
        eq: (column: string, value: string) => ({
          // `.is("revoked_at", null)` -- sign-out cleanup must never
          // delete a REVOKED row (a tombstone), or a removed device
          // could resurrect itself on the next sign-in.
          is: (isColumn: string, isValue: unknown) => deleteEqMock(table, column, value, isColumn, isValue),
        }),
      }),
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: () => selectMaybeSingleMock(table, columns, column, value),
        }),
      }),
    }),
  };
}

const createSupabaseServerClient = vi.fn(async () => makeFakeSupabaseClient());
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createSupabaseServerClient() }));

const {
  deletePushSubscriptionForCurrentUser,
  findPushSubscriptionForCurrentUser,
  upsertPushSubscriptionForCurrentUser,
  touchPushSubscriptionForCurrentUser,
  revokeDeviceForCurrentUser,
} = await import("./subscriptionStore");

const SUBSCRIPTION: RawPushSubscription = {
  endpoint: "https://push.example/e1",
  p256dh: "p256dh-key",
  auth: "auth-key",
  expirationTime: null,
};

describe("upsertPushSubscriptionForCurrentUser", () => {
  it("calls the upsert_push_subscription RPC with the subscription fields, never a client-supplied user id", async () => {
    // Reconfigure rpc to actually resolve for this call.
    const client = makeFakeSupabaseClient();
    client.rpc = (fn: string, params: Record<string, unknown>) => {
      rpcMock(fn, params);
      return {
        single: () =>
          Promise.resolve({
            data: {
              id: "sub_1",
              endpoint: SUBSCRIPTION.endpoint,
              p256dh: "p256dh-key",
              auth: "auth-key",
              expiration_time: null,
              revoked_at: null,
              revoked_reason: null,
            },
            error: null,
          }),
      };
    };
    createSupabaseServerClient.mockResolvedValueOnce(client);

    const result = await upsertPushSubscriptionForCurrentUser(SUBSCRIPTION, "explicit", {
      type: "phone",
      platform: "ios",
      browser: "safari",
      standalone: true,
    });

    expect(rpcMock).toHaveBeenCalledWith("upsert_push_subscription_v2", {
      p_endpoint: SUBSCRIPTION.endpoint,
      p_p256dh: SUBSCRIPTION.p256dh,
      p_auth: SUBSCRIPTION.auth,
      p_expiration_time: null,
      p_explicit: true,
      p_device_type: "phone",
      p_device_platform: "ios",
      p_device_browser: "safari",
      p_device_standalone: true,
    });
    const [, params] = rpcMock.mock.calls.at(-1)!;
    expect(params).not.toHaveProperty("p_user_id");
    expect(params).not.toHaveProperty("user_id");

    expect(result).toEqual({
      ok: true,
      subscription: {
        id: "sub_1",
        endpoint: SUBSCRIPTION.endpoint,
        p256dh: "p256dh-key",
        auth: "auth-key",
        expirationTime: null,
        revokedAt: null,
        revokedReason: null,
      },
    });
  });

  it("passes p_explicit: false for the silent auto-restore path -- the flag the database uses to refuse reviving a revoked device", async () => {
    const client = makeFakeSupabaseClient();
    client.rpc = (fn: string, params: Record<string, unknown>) => {
      rpcMock(fn, params);
      return {
        single: () =>
          Promise.resolve({
            data: {
              id: "sub_1",
              endpoint: SUBSCRIPTION.endpoint,
              p256dh: "k",
              auth: "k",
              expiration_time: null,
              revoked_at: null,
              revoked_reason: null,
            },
            error: null,
          }),
      };
    };
    createSupabaseServerClient.mockResolvedValueOnce(client);

    await upsertPushSubscriptionForCurrentUser(SUBSCRIPTION, "passive", UNKNOWN_DEVICE_DESCRIPTOR);

    const [, params] = rpcMock.mock.calls.at(-1)! as [string, { p_explicit: boolean }];
    expect(params.p_explicit).toBe(false);
  });

  it("reports revoked: true when the RPC rejects the upsert because the device is revoked", async () => {
    const client = makeFakeSupabaseClient();
    client.rpc = () => ({
      single: () => Promise.resolve({ data: null, error: { message: "push subscription is revoked on this device" } }),
    });
    createSupabaseServerClient.mockResolvedValueOnce(client);

    const result = await upsertPushSubscriptionForCurrentUser(SUBSCRIPTION, "passive", UNKNOWN_DEVICE_DESCRIPTOR);
    expect(result).toEqual({
      ok: false,
      revoked: true,
      reason: "push subscription is revoked on this device",
    });
  });

  it("converts a numeric epoch-ms expirationTime to an ISO timestamp for the RPC param", async () => {
    const client = makeFakeSupabaseClient();
    client.rpc = (fn: string, params: Record<string, unknown>) => {
      rpcMock(fn, params);
      return {
        single: () =>
          Promise.resolve({
            data: {
              id: "sub_1",
              endpoint: SUBSCRIPTION.endpoint,
              p256dh: "k",
              auth: "k",
              expiration_time: null,
              revoked_at: null,
              revoked_reason: null,
            },
            error: null,
          }),
      };
    };
    createSupabaseServerClient.mockResolvedValueOnce(client);

    await upsertPushSubscriptionForCurrentUser(
      { ...SUBSCRIPTION, expirationTime: 1750000000000 },
      "explicit",
      UNKNOWN_DEVICE_DESCRIPTOR,
    );

    const [, params] = rpcMock.mock.calls.at(-1)! as [string, { p_expiration_time: string }];
    expect(params.p_expiration_time).toBe(new Date(1750000000000).toISOString());
  });

  it("returns a failure result (never throws) when the RPC errors", async () => {
    const client = makeFakeSupabaseClient();
    client.rpc = () => ({
      single: () => Promise.resolve({ data: null, error: { message: "permission denied" } }),
    });
    createSupabaseServerClient.mockResolvedValueOnce(client);

    const result = await upsertPushSubscriptionForCurrentUser(SUBSCRIPTION, "explicit", UNKNOWN_DEVICE_DESCRIPTOR);
    expect(result.ok).toBe(false);
  });
});

describe("deletePushSubscriptionForCurrentUser", () => {
  it("deletes scoped by endpoint and reports ok on success", async () => {
    deleteEqMock.mockReset().mockResolvedValue({ error: null });
    createSupabaseServerClient.mockResolvedValueOnce(makeFakeSupabaseClient());

    const result = await deletePushSubscriptionForCurrentUser("https://push.example/e1");

    expect(deleteEqMock).toHaveBeenCalledWith(
      "push_subscriptions",
      "endpoint",
      "https://push.example/e1",
      "revoked_at",
      null,
    );
    expect(result).toEqual({ ok: true });
  });

  it("reports ok:false (never throws) when the delete errors, so callers can decide how to handle it", async () => {
    deleteEqMock.mockReset().mockResolvedValue({ error: { message: "boom" } });
    createSupabaseServerClient.mockResolvedValueOnce(makeFakeSupabaseClient());

    const result = await deletePushSubscriptionForCurrentUser("https://push.example/e1");
    expect(result).toEqual({ ok: false });
  });
});

describe("findPushSubscriptionForCurrentUser", () => {
  it("returns the RLS-scoped row mapped to camelCase when found", async () => {
    selectMaybeSingleMock.mockReset().mockResolvedValue({
      data: {
        id: "sub_1",
        endpoint: "https://push.example/e1",
        p256dh: "p",
        auth: "a",
        expiration_time: "2026-01-01T00:00:00.000Z",
        revoked_at: null,
        revoked_reason: null,
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValueOnce(makeFakeSupabaseClient());

    const result = await findPushSubscriptionForCurrentUser("https://push.example/e1");
    expect(result).toEqual({
      id: "sub_1",
      endpoint: "https://push.example/e1",
      p256dh: "p",
      auth: "a",
      expirationTime: "2026-01-01T00:00:00.000Z",
      revokedAt: null,
      revokedReason: null,
    });
  });

  it("surfaces a revoked row's tombstone fields rather than hiding them -- the caller must be able to tell 'revoked' from 'never registered'", async () => {
    selectMaybeSingleMock.mockReset().mockResolvedValue({
      data: {
        id: "sub_1",
        endpoint: "https://push.example/e1",
        p256dh: "p",
        auth: "a",
        expiration_time: null,
        revoked_at: "2026-09-01T00:00:00.000Z",
        revoked_reason: "permanent_push_failure",
      },
      error: null,
    });
    createSupabaseServerClient.mockResolvedValueOnce(makeFakeSupabaseClient());

    const result = await findPushSubscriptionForCurrentUser("https://push.example/e1");
    expect(result?.revokedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(result?.revokedReason).toBe("permanent_push_failure");
  });

  it("returns null (never throws) when no row is found -- covers both 'no such row' and 'belongs to someone else' under RLS", async () => {
    selectMaybeSingleMock.mockReset().mockResolvedValue({ data: null, error: null });
    createSupabaseServerClient.mockResolvedValueOnce(makeFakeSupabaseClient());

    const result = await findPushSubscriptionForCurrentUser("https://push.example/unknown");
    expect(result).toBeNull();
  });

  it("returns null on a query error too, never throws", async () => {
    selectMaybeSingleMock.mockReset().mockResolvedValue({ data: null, error: { message: "boom" } });
    createSupabaseServerClient.mockResolvedValueOnce(makeFakeSupabaseClient());

    const result = await findPushSubscriptionForCurrentUser("https://push.example/e1");
    expect(result).toBeNull();
  });
});

describe("touchPushSubscriptionForCurrentUser (the heartbeat)", () => {
  function heartbeatClient(result: { data: unknown; error: unknown }) {
    const client = makeFakeSupabaseClient();
    client.rpc = (fn: string, params: Record<string, unknown>) => {
      rpcMock(fn, params);
      return Promise.resolve(result) as never;
    };
    return client;
  }

  it("goes through the narrow touch_push_subscription RPC, addressed only by endpoint -- never a user id, never a direct table update", async () => {
    createSupabaseServerClient.mockResolvedValueOnce(heartbeatClient({ data: true, error: null }));

    const result = await touchPushSubscriptionForCurrentUser("https://push.example/e1", UNKNOWN_DEVICE_DESCRIPTOR);

    expect(result).toBe(true);
    const [fn, params] = rpcMock.mock.calls.at(-1)! as [string, Record<string, unknown>];
    expect(fn).toBe("touch_push_subscription");
    expect(params.p_endpoint).toBe("https://push.example/e1");
    expect(params).not.toHaveProperty("p_user_id");
  });

  it("carries this device's coarse descriptor, which is what backfills a legacy row's missing metadata", async () => {
    createSupabaseServerClient.mockResolvedValueOnce(heartbeatClient({ data: true, error: null }));

    await touchPushSubscriptionForCurrentUser("https://push.example/e1", {
      type: "desktop",
      platform: "windows",
      browser: "chrome",
      standalone: false,
    });

    expect(rpcMock).toHaveBeenCalledWith("touch_push_subscription", {
      p_endpoint: "https://push.example/e1",
      p_device_type: "desktop",
      p_device_platform: "windows",
      p_device_browser: "chrome",
      p_device_standalone: false,
    });
  });

  it("sends nulls for an unknown descriptor -- a device we cannot describe must never clear metadata already stored", async () => {
    createSupabaseServerClient.mockResolvedValueOnce(heartbeatClient({ data: true, error: null }));

    await touchPushSubscriptionForCurrentUser("https://push.example/e1", UNKNOWN_DEVICE_DESCRIPTOR);

    const [, params] = rpcMock.mock.calls.at(-1)! as [string, Record<string, unknown>];
    // `coalesce(<column>, null)` keeps whatever the column already held,
    // so an unknown descriptor is a guaranteed no-op on metadata.
    expect(params.p_device_type).toBeNull();
    expect(params.p_device_platform).toBeNull();
    expect(params.p_device_browser).toBeNull();
    expect(params.p_device_standalone).toBeNull();
  });

  it("reports false (never throws) when the RPC errors -- a heartbeat must never be able to break the app", async () => {
    createSupabaseServerClient.mockResolvedValueOnce(heartbeatClient({ data: null, error: { message: "boom" } }));

    expect(await touchPushSubscriptionForCurrentUser("https://push.example/e1", UNKNOWN_DEVICE_DESCRIPTOR)).toBe(false);
  });
});

describe("revokeDeviceForCurrentUser", () => {
  it("revokes by opaque device_ref through the RPC, never by endpoint and never a delete", async () => {
    const client = makeFakeSupabaseClient();
    client.rpc = (fn: string, params: Record<string, unknown>) => {
      rpcMock(fn, params);
      return Promise.resolve({ data: true, error: null }) as never;
    };
    createSupabaseServerClient.mockResolvedValueOnce(client);
    deleteEqMock.mockReset();

    const result = await revokeDeviceForCurrentUser("ref-abc", "user_removed");

    expect(result).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("revoke_push_subscription", {
      p_device_ref: "ref-abc",
      p_reason: "user_removed",
    });
    expect(deleteEqMock).not.toHaveBeenCalled();
  });

  it("reports false for an unknown/foreign device_ref -- indistinguishable from 'does not exist'", async () => {
    const client = makeFakeSupabaseClient();
    client.rpc = () => Promise.resolve({ data: false, error: null }) as never;
    createSupabaseServerClient.mockResolvedValueOnce(client);

    expect(await revokeDeviceForCurrentUser("someone-elses-ref", "user_removed")).toBe(false);
  });
});
