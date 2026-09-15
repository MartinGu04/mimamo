import { BLOCKING_ABSENCE_KINDS } from "@/lib/domain/operationalIssues";
import type { ReportOneDraft } from "@/lib/domain/reportOne";
import { DataFreshnessStatus } from "@/components/ui/DataFreshnessStatus";
import { ReportOneQuickAction } from "@/components/home/ReportOneQuickAction";
import { SetupSection } from "@/components/home/SetupSection";
import { buildPersonalWeekOverview } from "@/lib/presentation/personalWeekOverview";
import type { PersonalEventView, PersonalScheduleReadModel } from "@/lib/readModels/types";
import type { DashboardVisitRecap } from "@/lib/readModels/recentDashboardChangesTypes";
import { DashboardVisitSession } from "./DashboardVisitSession";
import { Header } from "./Header";
import { Hero } from "./Hero";
import { IssuesPanel } from "./IssuesPanel";
import { TodayTimeline } from "./TodayTimeline";
import { UpcomingSection } from "./UpcomingSection";
import { WeekOverviewSection } from "./WeekOverviewSection";

interface DashboardProps {
  model: PersonalScheduleReadModel;
  /**
   * The "מה השתנה מאז הפעם הקודמת" recap (originally PR #36's "מה
   * השתנה", upgraded to a true "since your previous Home visit" recap)
   * -- `null`/omitted for every existing caller/test (regression-safe),
   * and whenever `page.tsx` decided this person is ineligible
   * (permanent/unclassified personnel never receive this prop at all).
   * Handed to `DashboardVisitSession` (mounted only when non-null),
   * which freezes it for the lifetime of one mounted Home visit -- see
   * that component's own docstring for why a plain pass-through here
   * would let an `AppRevalidator` refresh silently replace/empty a recap
   * the user is still looking at.
   */
  visitRecap?: DashboardVisitRecap | null;
  /**
   * "דוח 1 למחר" -- `null`/omitted whenever this person isn't a manager
   * (Report 1 needs department-wide roster/schedule access, not just a
   * personal schedule) or the draft itself failed to load. Reaches THIS
   * component for every manager who is NOT a permanent (קבע) manager --
   * a permanent manager gets the same quick action on `PermanentManagerHome`
   * instead; see `(dashboard)/page.tsx` for the routing.
   */
  reportOneDraft?: ReportOneDraft | null;
  /** Passed straight through to `ReportOneQuickAction` -- see `ReportOneEditorOverlay`'s own docs. `undefined`/omitted whenever `reportOneDraft` itself is `null`. */
  reportOneReserveInclusion?: Readonly<Record<string, boolean>>;
  /** Authenticated Supabase user id, passed straight through to `SetupSection` -- see its own docstring. `undefined`/omitted degrades to no setup card at all, same as every other optional prop here. */
  userId?: string;
  /** The authoritative calendar-sync state, passed straight through to `SetupSection` -- see its own docstring. Defaults to `false` (not yet synced) for callers that don't pass it, same conservative default `SetupSection` itself would derive from an absent signal. */
  calendarSyncEnabled?: boolean;
  /**
   * Account-level onboarding eligibility, passed straight through to
   * `SetupSection` -- see its own docstring and `lib/config/onboardingRollout.ts`.
   * Defaults to `false` (never show) for callers that don't pass it -- the
   * safe fail-closed default: an unproven account age must never be
   * treated as "new".
   */
  eligibleForOnboarding?: boolean;
}

/** A known blocking absence (vacation/abroad/medical/day_off) dated today, reusing the domain's own "blocking" semantics -- never redefined here. */
function findVacationEvent(todayEvents: readonly PersonalEventView[]): PersonalEventView | null {
  return (
    todayEvents.find(
      (event) => event.category === "absence" && event.absenceKind !== null && BLOCKING_ABSENCE_KINDS.has(event.absenceKind),
    ) ?? null
  );
}

/**
 * Server-rendered composition of the whole dashboard. All data comes from
 * the already-safe `PersonalScheduleReadModel` -- no raw Events/People,
 * nothing re-derived from spreadsheet text here.
 *
 * Layout: a main narrative column (header, hero, today) plus a secondary
 * contextual column (issues, upcoming) on desktop; a single stacked column
 * on mobile, hero-first. Release-polish pass: the top-level Header/
 * freshness/content spacing was trimmed from `gap-6` down to `gap-4` (a
 * follow-up pass tightened it further from an intermediate `gap-5`) --
 * real vertical space this page didn't need, part of removing a small
 * unnecessary page scroll at normal desktop viewport heights, alongside
 * `AppShell`'s own top padding. The two-column grid's OWN internal `gap-6`
 * (between Hero/Timeline/etc.) is unchanged.
 *
 * "השבוע הקרוב" (`WeekOverviewSection`) sits BELOW that whole two-column
 * grid as its own full-width section -- deliberately not squeezed inside
 * the narrower main column (which shares its width with the 360px
 * sidebar), since a full seven-day week needs the page's whole width to
 * stay readable on desktop. This never touches Hero/Today's own
 * prominence (both still lead the page) or the sidebar's existing
 * issues/upcoming meaning -- it's a distinct, complete weekly view build
 * purely from `calendarEvents` (never `upcomingEvents`, which excludes
 * finished history) via `buildPersonalWeekOverview`.
 */
export function Dashboard({
  model,
  visitRecap = null,
  reportOneDraft = null,
  reportOneReserveInclusion,
  userId,
  calendarSyncEnabled = false,
  eligibleForOnboarding = false,
}: DashboardProps) {
  const hasCurrentAssignment = model.currentAssignments.length > 0;

  // Vacation only becomes the hero's story when nothing is currently
  // active -- a blocking absence alongside a live assignment is exactly
  // the blocking_absence_with_assignment conflict, already surfaced via
  // Issues; the current assignment still leads the hero.
  const vacationEvent = hasCurrentAssignment ? null : findVacationEvent(model.todayEvents);
  const otherTodayEvents = vacationEvent ? model.todayEvents.filter((event) => event !== vacationEvent) : [];

  const showsNextGroup = !hasCurrentAssignment && !vacationEvent && model.nextAssignmentGroup !== null;

  // The exact assignments the Hero is already displaying -- Upcoming must
  // exclude only these specific Events, never every Event sharing their
  // date (see UpcomingSection for why a date-wide exclusion is wrong).
  // Nothing is "represented" when the hero shows the vacation/empty state.
  const heroAssignments = hasCurrentAssignment
    ? model.currentAssignments
    : showsNextGroup
      ? (model.nextAssignmentGroup?.events ?? [])
      : [];

  const todayDutyActions = model.dutyActions.filter((action) => action.date === model.localNow.date);

  const weekOverview = buildPersonalWeekOverview(model.calendarEvents, model.localNow);

  return (
    <div className="flex flex-col gap-4">
      <Header personName={model.person.name} localNow={model.localNow} />
      <SetupSection userId={userId} calendarSyncEnabled={calendarSyncEnabled} eligibleForOnboarding={eligibleForOnboarding} />
      {reportOneDraft ? (
        <ReportOneQuickAction draft={reportOneDraft} reserveInclusionByPersonId={reportOneReserveInclusion} />
      ) : null}
      <DataFreshnessStatus fetchedAt={model.fetchedAt} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6 lg:order-1">
          <Hero
            currentAssignments={model.currentAssignments}
            nextAssignmentGroup={model.nextAssignmentGroup}
            currentShiftContexts={model.currentShiftContexts}
            nextShiftContexts={model.nextShiftContexts}
            currentAdjacentShiftContexts={model.currentAdjacentShiftContexts}
            vacationEvent={vacationEvent}
            otherTodayEvents={otherTodayEvents}
            fetchedAt={model.fetchedAt}
            localNowDate={model.localNow.date}
          />

          <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
            <TodayTimeline
              todayEvents={model.todayEvents}
              todayDutyActions={todayDutyActions}
              localNow={model.localNow}
            />
          </div>

          {visitRecap ? <DashboardVisitSession visitRecap={visitRecap} /> : null}
        </div>

        <div className="flex flex-col gap-6 lg:order-2">
          <div className="animate-fade-up" style={{ animationDelay: "140ms" }}>
            <IssuesPanel issues={model.issues} />
          </div>
          <div className="animate-fade-up" style={{ animationDelay: "200ms" }}>
            <UpcomingSection
              upcomingEvents={model.upcomingEvents}
              dutyBlocks={model.dutyBlocks}
              localNowDate={model.localNow.date}
              representedAssignments={heroAssignments}
            />
          </div>
        </div>
      </div>

      <div className="animate-fade-up" style={{ animationDelay: "240ms" }}>
        <WeekOverviewSection overview={weekOverview} />
      </div>
    </div>
  );
}
