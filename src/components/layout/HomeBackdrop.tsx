"use client";

import { usePathname } from "next/navigation";
import { SatcomBackground } from "./SatcomBackground";

/**
 * Mounts the SATCOM canvas for the Home route only.
 *
 * The backdrop has to live at `AppShell`'s main-column level to cover the
 * whole page canvas (see `SatcomBackground`'s docstring for why), but
 * `AppShell` is rendered once by the shared `(app)/layout.tsx` and wraps
 * every route in the group -- so the Home page itself has no way to hand
 * it down. A server layout can't read the pathname either, so this reads
 * it client-side, exactly as `Sidebar` already does for its active-nav
 * state. Renders nothing at all on every other route.
 */
export function HomeBackdrop() {
  const pathname = usePathname();

  if (pathname !== "/") {
    return null;
  }

  return <SatcomBackground />;
}
