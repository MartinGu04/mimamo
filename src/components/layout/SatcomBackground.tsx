import type { SatcomVariant } from "./satcom-variants";

/**
 * The app's SATCOM canvas -- a page-level visual layer, never page content.
 *
 * MOUNTING: this belongs to `AppShell`'s main column (see `PageBackdrop`),
 * NOT to any component rendered inside `main`. Mounted deeper it would be
 * boxed in twice over: `main`'s inner `mx-auto max-w-[1440px]` wrapper caps
 * its width, and the page's own content box caps its height at whatever the
 * sections happen to occupy -- leaving the shell's padding, the gaps between
 * sections and all trailing space outside the canvas. As a child of the main
 * column instead, `inset-0` resolves against a box that is exactly the full
 * main-content area (the sidebar is a sibling, so it stays untouched) and
 * that grows with the document, so the canvas covers the complete scrollable
 * page height without reserving a single pixel of layout space of its own.
 *
 * STACKING: `-z-10` resolves against the stacking context `AppShell`'s root
 * isolates, so this paints above that root's `bg-background` and below every
 * piece of UI. The main column is deliberately only `relative` (never
 * `isolate`) so that overlays inside `main` keep out-stacking the fixed
 * `BottomNav` exactly as they did before.
 *
 * COMPOSITION: one shared vocabulary -- wash, starfield, technical grid,
 * orbital/communication arcs, ambient glows, dish and satellite motifs --
 * arranged differently and at different strengths per `variant`, so every
 * page reads as the same design system without any two looking copy-pasted.
 * Within a page the weight is spread across left/center/right and
 * upper/middle/lower rather than massed into one focal object. Decorative
 * placement uses PHYSICAL sides (left/right, not start/end): it is a
 * picture, not text that should flip with direction.
 *
 * MOTION: ambient micro-motion only -- a starfield drift measured in minutes,
 * slow glow breathing, and light tracing along two comm paths. Everything
 * animates `transform`/`opacity` (plus one `stroke-dashoffset`) and is
 * disabled under `prefers-reduced-motion` via `globals.css`.
 *
 * Colors come entirely from the `--satcom-*` tokens in `globals.css`
 * (cinematic deep space in dark mode, the same composition translated to
 * white/pale-blue in light mode), so there is no light/dark branching here.
 */
interface SatcomBackgroundProps {
  variant: SatcomVariant;
}

interface ArcSpec {
  /** Vertical anchor + height, as Tailwind classes. */
  position: string;
  cy: number;
  ry: number;
  dash?: string;
  opacity: string;
  /** Animates a light along the path -- at most two per page. */
  traced?: boolean;
}

interface SpotSpec {
  position: string;
  token: string;
  /** Staggers the breathing so the glows never pulse in unison. */
  motion: string;
}

interface SatelliteSpec {
  position: string;
  /** Desktop-only where the gap it sits in does not exist on narrow widths. */
  desktopOnly?: boolean;
}

interface Composition {
  /** Overall strength -- dense pages get a quieter canvas. */
  rootClass: string;
  /** The planet limb: the loudest motif, reserved for open pages. */
  showEarthLimb: boolean;
  /** Primary/secondary atmospheric lighting, as CSS gradients. */
  lighting: readonly string[];
  starClass: string;
  gridFloor: string;
  dish: string | null;
  arcs: readonly ArcSpec[];
  spots: readonly SpotSpec[];
  satellites: readonly SatelliteSpec[];
}

const COMPOSITIONS: Readonly<Record<SatcomVariant, Composition>> = {
  // Open pages: the full environment -- planet limb upper right, ground
  // station lower left of it, traffic across the whole height.
  rich: {
    rootClass: "",
    showEarthLimb: true,
    lighting: [
      "radial-gradient(70% 34% at 86% -6%, var(--satcom-horizon-glow), transparent 64%)",
      "radial-gradient(52% 30% at 8% 74%, var(--satcom-glow-b), transparent 68%)",
    ],
    starClass: "",
    gridFloor: "rgba(0,0,0,0.6)",
    dish: "top-6 left-[1%] h-40 w-40 sm:h-48 sm:w-48",
    arcs: [
      { position: "-top-16 h-[380px]", cy: -120, ry: 300, opacity: "opacity-100", traced: true },
      { position: "top-[22%] h-[300px]", cy: -60, ry: 260, dash: "2 9", opacity: "opacity-85" },
      { position: "top-[44%] h-[300px]", cy: -70, ry: 270, opacity: "opacity-80", traced: true },
      { position: "top-[66%] h-[280px]", cy: -80, ry: 260, dash: "3 10", opacity: "opacity-75" },
      { position: "top-[86%] h-[260px]", cy: -90, ry: 250, opacity: "opacity-65" },
    ],
    spots: [
      { position: "top-4 left-[2%] h-32 w-32", token: "var(--satcom-glow-a)", motion: "animate-satcom-breathe" },
      { position: "top-[18%] left-[38%] h-24 w-24 opacity-80", token: "var(--satcom-glow-b)", motion: "animate-satcom-breathe-slow" },
      { position: "top-[34%] left-[6%] h-28 w-28 opacity-90", token: "var(--satcom-glow-b)", motion: "animate-satcom-breathe-slow" },
      { position: "top-[46%] right-[5%] h-32 w-32 opacity-90", token: "var(--satcom-glow-a)", motion: "animate-satcom-breathe" },
      { position: "top-[68%] left-[44%] h-32 w-32 opacity-80", token: "var(--satcom-glow-a)", motion: "animate-satcom-breathe-slow" },
      { position: "top-[88%] right-[22%] h-28 w-28 opacity-70", token: "var(--satcom-glow-b)", motion: "animate-satcom-breathe" },
    ],
    satellites: [
      { position: "top-[132px] left-[45%] h-8 w-14", desktopOnly: true },
      { position: "top-[40%] right-[14%] h-7 w-12 rotate-6 opacity-90" },
      { position: "top-[78%] left-[20%] h-6 w-11 -rotate-6 opacity-75" },
    ],
  },
  // Ordinary content pages: same vocabulary, mirrored and thinned out. No
  // planet; the dish sits low like a distant ground station instead of
  // heading the page, so this never reads as the Home composition again.
  standard: {
    rootClass: "opacity-80",
    showEarthLimb: false,
    lighting: [
      "radial-gradient(64% 30% at 14% -8%, var(--satcom-horizon-glow), transparent 66%)",
      "radial-gradient(48% 26% at 88% 66%, var(--satcom-glow-b), transparent 70%)",
    ],
    starClass: "opacity-75",
    gridFloor: "rgba(0,0,0,0.5)",
    dish: "bottom-[8%] left-[3%] h-24 w-24 sm:h-28 sm:w-28",
    arcs: [
      { position: "-top-24 h-[340px]", cy: -130, ry: 290, dash: "2 9", opacity: "opacity-90", traced: true },
      { position: "top-[38%] h-[300px]", cy: -70, ry: 270, opacity: "opacity-70" },
      { position: "top-[74%] h-[260px]", cy: -90, ry: 250, dash: "3 10", opacity: "opacity-60" },
    ],
    spots: [
      { position: "top-[6%] right-[8%] h-28 w-28 opacity-90", token: "var(--satcom-glow-a)", motion: "animate-satcom-breathe" },
      { position: "top-[30%] left-[10%] h-24 w-24 opacity-80", token: "var(--satcom-glow-b)", motion: "animate-satcom-breathe-slow" },
      { position: "top-[58%] right-[16%] h-28 w-28 opacity-75", token: "var(--satcom-glow-a)", motion: "animate-satcom-breathe-slow" },
      { position: "top-[84%] left-[34%] h-24 w-24 opacity-65", token: "var(--satcom-glow-b)", motion: "animate-satcom-breathe" },
    ],
    satellites: [
      { position: "top-[26%] right-[26%] h-7 w-12 -rotate-6 opacity-80" },
      { position: "top-[70%] left-[12%] h-6 w-11 rotate-6 opacity-70" },
    ],
  },
  // Dense data surfaces: atmosphere only. Enough to keep the identity,
  // little enough that a month grid or a fairness table stays the subject.
  calm: {
    rootClass: "opacity-60",
    showEarthLimb: false,
    lighting: ["radial-gradient(80% 28% at 50% -10%, var(--satcom-horizon-glow), transparent 68%)"],
    starClass: "opacity-50",
    gridFloor: "rgba(0,0,0,0.45)",
    dish: null,
    arcs: [
      { position: "-top-28 h-[320px]", cy: -140, ry: 290, dash: "2 10", opacity: "opacity-70", traced: true },
      { position: "top-[62%] h-[280px]", cy: -90, ry: 260, opacity: "opacity-55" },
    ],
    spots: [
      { position: "top-[8%] left-[6%] h-24 w-24 opacity-75", token: "var(--satcom-glow-a)", motion: "animate-satcom-breathe-slow" },
      { position: "top-[48%] right-[8%] h-24 w-24 opacity-60", token: "var(--satcom-glow-b)", motion: "animate-satcom-breathe" },
      { position: "top-[86%] left-[40%] h-20 w-20 opacity-55", token: "var(--satcom-glow-a)", motion: "animate-satcom-breathe-slow" },
    ],
    satellites: [{ position: "top-[34%] right-[10%] h-6 w-11 rotate-6 opacity-65" }],
  },
};

const STAR_FIELD = [
  "radial-gradient(1px 1px at 5% 7%, var(--satcom-star), transparent)",
  "radial-gradient(1px 1px at 23% 18%, var(--satcom-star), transparent)",
  "radial-gradient(1.5px 1.5px at 44% 5%, var(--satcom-star), transparent)",
  "radial-gradient(1px 1px at 61% 22%, var(--satcom-star), transparent)",
  "radial-gradient(1px 1px at 84% 11%, var(--satcom-star), transparent)",
  "radial-gradient(1.5px 1.5px at 13% 33%, var(--satcom-star), transparent)",
  "radial-gradient(1px 1px at 37% 41%, var(--satcom-star), transparent)",
  "radial-gradient(1px 1px at 72% 36%, var(--satcom-star), transparent)",
  "radial-gradient(1.5px 1.5px at 94% 44%, var(--satcom-star), transparent)",
  "radial-gradient(1px 1px at 8% 57%, var(--satcom-star), transparent)",
  "radial-gradient(1px 1px at 29% 68%, var(--satcom-star), transparent)",
  "radial-gradient(1.5px 1.5px at 53% 61%, var(--satcom-star), transparent)",
  "radial-gradient(1px 1px at 79% 72%, var(--satcom-star), transparent)",
  "radial-gradient(1px 1px at 17% 88%, var(--satcom-star), transparent)",
  "radial-gradient(1.5px 1.5px at 66% 93%, var(--satcom-star), transparent)",
  "radial-gradient(1px 1px at 91% 84%, var(--satcom-star), transparent)",
].join(", ");

/** The brighter, sparser stars that carry the twinkle. */
const STAR_FIELD_BRIGHT = [
  "radial-gradient(1.5px 1.5px at 31% 12%, var(--satcom-star), transparent)",
  "radial-gradient(1.5px 1.5px at 69% 48%, var(--satcom-star), transparent)",
  "radial-gradient(1.5px 1.5px at 12% 76%, var(--satcom-star), transparent)",
  "radial-gradient(1.5px 1.5px at 88% 28%, var(--satcom-star), transparent)",
].join(", ");

/**
 * A parabolic reflector rather than a dish-shaped blob: elliptical rim with
 * a soft structural glow, panel seams and ribs hinting at the mesh, a
 * three-strut feed assembly converging on a feed horn at the focus, and a
 * slim elbow onto an azimuth housing and pedestal. Deliberately thin, uneven
 * linework -- heavier on the rim and bowl, hairline on the seams -- so it
 * reads as engineering rather than clip art at low opacity.
 */
function SatcomDish({ className }: { className: string }) {
  return (
    <svg className={`absolute ${className}`} viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <path d="M26 72 C26 102 60 124 100 124 C140 124 174 102 174 72 Z" fill="var(--satcom-dish)" stroke="none" />

      {/* Structural rim glow, under the linework. */}
      <ellipse
        cx="100"
        cy="72"
        rx="74"
        ry="20"
        fill="none"
        stroke="var(--satcom-horizon-glow)"
        strokeWidth="3"
        style={{ filter: "blur(3px)" }}
      />

      <g stroke="var(--satcom-orbit-line)" fill="none" strokeLinecap="round">
        {/* Reflector: rim + bowl. */}
        <ellipse cx="100" cy="72" rx="74" ry="20" strokeWidth="1.6" />
        <path d="M26 72 C26 102 60 124 100 124 C140 124 174 102 174 72" strokeWidth="1.4" />

        {/* Panel seams and ribs -- mesh hints, hairline. */}
        <path d="M44 76 C44 95 68 109 100 109 C132 109 156 95 156 76" strokeWidth="0.75" opacity="0.45" />
        <path d="M64 79 C64 90 80 98 100 98 C120 98 136 90 136 79" strokeWidth="0.75" opacity="0.35" />
        <path d="M100 124 L38 76" strokeWidth="0.7" opacity="0.3" />
        <path d="M100 124 L100 92" strokeWidth="0.7" opacity="0.3" />
        <path d="M100 124 L162 76" strokeWidth="0.7" opacity="0.3" />

        {/* Feed assembly: three struts converging on the focus. */}
        <path d="M38 70 L100 38" strokeWidth="1" opacity="0.8" />
        <path d="M162 70 L100 38" strokeWidth="1" opacity="0.8" />
        <path d="M100 110 L100 44" strokeWidth="1" opacity="0.65" />

        {/* Elbow onto the azimuth housing and pedestal. */}
        <path d="M100 124 L100 144" strokeWidth="1.3" />
        <rect x="87" y="144" width="26" height="15" rx="4.5" strokeWidth="1.2" />
        <path d="M100 159 L100 180" strokeWidth="1.3" />
        <ellipse cx="100" cy="183" rx="21" ry="4.5" strokeWidth="1.1" opacity="0.75" />
      </g>

      {/* Feed horn at the focus. */}
      <rect x="94" y="30" width="12" height="15" rx="4" fill="var(--satcom-dish)" stroke="var(--satcom-orbit-line)" strokeWidth="1.1" />
      <circle cx="100" cy="26" r="2.6" fill="var(--satcom-orbit-line)" />

      {/* Signal waves off the feed -- two very faint, very slow pings. */}
      {/* `transformBox` is set explicitly so the scale pivots on the feed horn
          in viewBox coordinates rather than the element's own bounding box. */}
      <g stroke="var(--satcom-horizon-glow)" fill="none" strokeWidth="1.2" strokeLinecap="round">
        <path
          className="animate-satcom-ping"
          style={{ transformBox: "view-box", transformOrigin: "100px 30px" }}
          d="M78 24 A 26 26 0 0 1 122 24"
        />
        <path
          className="animate-satcom-ping-late"
          style={{ transformBox: "view-box", transformOrigin: "100px 30px" }}
          d="M78 24 A 26 26 0 0 1 122 24"
        />
      </g>
    </svg>
  );
}

function SatcomSatellite({ className }: { className: string }) {
  return (
    <svg className={`absolute ${className}`} viewBox="0 0 100 60" fill="none" aria-hidden="true">
      <g stroke="var(--satcom-orbit-line)" strokeLinejoin="round" fill="none">
        <rect x="40" y="20" width="20" height="16" rx="3" strokeWidth="1.8" />
        <rect x="8" y="24" width="26" height="8" rx="1.5" strokeWidth="1.3" />
        <rect x="66" y="24" width="26" height="8" rx="1.5" strokeWidth="1.3" />
        <path d="M34 28 L40 28" strokeWidth="1.1" opacity="0.7" />
        <path d="M60 28 L66 28" strokeWidth="1.1" opacity="0.7" />
        <path d="M50 20 L50 9" strokeWidth="1.3" strokeLinecap="round" />
      </g>
      <circle cx="50" cy="6" r="2.4" fill="var(--satcom-orbit-line)" />
    </svg>
  );
}

export function SatcomBackground({ variant }: SatcomBackgroundProps) {
  const composition = COMPOSITIONS[variant];

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${composition.rootClass}`}
    >
      {/* Base wash: space at the top settling back into the ordinary page
          background further down, so the lower page blends seamlessly. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, var(--satcom-bg-from) 0%, var(--satcom-bg-via) 22%, var(--satcom-bg-via) 44%, var(--background) 76%)",
        }}
      />

      {/* Atmospheric lighting -- lit from more than one place, and from
          different places per variant. */}
      {composition.lighting.map((gradient) => (
        <div key={gradient} className="absolute inset-0" style={{ background: gradient }} />
      ))}

      {/* Starfield. Oversized and inset past the edges so the drift never
          exposes a seam, and split into a dim bed plus a few brighter stars
          that carry the twinkle. */}
      <div className={`absolute -inset-[6%] ${composition.starClass}`}>
        <div
          className="animate-satcom-drift absolute inset-0"
          style={{ backgroundImage: STAR_FIELD, backgroundSize: "900px 760px", backgroundRepeat: "repeat" }}
        />
        <div
          className="animate-satcom-twinkle absolute inset-0"
          style={{ backgroundImage: STAR_FIELD_BRIGHT, backgroundSize: "1100px 820px", backgroundRepeat: "repeat" }}
        />
      </div>

      {/* Earth limb: a faint body plus a soft-glowing edge. */}
      {composition.showEarthLimb ? (
        <svg className="absolute -top-8 right-0 h-[620px] w-[1080px]" viewBox="0 0 1080 620" fill="none" aria-hidden="true">
          <circle cx="880" cy="760" r="660" fill="var(--satcom-earth-fill)" />
          <circle
            cx="880"
            cy="760"
            r="660"
            fill="none"
            stroke="var(--satcom-horizon-glow)"
            strokeWidth="2.5"
            style={{ filter: "blur(2.5px)" }}
          />
        </svg>
      ) : null}

      {/* Technical grid: the full page height, easing off lower down but
          never disappearing. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, var(--satcom-grid-line) 1px, transparent 1px), linear-gradient(to right, var(--satcom-grid-line) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: `linear-gradient(to bottom, black 0%, black 24%, rgba(0,0,0,0.78) 55%, ${composition.gridFloor} 100%)`,
          WebkitMaskImage: `linear-gradient(to bottom, black 0%, black 24%, rgba(0,0,0,0.78) 55%, ${composition.gridFloor} 100%)`,
        }}
      />

      {/* Communication/orbital paths: full-width sweeps at several heights,
          two of them carrying a slow travelling light. */}
      {composition.arcs.map((arc) => (
        <svg
          key={arc.position}
          className={`absolute ${arc.position} left-1/2 w-[150%] -translate-x-1/2 ${arc.opacity}`}
          viewBox="0 0 1200 300"
          preserveAspectRatio="none"
          fill="none"
          aria-hidden="true"
        >
          <ellipse
            cx="600"
            cy={arc.cy}
            rx="640"
            ry={arc.ry}
            stroke="var(--satcom-orbit-line)"
            strokeWidth="1.25"
            strokeDasharray={arc.dash}
            vectorEffect="non-scaling-stroke"
          />
          {arc.traced ? (
            <ellipse
              className="animate-satcom-trace"
              cx="600"
              cy={arc.cy}
              rx="640"
              ry={arc.ry}
              stroke="var(--satcom-horizon-glow)"
              strokeWidth="1.5"
              strokeDasharray="80 2950"
            />
          ) : null}
        </svg>
      ))}

      {/* Ambient glows, seeded across every region and breathing out of sync. */}
      {composition.spots.map((spot) => (
        <div
          key={spot.position}
          className={`absolute rounded-full blur-2xl ${spot.position} ${spot.motion}`}
          style={{ background: spot.token }}
        />
      ))}

      {composition.dish ? <SatcomDish className={composition.dish} /> : null}

      {composition.satellites.map((satellite) => (
        <SatcomSatellite
          key={satellite.position}
          className={`${satellite.position}${satellite.desktopOnly ? " hidden lg:block" : ""}`}
        />
      ))}
    </div>
  );
}
