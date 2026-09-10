import Image from "next/image";
import { Calendar, Moon, Sun, TreePalm, Users } from "lucide-react";
import { BRAND_SYMBOL } from "@/lib/config/brandAssets";

interface FloatingCardSpec {
  key: string;
  title: string;
  time: string;
  Icon: typeof Sun;
  dotClass: string;
  badgeClass: string;
  /** Absolute position, mobile-first with `sm`/`lg` steps -- a genuinely different arrangement per breakpoint, not a uniform scale-down. */
  positionClassName: string;
}

/**
 * Purely decorative illustration of the product's core vocabulary (shift/
 * duty/day-off cards around a clock) -- never real schedule data, same
 * spirit as the timeline it replaces. Colors/times are illustrative only.
 * Desktop (`lg`+) only -- see `FloatingCard`'s `hidden lg:flex`: on mobile
 * these crowded the small ring and sat too close to the centered logo, so
 * mobile shows just the ring/ticks/logo/sweep hand with no cards at all.
 */
const FLOATING_CARDS: FloatingCardSpec[] = [
  {
    key: "evening",
    title: "משמרת ערב",
    time: "17:00 - 23:00",
    Icon: Calendar,
    dotClass: "bg-[#d98a9c]",
    badgeClass: "bg-[#4a2530]",
    positionClassName: "top-[-8%] left-[-2%] sm:top-[-2%] sm:left-[4%] lg:top-[6%] lg:left-[30%]",
  },
  {
    key: "morning",
    title: "משמרת בוקר",
    time: "07:00 - 15:00",
    Icon: Sun,
    dotClass: "bg-[#6fc3f7]",
    badgeClass: "bg-[#1f4f6e]",
    positionClassName: "top-[20%] right-[-6%] sm:top-[2%] sm:right-[0%] lg:top-[16%] lg:left-[0%] lg:right-auto",
  },
  {
    key: "off",
    title: "חופש",
    time: "יום חמישי",
    Icon: TreePalm,
    dotClass: "bg-[#57cc8a]",
    badgeClass: "bg-[#1e4430]",
    positionClassName: "top-[46%] left-[-4%] sm:left-[-6%] lg:top-[50%] lg:left-[-6%]",
  },
  {
    key: "duty",
    title: "תורנות",
    time: "08:00 - 12:00",
    Icon: Users,
    dotClass: "bg-[#f0a35f]",
    badgeClass: "bg-[#5a3a1e]",
    positionClassName: "top-[62%] right-[-4%] sm:right-[-6%] lg:top-[70%] lg:right-[-4%] lg:left-auto",
  },
  {
    key: "night",
    title: "משמרת לילה",
    time: "23:00 - 07:00",
    Icon: Moon,
    dotClass: "bg-[#7fb0c2]",
    badgeClass: "bg-[#1f3540]",
    positionClassName: "top-[96%] left-[16%] sm:top-[92%] sm:left-[18%] lg:top-[82%] lg:left-[28%]",
  },
];

function FloatingCard({ card }: { card: FloatingCardSpec }) {
  const { Icon } = card;
  return (
    <div
      className={`absolute hidden lg:flex w-max max-w-[7rem] items-center gap-1.5 rounded-2xl bg-[#141a22]/90 px-2 py-1.5 shadow-[0_16px_32px_-14px_rgba(0,0,0,0.6)] ring-1 ring-white/10 backdrop-blur-sm sm:max-w-[9.5rem] sm:gap-2 sm:px-2.5 sm:py-2 lg:max-w-[10rem] lg:gap-2 lg:px-3 lg:py-2 xl:max-w-[13rem] xl:gap-3 xl:rounded-3xl xl:px-4 xl:py-3 ${card.positionClassName}`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl sm:h-8 sm:w-8 lg:h-9 lg:w-9 xl:h-11 xl:w-11 xl:rounded-2xl ${card.badgeClass}`}
      >
        <Icon className="h-3.5 w-3.5 text-white sm:h-4 sm:w-4 xl:h-5 xl:w-5" aria-hidden="true" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 xl:gap-2">
          <span className="whitespace-nowrap text-[11px] font-semibold text-white sm:text-xs lg:text-sm xl:text-base">
            {card.title}
          </span>
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full xl:h-2 xl:w-2 ${card.dotClass}`} />
        </span>
        <span dir="ltr" className="block whitespace-nowrap text-[10px] text-white/50 sm:text-[11px] xl:text-sm">
          {card.time}
        </span>
      </span>
    </div>
  );
}

/** A ring of evenly-spaced tick marks (like a clock face), purely decorative -- computed once at module scope, never re-derived per render. */
const TICK_COUNT = 48;
const TICKS = Array.from({ length: TICK_COUNT }, (_, index) => {
  const angle = (index / TICK_COUNT) * 2 * Math.PI;
  const isMajor = index % 6 === 0;
  const outerRadius = 96;
  const innerRadius = isMajor ? 88 : 91.5;
  return {
    key: index,
    x1: 100 + outerRadius * Math.sin(angle),
    y1: 100 - outerRadius * Math.cos(angle),
    x2: 100 + innerRadius * Math.sin(angle),
    y2: 100 - innerRadius * Math.cos(angle),
    opacity: isMajor ? 0.28 : 0.12,
  };
});

/**
 * The login clock's decorative rotating sweep hand -- radar/sweep-style,
 * spinning forever via the `animate-login-clock-sweep` CSS keyframe (see
 * globals.css, which also disables it under `prefers-reduced-motion`).
 * Deliberately NOT a real clock hand: no relation to the actual time, a
 * shift, a duty, or any schedule data -- purely decorative motion, same
 * spirit as `TICKS`/`FLOATING_CARDS` above. Geometry (a thin bright edge
 * plus a soft fading trail wedge, both reaching almost to the tick ring)
 * is computed once at module scope, same convention as `TICKS`.
 */
const SWEEP_HAND_RADIUS = 92;
const SWEEP_HAND_TRAIL_DEGREES = 20;
function sweepHandPoint(angleDegrees: number) {
  const angle = (angleDegrees * Math.PI) / 180;
  return { x: 100 + SWEEP_HAND_RADIUS * Math.sin(angle), y: 100 - SWEEP_HAND_RADIUS * Math.cos(angle) };
}
const SWEEP_HAND_LEAD = sweepHandPoint(0);
const SWEEP_HAND_TRAIL = sweepHandPoint(-SWEEP_HAND_TRAIL_DEGREES);
const SWEEP_HAND_TRAIL_PATH = `M 100 100 L ${SWEEP_HAND_TRAIL.x} ${SWEEP_HAND_TRAIL.y} A ${SWEEP_HAND_RADIUS} ${SWEEP_HAND_RADIUS} 0 0 1 ${SWEEP_HAND_LEAD.x} ${SWEEP_HAND_LEAD.y} Z`;

/**
 * The login hero's decorative clock/schedule composition -- the SAME
 * tick-marked ring, glowing brand mark, and rotating sweep hand at every
 * viewport size (mobile used to swap this ring graphic out for a plain
 * centered digital readout; now mobile gets the identical clock face
 * desktop has, just at a smaller `clamp()` size via the wrapper below --
 * see `LoginHero`, which now renders the digital readout as its own
 * mobile-only block underneath this ring instead of inside it). Shift/
 * duty/day-off cards still float around its circumference on desktop
 * (`lg`+) exactly as before, but are hidden entirely below `lg` -- see
 * `FLOATING_CARDS`'s docstring -- so mobile shows only the ring/ticks/
 * logo/sweep hand. Entirely `aria-hidden` except where noted --
 * illustrative only, never real schedule data.
 */
export function LoginScheduleRing() {
  return (
    <div className="relative mx-auto w-[clamp(10.5rem,50vw,14rem)] sm:w-[clamp(19rem,88vw,26rem)] lg:mx-0 lg:w-[clamp(24rem,32vw,30rem)] xl:w-[clamp(30rem,42vw,42rem)]">
      <div className="relative aspect-square w-full">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 rounded-full opacity-70 blur-2xl"
          style={{ background: "radial-gradient(closest-side, rgba(120,169,204,0.18), transparent 72%)" }}
        />

        <svg viewBox="0 0 200 200" aria-hidden="true" className="absolute inset-0 h-full w-full">
          <circle cx="100" cy="100" r="96" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
          {TICKS.map((tick) => (
            <line
              key={tick.key}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              stroke="white"
              strokeOpacity={tick.opacity}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          ))}
          <defs>
            <linearGradient
              id="loginClockSweepTrail"
              gradientUnits="userSpaceOnUse"
              x1={SWEEP_HAND_TRAIL.x}
              y1={SWEEP_HAND_TRAIL.y}
              x2={SWEEP_HAND_LEAD.x}
              y2={SWEEP_HAND_LEAD.y}
            >
              <stop offset="0%" stopColor="#8ab4d6" stopOpacity="0" />
              <stop offset="100%" stopColor="#8ab4d6" stopOpacity="0.32" />
            </linearGradient>
            <linearGradient id="loginClockSweepHand" gradientUnits="userSpaceOnUse" x1="100" y1="100" x2={SWEEP_HAND_LEAD.x} y2={SWEEP_HAND_LEAD.y}>
              <stop offset="0%" stopColor="#bcd7ec" stopOpacity="0" />
              <stop offset="100%" stopColor="#bcd7ec" stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <g style={{ transformOrigin: "100px 100px" }} className="animate-login-clock-sweep">
            <path d={SWEEP_HAND_TRAIL_PATH} fill="url(#loginClockSweepTrail)" />
            <line
              x1="100"
              y1="100"
              x2={SWEEP_HAND_LEAD.x}
              y2={SWEEP_HAND_LEAD.y}
              stroke="url(#loginClockSweepHand)"
              strokeWidth="1.25"
              strokeLinecap="round"
            />
          </g>
        </svg>

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative flex h-[38%] w-[38%] items-center justify-center">
            <div
              aria-hidden="true"
              className="absolute inset-0 rounded-full opacity-60 blur-xl"
              style={{ background: "radial-gradient(closest-side, rgba(120,169,204,0.3), transparent 75%)" }}
            />
            <Image
              src={BRAND_SYMBOL.src}
              alt=""
              aria-hidden="true"
              width={BRAND_SYMBOL.width}
              height={BRAND_SYMBOL.height}
              className="relative h-full w-full rounded-full drop-shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
            />
          </div>
        </div>

        {FLOATING_CARDS.map((card) => (
          <FloatingCard key={card.key} card={card} />
        ))}
      </div>
    </div>
  );
}
