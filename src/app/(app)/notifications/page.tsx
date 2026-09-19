import { ManagerBroadcastComposer } from "@/components/manager/ManagerBroadcastComposer";
import { ManagerFixedNotificationsSection } from "@/components/manager/ManagerFixedNotificationsSection";
import { ManagerForbiddenState } from "@/components/manager/ManagerForbiddenState";
import { NotificationCenterHeader } from "@/components/notifications/NotificationCenterHeader";
import { NotificationCenterNav } from "@/components/notifications/NotificationCenterNav";
import { NotificationHistorySection } from "@/components/notifications/NotificationHistorySection";
import { NotificationScheduleSection } from "@/components/notifications/NotificationScheduleSection";
import {
  NOTIFICATION_CENTER_SECTION_LABEL,
  notificationCenterSectionNeedsRosterAndAdoption,
  parseNotificationCenterSectionParam,
} from "@/lib/presentation/notificationCenterUrl";
import { getRequestNotificationCenterContext } from "@/lib/readModels/getRequestNotificationCenterContext";

type SearchParamValue = string | string[] | undefined;

interface NotificationCenterPageProps {
  searchParams: Promise<{ section?: SearchParamValue }>;
}

/**
 * "מרכז התראות" -- a completely standalone, top-level Manager-only
 * destination (`/notifications`), at the same navigation level as
 * "לוח בקרה"/"הלוח שלי"/"תורנויות"/"טבלת צדק"/"אזור מנהל" -- NOT a
 * subsection of "אזור מנהל" (`/manager`). The two are separate product
 * surfaces: "אזור מנהל" is operational/team management (schedule, coverage,
 * roster, duties, login readiness); "מרכז התראות" is sending, scheduling,
 * history, and recurring/system notification management, none of which
 * "אזור מנהל" renders anymore.
 *
 * Authorization is independently re-derived here, server-side, every
 * request -- `getRequestNotificationCenterContext()` (a request-scoped
 * `cache()` around `loadNotificationCenterContext()`) resolves the
 * authenticated identity against the CURRENT personnel roster and verifies
 * `Person.isManager === true`, via the SAME lightweight
 * `loadManagerPersonnelContext()` boundary the existing scheduled/recent-
 * broadcast polls and notification-rule Server Actions already use (a
 * personnel-only workbook read, the existing short-TTL cache -- never the
 * heavier 5-source `loadManagerWorkbookContext()` Manager Overview needs,
 * and never a persistent cache of authenticated identity). Hiding the nav
 * link from non-managers (`nav-items.ts`) is presentation only, not
 * authorization -- a non-manager who navigates here directly still fails
 * closed to `ManagerForbiddenState` below and never receives roster/
 * readiness data. Every Server Action this page's sections call
 * (`sendManagerBroadcastAction`, the scheduled-broadcast actions, the
 * notification-rule actions) ALSO independently re-authorizes itself --
 * this page-level check is additional route protection, never a
 * replacement for that defense-in-depth.
 *
 * `?section=` picks one of exactly four sections, in the product's own
 * fixed order (see `NotificationCenterNav`): "עכשיו" (default) reuses the
 * existing broadcast composer fixed to an immediate send; "תזמון" reuses
 * the SAME composer fixed to scheduling, plus the existing scheduled-
 * broadcast list; "היסטוריה" reuses the existing "נשלחו לאחרונה" list
 * outright; "קבועות" reuses the existing system/recurring notification-rule
 * UI outright. Not every section needs the same data --
 * `notificationCenterSectionNeedsRosterAndAdoption()` gates the roster +
 * readiness/adoption projection off entirely for "היסטוריה" (which renders
 * no audience picker at all), so that section never pays for the
 * privileged Supabase Admin API + `push_subscriptions` readiness lookup.
 * This page never builds/loads the full `ManagerOverviewReadModel` --
 * no schedule/settings/Potential parsing, no `detectOperationalIssues()`,
 * no `ShiftSchedule` -- see `NotificationCenterContext`'s own docstring.
 */
export default async function NotificationCenterPage({ searchParams }: NotificationCenterPageProps) {
  const rawParams = await searchParams;
  const section = parseNotificationCenterSectionParam(
    Array.isArray(rawParams.section) ? rawParams.section[0] : rawParams.section,
  );
  const needsRosterAndAdoption = notificationCenterSectionNeedsRosterAndAdoption(section);

  const result = await getRequestNotificationCenterContext(needsRosterAndAdoption);

  // Every non-"ok" status -- `forbidden` (a mapped, authenticated, non-manager
  // visitor -- the reachable case) and the four identity-resolution states
  // (unreachable in practice: the protecting `(app)/layout.tsx` already
  // redirects/denies an unauthenticated or unmapped/ambiguous visitor before
  // any page under it renders, via the same underlying identity check) --
  // fails closed to the SAME manager-only denial screen `/manager` itself
  // uses. No manager roster/readiness data is ever returned to a non-"ok"
  // caller (see `loadNotificationCenterContext`'s own contract).
  if (result.status !== "ok") {
    return <ManagerForbiddenState />;
  }

  const { roster, adoptionPeople } = result.context;

  return (
    <div className="flex flex-col gap-6">
      <NotificationCenterHeader />
      <NotificationCenterNav active={section} />

      {/*
       * "מרכז התראות"'s own `<h1>` (NotificationCenterHeader) stays put --
       * each section/tab below still needs its OWN `<h2>` ahead of its own
       * `<h3>`/`<h4>` content (the composer's "📣 שליחת התראה", "📌 התראות
       * קבועות" and its two `<h4>` subgroups, etc.), or those would skip
       * straight from the page's h1 to an h3/h4. `sr-only`: the tab strip
       * right above already shows this section's name visibly, so this is
       * a heading for the accessibility tree only, not a second visible
       * title -- current appearance is unaffected.
       */}
      <h2 className="sr-only">{NOTIFICATION_CENTER_SECTION_LABEL[section]}</h2>

      {section === "now" ? <ManagerBroadcastComposer mode="now" roster={roster} adoptionPeople={adoptionPeople} /> : null}

      {section === "schedule" ? <NotificationScheduleSection roster={roster} adoptionPeople={adoptionPeople} /> : null}

      {section === "history" ? <NotificationHistorySection /> : null}

      {section === "fixed" ? (
        <ManagerFixedNotificationsSection roster={roster} adoptionPeople={adoptionPeople} />
      ) : null}
    </div>
  );
}
