import type { ReactNode } from "react";
import { ScrollHomeToTopOnLaunch } from "@/components/dashboard/ScrollHomeToTopOnLaunch";

/**
 * Scoped to this `(dashboard)` route group -- which adds no URL segment of
 * its own, so this layout applies to `/` and nothing else -- for the exact
 * same reason `loading.tsx` in this same folder lives here instead of the
 * shared `(app)/layout.tsx`: Home-specific behavior must never leak onto
 * every other route (see that file's own docstring).
 *
 * Mounts `ScrollHomeToTopOnLaunch` once, wrapping every possible Home
 * surface `page.tsx` can render (`Dashboard`, `PermanentManagerHome`, the
 * Emergency Mode variants, `ConfigurationErrorState`) -- see that
 * component's own docstring for why a fresh page load should open at the
 * top while a mere app resume must never be disturbed.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ScrollHomeToTopOnLaunch />
      {children}
    </>
  );
}
