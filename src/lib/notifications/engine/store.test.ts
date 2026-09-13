import { afterEach, describe, expect, it, vi } from "vitest";
import type { FactChange } from "./diffFacts";
import type { SemanticFact } from "./semanticFacts";

interface FakeRow {
  fact_key: string;
  category: string;
  original_value: Record<string, unknown>;
  latest_value: Record<string, unknown>;
  settle_at?: string;
}

/**
 * A minimal, faithful fake of the exact postgrest query shapes
 * `applyPendingChanges` uses (`from().select().eq()` awaited directly,
 * `from().delete().eq().in()`, `from().upsert()`) -- there is no local
 * Supabase/PostgREST stack available in this sandbox to test the real
 * HTTP layer against (unlike the SQL functions themselves, which ARE
 * proven against real Postgres in
 * `notificationEngineFunctions.integration.test.ts`). This is the same
 * fake-client style used by `recipients.test.ts`.
 *
 * Stateful (`rows` persists across calls) so the multi-tick simulations
 * below can call `applyPendingChanges` repeatedly, exactly like the real
 * worker firing every 5 minutes, and observe what a LATER tick actually
 * sees from an EARLIER tick's write -- not just single isolated calls.
 */
function makeStatefulFakeSupabase(initialRows: FakeRow[] = []) {
  const rows = new Map<string, FakeRow>(initialRows.map((row) => [row.fact_key, row]));

  const client = {
    from: (table: string) => {
      if (table !== "pending_notification_changes") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [...rows.values()], error: null }),
        }),
        delete: () => ({
          eq: () => ({
            in: (_column: string, keys: string[]) => {
              for (const key of keys) rows.delete(key);
              return Promise.resolve({ error: null });
            },
          }),
        }),
        upsert: (newRows: Record<string, unknown>[]) => {
          for (const row of newRows) rows.set(row.fact_key as string, row as unknown as FakeRow);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  return { client, rows };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
});

async function loadModule(fakeClient: unknown) {
  vi.doMock("./serviceClient", () => ({ getNotificationServiceClient: () => fakeClient }));
  return import("./store");
}

function fact(factKey: string, category: string, value: unknown): SemanticFact {
  return { factKey, category: category as SemanticFact["category"], value: value as SemanticFact["value"] };
}

const EVENING = { entries: [{ period: "day", role: "technician", shadow: false }] };
const MORNING = { entries: [{ period: "morning", role: "technician", shadow: false }] };
const NIGHT = { entries: [{ period: "night", role: "technician", shadow: false }] };
const KEY = "shift:p1:2026-08-18";
const WEEK = "2026-08-16";

describe("applyPendingChanges -- single-tick cases", () => {
  it("opens a brand-new pending row with original = the observed (old) value", async () => {
    const { client, rows } = makeStatefulFakeSupabase([]);
    const { applyPendingChanges } = await loadModule(client);

    const change: FactChange = { factKey: KEY, category: "shift", oldValue: EVENING as never, newValue: NIGHT as never };
    const freshFacts = new Map([[KEY, fact(KEY, "shift", NIGHT)]]);

    await applyPendingChanges(WEEK, [change], freshFacts);

    const row = rows.get(KEY)!;
    expect(row.original_value).toEqual(EVENING);
    expect(row.latest_value).toEqual(NIGHT);
  });

  it("extends an already-open row with a GENUINELY NEW value: keeps the FIRST original_value, updates latest_value and settle_at", async () => {
    const existing: FakeRow = { fact_key: KEY, category: "shift", original_value: EVENING, latest_value: MORNING };
    const { client, rows } = makeStatefulFakeSupabase([existing]);
    const { applyPendingChanges } = await loadModule(client);

    // The diff's own oldValue here is stale ("morning"), but the row's
    // REAL original ("evening") must be preserved, never overwritten by
    // the diff's oldValue.
    const change: FactChange = { factKey: KEY, category: "shift", oldValue: MORNING as never, newValue: NIGHT as never };
    const freshFacts = new Map([[KEY, fact(KEY, "shift", NIGHT)]]);

    await applyPendingChanges(WEEK, [change], freshFacts);

    const row = rows.get(KEY)!;
    expect(row.original_value).toEqual(EVENING);
    expect(row.latest_value).toEqual(NIGHT);
  });

  it("a fresh value identical to the row's already-recorded latest_value leaves the row COMPLETELY untouched -- polling is never evidence of a new change", async () => {
    const existing: FakeRow = {
      fact_key: KEY,
      category: "shift",
      original_value: EVENING,
      latest_value: MORNING,
      settle_at: "2026-08-16T18:10:00.000Z",
    };
    const { client, rows } = makeStatefulFakeSupabase([existing]);
    const { applyPendingChanges } = await loadModule(client);

    const change: FactChange = { factKey: KEY, category: "shift", oldValue: EVENING as never, newValue: MORNING as never };
    const freshFacts = new Map([[KEY, fact(KEY, "shift", MORNING)]]);

    await applyPendingChanges(WEEK, [change], freshFacts);

    const row = rows.get(KEY)!;
    expect(row.settle_at).toBe("2026-08-16T18:10:00.000Z"); // completely unchanged
    expect(row.latest_value).toEqual(MORNING);
  });

  it("cancels a pending row when the fresh value returns to the row's TRUE original", async () => {
    const existing: FakeRow = { fact_key: KEY, category: "shift", original_value: EVENING, latest_value: NIGHT };
    const { client, rows } = makeStatefulFakeSupabase([existing]);
    const { applyPendingChanges } = await loadModule(client);

    const change: FactChange = { factKey: KEY, category: "shift", oldValue: NIGHT as never, newValue: EVENING as never };
    const freshFacts = new Map([[KEY, fact(KEY, "shift", EVENING)]]);

    await applyPendingChanges(WEEK, [change], freshFacts);

    expect(rows.has(KEY)).toBe(false);
  });

  it("cancels a stale open row even when THIS tick's diff never mentions it -- the 'orphaned revert' case", async () => {
    const existing: FakeRow = { fact_key: KEY, category: "shift", original_value: EVENING, latest_value: MORNING };
    const { client, rows } = makeStatefulFakeSupabase([existing]);
    const { applyPendingChanges } = await loadModule(client);

    const freshFacts = new Map([[KEY, fact(KEY, "shift", EVENING)]]);
    await applyPendingChanges(WEEK, [], freshFacts); // no diffed changes this tick at all

    expect(rows.has(KEY)).toBe(false);
  });

  it("cancels a false pending row caused only by jsonb object-key reordering", async () => {
    const jsonbOrderedEvening = { entries: [{ role: "technician", period: "day", shadow: false }] };
    const existing: FakeRow = {
      fact_key: KEY,
      category: "shift",
      original_value: jsonbOrderedEvening,
      latest_value: jsonbOrderedEvening,
    };
    const { client, rows } = makeStatefulFakeSupabase([existing]);
    const { applyPendingChanges } = await loadModule(client);

    await applyPendingChanges(WEEK, [], new Map([[KEY, fact(KEY, "shift", EVENING)]]));

    expect(rows.has(KEY)).toBe(false);
  });

  it("does nothing when there are no changes and no open pending rows", async () => {
    const { client, rows } = makeStatefulFakeSupabase([]);
    const { applyPendingChanges } = await loadModule(client);

    await applyPendingChanges(WEEK, [], new Map());

    expect(rows.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-tick simulations at the real production cadence: the worker fires
// every 5 minutes and re-diffs `observed` (unchanged until settlement)
// against a fresh read every time, so these tests call
// applyPendingChanges REPEATEDLY across simulated 5-minute ticks --
// exactly reproducing the bug report's scenario -- rather than calling
// the function once and trusting the single-call unit tests above to
// generalize.
// ---------------------------------------------------------------------------

function at(isoTime: string): void {
  vi.setSystemTime(new Date(isoTime));
}

describe("applyPendingChanges -- repeated worker ticks at 5-minute cadence", () => {
  it("A. a stable changed value settles on schedule -- settle_at must NOT be pushed forward by repeated polling of the same unsettled diff", async () => {
    vi.useFakeTimers();
    const { client, rows } = makeStatefulFakeSupabase([]);
    const { applyPendingChanges } = await loadModule(client);
    const freshFacts = new Map([[KEY, fact(KEY, "shift", MORNING)]]);
    const change: FactChange = { factKey: KEY, category: "shift", oldValue: EVENING as never, newValue: MORNING as never };

    // T=00 -- observed=evening, fresh=morning. Opens the pending row.
    at("2026-08-16T18:00:00.000Z");
    await applyPendingChanges(WEEK, [change], freshFacts);
    const settleAtAfterFirstTick = rows.get(KEY)!.settle_at;
    expect(settleAtAfterFirstTick).toBe("2026-08-16T18:10:00.000Z");

    // T=05 -- observed STILL evening (nothing settled yet), fresh STILL
    // morning -- diffSemanticFacts(observed, fresh) reports the exact
    // same "evening -> morning" change again, since observed hasn't
    // moved. settle_at must remain exactly what it was.
    at("2026-08-16T18:05:00.000Z");
    await applyPendingChanges(WEEK, [change], freshFacts);
    expect(rows.get(KEY)!.settle_at).toBe(settleAtAfterFirstTick);

    // A third tick at T=09 (still before the original 18:10 deadline)
    // must ALSO leave it untouched -- proves this isn't a one-off fluke.
    at("2026-08-16T18:09:00.000Z");
    await applyPendingChanges(WEEK, [change], freshFacts);
    expect(rows.get(KEY)!.settle_at).toBe(settleAtAfterFirstTick);

    // T=10+ -- claim/settle is the real SQL function's job (proven for
    // real against Postgres in
    // notificationEngineFunctions.integration.test.ts); here we only
    // assert the row is exactly what a correct settle should consume:
    // original=evening, latest=morning, due at 18:10.
    expect(rows.get(KEY)).toMatchObject({ original_value: EVENING, latest_value: MORNING, settle_at: "2026-08-16T18:10:00.000Z" });
  });

  it("B. evening -> morning -> night coalesces: settle_at resets only on the GENUINE second change, not on repeated polling of either value", async () => {
    vi.useFakeTimers();
    const { client, rows } = makeStatefulFakeSupabase([]);
    const { applyPendingChanges } = await loadModule(client);

    // T=00: evening -> morning.
    at("2026-08-16T18:00:00.000Z");
    await applyPendingChanges(WEEK, [{ factKey: KEY, category: "shift", oldValue: EVENING as never, newValue: MORNING as never }], new Map([[KEY, fact(KEY, "shift", MORNING)]]));
    expect(rows.get(KEY)!.settle_at).toBe("2026-08-16T18:10:00.000Z");

    // T=05: still morning -- must not move settle_at.
    at("2026-08-16T18:05:00.000Z");
    await applyPendingChanges(WEEK, [{ factKey: KEY, category: "shift", oldValue: EVENING as never, newValue: MORNING as never }], new Map([[KEY, fact(KEY, "shift", MORNING)]]));
    expect(rows.get(KEY)!.settle_at).toBe("2026-08-16T18:10:00.000Z");

    // T=07: morning -> night. A genuinely new value -- resets the clock.
    at("2026-08-16T18:07:00.000Z");
    await applyPendingChanges(WEEK, [{ factKey: KEY, category: "shift", oldValue: EVENING as never, newValue: NIGHT as never }], new Map([[KEY, fact(KEY, "shift", NIGHT)]]));
    expect(rows.get(KEY)!.settle_at).toBe("2026-08-16T18:17:00.000Z");
    expect(rows.get(KEY)!.original_value).toEqual(EVENING); // still the true original

    // T=12: still night -- must not move settle_at again.
    at("2026-08-16T18:12:00.000Z");
    await applyPendingChanges(WEEK, [{ factKey: KEY, category: "shift", oldValue: EVENING as never, newValue: NIGHT as never }], new Map([[KEY, fact(KEY, "shift", NIGHT)]]));
    expect(rows.get(KEY)!.settle_at).toBe("2026-08-16T18:17:00.000Z");

    // T=17+: ready to settle as evening -> night (a single coalesced
    // notification, not two) -- the real settle/claim mechanics are
    // proven against real Postgres elsewhere; here we assert the row
    // that would be consumed is exactly right.
    expect(rows.get(KEY)).toMatchObject({ original_value: EVENING, latest_value: NIGHT });
  });

  it("C. evening -> morning -> evening (revert) sends zero notifications", async () => {
    vi.useFakeTimers();
    const { client, rows } = makeStatefulFakeSupabase([]);
    const { applyPendingChanges } = await loadModule(client);

    // T=00: evening -> morning.
    at("2026-08-16T18:00:00.000Z");
    await applyPendingChanges(WEEK, [{ factKey: KEY, category: "shift", oldValue: EVENING as never, newValue: MORNING as never }], new Map([[KEY, fact(KEY, "shift", MORNING)]]));
    expect(rows.has(KEY)).toBe(true);

    // T=05: still morning -- no-op.
    at("2026-08-16T18:05:00.000Z");
    await applyPendingChanges(WEEK, [{ factKey: KEY, category: "shift", oldValue: EVENING as never, newValue: MORNING as never }], new Map([[KEY, fact(KEY, "shift", MORNING)]]));
    expect(rows.has(KEY)).toBe(true);

    // T=07: fresh reverts to "evening" -- since `observed` is STILL
    // "evening" too (nothing has settled), the real
    // diffSemanticFacts(observed, fresh) would report NO change at all
    // for this key (old === new), so this tick's `changes` array is
    // empty here -- exactly the "orphaned revert" path, not a
    // change-object with oldValue===newValue (which diffSemanticFacts
    // itself would never produce).
    at("2026-08-16T18:07:00.000Z");
    await applyPendingChanges(WEEK, [], new Map([[KEY, fact(KEY, "shift", EVENING)]]));

    expect(rows.has(KEY)).toBe(false); // no pending row left to ever settle -- zero notifications
  });
});

describe("getRecentSettledJobsForRecipient (personal Home 'since your previous visit' recap)", () => {
  interface FakeJobRow {
    id: string;
    category: string;
    title: string;
    body: string;
    path: string;
    source_ref: string | null;
    created_at: string;
    recipient_user_id: string;
    status?: string;
  }

  /** A minimal, faithful fake of `.from("notification_jobs").select(cols, {count:'exact'}).eq().in().gt().order().limit()` -- same style as `makeStatefulFakeSupabase` above, scoped to this one query shape. `count` mirrors postgrest's real `count: "exact"` behavior: computed over the WHOLE filtered match set, independent of `limit()`. */
  function makeJobsFakeSupabase(rows: FakeJobRow[]) {
    const calls: Record<string, unknown> = {};
    const client = {
      from: (table: string) => {
        if (table !== "notification_jobs") throw new Error(`unexpected table ${table}`);
        let filtered = [...rows];
        const builder = {
          select: (columns: string, options?: { count?: string }) => {
            calls.select = columns;
            calls.selectOptions = options;
            return builder;
          },
          eq: (column: string, value: unknown) => {
            calls.eq = [column, value];
            filtered = filtered.filter((row) => (row as unknown as Record<string, unknown>)[column] === value);
            return builder;
          },
          in: (column: string, values: unknown[]) => {
            calls.in = [column, values];
            filtered = filtered.filter((row) => values.includes((row as unknown as Record<string, unknown>)[column]));
            return builder;
          },
          gt: (column: string, value: string) => {
            calls.gt = [column, value];
            filtered = filtered.filter((row) => String((row as unknown as Record<string, unknown>)[column]) > value);
            return builder;
          },
          order: (column: string, opts: { ascending: boolean }) => {
            calls.order = [column, opts];
            filtered = [...filtered].sort((a, b) => {
              const av = String((a as unknown as Record<string, unknown>)[column]);
              const bv = String((b as unknown as Record<string, unknown>)[column]);
              const cmp = av < bv ? -1 : av > bv ? 1 : 0;
              return opts.ascending ? cmp : -cmp;
            });
            return builder;
          },
          limit: (n: number) => {
            calls.limit = n;
            return Promise.resolve({ data: filtered.slice(0, n), error: null, count: filtered.length });
          },
        };
        return builder;
      },
    };
    return { client, calls };
  }

  function jobRow(overrides: Partial<FakeJobRow> = {}): FakeJobRow {
    return {
      id: "job_1",
      category: "shift_change",
      title: "⚠️ שינוי בשיבוץ",
      body: "השיבוץ שלך ליום חמישי השתנה: יום → לילה",
      path: "/schedule",
      source_ref: "shift:p_me:2026-08-19",
      created_at: "2026-08-16T10:00:00.000Z",
      recipient_user_id: "u_me",
      status: "completed",
      ...overrides,
    };
  }

  it("filters by recipient_user_id, category IN (...), and created_at STRICTLY AFTER sinceIso (.gt, never .gte)", async () => {
    const { client, calls } = makeJobsFakeSupabase([jobRow()]);
    const { getRecentSettledJobsForRecipient } = await loadModule(client);

    const { rows } = await getRecentSettledJobsForRecipient(
      "u_me",
      ["shift_change", "team_change", "duty_change"],
      "2026-08-13T10:00:00.000Z",
      3,
    );

    expect(calls.eq).toEqual(["recipient_user_id", "u_me"]);
    expect(calls.in).toEqual(["category", ["shift_change", "team_change", "duty_change"]]);
    expect(calls.gt).toEqual(["created_at", "2026-08-13T10:00:00.000Z"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("job_1");
  });

  describe("previous-visit boundary is strictly AFTER, never >= (a job created exactly AT the cutoff belongs to that boundary, not the next period)", () => {
    const CUTOFF = "2026-08-24T20:00:00.000Z";

    it("created_at < cutoff -> excluded", async () => {
      const { client } = makeJobsFakeSupabase([jobRow({ id: "before", created_at: "2026-08-24T19:59:59.999Z" })]);
      const { getRecentSettledJobsForRecipient } = await loadModule(client);

      const { rows, totalCount } = await getRecentSettledJobsForRecipient("u_me", ["shift_change"], CUTOFF, 10);

      expect(rows).toEqual([]);
      expect(totalCount).toBe(0);
    });

    it("created_at == cutoff -> excluded", async () => {
      const { client } = makeJobsFakeSupabase([jobRow({ id: "exact", created_at: CUTOFF })]);
      const { getRecentSettledJobsForRecipient } = await loadModule(client);

      const { rows, totalCount } = await getRecentSettledJobsForRecipient("u_me", ["shift_change"], CUTOFF, 10);

      expect(rows).toEqual([]);
      expect(totalCount).toBe(0);
    });

    it("created_at > cutoff -> included", async () => {
      const { client } = makeJobsFakeSupabase([jobRow({ id: "after", created_at: "2026-08-24T20:00:00.001Z" })]);
      const { getRecentSettledJobsForRecipient } = await loadModule(client);

      const { rows, totalCount } = await getRecentSettledJobsForRecipient("u_me", ["shift_change"], CUTOFF, 10);

      expect(rows.map((r) => r.id)).toEqual(["after"]);
      expect(totalCount).toBe(1);
    });
  });

  it("requests an exact count in the SAME select call -- never a second query (no N+1)", async () => {
    const { client, calls } = makeJobsFakeSupabase([jobRow()]);
    const { getRecentSettledJobsForRecipient } = await loadModule(client);

    await getRecentSettledJobsForRecipient("u_me", ["shift_change"], "2026-08-13T10:00:00.000Z", 3);

    expect(calls.selectOptions).toEqual({ count: "exact" });
  });

  it("totalCount reflects the FULL match count, even when more rows exist than the limit returns (28)", async () => {
    const rows7 = Array.from({ length: 7 }, (_, i) =>
      jobRow({ id: `job_${i}`, created_at: `2026-08-${10 + i}T10:00:00.000Z` }),
    );
    const { client } = makeJobsFakeSupabase(rows7);
    const { getRecentSettledJobsForRecipient } = await loadModule(client);

    const { rows, totalCount } = await getRecentSettledJobsForRecipient("u_me", ["shift_change"], "2026-08-01T00:00:00.000Z", 3);

    expect(rows).toHaveLength(3);
    expect(totalCount).toBe(7);
  });

  it("totalCount equals rows.length when everything fits within the limit", async () => {
    const { client } = makeJobsFakeSupabase([jobRow({ id: "a" }), jobRow({ id: "b" })]);
    const { getRecentSettledJobsForRecipient } = await loadModule(client);

    const { rows, totalCount } = await getRecentSettledJobsForRecipient("u_me", ["shift_change"], "2026-08-01T00:00:00.000Z", 10);

    expect(totalCount).toBe(rows.length);
    expect(totalCount).toBe(2);
  });

  it("never returns another recipient's rows", async () => {
    const { client } = makeJobsFakeSupabase([jobRow({ id: "mine", recipient_user_id: "u_me" }), jobRow({ id: "theirs", recipient_user_id: "u_other" })]);
    const { getRecentSettledJobsForRecipient } = await loadModule(client);

    const { rows } = await getRecentSettledJobsForRecipient("u_me", ["shift_change"], "2026-08-01T00:00:00.000Z", 10);

    expect(rows.map((r) => r.id)).toEqual(["mine"]);
  });

  it("orders newest first and respects the limit", async () => {
    const { client, calls } = makeJobsFakeSupabase([
      jobRow({ id: "old", created_at: "2026-08-14T00:00:00.000Z" }),
      jobRow({ id: "new", created_at: "2026-08-16T00:00:00.000Z" }),
      jobRow({ id: "mid", created_at: "2026-08-15T00:00:00.000Z" }),
    ]);
    const { getRecentSettledJobsForRecipient } = await loadModule(client);

    const { rows } = await getRecentSettledJobsForRecipient("u_me", ["shift_change"], "2026-08-01T00:00:00.000Z", 2);

    expect(calls.order).toEqual(["created_at", { ascending: false }]);
    expect(calls.limit).toBe(2);
    expect(rows.map((r) => r.id)).toEqual(["new", "mid"]);
  });

  it("includes jobs regardless of push-delivery status -- never filters on status (11)", async () => {
    const { client } = makeJobsFakeSupabase([
      jobRow({ id: "a", status: "completed" }),
      jobRow({ id: "b", status: "failed" }),
      jobRow({ id: "c", status: "skipped" }),
      jobRow({ id: "d", status: "pending" }),
    ]);
    const { getRecentSettledJobsForRecipient } = await loadModule(client);

    const { rows } = await getRecentSettledJobsForRecipient("u_me", ["shift_change"], "2026-08-01T00:00:00.000Z", 10);

    expect(rows.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("never exposes internal columns (recipient_user_id, status, etc.) on the returned rows", async () => {
    const { client } = makeJobsFakeSupabase([jobRow()]);
    const { getRecentSettledJobsForRecipient } = await loadModule(client);

    const {
      rows: [row],
    } = await getRecentSettledJobsForRecipient("u_me", ["shift_change"], "2026-08-01T00:00:00.000Z", 3);

    expect(Object.keys(row).sort()).toEqual(["body", "category", "createdAt", "id", "path", "sourceRef", "title"]);
  });
});

describe("getLatestNotificationSourceRef (aggregate/summary notification dedupe read-back, e.g. weaponQualification.ts)", () => {
  interface FakeSourceRefRow {
    recipient_user_id: string;
    category: string;
    source_ref: string | null;
    created_at: string;
  }

  /** A minimal fake of `.from("notification_jobs").select("source_ref").eq().eq().order().limit(1).maybeSingle()`. */
  function makeSourceRefFakeSupabase(rows: FakeSourceRefRow[]) {
    const client = {
      from: (table: string) => {
        if (table !== "notification_jobs") throw new Error(`unexpected table ${table}`);
        let filtered = [...rows];
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filtered = filtered.filter((row) => (row as unknown as Record<string, unknown>)[column] === value);
            return builder;
          },
          order: (column: string, opts: { ascending: boolean }) => {
            filtered = [...filtered].sort((a, b) => {
              const av = String((a as unknown as Record<string, unknown>)[column]);
              const bv = String((b as unknown as Record<string, unknown>)[column]);
              const cmp = av < bv ? -1 : av > bv ? 1 : 0;
              return opts.ascending ? cmp : -cmp;
            });
            return builder;
          },
          limit: () => builder,
          maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }),
        };
        return builder;
      },
    };
    return client;
  }

  function row(overrides: Partial<FakeSourceRefRow> = {}): FakeSourceRefRow {
    return {
      recipient_user_id: "u_mgr1",
      category: "weapon_qualification_summary",
      source_ref: '["p1:2026-09-02:oxid"]',
      created_at: "2026-08-30T10:00:00.000Z",
      ...overrides,
    };
  }

  it("returns the source_ref of the MOST RECENTLY created job for this recipient+category", async () => {
    const client = makeSourceRefFakeSupabase([
      row({ source_ref: '["a"]', created_at: "2026-08-30T09:00:00.000Z" }),
      row({ source_ref: '["a","b"]', created_at: "2026-08-30T10:00:00.000Z" }),
    ]);
    const { getLatestNotificationSourceRef } = await loadModule(client);

    const result = await getLatestNotificationSourceRef("u_mgr1", "weapon_qualification_summary");

    expect(result).toBe('["a","b"]');
  });

  it("scopes strictly to the given recipient AND category -- another recipient's or another category's job never leaks through", async () => {
    const client = makeSourceRefFakeSupabase([
      row({ recipient_user_id: "u_other", source_ref: '["should-not-appear"]' }),
      row({ category: "coverage_gap", source_ref: '["should-not-appear-either"]' }),
    ]);
    const { getLatestNotificationSourceRef } = await loadModule(client);

    const result = await getLatestNotificationSourceRef("u_mgr1", "weapon_qualification_summary");

    expect(result).toBeNull();
  });

  it("returns null when this recipient has never received a job of this category -- never a fabricated empty-array string", async () => {
    const client = makeSourceRefFakeSupabase([]);
    const { getLatestNotificationSourceRef } = await loadModule(client);

    expect(await getLatestNotificationSourceRef("u_mgr1", "weapon_qualification_summary")).toBeNull();
  });
});

describe("notification center -- inbox read/dismiss state", () => {
  interface FakeInboxJobRow {
    id: string;
    category: string;
    title: string;
    body: string;
    path: string;
    created_at: string;
    scheduled_for: string;
    recipient_user_id: string;
    status: string;
  }

  /** A minimal, faithful fake of `.from("notification_jobs").select().eq().neq().lte().gt().order().limit()` (and, for `isEligibleInboxJobForRecipient`, `.select().eq().eq().neq().maybeSingle()`), same style as `makeJobsFakeSupabase` above. */
  function makeInboxJobsFakeSupabase(rows: FakeInboxJobRow[]) {
    const calls: Record<string, unknown> = {};
    const client = {
      from: (table: string) => {
        if (table !== "notification_jobs") throw new Error(`unexpected table ${table}`);
        let filtered = [...rows];
        const builder = {
          select: (columns: string) => {
            calls.select = columns;
            return builder;
          },
          eq: (column: string, value: unknown) => {
            calls.eq = [column, value];
            filtered = filtered.filter((row) => (row as unknown as Record<string, unknown>)[column] === value);
            return builder;
          },
          neq: (column: string, value: unknown) => {
            calls.neq = [column, value];
            filtered = filtered.filter((row) => (row as unknown as Record<string, unknown>)[column] !== value);
            return builder;
          },
          lte: (column: string, value: string) => {
            calls.lte = [column, value];
            filtered = filtered.filter((row) => String((row as unknown as Record<string, unknown>)[column]) <= value);
            return builder;
          },
          gt: (column: string, value: string) => {
            calls.gt = [column, value];
            filtered = filtered.filter((row) => String((row as unknown as Record<string, unknown>)[column]) > value);
            return builder;
          },
          order: (column: string, opts: { ascending: boolean }) => {
            calls.order = [column, opts];
            filtered = [...filtered].sort((a, b) => {
              const av = String((a as unknown as Record<string, unknown>)[column]);
              const bv = String((b as unknown as Record<string, unknown>)[column]);
              const cmp = av < bv ? -1 : av > bv ? 1 : 0;
              return opts.ascending ? cmp : -cmp;
            });
            return builder;
          },
          limit: (n: number) => {
            calls.limit = n;
            return Promise.resolve({ data: filtered.slice(0, n), error: null });
          },
          maybeSingle: () => {
            calls.maybeSingle = true;
            return Promise.resolve({ data: filtered[0] ?? null, error: null });
          },
        };
        return builder;
      },
    };
    return { client, calls };
  }

  function inboxJobRow(overrides: Partial<FakeInboxJobRow> = {}): FakeInboxJobRow {
    return {
      id: "job_1",
      category: "tomorrow_shift",
      title: "⏰ המשמרת שלך מחר",
      body: "מחר ב־07:30 מתחילה משמרת יום שלך",
      path: "/",
      created_at: "2026-08-18T00:05:00.000Z",
      scheduled_for: "2026-08-18T17:00:00.000Z",
      recipient_user_id: "u_me",
      status: "pending",
      ...overrides,
    };
  }

  describe("getInboxJobsForRecipient", () => {
    it("filters by recipient_user_id, status != cancelled, scheduled_for <= now, and scheduled_for > clearedBefore", async () => {
      const { client, calls } = makeInboxJobsFakeSupabase([inboxJobRow()]);
      const { getInboxJobsForRecipient } = await loadModule(client);

      const rows = await getInboxJobsForRecipient("u_me", "-infinity", 50);

      expect(calls.eq).toEqual(["recipient_user_id", "u_me"]);
      expect(calls.neq).toEqual(["status", "cancelled"]);
      expect((calls.lte as [string, string])[0]).toBe("scheduled_for");
      expect(calls.gt).toEqual(["scheduled_for", "-infinity"]);
      expect(rows).toHaveLength(1);
    });

    it("excludes a cancelled reminder even once its scheduled_for has passed -- a cancelled job never resurfaces as if it still described something real", async () => {
      const { client } = makeInboxJobsFakeSupabase([
        inboxJobRow({ id: "cancelled", status: "cancelled" }),
        inboxJobRow({ id: "still-valid", status: "pending" }),
      ]);
      const { getInboxJobsForRecipient } = await loadModule(client);

      const rows = await getInboxJobsForRecipient("u_me", "-infinity", 50);

      expect(rows.map((r) => r.id)).toEqual(["still-valid"]);
    });

    it("includes every other delivery outcome -- completed/skipped/failed/still-pending all represent a real logical notification", async () => {
      const { client } = makeInboxJobsFakeSupabase([
        inboxJobRow({ id: "a", status: "completed" }),
        inboxJobRow({ id: "b", status: "skipped" }),
        inboxJobRow({ id: "c", status: "failed" }),
        inboxJobRow({ id: "d", status: "pending" }),
        inboxJobRow({ id: "e", status: "claimed" }),
      ]);
      const { getInboxJobsForRecipient } = await loadModule(client);

      const rows = await getInboxJobsForRecipient("u_me", "-infinity", 50);

      expect(rows.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("excludes a reminder whose scheduled_for hasn't happened yet -- never shown hours early", async () => {
      const futureIso = new Date(Date.now() + 60 * 60_000).toISOString();
      const { client } = makeInboxJobsFakeSupabase([inboxJobRow({ id: "future", scheduled_for: futureIso })]);
      const { getInboxJobsForRecipient } = await loadModule(client);

      const rows = await getInboxJobsForRecipient("u_me", "-infinity", 50);

      expect(rows).toEqual([]);
    });

    it("excludes a job scheduled at/before the user's own clear cutoff", async () => {
      const { client } = makeInboxJobsFakeSupabase([
        inboxJobRow({ id: "before", scheduled_for: "2026-08-10T00:00:00.000Z" }),
        inboxJobRow({ id: "after", scheduled_for: "2026-08-18T17:00:00.000Z" }),
      ]);
      const { getInboxJobsForRecipient } = await loadModule(client);

      const rows = await getInboxJobsForRecipient("u_me", "2026-08-15T00:00:00.000Z", 50);

      expect(rows.map((r) => r.id)).toEqual(["after"]);
    });

    it("never returns another recipient's rows", async () => {
      const { client } = makeInboxJobsFakeSupabase([
        inboxJobRow({ id: "mine", recipient_user_id: "u_me" }),
        inboxJobRow({ id: "theirs", recipient_user_id: "u_other" }),
      ]);
      const { getInboxJobsForRecipient } = await loadModule(client);

      const rows = await getInboxJobsForRecipient("u_me", "-infinity", 50);

      expect(rows.map((r) => r.id)).toEqual(["mine"]);
    });

    it("orders newest (by scheduled_for) first and respects the limit", async () => {
      const { client, calls } = makeInboxJobsFakeSupabase([
        inboxJobRow({ id: "old", scheduled_for: "2026-08-16T00:00:00.000Z" }),
        inboxJobRow({ id: "new", scheduled_for: "2026-08-18T00:00:00.000Z" }),
        inboxJobRow({ id: "mid", scheduled_for: "2026-08-17T00:00:00.000Z" }),
      ]);
      const { getInboxJobsForRecipient } = await loadModule(client);

      const rows = await getInboxJobsForRecipient("u_me", "-infinity", 2);

      expect(calls.order).toEqual(["scheduled_for", { ascending: false }]);
      expect(calls.limit).toBe(2);
      expect(rows.map((r) => r.id)).toEqual(["new", "mid"]);
    });

    it("never exposes internal columns (recipient_user_id, status, etc.) on the returned rows", async () => {
      const { client } = makeInboxJobsFakeSupabase([inboxJobRow()]);
      const { getInboxJobsForRecipient } = await loadModule(client);

      const [row] = await getInboxJobsForRecipient("u_me", "-infinity", 50);

      expect(Object.keys(row).sort()).toEqual(["body", "category", "createdAt", "id", "path", "scheduledFor", "title"]);
    });
  });

  describe("isEligibleInboxJobForRecipient", () => {
    it("true for a job that belongs to this recipient and is not cancelled", async () => {
      const { client } = makeInboxJobsFakeSupabase([inboxJobRow({ id: "job_1", recipient_user_id: "u_me", status: "pending" })]);
      const { isEligibleInboxJobForRecipient } = await loadModule(client);

      expect(await isEligibleInboxJobForRecipient("u_me", "job_1")).toBe(true);
    });

    it("false for a job that belongs to a DIFFERENT recipient", async () => {
      const { client } = makeInboxJobsFakeSupabase([inboxJobRow({ id: "job_1", recipient_user_id: "u_other" })]);
      const { isEligibleInboxJobForRecipient } = await loadModule(client);

      expect(await isEligibleInboxJobForRecipient("u_me", "job_1")).toBe(false);
    });

    it("false for a job id that does not exist at all", async () => {
      const { client } = makeInboxJobsFakeSupabase([]);
      const { isEligibleInboxJobForRecipient } = await loadModule(client);

      expect(await isEligibleInboxJobForRecipient("u_me", "job_missing")).toBe(false);
    });

    it("false for the caller's OWN job once it has been cancelled", async () => {
      const { client } = makeInboxJobsFakeSupabase([inboxJobRow({ id: "job_1", recipient_user_id: "u_me", status: "cancelled" })]);
      const { isEligibleInboxJobForRecipient } = await loadModule(client);

      expect(await isEligibleInboxJobForRecipient("u_me", "job_1")).toBe(false);
    });

    it("scopes the lookup by both id and recipient_user_id -- never id alone", async () => {
      const { client, calls } = makeInboxJobsFakeSupabase([inboxJobRow({ id: "job_1", recipient_user_id: "u_me" })]);
      const { isEligibleInboxJobForRecipient } = await loadModule(client);

      await isEligibleInboxJobForRecipient("u_me", "job_1");

      expect(calls.eq).toEqual(["recipient_user_id", "u_me"]);
    });
  });

  describe("getInboxClearedBefore", () => {
    function makeInboxStateFakeSupabase(row: { user_id: string; cleared_before: string } | null) {
      const client = {
        from: (table: string) => {
          if (table !== "notification_inbox_state") throw new Error(`unexpected table ${table}`);
          return {
            select: () => ({
              eq: (_column: string, value: string) => ({
                maybeSingle: () =>
                  Promise.resolve({ data: row && row.user_id === value ? row : null, error: null }),
              }),
            }),
          };
        },
      };
      return client;
    }

    it("returns the stored cutoff for this user", async () => {
      const client = makeInboxStateFakeSupabase({ user_id: "u_me", cleared_before: "2026-08-15T00:00:00.000Z" });
      const { getInboxClearedBefore } = await loadModule(client);

      expect(await getInboxClearedBefore("u_me")).toBe("2026-08-15T00:00:00.000Z");
    });

    it("defaults to -infinity when the user has never cleared their inbox", async () => {
      const client = makeInboxStateFakeSupabase(null);
      const { getInboxClearedBefore } = await loadModule(client);

      expect(await getInboxClearedBefore("u_new")).toBe("-infinity");
    });
  });

  describe("getReadJobIds / markNotificationJobRead / markNotificationJobsRead", () => {
    function makeReadsFakeSupabase(initialReadJobIds: string[] = []) {
      const reads = new Map<string, Set<string>>(); // user_id -> job_ids
      for (const jobId of initialReadJobIds) {
        reads.set("u_me", (reads.get("u_me") ?? new Set()).add(jobId));
      }
      const upsertCalls: Record<string, unknown>[][] = [];

      const client = {
        from: (table: string) => {
          if (table !== "notification_reads") throw new Error(`unexpected table ${table}`);
          return {
            select: () => ({
              eq: (_col: string, userId: string) => ({
                in: (_col2: string, jobIds: string[]) => {
                  const userReads = reads.get(userId) ?? new Set();
                  const matched = jobIds.filter((id) => userReads.has(id)).map((id) => ({ job_id: id }));
                  return Promise.resolve({ data: matched, error: null });
                },
              }),
            }),
            upsert: (rowOrRows: Record<string, unknown> | Record<string, unknown>[]) => {
              const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
              upsertCalls.push(rows);
              for (const row of rows) {
                const userId = row.user_id as string;
                const jobId = row.job_id as string;
                reads.set(userId, (reads.get(userId) ?? new Set()).add(jobId));
              }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      return { client, reads, upsertCalls };
    }

    it("getReadJobIds returns only the subset of jobIds this user has read", async () => {
      const { client } = makeReadsFakeSupabase(["job_1", "job_2"]);
      const { getReadJobIds } = await loadModule(client);

      const readIds = await getReadJobIds("u_me", ["job_1", "job_2", "job_3"]);

      expect(readIds).toEqual(new Set(["job_1", "job_2"]));
    });

    it("getReadJobIds never queries when jobIds is empty -- no wasted round trip", async () => {
      const fromSpy = vi.fn();
      const client = { from: fromSpy };
      const { getReadJobIds } = await loadModule(client);

      const readIds = await getReadJobIds("u_me", []);

      expect(readIds).toEqual(new Set());
      expect(fromSpy).not.toHaveBeenCalled();
    });

    it("markNotificationJobRead upserts exactly one (user_id, job_id) row", async () => {
      const { client, upsertCalls } = makeReadsFakeSupabase();
      const { markNotificationJobRead } = await loadModule(client);

      await markNotificationJobRead("u_me", "job_1");

      expect(upsertCalls).toEqual([[{ user_id: "u_me", job_id: "job_1" }]]);
    });

    it("markNotificationJobsRead marks every job in ONE upsert call -- never one query per job", async () => {
      const { client, upsertCalls } = makeReadsFakeSupabase();
      const { markNotificationJobsRead } = await loadModule(client);

      await markNotificationJobsRead("u_me", ["job_1", "job_2", "job_3"]);

      expect(upsertCalls).toHaveLength(1);
      expect(upsertCalls[0]).toEqual([
        { user_id: "u_me", job_id: "job_1" },
        { user_id: "u_me", job_id: "job_2" },
        { user_id: "u_me", job_id: "job_3" },
      ]);
    });

    it("markNotificationJobsRead never queries when jobIds is empty", async () => {
      const fromSpy = vi.fn();
      const client = { from: fromSpy };
      const { markNotificationJobsRead } = await loadModule(client);

      await markNotificationJobsRead("u_me", []);

      expect(fromSpy).not.toHaveBeenCalled();
    });
  });

  describe("clearNotificationInbox", () => {
    it("upserts this user's cutoff, never touching notification_jobs", async () => {
      const upsertCalls: Record<string, unknown>[] = [];
      const client = {
        from: (table: string) => {
          if (table !== "notification_inbox_state") throw new Error(`unexpected table ${table}`);
          return {
            upsert: (row: Record<string, unknown>) => {
              upsertCalls.push(row);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
      const { clearNotificationInbox } = await loadModule(client);

      await clearNotificationInbox("u_me");

      expect(upsertCalls).toHaveLength(1);
      expect(upsertCalls[0].user_id).toBe("u_me");
      expect(typeof upsertCalls[0].cleared_before).toBe("string");
    });

    it("is idempotent -- calling it twice never errors, and the second call's cutoff is never earlier than the first", async () => {
      const upsertCalls: Record<string, unknown>[] = [];
      const client = {
        from: () => ({
          upsert: (row: Record<string, unknown>) => {
            upsertCalls.push(row);
            return Promise.resolve({ error: null });
          },
        }),
      };
      const { clearNotificationInbox } = await loadModule(client);

      await clearNotificationInbox("u_me");
      await clearNotificationInbox("u_me");

      expect(upsertCalls).toHaveLength(2);
      expect(Date.parse(upsertCalls[1].cleared_before as string)).toBeGreaterThanOrEqual(
        Date.parse(upsertCalls[0].cleared_before as string),
      );
    });
  });
});

describe("upsertPendingReminderJob -- hotfix regression guard", () => {
  function makeRpcFakeSupabase() {
    const rpcCalls: { name: string; args: unknown }[] = [];
    const client = {
      rpc: (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return Promise.resolve({ error: null });
      },
      from: () => {
        throw new Error("upsertPendingReminderJob must never call .from() directly -- it must go through the RPC");
      },
    };
    return { client, rpcCalls };
  }

  function newJob(overrides: Partial<import("./store").NewNotificationJob> = {}): import("./store").NewNotificationJob {
    return {
      category: "tomorrow_shift",
      recipientUserId: "u_me",
      title: "⏰ המשמרת שלך מחר",
      body: "מחר ב־07:30 מתחילה משמרת יום שלך",
      path: "/",
      dedupeKey: "tomorrow_shift:2026-08-19:u_me:day",
      scheduledFor: "2026-08-18T17:00:00.000Z",
      ...overrides,
    };
  }

  it(
    "calls the upsert_pending_reminder_job RPC with the exact job fields -- NEVER a plain .upsert(...).eq('status','pending') " +
      "client call, which does not actually guard an upsert's ON CONFLICT DO UPDATE (the real Production bug)",
    async () => {
      const { client, rpcCalls } = makeRpcFakeSupabase();
      const { upsertPendingReminderJob } = await loadModule(client);

      await upsertPendingReminderJob(newJob({ tag: "tag-1", sourceRef: "shift:p1:2026-08-19" }));

      expect(rpcCalls).toEqual([
        {
          name: "upsert_pending_reminder_job",
          args: {
            p_category: "tomorrow_shift",
            p_recipient_user_id: "u_me",
            p_title: "⏰ המשמרת שלך מחר",
            p_body: "מחר ב־07:30 מתחילה משמרת יום שלך",
            p_path: "/",
            p_tag: "tag-1",
            p_dedupe_key: "tomorrow_shift:2026-08-19:u_me:day",
            p_scheduled_for: "2026-08-18T17:00:00.000Z",
            p_source_ref: "shift:p1:2026-08-19",
          },
        },
      ]);
    },
  );

  it("passes null for omitted optional tag/sourceRef, never undefined (RPC parameter binding)", async () => {
    const { client, rpcCalls } = makeRpcFakeSupabase();
    const { upsertPendingReminderJob } = await loadModule(client);

    await upsertPendingReminderJob(newJob());

    const args = rpcCalls[0].args as Record<string, unknown>;
    expect(args.p_tag).toBeNull();
    expect(args.p_source_ref).toBeNull();
  });

  it("propagates an RPC error rather than swallowing it", async () => {
    const client = { rpc: () => Promise.resolve({ error: new Error("db down") }) };
    const { upsertPendingReminderJob } = await loadModule(client);

    await expect(upsertPendingReminderJob(newJob())).rejects.toThrow("db down");
  });
});

describe("upsertAggregateNotificationJob / resolveAggregateNotificationJob -- aggregate episode dedupe (spec: fix the 38 -> 40 -> 44 notification-spam incident)", () => {
  function makeRpcFakeSupabase(rpcResult: { data?: unknown; error?: unknown } = { data: true, error: null }) {
    const rpcCalls: { name: string; args: unknown }[] = [];
    const client = {
      rpc: (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return Promise.resolve(rpcResult);
      },
      from: () => {
        throw new Error("must never call .from() directly -- it must go through the RPC");
      },
    };
    return { client, rpcCalls };
  }

  function newAggregateJob(overrides: Partial<import("./store").NewNotificationJob> = {}): import("./store").NewNotificationJob {
    return {
      category: "weapon_qualification_summary",
      recipientUserId: "u_mgr1",
      title: "⚠️ בעיות כשירות מטווחים",
      body: "נמצאו 44 שיבוצים עתידיים ללא כשירות מטווחים בתוקף אצל 7 אנשים. האירוע הקרוב: 2.9. נדרש טיפול.",
      path: "/manager",
      dedupeKey: "weapon_qualification_summary:u_mgr1",
      scheduledFor: "2026-08-30T10:00:00.000Z",
      sourceRef: '["p1:2026-09-02:oxid"]',
      ...overrides,
    };
  }

  describe("upsertAggregateNotificationJob", () => {
    it("calls the upsert_aggregate_notification_job RPC with the exact job fields -- never a plain client upsert", async () => {
      const { client, rpcCalls } = makeRpcFakeSupabase();
      const { upsertAggregateNotificationJob } = await loadModule(client);

      await upsertAggregateNotificationJob(newAggregateJob({ tag: "tag-1" }));

      expect(rpcCalls).toEqual([
        {
          name: "upsert_aggregate_notification_job",
          args: {
            p_category: "weapon_qualification_summary",
            p_recipient_user_id: "u_mgr1",
            p_title: "⚠️ בעיות כשירות מטווחים",
            p_body: "נמצאו 44 שיבוצים עתידיים ללא כשירות מטווחים בתוקף אצל 7 אנשים. האירוע הקרוב: 2.9. נדרש טיפול.",
            p_path: "/manager",
            p_tag: "tag-1",
            p_dedupe_key: "weapon_qualification_summary:u_mgr1",
            p_scheduled_for: "2026-08-30T10:00:00.000Z",
            p_source_ref: '["p1:2026-09-02:oxid"]',
          },
        },
      ]);
    });

    it("passes null for the omitted optional tag, never undefined (RPC parameter binding)", async () => {
      const { client, rpcCalls } = makeRpcFakeSupabase();
      const { upsertAggregateNotificationJob } = await loadModule(client);

      await upsertAggregateNotificationJob(newAggregateJob());

      const args = rpcCalls[0].args as Record<string, unknown>;
      expect(args.p_tag).toBeNull();
    });

    it("returns true when the RPC reports a fresh/reopened episode", async () => {
      const { client } = makeRpcFakeSupabase({ data: true, error: null });
      const { upsertAggregateNotificationJob } = await loadModule(client);

      expect(await upsertAggregateNotificationJob(newAggregateJob())).toBe(true);
    });

    it("returns false when the RPC reports an already-open episode was merely content-refreshed", async () => {
      const { client } = makeRpcFakeSupabase({ data: false, error: null });
      const { upsertAggregateNotificationJob } = await loadModule(client);

      expect(await upsertAggregateNotificationJob(newAggregateJob())).toBe(false);
    });

    it("propagates an RPC error rather than swallowing it", async () => {
      const client = { rpc: () => Promise.resolve({ error: new Error("db down") }) };
      const { upsertAggregateNotificationJob } = await loadModule(client);

      await expect(upsertAggregateNotificationJob(newAggregateJob())).rejects.toThrow("db down");
    });
  });

  describe("resolveAggregateNotificationJob", () => {
    it("calls the resolve_aggregate_notification_job RPC with the dedupe key", async () => {
      const { client, rpcCalls } = makeRpcFakeSupabase({ data: null, error: null });
      const { resolveAggregateNotificationJob } = await loadModule(client);

      await resolveAggregateNotificationJob("weapon_qualification_summary:u_mgr1");

      expect(rpcCalls).toEqual([
        { name: "resolve_aggregate_notification_job", args: { p_dedupe_key: "weapon_qualification_summary:u_mgr1" } },
      ]);
    });

    it("propagates an RPC error rather than swallowing it", async () => {
      const client = { rpc: () => Promise.resolve({ error: new Error("db down") }) };
      const { resolveAggregateNotificationJob } = await loadModule(client);

      await expect(resolveAggregateNotificationJob("weapon_qualification_summary:u_mgr1")).rejects.toThrow("db down");
    });
  });
});

// ---------------------------------------------------------------------------
// Manager manual broadcast batches
// ---------------------------------------------------------------------------

interface FakeBatchRow {
  id: string;
  idempotency_key: string;
  created_by_person_id: string;
  created_by_person_name: string;
  audience_kind: string;
  target_person_ids: string[];
  title: string;
  body: string;
  resolved_recipient_count: number;
  push_capable_count: number;
  inbox_only_count: number;
  unresolved_count: number;
  created_at: string;
}

function makeBatchesFakeSupabase(initialRows: FakeBatchRow[] = []) {
  const byIdempotencyKey = new Map(initialRows.map((row) => [row.idempotency_key, row]));
  let counter = initialRows.length;

  const client = {
    from: (table: string) => {
      if (table !== "manager_notification_batches") throw new Error(`unexpected table ${table}`);
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const key = row.idempotency_key as string;
              if (byIdempotencyKey.has(key)) return { data: null, error: { code: "23505" } };
              counter += 1;
              const stored = { id: `batch_${counter}`, created_at: "2026-08-21T08:00:00.000Z", ...row } as FakeBatchRow;
              byIdempotencyKey.set(key, stored);
              return { data: stored, error: null };
            },
          }),
        }),
        select: () => ({
          eq: (_column: string, value: string) => ({
            maybeSingle: async () => ({ data: byIdempotencyKey.get(value) ?? null, error: null }),
          }),
          not: () => ({
            order: () => ({
              limit: async (limit: number) => ({
                data: [...byIdempotencyKey.values()].slice(0, limit),
                error: null,
              }),
            }),
          }),
          order: () => ({
            limit: async (limit: number) => ({
              data: [...byIdempotencyKey.values()].slice(0, limit),
              error: null,
            }),
          }),
        }),
      };
    },
  };

  return { client, byIdempotencyKey };
}

function newBatch(overrides: Record<string, unknown> = {}) {
  return {
    idempotencyKey: "idem-1",
    createdByPersonId: "p_manager",
    createdByPersonName: "דני מנהל",
    audienceKind: "person" as const,
    targetPersonIds: ["p_1"],
    resolvedRecipientUserIds: ["user_1"],
    title: "כותרת",
    body: "תוכן",
    resolvedRecipientCount: 1,
    pushCapableCount: 1,
    inboxOnlyCount: 0,
    unresolvedCount: 0,
    ...overrides,
  };
}

describe("insertManagerNotificationBatchIfAbsent / getManagerNotificationBatchByIdempotencyKey / listRecentManagerNotificationBatches", () => {
  it("inserts a genuinely new batch, returns its full mapped row, and reports created: true", async () => {
    const { client } = makeBatchesFakeSupabase();
    const { insertManagerNotificationBatchIfAbsent } = await loadModule(client);

    const { row, created } = await insertManagerNotificationBatchIfAbsent(newBatch());

    expect(created).toBe(true);
    expect(row).toMatchObject({
      idempotencyKey: "idem-1",
      createdByPersonId: "p_manager",
      createdByPersonName: "דני מנהל",
      audienceKind: "person",
      targetPersonIds: ["p_1"],
      resolvedRecipientUserIds: ["user_1"],
      title: "כותרת",
      body: "תוכן",
      resolvedRecipientCount: 1,
      pushCapableCount: 1,
      inboxOnlyCount: 0,
      unresolvedCount: 0,
    });
    expect(row.id).toBeTruthy();
  });

  it("a retried insert with the SAME idempotency key returns created: false and the ALREADY-EXISTING row, never a second one", async () => {
    const { client, byIdempotencyKey } = makeBatchesFakeSupabase();
    const { insertManagerNotificationBatchIfAbsent } = await loadModule(client);

    const first = await insertManagerNotificationBatchIfAbsent(newBatch());
    const second = await insertManagerNotificationBatchIfAbsent(newBatch({ title: "כותרת אחרת בכלל" }));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.title).toBe("כותרת"); // the ORIGINAL stored title, never overwritten by the retry's payload
    expect(byIdempotencyKey.size).toBe(1);
  });

  it("getManagerNotificationBatchByIdempotencyKey returns null for an unknown key", async () => {
    const { client } = makeBatchesFakeSupabase();
    const { getManagerNotificationBatchByIdempotencyKey } = await loadModule(client);

    expect(await getManagerNotificationBatchByIdempotencyKey("nope")).toBeNull();
  });

  it("listRecentManagerNotificationBatches maps every stored row", async () => {
    const { client } = makeBatchesFakeSupabase([
      {
        id: "batch_1",
        idempotency_key: "idem-1",
        created_by_person_id: "p_manager",
        created_by_person_name: "דני מנהל",
        audience_kind: "everyone",
        target_person_ids: ["p_1", "p_2"],
        title: "כותרת",
        body: "תוכן",
        resolved_recipient_count: 2,
        push_capable_count: 1,
        inbox_only_count: 1,
        unresolved_count: 0,
        created_at: "2026-08-21T08:00:00.000Z",
      },
    ]);
    const { listRecentManagerNotificationBatches } = await loadModule(client);

    const rows = await listRecentManagerNotificationBatches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "batch_1", audienceKind: "everyone", resolvedRecipientCount: 2 });
  });
});

// ---------------------------------------------------------------------------
// getManagerBroadcastDeliveryTiming -- read-only aggregation for the
// "נשלחו לאחרונה" compact timing row.
// ---------------------------------------------------------------------------

interface FakeScheduledTimingRow {
  batch_id: string | null;
  created_at: string;
  scheduled_for: string;
  sent_now_at: string | null;
}

interface FakeJobRow {
  id: string;
  source_ref: string | null;
  status: string;
}

interface FakeDeliveryRow {
  job_id: string;
  status: string;
  last_attempted_at: string | null;
}

/**
 * A minimal, faithful fake of the exact THREE-query chain shapes
 * `getManagerBroadcastDeliveryTiming` uses:
 * `manager_scheduled_broadcasts.select().in("batch_id", ...)`,
 * `notification_jobs.select().in("source_ref", ...)`, and
 * `notification_deliveries.select().eq("status", "sent").in("job_id", ...)`.
 * Same fake-client style as `makeBatchesFakeSupabase` above -- records every
 * `.in()` call so tests can assert exactly which ids/refs were queried
 * (never one query per batch).
 */
function makeDeliveryTimingFakeSupabase(opts: {
  scheduledBroadcasts?: FakeScheduledTimingRow[];
  jobs?: FakeJobRow[];
  deliveries?: FakeDeliveryRow[];
}) {
  const scheduledBroadcasts = opts.scheduledBroadcasts ?? [];
  const jobs = opts.jobs ?? [];
  const deliveries = opts.deliveries ?? [];
  const calls = { scheduledBroadcastsQueries: 0, jobsQueries: 0, deliveriesQueries: 0 };

  const client = {
    from: (table: string) => {
      if (table === "manager_scheduled_broadcasts") {
        return {
          select: () => ({
            in: (_column: string, batchIds: string[]) => {
              calls.scheduledBroadcastsQueries += 1;
              return Promise.resolve({
                data: scheduledBroadcasts.filter((row) => row.batch_id !== null && batchIds.includes(row.batch_id)),
                error: null,
              });
            },
          }),
        };
      }
      if (table === "notification_jobs") {
        return {
          select: () => ({
            in: (_column: string, sourceRefs: string[]) => {
              calls.jobsQueries += 1;
              return Promise.resolve({
                data: jobs.filter((row) => row.source_ref !== null && sourceRefs.includes(row.source_ref)),
                error: null,
              });
            },
          }),
        };
      }
      if (table === "notification_deliveries") {
        return {
          select: () => ({
            eq: (_statusColumn: string, statusValue: string) => ({
              in: (_column: string, jobIds: string[]) => {
                calls.deliveriesQueries += 1;
                return Promise.resolve({
                  data: deliveries.filter((row) => row.status === statusValue && jobIds.includes(row.job_id)),
                  error: null,
                });
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { client, calls };
}

describe("getManagerBroadcastDeliveryTiming", () => {
  it("returns an empty map without querying anything when given zero batches", async () => {
    const { client, calls } = makeDeliveryTimingFakeSupabase({});
    const { getManagerBroadcastDeliveryTiming } = await loadModule(client);

    const result = await getManagerBroadcastDeliveryTiming([]);

    expect(result.size).toBe(0);
    expect(calls.scheduledBroadcastsQueries).toBe(0);
    expect(calls.jobsQueries).toBe(0);
    expect(calls.deliveriesQueries).toBe(0);
  });

  it("1. immediate broadcast: batch created timestamp + successful delivery timestamp -> firstSuccessfulPushAt set, deliveryState 'sent', no schedule fields", async () => {
    const { client } = makeDeliveryTimingFakeSupabase({
      jobs: [{ id: "job_1", source_ref: "manual:batch_1", status: "completed" }],
      deliveries: [{ job_id: "job_1", status: "sent", last_attempted_at: "2026-08-22T21:46:02.000Z" }],
    });
    const { getManagerBroadcastDeliveryTiming } = await loadModule(client);

    const result = await getManagerBroadcastDeliveryTiming([{ id: "batch_1", pushCapableCount: 1 }]);

    expect(result.get("batch_1")).toEqual({
      scheduleCreatedAt: null,
      scheduledFor: null,
      sentNowAt: null,
      firstSuccessfulPushAt: "2026-08-22T21:46:02.000Z",
      deliveryState: "sent",
    });
  });

  it("2. multiple jobs/devices: the earliest SUCCESSFUL status='sent' timestamp wins, across every job for the batch", async () => {
    const { client } = makeDeliveryTimingFakeSupabase({
      jobs: [
        { id: "job_1", source_ref: "manual:batch_1", status: "completed" },
        { id: "job_2", source_ref: "manual:batch_1", status: "completed" },
      ],
      deliveries: [
        { job_id: "job_1", status: "sent", last_attempted_at: "2026-08-22T21:46:05.000Z" },
        { job_id: "job_1", status: "sent", last_attempted_at: "2026-08-22T21:46:02.000Z" }, // a second device, earlier
        { job_id: "job_2", status: "sent", last_attempted_at: "2026-08-22T21:46:09.000Z" },
      ],
    });
    const { getManagerBroadcastDeliveryTiming } = await loadModule(client);

    const result = await getManagerBroadcastDeliveryTiming([{ id: "batch_1", pushCapableCount: 2 }]);

    expect(result.get("batch_1")?.firstSuccessfulPushAt).toBe("2026-08-22T21:46:02.000Z");
    expect(result.get("batch_1")?.deliveryState).toBe("sent");
  });

  it("3. failed/transient delivery attempts earlier than a successful one must NOT become firstSuccessfulPushAt", async () => {
    const { client } = makeDeliveryTimingFakeSupabase({
      jobs: [{ id: "job_1", source_ref: "manual:batch_1", status: "completed" }],
      deliveries: [
        // An earlier FAILED attempt -- the fake client's own `.eq("status","sent")`
        // filter (mirroring the real server-side filter) means this row is never
        // even returned to the aggregator, so it can never win the "earliest" race.
        { job_id: "job_1", status: "failed_transient", last_attempted_at: "2026-08-22T21:45:00.000Z" },
        { job_id: "job_1", status: "sent", last_attempted_at: "2026-08-22T21:46:02.000Z" },
      ],
    });
    const { getManagerBroadcastDeliveryTiming } = await loadModule(client);

    const result = await getManagerBroadcastDeliveryTiming([{ id: "batch_1", pushCapableCount: 1 }]);

    expect(result.get("batch_1")?.firstSuccessfulPushAt).toBe("2026-08-22T21:46:02.000Z");
  });

  it("4a. no successful push, still-outstanding jobs -> firstSuccessfulPushAt/deliveryLatency stay null, deliveryState 'pending'", async () => {
    const { client } = makeDeliveryTimingFakeSupabase({
      jobs: [{ id: "job_1", source_ref: "manual:batch_1", status: "pending" }],
      deliveries: [],
    });
    const { getManagerBroadcastDeliveryTiming } = await loadModule(client);

    const result = await getManagerBroadcastDeliveryTiming([{ id: "batch_1", pushCapableCount: 1 }]);

    expect(result.get("batch_1")).toEqual({
      scheduleCreatedAt: null,
      scheduledFor: null,
      sentNowAt: null,
      firstSuccessfulPushAt: null,
      deliveryState: "pending",
    });
  });

  it("4b. no successful push, every job reached a terminal state -> deliveryState 'failed', never a false 'sent'", async () => {
    const { client } = makeDeliveryTimingFakeSupabase({
      jobs: [{ id: "job_1", source_ref: "manual:batch_1", status: "failed" }],
      deliveries: [{ job_id: "job_1", status: "failed_permanent", last_attempted_at: "2026-08-22T21:46:02.000Z" }],
    });
    const { getManagerBroadcastDeliveryTiming } = await loadModule(client);

    const result = await getManagerBroadcastDeliveryTiming([{ id: "batch_1", pushCapableCount: 1 }]);

    expect(result.get("batch_1")?.firstSuccessfulPushAt).toBeNull();
    expect(result.get("batch_1")?.deliveryState).toBe("failed");
  });

  it("4c. zero push-capable recipients -> deliveryState 'no_push_recipients', independent of job state", async () => {
    const { client } = makeDeliveryTimingFakeSupabase({ jobs: [], deliveries: [] });
    const { getManagerBroadcastDeliveryTiming } = await loadModule(client);

    const result = await getManagerBroadcastDeliveryTiming([{ id: "batch_1", pushCapableCount: 0 }]);

    expect(result.get("batch_1")).toEqual({
      scheduleCreatedAt: null,
      scheduledFor: null,
      sentNowAt: null,
      firstSuccessfulPushAt: null,
      deliveryState: "no_push_recipients",
    });
  });

  it("5. scheduled broadcast: matched through batch_id, surfaces the scheduled row's own created_at/scheduled_for", async () => {
    const { client } = makeDeliveryTimingFakeSupabase({
      scheduledBroadcasts: [
        { batch_id: "batch_1", created_at: "2026-08-22T20:10:00.000Z", scheduled_for: "2026-08-22T21:46:00.000Z", sent_now_at: null },
      ],
      jobs: [{ id: "job_1", source_ref: "manual:batch_1", status: "completed" }],
      deliveries: [{ job_id: "job_1", status: "sent", last_attempted_at: "2026-08-22T21:46:04.000Z" }],
    });
    const { getManagerBroadcastDeliveryTiming } = await loadModule(client);

    const result = await getManagerBroadcastDeliveryTiming([{ id: "batch_1", pushCapableCount: 1 }]);

    expect(result.get("batch_1")).toEqual({
      scheduleCreatedAt: "2026-08-22T20:10:00.000Z",
      scheduledFor: "2026-08-22T21:46:00.000Z",
      sentNowAt: null,
      firstSuccessfulPushAt: "2026-08-22T21:46:04.000Z",
      deliveryState: "sent",
    });
  });

  it("6. scheduled 'שלח עכשיו': surfaces sentNowAt distinct from the original scheduled_for", async () => {
    const { client } = makeDeliveryTimingFakeSupabase({
      scheduledBroadcasts: [
        {
          batch_id: "batch_1",
          created_at: "2026-08-22T20:10:00.000Z",
          scheduled_for: "2026-08-22T22:30:00.000Z", // the ORIGINAL, still-future schedule
          sent_now_at: "2026-08-22T21:45:57.000Z", // forced early
        },
      ],
      jobs: [{ id: "job_1", source_ref: "manual:batch_1", status: "completed" }],
      deliveries: [{ job_id: "job_1", status: "sent", last_attempted_at: "2026-08-22T21:46:00.000Z" }],
    });
    const { getManagerBroadcastDeliveryTiming } = await loadModule(client);

    const result = await getManagerBroadcastDeliveryTiming([{ id: "batch_1", pushCapableCount: 1 }]);

    expect(result.get("batch_1")).toEqual({
      scheduleCreatedAt: "2026-08-22T20:10:00.000Z",
      scheduledFor: "2026-08-22T22:30:00.000Z",
      sentNowAt: "2026-08-22T21:45:57.000Z",
      firstSuccessfulPushAt: "2026-08-22T21:46:00.000Z",
      deliveryState: "sent",
    });
  });

  it("bulk-fetches in exactly THREE queries total regardless of batch count -- never one query per batch", async () => {
    const { client, calls } = makeDeliveryTimingFakeSupabase({
      jobs: [
        { id: "job_1", source_ref: "manual:batch_1", status: "completed" },
        { id: "job_2", source_ref: "manual:batch_2", status: "completed" },
      ],
      deliveries: [
        { job_id: "job_1", status: "sent", last_attempted_at: "2026-08-22T21:46:00.000Z" },
        { job_id: "job_2", status: "sent", last_attempted_at: "2026-08-22T21:47:00.000Z" },
      ],
    });
    const { getManagerBroadcastDeliveryTiming } = await loadModule(client);

    const result = await getManagerBroadcastDeliveryTiming([
      { id: "batch_1", pushCapableCount: 1 },
      { id: "batch_2", pushCapableCount: 1 },
    ]);

    expect(result.size).toBe(2);
    expect(calls.scheduledBroadcastsQueries).toBe(1);
    expect(calls.jobsQueries).toBe(1);
    expect(calls.deliveriesQueries).toBe(1);
  });
});

describe("peekLastOperationalGeneration / setLastOperationalGeneration -- Emergency Mode baseline tracking (spec section 22)", () => {
  function makeBaselineStateFakeSupabase(initial: { last_operational_generation: string } | null) {
    let row = initial;
    const updateCalls: Record<string, unknown>[] = [];
    const client = {
      from: (table: string) => {
        if (table !== "notification_baseline_state") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: row, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => {
              updateCalls.push(patch);
              row = { last_operational_generation: patch.last_operational_generation as string };
              return Promise.resolve({ error: null });
            },
          }),
        };
      },
    };
    return { client, updateCalls, getRow: () => row };
  }

  it("peekLastOperationalGeneration reads the stored value", async () => {
    const { client } = makeBaselineStateFakeSupabase({ last_operational_generation: "emergency:period-a" });
    const { peekLastOperationalGeneration } = await loadModule(client);
    expect(await peekLastOperationalGeneration()).toBe("emergency:period-a");
  });

  it("peekLastOperationalGeneration returns null when the row doesn't exist yet (pre-first-tick), never a guessed default", async () => {
    const { client } = makeBaselineStateFakeSupabase(null);
    const { peekLastOperationalGeneration } = await loadModule(client);
    expect(await peekLastOperationalGeneration()).toBeNull();
  });

  it("setLastOperationalGeneration writes the new value via a plain update, not the atomic baseline RPC", async () => {
    const { client, updateCalls, getRow } = makeBaselineStateFakeSupabase({ last_operational_generation: "regular" });
    const { setLastOperationalGeneration } = await loadModule(client);

    await setLastOperationalGeneration("emergency:period-a");

    expect(updateCalls).toEqual([{ last_operational_generation: "emergency:period-a" }]);
    expect(getRow()).toEqual({ last_operational_generation: "emergency:period-a" });
  });

  it("setLastOperationalGeneration persists a generation swap between two different emergency sessions verbatim (period A -> period B)", async () => {
    const { client, getRow } = makeBaselineStateFakeSupabase({ last_operational_generation: "emergency:period-a" });
    const { setLastOperationalGeneration } = await loadModule(client);

    await setLastOperationalGeneration("emergency:period-b");

    expect(getRow()).toEqual({ last_operational_generation: "emergency:period-b" });
  });
});
