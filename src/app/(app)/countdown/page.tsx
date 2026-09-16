import { redirect } from "next/navigation";
import { AccessDeniedScreen } from "@/components/auth/AccessDeniedScreen";
import Link from "next/link";
import { DischargeCountdownScreen } from "@/components/discharge/DischargeCountdownScreen";
import { DischargeEveryoneOverview } from "@/components/discharge/DischargeEveryoneOverview";
import { DischargeViewToggle } from "@/components/discharge/DischargeViewToggle";
import {
  countdownEveryoneHref,
  parseDischargeCountdownPersonId,
  parseDischargeCountdownView,
} from "@/lib/presentation/dischargeCountdownUrl";
import { formatDischargeDateLabel } from "@/lib/presentation/dischargeCountdown";
import {
  getRequestDischargeCountdown,
  type DischargeCountdownPersonSummary,
} from "@/lib/readModels/dischargeCountdown";

/**
 * "עד מתי???" -- a personal, live discharge countdown available to EVERY
 * mapped user (not manager-only), driven entirely by that user's own
 * `Person.dischargeDate`/`enlistmentDate` (never a hardcoded date, never
 * another person's). Identity is re-verified the same fail-closed way every
 * other protected page does (`getRequestDischargeCountdown`, request-scoped
 * `cache()`-memoized), and the same generic denial states apply -- no
 * personnel names/emails/workbook details leak through any of them.
 *
 * The actual live ticking (H:M:S, milestone phase, service progress) lives
 * entirely in the client `DischargeCountdownScreen` + the pure
 * `lib/presentation/dischargeCountdown` module -- this server component's
 * only job is authorization plus handing down the two already-resolved
 * instants (never a bare "YYYY-MM-DD" for the client to reinterpret, since
 * `lib/time/jerusalemClock` is server-only).
 */
interface CountdownPageProps {
  /** Optional so existing callers/tests can render the page with no query at all -- a bare `/countdown` is the canonical personal entry point. */
  searchParams?: Promise<{ view?: string | string[]; person?: string | string[] }>;
}

export default async function CountdownPage({ searchParams }: CountdownPageProps = {}) {
  const result = await getRequestDischargeCountdown();

  if (result.status === "unauthenticated") {
    redirect("/login");
  }
  if (result.status === "missing_email" || result.status === "unmapped" || result.status === "ambiguous_identity") {
    return <AccessDeniedScreen />;
  }

  const { view } = result;
  const params = searchParams ? await searchParams : {};

  // `view.everyone === null` IS the authorization answer (resolved server-side
  // against this caller's own כ"א record). With no roster, `?view=`/`?person=`
  // are ignored outright rather than merely hidden, so a hand-written URL
  // cannot reach another person's countdown.
  const roster = view.everyone;
  const requestedView = roster ? parseDischargeCountdownView(params.view) : "personal";
  const requestedPersonId = roster ? parseDischargeCountdownPersonId(params.person) : null;

  // A selection is honoured only for someone actually ON the roster, so a
  // permanent or reserve person's id in the URL resolves to nobody and falls
  // back to the overview rather than rendering them.
  const selectedPerson = requestedPersonId
    ? (roster?.find((candidate) => candidate.personId === requestedPersonId) ?? null)
    : null;

  if (requestedView === "everyone" && roster) {
    return (
      <div className="flex flex-col gap-4">
        <DischargeViewToggle active="everyone" />
        {selectedPerson ? (
          <SelectedPersonCountdown person={selectedPerson} />
        ) : (
          <DischargeEveryoneOverview people={roster} nowMs={new Date(view.resolvedAtIso).getTime()} />
        )}
      </div>
    );
  }

  if (!view.dischargeDate || !view.dischargeInstantIso || !view.dischargeDayEndInstantIso) {
    return renderEmptyState(roster !== null);
  }

  const dischargeDateLabel = formatDischargeDateLabel(view.dischargeDate) ?? view.dischargeDate;

  return (
    <div className="flex flex-col gap-4">
      {roster ? <DischargeViewToggle active="personal" /> : null}
      <DischargeCountdownScreen
        dischargeDateLabel={dischargeDateLabel}
        dischargeInstantIso={view.dischargeInstantIso}
        dischargeDayEndInstantIso={view.dischargeDayEndInstantIso}
        enlistmentInstantIso={view.enlistmentInstantIso}
      />
    </div>
  );
}

/**
 * One person opened from the overview -- the SAME `DischargeCountdownScreen`
 * the personal view renders, just fed that person's instants and told whose
 * countdown it is, rather than a second countdown implementation. Browser
 * Back already returns to the roster (the view lives in the URL); this adds
 * the explicit way back alongside it.
 */
function SelectedPersonCountdown({ person }: { person: DischargeCountdownPersonSummary }) {
  const backLink = (
    <Link
      href={countdownEveryoneHref()}
      className="mx-auto text-sm font-medium text-muted transition-colors duration-200 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      → חזרה לכולם
    </Link>
  );

  if (!person.dischargeDate || !person.dischargeInstantIso || !person.dischargeDayEndInstantIso) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <div className="flex min-h-[calc(100dvh-16rem)] flex-col items-center justify-center gap-4 px-4 py-16 text-center text-foreground sm:px-8">
          <h1 className="text-4xl font-black tracking-tight sm:text-6xl">עד מתי???</h1>
          <p className="text-base font-semibold text-foreground sm:text-lg">{person.personName}</p>
          <p className="max-w-sm text-base text-muted">לא נמצא תאריך שחרור עבור אדם זה במערכת.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {backLink}
      <DischargeCountdownScreen
        personName={person.personName}
        dischargeDateLabel={formatDischargeDateLabel(person.dischargeDate) ?? person.dischargeDate}
        dischargeInstantIso={person.dischargeInstantIso}
        dischargeDayEndInstantIso={person.dischargeDayEndInstantIso}
        enlistmentInstantIso={person.enlistmentInstantIso}
      />
    </div>
  );
}

/** No discharge date on record for this person -- a clean, non-blocking empty state, never a guessed/default date. The toggle stays when this viewer is allowed the roster, so "no date of my own" never strands them away from "כולם". */
function renderEmptyState(showToggle: boolean) {
  return (
    <div className="flex flex-col gap-4">
      {showToggle ? <DischargeViewToggle active="personal" /> : null}
      <div className="relative flex min-h-[calc(100dvh-10rem)] flex-col items-center justify-center gap-4 overflow-hidden px-4 py-16 text-center text-foreground sm:px-8">
      <h1 className="text-4xl font-black tracking-tight sm:text-6xl">עד מתי???</h1>
      <p className="max-w-sm text-base text-muted">
          לא נמצא תאריך שחרור עבורך במערכת. פנה/י למנהל המערכת אם לדעתך זו טעות.
        </p>
      </div>
    </div>
  );
}
