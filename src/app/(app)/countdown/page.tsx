import { redirect } from "next/navigation";
import { AccessDeniedScreen } from "@/components/auth/AccessDeniedScreen";
import { DischargeCountdownScreen } from "@/components/discharge/DischargeCountdownScreen";
import { formatDischargeDateLabel } from "@/lib/presentation/dischargeCountdown";
import { getRequestDischargeCountdown } from "@/lib/readModels/dischargeCountdown";

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
export default async function CountdownPage() {
  const result = await getRequestDischargeCountdown();

  if (result.status === "unauthenticated") {
    redirect("/login");
  }
  if (result.status === "missing_email" || result.status === "unmapped" || result.status === "ambiguous_identity") {
    return <AccessDeniedScreen />;
  }

  const { view } = result;

  if (!view.dischargeDate || !view.dischargeInstantIso || !view.dischargeDayEndInstantIso) {
    return renderEmptyState();
  }

  const dischargeDateLabel = formatDischargeDateLabel(view.dischargeDate) ?? view.dischargeDate;

  return (
    <DischargeCountdownScreen
      dischargeDateLabel={dischargeDateLabel}
      dischargeInstantIso={view.dischargeInstantIso}
      dischargeDayEndInstantIso={view.dischargeDayEndInstantIso}
      enlistmentInstantIso={view.enlistmentInstantIso}
    />
  );
}

/** No discharge date on record for this person -- a clean, non-blocking empty state, never a guessed/default date. */
function renderEmptyState() {
  return (
    <div className="relative flex min-h-[calc(100dvh-10rem)] flex-col items-center justify-center gap-4 overflow-hidden px-4 py-16 text-center text-foreground sm:px-8">
      <h1 className="text-4xl font-black tracking-tight sm:text-6xl">עד מתי???</h1>
      <p className="max-w-sm text-base text-muted">
        לא נמצא תאריך שחרור עבורך במערכת. פנה/י למנהל המערכת אם לדעתך זו טעות.
      </p>
    </div>
  );
}
