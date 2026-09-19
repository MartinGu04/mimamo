import { Clock } from "lucide-react";
import Image from "next/image";
import { NotificationBell } from "@/components/pwa/NotificationBell";
import { LiveClock } from "@/components/ui/LiveClock";
import { ORG_LOGO_STRATEGIC_COMMUNICATION, ORG_LOGO_TAKSHAL, type OrgLogo } from "@/lib/config/brandAssets";

interface ShellUtilityBarProps {
  /** Same "HH:mm:ss" (or `null`) contract as `LiveClock.initialTime` -- see there for why it can be `null`. */
  initialClockTime: string | null;
  /**
   * Pre-formatted Hebrew weekday+date (`formatHebrewWeekdayAndDate`), e.g.
   * "יום רביעי · 12 באוגוסט" -- same "server formats, component only
   * renders" convention every other date label in this app already
   * follows (see `MonthNav.monthLabel`). `null` exactly when
   * `initialClockTime` is `null` (no server-derived `localNow` to format
   * from) -- the date line is simply omitted then, never guessed
   * client-side.
   */
  dateLabel: string | null;
  /**
   * Authenticated Supabase user id, threaded through only to
   * `NotificationBell`'s `usePushSubscription` -- see `AppShell`'s own
   * docstring. `undefined` on the (never actually reached in real usage)
   * no-`person` render path -- `usePushSubscription` degrades gracefully
   * with no persisted preference in that case.
   */
  userId?: string;
}

/**
 * Both supplied org marks have a genuinely transparent background (not a
 * baked-in white square), so they composite cleanly on either theme with
 * no extra "chip" container. Their SOURCE canvases are not equally tight
 * crops around the visible emblem, though (תקש"ל's is a portrait canvas
 * with generous top/bottom margin; the 502 mark's is a near-full-bleed
 * square) -- rendering both at the same outer height would make the
 * תקש"ל emblem look visibly smaller. `heightClassName` is therefore
 * calibrated per logo (measured from each file's actual opaque-pixel
 * bounding box) so the two marks read as the same size, not just the same
 * bounding box -- see the two call sites below for the exact values.
 * Follow-up visual pass: both marks read as too small/icon-like at their
 * original sizes, so both grew ~50% (60px/78px, up from 40px/52px) while
 * keeping the SAME measured ratio (≈1.3) between them, so the calibration
 * itself is unchanged -- only the overall scale. Release-polish pass:
 * scaled back down slightly (49px/64px) purely to shave real height off
 * the bar (see `ShellUtilityBar`'s own docstring). Header-logo-correction
 * pass: the previous pass over-corrected in the wrong direction (a
 * different mark, `BrandMark`, was enlarged instead of these two) --
 * these two are now the actual target, grown meaningfully (49px/64px ->
 * 69px/90px, +~41%) while the ≈1.3 ratio is still preserved.
 */
function OrgLogoImage({ logo, heightClassName }: { logo: OrgLogo; heightClassName: string }) {
  return (
    <Image
      src={logo.src}
      alt={logo.alt}
      width={logo.width}
      height={logo.height}
      className={`w-auto shrink-0 object-contain ${heightClassName}`}
    />
  );
}

/**
 * The global app shell's top utility bar (Design Pass PR #19, redesigned in
 * the "header polish" pass) -- desktop-only (`lg:`, matching the desktop
 * `Sidebar`; mobile/tablet keep their own `MobileIdentityBar`, which
 * already carries its own bell and needs no change here). Three-zone
 * layout via CSS grid so the CENTER group (the two organizational marks
 * flanking the live clock/date) stays mathematically centered regardless
 * of what sits in the left/right cells:
 *
 *   [ bell ]   [ תקש"ל  ·  clock + date  ·  502/תקש"אס ]   [ (balance) ]
 *
 * The clock is the one deliberate FOCAL element -- a soft `surface-1` pill
 * (bigger digits than the old bare "sm" readout, plus the date as a clear
 * secondary line underneath) so it reads as real shell chrome instead of
 * a loose timestamp. Release-polish pass: the bar's own vertical padding
 * and the pill's padding were both trimmed down -- the bar was taller than
 * it needed to be, tall enough to force a small unnecessary page scroll at
 * normal desktop viewport heights. A follow-up pass then dropped the
 * pill's own `ring-1 ring-border` -- against the two org marks and the
 * bell right next to it, the extra outline read as one more heavy frame;
 * the `surface-1` tint alone still separates it from the bar's background
 * without boxing it in. The two logos are real supplied institutional marks
 * (`lib/config/brandAssets.ts`), used exactly as provided -- grown to a
 * genuinely prominent size (header-logo-correction pass) so they carry real
 * visual weight next to the clock rather than reading as small icons; the
 * bar's own vertical padding was trimmed slightly (`py-2` -> `py-1.5`) to
 * absorb part of that growth, so the bar itself grows only by what the
 * bigger marks actually need, not by added dead space. The bell
 * (`NotificationBell` `variant="shell"`) sits at the bar's own physical
 * left, replacing its old spot in `Sidebar`'s top row -- same component,
 * same push-notification behavior, purely relocated. Home-dashboard-polish
 * pass: the center group's own gap was trimmed (`gap-5 sm:gap-8` ->
 * `gap-4 sm:gap-6`) -- the three elements read as loosely scattered rather
 * than one composed unit; no size/alignment/structure change, purely
 * tighter spacing between them.
 */
export function ShellUtilityBar({ initialClockTime, dateLabel, userId }: ShellUtilityBarProps) {
  return (
    <div className="hidden shrink-0 border-b border-border lg:block">
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center gap-4 px-10 py-1.5">
        {/* CSS Grid columns mirror under RTL exactly like a flex row does --
            the FIRST-defined column ends up on the PHYSICAL right, the LAST
            on the physical left. The bell is therefore the LAST grid child
            here (not the first), so it actually lands on the bar's physical
            left edge, matching the requested composition -- confirmed via a
            real rendered screenshot, not just this comment's own logic. */}
        <div aria-hidden="true" />

        <div className="flex items-center justify-center gap-4 sm:gap-6">
          <OrgLogoImage logo={ORG_LOGO_TAKSHAL} heightClassName="h-[90px]" />

          {/* Strong glass: a small, text-light widget floating in the shell's
              own empty top band, with the SATCOM canvas running right up
              behind it -- the clearest case in the app for the material at
              full strength. */}
          <div className="glass-strong flex flex-col items-center gap-1 rounded-xl bg-surface-1 px-5 py-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" aria-hidden="true" strokeWidth={1.75} />
              <LiveClock initialTime={initialClockTime} size="md" />
            </div>
            {dateLabel ? <span className="text-xs font-medium text-muted">{dateLabel}</span> : null}
          </div>

          <OrgLogoImage logo={ORG_LOGO_STRATEGIC_COMMUNICATION} heightClassName="h-[69px]" />
        </div>

        <div className="flex items-center justify-self-end">
          {/* `key={userId}` -- see `MobileIdentityBar`'s identical comment: forces a fresh instance (and `usePushSubscription`) on every account switch. */}
          <NotificationBell key={userId} variant="shell" userId={userId} />
        </div>
      </div>
    </div>
  );
}
