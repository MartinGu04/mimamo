"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { refreshWorkbookSnapshotAction } from "@/lib/sync/actions";
import { formatDataFreshnessLabel } from "@/lib/presentation/dataFreshness";

interface DataFreshnessStatusProps {
  /**
   * The CURRENT route's own read model's snapshot-fetch timestamp (ISO
   * instant) -- whichever specific read model the page actually rendered
   * from (personal/manager-overview/manager-fairness all carry their own;
   * PR #17 §10), never one page's timestamp borrowed for another. Never a
   * raw Google timestamp, never workbook cell/sheet/spreadsheet metadata
   * (PR #17 §14) -- this is the ONLY prop this component reads.
   */
  fetchedAt: string;
  className?: string;
}

/** How often the DISPLAYED relative-age text re-ticks -- a local timer only, never a network request (PR #17 §5). */
const RELATIVE_AGE_TICK_MS = 30_000;

/**
 * Restrained, reusable "how fresh is what I'm looking at" metadata row
 * (PR #17) -- supporting context, never a hero card. Google Sheets remains
 * the source of truth; המחלבה only ever holds a read-only, timestamped
 * snapshot of it. The refresh control FIRST forces the short-lived
 * workbook-snapshot cache to expire (`refreshWorkbookSnapshotAction`, see
 * `lib/sync`) so this is a REAL refresh, never one that quietly returns
 * the still-cached snapshot, then reruns the CURRENT route's existing
 * Server Component data loader via `router.refresh()` -- no new API
 * route, no direct browser Google call, no writeback, and no automatic
 * polling for new data (only the displayed text re-ticks locally).
 *
 * Hydration-safe by construction: `label` starts `null` (matching exactly
 * what the server rendered) and is only ever computed inside a
 * `useEffect`, i.e. strictly after mount -- server "now" and browser "now"
 * never both render into the same pass, so there is nothing for React to
 * flag as a mismatch (PR #17 §8). Once a genuinely new `fetchedAt` prop
 * arrives (a real refreshed snapshot), the effect re-runs and the label
 * naturally resets to "עודכן עכשיו" -- that IS the success confirmation;
 * no separate "הרענון הצליח" state is ever shown (PR #17 §13).
 */
export function DataFreshnessStatus({ fetchedAt, className = "" }: DataFreshnessStatusProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setLabel(formatDataFreshnessLabel(fetchedAt, new Date()));
    tick();
    const interval = setInterval(tick, RELATIVE_AGE_TICK_MS);
    return () => clearInterval(interval);
  }, [fetchedAt]);

  function handleRefresh() {
    startTransition(async () => {
      // Invalidate the workbook-snapshot cache FIRST, then ask Next to
      // re-render this route -- in that order, never reversed and never
      // in parallel, so the refresh request can never race ahead of the
      // invalidation and observe the stale cache entry.
      await refreshWorkbookSnapshotAction();
      router.refresh();
    });
  }

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 text-xs text-muted ${className}`}>
      <span>
        מקור: Google Sheets
        {label ? <span dir="rtl"> · {label}</span> : null}
      </span>
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isPending}
        aria-label="רענון נתונים"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-overlay-soft px-2.5 py-1 font-medium text-muted transition-colors duration-200 hover:bg-overlay-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-70"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} aria-hidden="true" strokeWidth={2} />
        {isPending ? "מרענן…" : "רענון נתונים"}
      </button>
    </div>
  );
}
