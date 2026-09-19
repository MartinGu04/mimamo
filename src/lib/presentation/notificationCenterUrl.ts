/**
 * מרכז התראות -- the standalone Notification Center's four primary
 * sections. "עכשיו" (immediate send) is the default, omitted from the URL
 * like every other "default" param this app already omits (`ManagerCategory`'s
 * `overview`, `FairnessMode`'s `shifts`). Order here is the product's own
 * fixed order (עכשיו / תזמון / היסטוריה / קבועות), never re-sorted.
 */
export type NotificationCenterSection = "now" | "schedule" | "history" | "fixed";

/** Each section's own Hebrew label, in the product's fixed order -- the single source both `NotificationCenterNav`'s tab strip and the page's per-section `<h2>` (ahead of that section's own `<h3>`/`<h4>` content) render from, so the two can never drift apart. */
export const NOTIFICATION_CENTER_SECTION_LABEL: Record<NotificationCenterSection, string> = {
  now: "עכשיו",
  schedule: "תזמון",
  history: "היסטוריה",
  fixed: "קבועות",
};

/** Strict parse of `?section=` -- anything else (including missing) falls back to `"now"`, never a guess or a crash. */
export function parseNotificationCenterSectionParam(raw: string | null | undefined): NotificationCenterSection {
  if (raw === "schedule" || raw === "history" || raw === "fixed") return raw;
  return "now";
}

/**
 * Whether this section needs the manager-safe roster + readiness/adoption
 * projection (`NotificationCenterContext`) -- "עכשיו"/"תזמון"/"קבועות" all
 * render an audience picker that needs both; "היסטוריה" renders neither (see
 * `ManagerRecentBroadcastsSection`, which takes no roster/adoptionPeople
 * prop at all), so the page's own loader skips building/fetching either for
 * it entirely -- see `loadNotificationCenterContext` (`notificationCenter.ts`).
 */
export function notificationCenterSectionNeedsRosterAndAdoption(section: NotificationCenterSection): boolean {
  return section !== "history";
}

/** Builds a `/notifications` URL for the given section, omitting `?section=` entirely for the default ("עכשיו") -- so the default view is always the bare `/notifications`. Pure string building, no navigation/side effects -- safe to call from a Server Component. */
export function buildNotificationCenterHref(section: NotificationCenterSection): string {
  return section === "now" ? "/notifications" : `/notifications?section=${section}`;
}
