import "server-only";
import { cache } from "react";
import { loadScheduleReadModel, type ScheduleLoadResult } from "./schedule";

/**
 * Request-scoped memoization of `loadScheduleReadModel()`, via React's
 * `cache()` -- same convention and safety properties as
 * `getRequestPersonalSchedule`/`getRequestManagerOverview` (reset per
 * request/render, never shared across users or requests, never
 * `unstable_cache`, no module-level state).
 *
 * Takes the already-resolved primitive params (not one object) so
 * `cache()`'s per-argument identity comparison actually dedupes -- an
 * object literal built separately at each call site would never compare
 * equal even with identical field values.
 */
export const getRequestSchedule = cache(
  (rawMonth: string | null, personId: string | null, rawWeek: string | null): Promise<ScheduleLoadResult> =>
    loadScheduleReadModel({ rawMonth, personId, rawWeek }),
);
