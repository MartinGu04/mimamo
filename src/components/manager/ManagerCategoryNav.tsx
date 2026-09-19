import { TabLink } from "@/components/ui/TabLink";
import { buildManagerHref, type ManagerCategory, type ManagerHrefParams } from "@/lib/presentation/managerUrl";

interface ManagerCategoryNavProps {
  active: ManagerCategory;
  /** The manager's current range/month URL state, preserved across category switches -- same `ManagerHrefParams` convention `ManagerRangeSelector`/`ManagerRosterSection` already use. `personId` is deliberately never read from here: every category is a whole-team view, so switching category always leaves any person drill-down. */
  current: Omit<ManagerHrefParams, "personId" | "category">;
}

const CATEGORY_OPTIONS: { key: ManagerCategory; label: string }[] = [
  { key: "overview", label: "סקירה" },
  { key: "shifts", label: "משמרות" },
  { key: "personnel", label: "כוח אדם" },
  { key: "duties", label: "תורנויות והיעדרויות" },
  { key: "logins", label: "התחברויות" },
];

const TAB_BASE =
  "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * The Manager Area's top-level category switch (redesign) -- "סקירה"
 * (Overview, the default command-center view), "משמרות" (coverage +
 * Potential reconciliation), "כוח אדם" (roster + person drill-down),
 * "תורנויות והיעדרויות" (cross-team duties/absences), "התחברויות"
 * (login/notification-readiness adoption -- ONLY that; sending/scheduling/
 * history/recurring notification management is the separate standalone
 * "מרכז התראות" product area, `/notifications`, never rendered here). Real,
 * server-rendered `Link`s (same idiom `FairnessModeToggle`/`DutyViewToggle`
 * already use), never client-only tab state, so every category stays
 * directly linkable/shareable/back-button-safe. Each `TabLink` carries
 * `aria-current="page"` for the active category, the same native-navigation
 * pattern `DutyViewToggle` uses -- never `role="tablist"`/`role="tab"`, which
 * would promise assistive tech an ARIA-tabs keyboard model (arrow-key roving
 * between tabs) this control, a plain set of URL-backed links, doesn't
 * implement.
 *
 * All five tabs stay on ONE row, always -- `whitespace-nowrap` on each tab
 * (a two-word Hebrew label like "תורנויות והיעדרויות" would otherwise be
 * free to break at its internal space once squeezed,
 * which reads as that tab detaching onto its own row rather than staying
 * part of the strip) combined with `shrink-0` means no tab can shrink below
 * its own full label width, so the `inline-flex` tablist's shrink-to-fit
 * width is always its natural full content width -- on a narrow viewport
 * that exceeds the `nav`'s own width, which is exactly what makes
 * `overflow-x-auto` on the `nav` kick in as horizontal scroll instead of a
 * wrapped second row. Desktop is unaffected: the strip already fits on one
 * row there with no scrolling needed.
 *
 * Each tab is a `TabLink` (`components/ui/`) -- real per-tab pending-
 * navigation feedback (instant spinner + `aria-busy` on click, a second
 * click on an already-pending tab is a no-op) via the same `useLinkStatus`
 * mechanism the app's main Sidebar/BottomNav already use, shared with
 * `FairnessModeToggle`'s identical tab idiom rather than reimplemented
 * here. A category switch stays on the SAME `/manager` route segment
 * (only `?category=` changes), which is exactly the case the route's own
 * `loading.tsx` Suspense boundary can never fire for -- this is what
 * fills that gap.
 */
export function ManagerCategoryNav({ active, current }: ManagerCategoryNavProps) {
  return (
    <nav aria-label="קטגוריות אזור מנהל" className="-mx-1 overflow-x-auto px-1">
      <div className="inline-flex items-center gap-1 rounded-full bg-overlay-soft p-1">
        {CATEGORY_OPTIONS.map((option) => {
          const isActive = active === option.key;
          return (
            <TabLink
              key={option.key}
              href={buildManagerHref({ ...current, personId: null, category: option.key })}
              isActive={isActive}
              className={`${TAB_BASE} ${
                isActive ? "bg-surface-1 text-primary ring-1 ring-border" : "text-muted hover:text-foreground"
              }`}
            >
              {option.label}
            </TabLink>
          );
        })}
      </div>
    </nav>
  );
}
