/**
 * Decorative SATCOM/space ambient layer for the Home dashboard -- a real
 * deep-space canvas (gradient wash + starfield + a glowing planet-horizon
 * arc), a technical grid, orbital/communication-path arcs, a modest
 * satellite dish silhouette, and several tiny satellites/glows. The
 * composition is deliberately DISTRIBUTED -- left/center/right and
 * upper/mid/lower all carry some of the visual weight -- rather than
 * built around one oversized focal object in a single corner. Every
 * individual motif (dish, each satellite, each glow) stays small; the
 * immersive feel comes from their number and spread across the full
 * dashboard height, not from any one element's size.
 *
 * Reads its colors entirely from the `--satcom-*` tokens in `globals.css`
 * (per-theme there: a full cinematic dark-space canvas in dark mode, a
 * much lighter/airier version of the same composition in light mode), so
 * it never needs its own light/dark branching.
 *
 * `aria-hidden`/`pointer-events-none` and absolutely positioned at `-z-10`
 * inside the caller's `relative isolate` wrapper -- strictly behind every
 * card/panel (which stay fully opaque), never inside one, and never
 * affects layout.
 */
export function SatcomBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* Base space canvas -- a real gradient wash (near-black through navy
          in dark mode, white through a hair of sky-blue in light mode)
          rather than a tint on the flat page background, fading back into
          the ordinary --background by the lower third so it blends with
          whatever content follows. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, var(--satcom-bg-from) 0%, var(--satcom-bg-via) 30%, var(--satcom-bg-via) 55%, var(--background) 92%)",
        }}
      />

      {/* Starfield -- a tiled scatter of tiny points spread evenly left to
          right and the full height, so no single quadrant reads busier
          than another. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(1px 1px at 6% 8%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 24% 20%, var(--satcom-star), transparent)",
            "radial-gradient(1.5px 1.5px at 46% 6%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 68% 24%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 88% 12%, var(--satcom-star), transparent)",
            "radial-gradient(1.5px 1.5px at 14% 34%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 58% 32%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 3% 44%, var(--satcom-star), transparent)",
            "radial-gradient(1.5px 1.5px at 36% 40%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 80% 38%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 95% 46%, var(--satcom-star), transparent)",
            "radial-gradient(1.5px 1.5px at 28% 50%, var(--satcom-star), transparent)",
          ].join(", "),
          backgroundSize: "1200px 620px",
          backgroundRepeat: "repeat",
        }}
      />

      {/* Planet-horizon glow -- a soft, WIDE radial dome (not tied to one
          side) plus one bold, gently blurred curved line spanning the
          full width, so the "horizon" moment reads across the whole page
          rather than as a corner accent. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(140% 55% at 50% -12%, var(--satcom-horizon-glow), transparent 62%)" }}
      />
      <svg className="absolute -top-24 inset-x-0 h-[420px] w-full" viewBox="0 0 1400 420" preserveAspectRatio="none" fill="none" aria-hidden="true">
        <path
          d="M-80 340 C 260 170, 1140 170, 1480 340"
          stroke="var(--satcom-horizon-glow)"
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ filter: "blur(2px)" }}
        />
      </svg>

      {/* Technical grid -- spans the full content height, gently softer
          toward the bottom but never gone, so the page reads as one
          continuous SATCOM canvas. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, var(--satcom-grid-line) 1px, transparent 1px), linear-gradient(to right, var(--satcom-grid-line) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "linear-gradient(to bottom, black 0%, black 20%, rgba(0,0,0,0.75) 50%, rgba(0,0,0,0.65) 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, black 20%, rgba(0,0,0,0.75) 50%, rgba(0,0,0,0.65) 100%)",
        }}
      />

      {/* Small ambient glows -- five modest halos spread across left,
          center and right, and across upper/mid/lower bands, instead of
          clustered around one object. None is tied exclusively to the
          dish anymore. */}
      <div className="absolute -top-8 end-[4%] h-24 w-24 rounded-full blur-2xl" style={{ background: "var(--satcom-glow-a)" }} />
      <div className="absolute top-14 start-[10%] h-24 w-24 rounded-full blur-2xl" style={{ background: "var(--satcom-glow-b)" }} />
      <div className="absolute top-[30%] start-[3%] h-20 w-20 rounded-full opacity-90 blur-2xl" style={{ background: "var(--satcom-glow-a)" }} />
      <div className="absolute top-[48%] end-[14%] h-24 w-24 rounded-full opacity-90 blur-2xl" style={{ background: "var(--satcom-glow-b)" }} />
      <div className="absolute top-[74%] left-1/2 h-24 w-24 -translate-x-1/2 rounded-full opacity-80 blur-2xl" style={{ background: "var(--satcom-glow-a)" }} />

      {/* Orbital/communication-path arcs -- span the full width at three
          different heights (upper, mid, lower) so the "communication
          path" motif reads across the whole page, not just the header. */}
      <svg className="absolute -top-10 start-1/2 h-[420px] w-[1200px] -translate-x-1/2" viewBox="0 0 1200 420" fill="none" aria-hidden="true">
        <ellipse cx="600" cy="460" rx="640" ry="390" stroke="var(--satcom-orbit-line)" strokeWidth="1.5" />
        <ellipse cx="600" cy="500" rx="790" ry="440" stroke="var(--satcom-orbit-line)" strokeWidth="1" strokeDasharray="1 11" />
      </svg>

      <svg className="absolute top-[30%] start-1/2 h-[320px] w-[1300px] -translate-x-1/2 opacity-85" viewBox="0 0 1300 320" fill="none" aria-hidden="true">
        <ellipse cx="650" cy="-30" rx="700" ry="320" stroke="var(--satcom-orbit-line)" strokeWidth="1" strokeDasharray="2 9" />
      </svg>

      <svg className="absolute top-[58%] start-1/2 h-[280px] w-[1300px] -translate-x-1/2 opacity-90" viewBox="0 0 1300 280" fill="none" aria-hidden="true">
        <ellipse cx="650" cy="-60" rx="720" ry="340" stroke="var(--satcom-orbit-line)" strokeWidth="1.25" />
      </svg>

      <svg className="absolute top-[82%] start-1/2 h-[240px] w-[1300px] -translate-x-1/2 opacity-70" viewBox="0 0 1300 240" fill="none" aria-hidden="true">
        <ellipse cx="650" cy="-90" rx="680" ry="300" stroke="var(--satcom-orbit-line)" strokeWidth="1" strokeDasharray="3 9" />
      </svg>

      {/* Satellite dish -- kept modest and secondary: elliptical rim (in
          perspective) + bowl curve + feed mast + support pole/tripod, one
          motif among several rather than a dominant hero object. */}
      <svg className="absolute -top-1 end-[2%] h-28 w-28 sm:h-36 sm:w-36" viewBox="0 0 200 200" fill="none" aria-hidden="true">
        <path d="M18 64 C18 106 56 136 100 136 C144 136 182 106 182 64 Z" fill="var(--satcom-dish)" stroke="none" />
        <g stroke="var(--satcom-orbit-line)" strokeWidth="2" strokeLinecap="round" fill="none">
          <ellipse cx="100" cy="64" rx="82" ry="17" />
          <path d="M18 64 C18 106 56 136 100 136 C144 136 182 106 182 64" />
          <path d="M50 74 L150 74" strokeWidth="1" opacity="0.55" />
          <line x1="100" y1="94" x2="100" y2="22" />
          <line x1="100" y1="136" x2="100" y2="182" />
          <line x1="100" y1="182" x2="68" y2="204" />
          <line x1="100" y1="182" x2="132" y2="204" />
        </g>
        <circle cx="100" cy="18" r="4.5" fill="var(--satcom-orbit-line)" />
      </svg>

      {/* Tiny satellites -- body + two solar-panel wings + a short antenna,
          placed in three different regions (upper-center, mid-start,
          lower-end) so satellite motifs also read as distributed rather
          than bundled next to the dish. The first is desktop/wide-screen
          only, where the gap beside the header reliably clears the header
          text (hidden below `lg`); the other two sit where nothing else
          occupies the space on every width. */}
      <svg className="absolute top-2 left-1/2 hidden h-8 w-14 -translate-x-1/2 lg:block" viewBox="0 0 100 60" fill="none" aria-hidden="true">
        <g stroke="var(--satcom-orbit-line)" strokeLinejoin="round">
          <rect x="40" y="20" width="20" height="16" rx="2" strokeWidth="2" />
          <rect x="8" y="24" width="26" height="8" strokeWidth="1.5" />
          <rect x="66" y="24" width="26" height="8" strokeWidth="1.5" />
          <line x1="50" y1="20" x2="50" y2="9" strokeWidth="1.5" strokeLinecap="round" />
        </g>
        <circle cx="50" cy="6" r="2.5" fill="var(--satcom-orbit-line)" />
      </svg>

      <svg className="absolute top-[32%] start-[6%] h-7 w-12 rotate-12 opacity-90" viewBox="0 0 100 60" fill="none" aria-hidden="true">
        <g stroke="var(--satcom-orbit-line)" strokeLinejoin="round">
          <rect x="40" y="20" width="20" height="16" rx="2" strokeWidth="2" />
          <rect x="8" y="24" width="26" height="8" strokeWidth="1.5" />
          <rect x="66" y="24" width="26" height="8" strokeWidth="1.5" />
          <line x1="50" y1="20" x2="50" y2="9" strokeWidth="1.5" strokeLinecap="round" />
        </g>
        <circle cx="50" cy="6" r="2.5" fill="var(--satcom-orbit-line)" />
      </svg>

      <svg className="absolute top-[68%] end-[8%] h-7 w-12 -rotate-6 opacity-80" viewBox="0 0 100 60" fill="none" aria-hidden="true">
        <g stroke="var(--satcom-orbit-line)" strokeLinejoin="round">
          <rect x="40" y="20" width="20" height="16" rx="2" strokeWidth="2" />
          <rect x="8" y="24" width="26" height="8" strokeWidth="1.5" />
          <rect x="66" y="24" width="26" height="8" strokeWidth="1.5" />
          <line x1="50" y1="20" x2="50" y2="9" strokeWidth="1.5" strokeLinecap="round" />
        </g>
        <circle cx="50" cy="6" r="2.5" fill="var(--satcom-orbit-line)" />
      </svg>
    </div>
  );
}
