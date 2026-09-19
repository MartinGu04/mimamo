import { TabLink } from "@/components/ui/TabLink";
import { buildNotificationCenterHref, type NotificationCenterSection } from "@/lib/presentation/notificationCenterUrl";

interface NotificationCenterNavProps {
  active: NotificationCenterSection;
}

const SECTION_OPTIONS: { key: NotificationCenterSection; label: string }[] = [
  { key: "now", label: "עכשיו" },
  { key: "schedule", label: "תזמון" },
  { key: "history", label: "היסטוריה" },
  { key: "fixed", label: "קבועות" },
];

const TAB_BASE =
  "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/**
 * מרכז התראות's own top-level section switch -- the SAME `TabLink`-based,
 * URL-backed navigation idiom `ManagerCategoryNav`/`FairnessModeToggle`
 * already establish (real, server-rendered `Link`s, never client-only tab
 * state, so every section stays directly linkable/shareable/back-button-safe;
 * each `TabLink` carries `aria-current="page"` for the active section, never
 * `role="tablist"`/`role="tab"`, which would promise an ARIA-tabs keyboard
 * model this plain set of links doesn't implement), reused rather than a
 * third bespoke implementation. Fixed product order -- עכשיו / תזמון /
 * היסטוריה / קבועות -- never re-sorted.
 *
 * Same overflow handling as `ManagerCategoryNav`: `whitespace-nowrap` +
 * `shrink-0` on each tab keeps every label at its full natural width, so
 * the tablist's shrink-to-fit width on a narrow viewport exceeds the
 * `nav`'s own width -- exactly what makes `overflow-x-auto` on the `nav`
 * kick in as horizontal scroll instead of the strip ever wrapping onto a
 * second row.
 */
export function NotificationCenterNav({ active }: NotificationCenterNavProps) {
  return (
    <nav aria-label="מקטעי מרכז התראות" className="-mx-1 overflow-x-auto px-1">
      <div className="inline-flex items-center gap-1 rounded-full bg-overlay-soft p-1">
        {SECTION_OPTIONS.map((option) => {
          const isActive = active === option.key;
          return (
            <TabLink
              key={option.key}
              href={buildNotificationCenterHref(option.key)}
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
