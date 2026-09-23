import { Header } from "@/components/dashboard/Header";
import { DataFreshnessStatus } from "@/components/ui/DataFreshnessStatus";
import { SetupSection } from "@/components/home/SetupSection";
import type { ReportOneDraft } from "@/lib/domain/reportOne";
import type { PermanentManagerHomeReadModel } from "@/lib/readModels/permanentManagerHomeTypes";
import { HomeQuickActions } from "./HomeQuickActions";
import { ShiftSnapshotCard } from "./ShiftSnapshotCard";
import { TodayOperationalContext } from "./TodayOperationalContext";

interface PermanentManagerHomeProps {
  model: PermanentManagerHomeReadModel;
  /** `null`/omitted whenever "דוח 1 למחר" itself failed to load (e.g. a transient auth/config issue) -- the quick action simply doesn't render rather than breaking the rest of Home. */
  reportOneDraft?: ReportOneDraft | null;
  /** Passed straight through to `HomeQuickActions` (then `ReportOneQuickAction`) -- see `ReportOneEditorOverlay`'s own docs. `undefined`/omitted whenever `reportOneDraft` itself is `null`. */
  reportOneReserveInclusion?: Readonly<Record<string, boolean>>;
  /** Authenticated Supabase user id, passed straight through to `SetupSection` -- a permanent manager gets the exact same setup card a regular Dashboard visitor does, see that component's own docstring. */
  userId?: string;
  /** The authoritative calendar-sync state, passed straight through to `SetupSection` -- see its own docstring. */
  calendarSyncEnabled?: boolean;
  /** Account-level onboarding eligibility, passed straight through to `SetupSection` -- see its own docstring and `lib/config/onboardingRollout.ts`. Defaults to `false` (never show). */
  eligibleForOnboarding?: boolean;
}

/**
 * "מה קורה עכשיו במחלקה?" -- the operational snapshot Home for an
 * authenticated permanent (קבע) manager (see `page.tsx` for the exact
 * eligibility gate). Entirely driven by `PermanentManagerHomeReadModel` --
 * no raw Event/Person, no Potential/Fairness, no recommendation evidence.
 * A coverage problem links out to the EXISTING `/manager` "דורש טיפול"
 * flow (see `ShiftSnapshotCard`) rather than reproducing it here.
 *
 * Layout: previous/current/next as a row on desktop (current visibly
 * dominant via `order`/grid weighting, never plain DOM order alone -- see
 * the `order-*` classes below), current-first stacked on mobile, followed
 * by the smaller "today" section.
 */
export function PermanentManagerHome({
  model,
  reportOneDraft,
  reportOneReserveInclusion,
  userId,
  calendarSyncEnabled = false,
  eligibleForOnboarding = false,
}: PermanentManagerHomeProps) {
  const todayDate = model.localNow.date;

  return (
    <div className="flex flex-col gap-6">
      <Header personName={model.person.name} localNow={model.localNow} />
      <SetupSection userId={userId} calendarSyncEnabled={calendarSyncEnabled} eligibleForOnboarding={eligibleForOnboarding} />

      <HomeQuickActions reportOneDraft={reportOneDraft} reportOneReserveInclusion={reportOneReserveInclusion} />
      {/*
       * `DataFreshnessStatus` (shared across every route) lays itself out as
       * a `justify-between` row -- on this page's wide desktop content
       * column that pushes "רענון נתונים" all the way to the far edge,
       * detached from the "מקור: Google Sheets · עודכן..." text it belongs
       * to. `w-fit` (this page only, via the component's own existing
       * `className` prop -- no change to the shared component itself)
       * shrinks the row to its content width, so `justify-between` has no
       * extra space left to distribute and the two ends sit directly next
       * to each other as one compact metadata group. At narrow (mobile)
       * widths the content already fills the available width, so this is a
       * no-op there -- identical wrapping/stacking behavior as before.
       */}
      <DataFreshnessStatus fetchedAt={model.fetchedAt} className="w-fit" />

      <div>
        <h2 className="mb-3 text-lg font-semibold text-foreground sm:text-xl">מה קורה עכשיו במחלקה?</h2>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_1.5fr_1fr]">
          <div className="order-2 lg:order-1">
            <ShiftSnapshotCard label="הקודמת" shift={model.previousShift} todayDate={todayDate} />
          </div>
          <div className="order-1 lg:order-2">
            <ShiftSnapshotCard
              label="המשמרת עכשיו"
              shift={model.currentShift}
              todayDate={todayDate}
              current={{ timing: model.currentShift.timing, fetchedAt: model.fetchedAt }}
            />
          </div>
          <div className="order-3 lg:order-3">
            <ShiftSnapshotCard label="הבאה" shift={model.nextShift} todayDate={todayDate} />
          </div>
        </div>
      </div>

      <div className="animate-fade-up" style={{ animationDelay: "80ms" }}>
        <TodayOperationalContext duties={model.todayDuties} absences={model.todayAbsences} />
      </div>
    </div>
  );
}
