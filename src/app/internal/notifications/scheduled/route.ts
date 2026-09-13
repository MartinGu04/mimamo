import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedWorkerRequest } from "@/lib/notifications/workerAuth";
import { runScheduledBroadcastWorkerTick } from "@/lib/notifications/engine/scheduledWorker";
import { WorkerStageError, formatWorkerErrorLog, sanitizeWorkerError } from "@/lib/notifications/engine/workerErrors";
import { NOTIFICATION_WORKERS_PAUSED } from "@/lib/notifications/workerPause";

/**
 * The dedicated, secured internal worker endpoint Supabase Cron calls
 * every MINUTE in production -- separate from, and much narrower than,
 * `/internal/notifications/tick`'s own 5-minute job. See
 * `lib/notifications/engine/scheduledWorker.ts`'s own docstring for the
 * full "why a second endpoint instead of just running the 5-minute worker
 * every minute" rationale: this endpoint does a cheap Supabase pre-check
 * and, on a genuinely quiet minute, touches nothing else at all -- no
 * Google/workbook request, no notification generation, no push work.
 *
 * Reuses the EXACT SAME worker-auth mechanism as `/internal/notifications/tick`
 * -- `Authorization: Bearer <NOTIFICATION_WORKER_SECRET>`, the same
 * constant-time comparison (`isAuthorizedWorkerRequest`), checked BEFORE
 * anything else runs. Deliberately no second secret: this is one worker's
 * trust boundary (Supabase Cron -> this app's internal routes), not two.
 *
 * Deliberately placed OUTSIDE `src/app/api`, same reasoning as
 * `tick/route.ts` (see that file's own docstring and
 * `src/app/apiSurface.test.ts`'s "no src/app/api directory" regression
 * test) -- this is a secret-gated internal endpoint, never a public API
 * route.
 *
 * Response is a small, PII-safe JSON summary of counts only (spec
 * section 25's convention, same as `tick/route.ts`) -- never a name,
 * email, push endpoint, or full notification body, on success OR
 * failure. A failure's real diagnostics only ever reach the server-side
 * log line via `sanitizeWorkerError`/`formatWorkerErrorLog`.
 *
 * No `mode` query param here (unlike `tick/route.ts`) -- this endpoint
 * has no dry-run concept; a call either finds nothing due (a genuine,
 * side-effect-free no-op) or dispatches/delivers for real, since Supabase
 * Cron is this endpoint's only production caller and there's no separate
 * "preview real-send" use case for it the way `?mode=send` serves for
 * the main tick.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authorized = isAuthorizedWorkerRequest(request.headers.get("authorization"));
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (NOTIFICATION_WORKERS_PAUSED) {
    return NextResponse.json({ status: "paused" }, { status: 200 });
  }

  try {
    const summary = await runScheduledBroadcastWorkerTick();
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    const stage = error instanceof WorkerStageError ? error.stage : "unknown";
    const cause = error instanceof WorkerStageError ? error.cause : error;
    console.error(formatWorkerErrorLog(stage, sanitizeWorkerError(cause)));
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
