"use client";

import { usePathname } from "next/navigation";
import { SatcomBackground } from "./SatcomBackground";
import { satcomVariantForPath } from "./satcom-variants";

/**
 * Mounts the SATCOM canvas for whichever page is showing.
 *
 * The backdrop has to live at `AppShell`'s main-column level to cover the
 * whole page canvas (see `SatcomBackground`'s docstring for why), but
 * `AppShell` is rendered once by the shared `(app)/layout.tsx` and wraps
 * every route in the group -- so no individual page can hand it down, and a
 * server layout cannot read the pathname either. This reads it client-side,
 * exactly as `Sidebar` already does for its active-nav state, and maps it to
 * an intensity (see `satcom-variants.ts`) so a dense calendar gets a quieter
 * canvas than an open one while both keep the same visual language.
 */
export function PageBackdrop() {
  const pathname = usePathname();

  return <SatcomBackground variant={satcomVariantForPath(pathname)} />;
}
