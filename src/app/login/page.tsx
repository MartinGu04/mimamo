import { LoginHero } from "@/components/login/LoginHero";
import { MAIN_CONTENT_ID, SkipToMainContentLink } from "@/components/layout/SkipToMainContentLink";
import { parseCalendarDate } from "@/lib/domain/dutyBlocks";
import { formatHebrewMonthName, formatHebrewWeekday } from "@/lib/presentation/hebrewDate";
import { formatScheduleMinute } from "@/lib/presentation/scheduleTime";
import { getJerusalemLocalNow } from "@/lib/time/jerusalemClock";

/**
 * Renders a live Asia/Jerusalem clock/date on every request, so it must
 * never be statically optimized at build time (that would freeze "now" at
 * whatever moment `next build` ran). No authenticated data loader is ever
 * reachable from here -- `getJerusalemLocalNow()` only reads the server's
 * own clock, never Google Sheets/Supabase.
 */
export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

/**
 * The app's entry experience -- deliberately outside the `(app)` route
 * group, so it never renders Sidebar/BottomNav and is never subject to
 * that group's auth gate (see root layout.tsx). Google OAuth via
 * `GoogleSignInButton` (inside `LoginHero`) is the only real
 * authentication action; everything else on this page is presentation.
 *
 * This route uses ONE fixed dark canvas regardless of the app's light/
 * dark preference -- no theme toggle, no theme-responsive tokens anywhere
 * on this page (unlike the rest of the app, which follows the user's
 * Light/Dark choice once signed in). The composition itself (visual
 * reference supplied directly) lives in `LoginHero` and the components it
 * assembles; this file only computes the safe, presentation-only Asia/
 * Jerusalem clock/date props and paints the shared ambient background.
 *
 * `?error=auth` is the existing contract from `/auth/callback` on a failed
 * code exchange -- surfaced as a restrained inline notice rather than
 * nothing.
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const hasAuthError = params.error === "auth";

  const localNow = getJerusalemLocalNow();
  const initialClockTime = `${formatScheduleMinute(localNow.minuteOfDay)}:00`;
  const weekdayLabel = formatHebrewWeekday(localNow.date);
  const monthLabel = formatHebrewMonthName(localNow.date);
  const dayNumber = parseCalendarDate(localNow.date)?.day ?? null;

  return (
    <div
      className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-[#05070d]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <SkipToMainContentLink />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        {/* A quiet, neutral (never brand-colored) vignette for depth --
            replaces the old purple/teal glow blobs. Static, not animated:
            depth here, not a decorative attention loop. */}
        <div className="absolute -top-24 -start-20 h-[26rem] w-[26rem] rounded-full bg-white/[0.04] blur-3xl" />
        <div className="absolute -bottom-28 -end-16 h-[24rem] w-[24rem] rounded-full bg-white/[0.03] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, white 1px, transparent 1px), linear-gradient(to right, white 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(80% 55% at 50% 25%, black, transparent 85%)",
          }}
        />
      </div>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
        <LoginHero
          initialClockTime={initialClockTime}
          weekdayLabel={weekdayLabel}
          dayNumber={dayNumber}
          monthLabel={monthLabel}
          hasAuthError={hasAuthError}
        />
      </main>
    </div>
  );
}
