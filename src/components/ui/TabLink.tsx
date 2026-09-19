"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { LinkPendingWatcher } from "./LinkPendingWatcher";

interface TabLinkProps {
  href: string;
  isActive: boolean;
  className: string;
  children: ReactNode;
  /** Forwarded to `next/link`'s own `scroll` prop -- e.g. a duty-period tab that shouldn't reset scroll position. Defaults to Next's own default (true). */
  scroll?: boolean;
}

/**
 * One pill-style navigation `Link` with real, per-item pending-navigation
 * feedback -- the same `useLinkStatus` mechanism `layout/Sidebar.tsx`/
 * `layout/BottomNav.tsx` already use for the app's main navigation
 * surfaces, extracted here so the Manager Area category strip
 * (`ManagerCategoryNav`), the Fairness shift/duty mode toggle
 * (`FairnessModeToggle`), the "עד מתי???" view toggle
 * (`DischargeViewToggle`), and the Notification Center section switch
 * (`NotificationCenterNav`) share ONE pending-state implementation instead
 * of four independent copies.
 *
 * Uses `aria-current="page"` for the active item, the SAME native-navigation
 * pattern `DutyViewToggle` already establishes -- deliberately NOT
 * `role="tab"`/`aria-selected`. Every one of these controls is a real,
 * server-rendered `Link` that changes the URL (`?category=`/`?mode=`/
 * `?view=`/`?section=`) and stays linkable/shareable/back-button-safe; none
 * of them implements the ARIA tabs pattern's required keyboard model (Left/
 * Right arrow-key roving between tabs) or owns an `aria-controls` tabpanel,
 * so wearing `role="tab"` promised assistive-tech users an interaction that
 * didn't exist. `aria-current="page"` accurately describes what this
 * actually is: a navigation link to the current page/view.
 *
 * `aria-busy` + a small inline spinner give a click INSTANT visual
 * acknowledgment even though these links stay on the same route segment
 * (`?category=`/`?mode=` only) -- a case Next's own `loading.tsx`
 * segment-level Suspense boundary structurally cannot cover, since no new
 * segment ever mounts for a searchParam-only change. The label text is
 * NEVER replaced by the spinner (the destination stays nameable, and the
 * strip never loses an item or jumps to a skeleton) -- the spinner is a
 * small addition before the label, inside the item's own existing pill,
 * so the surrounding page layout never shifts.
 *
 * A second click while already pending is a no-op (`preventDefault`),
 * exactly like Sidebar/BottomNav: the click was already accepted, and a
 * user tapping repeatedly can never queue up redundant navigations to the
 * same destination.
 */
export function TabLink({ href, isActive, className, children, scroll }: TabLinkProps) {
  const [pending, setPending] = useState(false);

  return (
    <Link
      href={href}
      scroll={scroll}
      aria-current={isActive ? "page" : undefined}
      aria-busy={pending}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className={className}
    >
      <LinkPendingWatcher onPendingChange={setPending} />
      <span className="inline-flex items-center gap-1.5">
        {pending ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" strokeWidth={2} /> : null}
        {children}
      </span>
    </Link>
  );
}
