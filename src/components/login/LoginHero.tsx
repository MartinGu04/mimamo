import Link from "next/link";
import { Shield } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { LOGIN_AUTH_NOTE, LOGIN_HERO_EYEBROW, LOGIN_HERO_HEADLINE, LOGIN_HERO_SUBTEXT } from "@/lib/config/loginCopy";
import { LoginClockReadout } from "./LoginClockReadout";
import { LoginErrorNotice } from "./LoginErrorNotice";
import { LoginFeatureStrip } from "./LoginFeatureStrip";
import { LoginHeaderLogo } from "./LoginHeaderLogo";
import { LoginScheduleRing } from "./LoginScheduleRing";

interface LoginHeroProps {
  initialClockTime: string;
  weekdayLabel: string | null;
  dayNumber: number | null;
  monthLabel: string | null;
  hasAuthError: boolean;
}

/**
 * The login route's complete content composition (visual reference
 * supplied directly for this redesign) -- one continuous dark canvas at
 * every viewport size, no light/dark switch, no separate "card" surface.
 *
 * Desktop uses a 2-column CSS grid (ring on the start/right... actually
 * inline-start side, text column on it too -- see below) where the text
 * column's three stacked pieces (headline block, clock readout, CTA) are
 * three separate grid items placed in the SAME column via explicit
 * `col-start`/`row-start`, while the ring occupies the other column,
 * row-spanned to center beside all three. Below `lg`, the grid collapses
 * to one column and `order-*` sequences the pieces into the mobile
 * reference's actual order (headline block, then the ring, then the
 * CTA) -- a genuine reflow, not the desktop layout merely scaled down.
 * `LoginScheduleRing` itself now renders the identical tick-marked/
 * sweep-hand clock face at every breakpoint (previously mobile-only
 * swapped it for the plain digital readout) -- mobile keeps that digital
 * readout too, nested directly under the ring inside the SAME `order-2`
 * grid item (a tight `gap-3` flex column, not the grid's own `gap-y-6`)
 * so relocating it out of the ring's center doesn't add a full extra grid
 * row's worth of spacing -- narrow phones (e.g. iPhone SE) are short
 * enough that the CTA below would otherwise drop out of the first
 * viewport.
 */
export function LoginHero({ initialClockTime, weekdayLabel, dayNumber, monthLabel, hasAuthError }: LoginHeroProps) {
  return (
    <div className="relative mx-auto flex w-full max-w-[1680px] flex-1 flex-col px-6 pb-6 pt-5 sm:px-10 sm:pb-10 sm:pt-8 lg:px-16 lg:py-10 xl:px-24">
      <div className="flex justify-center lg:justify-start">
        <LoginHeaderLogo />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-y-6 sm:mt-12 sm:gap-y-9 lg:mt-14 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-x-16 lg:gap-y-8 xl:gap-x-24">
        <div className="order-1 flex flex-col items-center text-center lg:order-none lg:col-start-2 lg:row-start-1 lg:items-start lg:text-start">
          <p className="text-sm font-semibold text-[#8ab4d6] sm:text-base lg:text-xl lg:tracking-wide">
            {LOGIN_HERO_EYEBROW}
          </p>
          <h1 className="mt-2 max-w-md text-[clamp(1.75rem,4.4vw,2.75rem)] leading-[1.15] font-bold text-white lg:mt-4 lg:max-w-xl lg:text-[clamp(3rem,3.6vw,4.75rem)] lg:leading-[1.08]">
            {LOGIN_HERO_HEADLINE}
          </h1>
          <p className="mt-3 max-w-sm text-base leading-relaxed text-white/75 lg:mt-5 lg:max-w-lg lg:text-xl lg:text-white/60">
            {LOGIN_HERO_SUBTEXT}
          </p>
        </div>

        <div className="order-2 flex flex-col items-center gap-3 lg:order-none lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:items-start lg:gap-0">
          <LoginScheduleRing />
          <div className="lg:hidden">
            <LoginClockReadout
              variant="stacked"
              initialClockTime={initialClockTime}
              weekdayLabel={weekdayLabel}
              dayNumber={dayNumber}
              monthLabel={monthLabel}
            />
          </div>
        </div>

        <div className="hidden lg:col-start-2 lg:row-start-2 lg:block">
          <LoginClockReadout
            variant="panel"
            initialClockTime={initialClockTime}
            weekdayLabel={weekdayLabel}
            dayNumber={dayNumber}
            monthLabel={monthLabel}
          />
        </div>

        <div className="order-3 flex w-full flex-col items-center lg:order-none lg:col-start-2 lg:row-start-3 lg:items-start">
          <div className="w-full max-w-sm lg:max-w-md">
            {hasAuthError ? <LoginErrorNotice className="mb-4" /> : null}
            <GoogleSignInButton />
            <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-white/65 lg:mt-5 lg:justify-start lg:text-sm lg:text-white/50">
              <Shield className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
              {LOGIN_AUTH_NOTE}
            </p>
          </div>
        </div>
      </div>

      <div className="lg:mt-auto lg:pt-16">
        <LoginFeatureStrip />
      </div>

      {/* Public, unauthenticated -- the one discoverable link into the
          accessibility statement for a visitor who hasn't signed in yet
          (Phase 7). Deliberately a small, secondary footer-style link, not
          part of LoginFeatureStrip (which is desktop-only and a distinct
          "value prop" surface) -- this must be reachable at every viewport. */}
      <div className="mt-6 flex justify-center lg:justify-start">
        <Link
          href="/accessibility"
          className="rounded text-xs text-white/55 underline decoration-white/30 underline-offset-2 transition-colors duration-150 hover:text-white/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          הצהרת נגישות
        </Link>
      </div>
    </div>
  );
}
