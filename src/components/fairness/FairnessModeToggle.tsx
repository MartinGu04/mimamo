import { TabLink } from "@/components/ui/TabLink";
import { fairnessDutiesHref, fairnessEmergencyHref, fairnessShiftsHref, type FairnessMode } from "@/lib/presentation/fairnessUrl";

interface FairnessModeToggleProps {
  active: FairnessMode;
  /**
   * Renders the third "חירום" tab only while Emergency Mode is CURRENTLY
   * active (`resolveOperationalMode().kind === "emergency"`, the app's one
   * source of truth for this, computed by the caller -- see `fairness/page.tsx`).
   * Absent from the DOM entirely when false/omitted, never rendered
   * disabled/muted.
   */
  emergencyAvailable?: boolean;
}

const TAB_BASE =
  "flex-1 min-w-0 rounded-full px-4 py-2 text-center text-sm font-semibold transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:flex-initial sm:px-5";

/**
 * `[ משמרות ] [ תורנויות ]` -- the ONE mode switch for the standalone
 * Fairness experience (PR #4). Real, server-rendered `Link`s (same
 * convention as `ManagerSubNav`/`ManagerFairnessPeriodSelector`), never
 * client-only tab state, so each mode stays directly linkable/shareable/
 * back-button-safe. Switching mode always lands on that mode's OWN default
 * entry point (`fairnessShiftsHref()`/`fairnessDutiesHref()` with no
 * `month`/`period`/`person`) -- an H1/H2-only `?period=` must never leak
 * into the Shift experience, and vice versa; a selected person has no
 * meaning across modes either, so it's dropped too (same reasoning
 * `ManagerFairnessPeriodSelector` already applies to a period switch).
 *
 * A real `<nav aria-label>` landmark (the same native-navigation pattern
 * `DutyViewToggle` uses), with `aria-current="page"` on each `TabLink` for
 * the active mode -- never `role="tablist"`/`role="tab"`, which would
 * promise assistive tech an ARIA-tabs keyboard model (arrow-key roving
 * between tabs) this control, a plain set of URL-backed links, doesn't
 * implement. `flex-1` on mobile keeps both pills equal width and full-bleed
 * (compact, no dead space), `sm:flex-initial` lets them settle to their
 * natural width on larger screens instead of stretching.
 *
 * Each tab is a `TabLink` (`components/ui/`) -- real per-tab pending-
 * navigation feedback (instant spinner + `aria-busy` on click, a second
 * click on an already-pending tab is a no-op) via the same `useLinkStatus`
 * mechanism the app's main Sidebar/BottomNav already use, shared with
 * `ManagerCategoryNav`'s identical tab idiom rather than reimplemented
 * here.
 */
export function FairnessModeToggle({ active, emergencyAvailable = false }: FairnessModeToggleProps) {
  return (
    <nav aria-label="מצב תצוגה" className="flex items-stretch gap-1 rounded-full bg-overlay-soft p-1">
      <TabLink
        href={fairnessShiftsHref()}
        isActive={active === "shifts"}
        className={`${TAB_BASE} ${active === "shifts" ? "bg-surface-1 text-primary" : "text-muted hover:text-foreground"}`}
      >
        משמרות
      </TabLink>
      <TabLink
        href={fairnessDutiesHref()}
        isActive={active === "duties"}
        className={`${TAB_BASE} ${active === "duties" ? "bg-surface-1 text-primary" : "text-muted hover:text-foreground"}`}
      >
        תורנויות
      </TabLink>
      {emergencyAvailable ? (
        <TabLink
          href={fairnessEmergencyHref()}
          isActive={active === "emergency"}
          className={`${TAB_BASE} ${active === "emergency" ? "bg-surface-1 text-primary" : "text-muted hover:text-foreground"}`}
        >
          חירום
        </TabLink>
      ) : null}
    </nav>
  );
}
