/**
 * Decorative SATCOM/space ambient layer for the Home dashboard -- a real
 * deep-space canvas (gradient wash + starfield + a glowing planet-horizon
 * arc), a technical grid, orbital/communication-path arcs, a large
 * satellite dish silhouette, and a couple of tiny satellites. Built to
 * read as one immersive environment spanning the FULL dashboard height,
 * not a small top-only effect -- strongest near the greeting header
 * (where the horizon glow sits) and still clearly present, not just a
 * residual tint, through the lower sections.
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

      {/* Starfield -- a tiled scatter of tiny points, present the full
          height (this is deep space, not a header-only effect). Reads as
          near-nothing in light mode (a very low star token) and as a real
          night sky in dark mode. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(1px 1px at 8% 6%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 32% 14%, var(--satcom-star), transparent)",
            "radial-gradient(1.5px 1.5px at 55% 4%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 78% 18%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 95% 8%, var(--satcom-star), transparent)",
            "radial-gradient(1.5px 1.5px at 18% 26%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 63% 24%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 4% 38%, var(--satcom-star), transparent)",
            "radial-gradient(1.5px 1.5px at 41% 33%, var(--satcom-star), transparent)",
            "radial-gradient(1px 1px at 87% 31%, var(--satcom-star), transparent)",
          ].join(", "),
          backgroundSize: "1200px 620px",
          backgroundRepeat: "repeat",
        }}
      />

      {/* Planet-horizon glow -- a soft radial dome centered above the
          canvas, concentrating light near the top (like a limb of
          atmosphere) and fading by mid-page, plus one bold, gently
          blurred curved line to read unmistakably as a horizon. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(120% 55% at 50% -12%, var(--satcom-horizon-glow), transparent 62%)" }}
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

      {/* Small, tight glow halos -- tied to the dish/satellites below. */}
      <div
        className="absolute -top-10 end-[2%] h-52 w-52 rounded-full blur-2xl"
        style={{ background: "var(--satcom-glow-a)" }}
      />
      <div
        className="absolute top-12 start-[10%] h-28 w-28 rounded-full blur-2xl"
        style={{ background: "var(--satcom-glow-b)" }}
      />
      <div
        className="absolute top-[50%] end-[10%] h-32 w-32 rounded-full opacity-90 blur-2xl"
        style={{ background: "var(--satcom-glow-a)" }}
      />

      {/* Orbital/communication-path arcs -- a denser upper cluster plus a
          couple further down, so the environment feels populated rather
          than a single top ornament. */}
      <svg
        className="absolute -top-10 start-1/2 h-[420px] w-[1200px] -translate-x-1/2"
        viewBox="0 0 1200 420"
        fill="none"
        aria-hidden="true"
      >
        <ellipse cx="600" cy="460" rx="640" ry="390" stroke="var(--satcom-orbit-line)" strokeWidth="1.5" />
        <ellipse
          cx="600"
          cy="500"
          rx="790"
          ry="440"
          stroke="var(--satcom-orbit-line)"
          strokeWidth="1"
          strokeDasharray="1 11"
        />
        <ellipse
          cx="600"
          cy="440"
          rx="500"
          ry="330"
          stroke="var(--satcom-orbit-line)"
          strokeWidth="1"
          strokeDasharray="4 8"
          opacity="0.8"
        />
      </svg>

      <svg
        className="absolute top-[36%] start-1/2 h-[320px] w-[1300px] -translate-x-1/2 opacity-85"
        viewBox="0 0 1300 320"
        fill="none"
        aria-hidden="true"
      >
        <ellipse cx="650" cy="-30" rx="700" ry="320" stroke="var(--satcom-orbit-line)" strokeWidth="1" strokeDasharray="2 9" />
      </svg>

      <svg
        className="absolute top-[62%] start-1/2 h-[280px] w-[1300px] -translate-x-1/2 opacity-90"
        viewBox="0 0 1300 280"
        fill="none"
        aria-hidden="true"
      >
        <ellipse cx="650" cy="-60" rx="720" ry="340" stroke="var(--satcom-orbit-line)" strokeWidth="1.25" />
      </svg>

      {/* Satellite dish -- large elliptical rim (in perspective) + bowl
          curve + cross-brace mesh + feed mast + support pole/tripod, a
          real reflector silhouette rather than a filled shape. */}
      <svg className="absolute -top-4 end-[0%] h-60 w-60 sm:h-72 sm:w-72" viewBox="0 0 200 200" fill="none" aria-hidden="true">
        <path d="M18 64 C18 106 56 136 100 136 C144 136 182 106 182 64 Z" fill="var(--satcom-dish)" stroke="none" />
        <g stroke="var(--satcom-orbit-line)" strokeWidth="2" strokeLinecap="round" fill="none">
          <ellipse cx="100" cy="64" rx="82" ry="17" />
          <path d="M18 64 C18 106 56 136 100 136 C144 136 182 106 182 64" />
          <path d="M44 70 L156 70" strokeWidth="1" opacity="0.6" />
          <path d="M62 90 C 80 98, 120 98, 138 90" strokeWidth="1" opacity="0.6" />
          <line x1="100" y1="94" x2="100" y2="22" />
          <line x1="100" y1="136" x2="100" y2="182" />
          <line x1="100" y1="182" x2="68" y2="204" />
          <line x1="100" y1="182" x2="132" y2="204" />
        </g>
        <circle cx="100" cy="18" r="4.5" fill="var(--satcom-orbit-line)" />
      </svg>

      {/* Tiny satellites -- body + two solar-panel wings + a short antenna.
          The first sits in the open gap beside the header (desktop/wide
          screens only, where that gap reliably clears the header text --
          hidden below `lg`); the second floats lower, near the mid-page
          arcs, on every width since nothing else occupies that space. */}
      <svg
        className="absolute top-2 left-1/2 hidden h-8 w-14 -translate-x-1/2 lg:block"
        viewBox="0 0 100 60"
        fill="none"
        aria-hidden="true"
      >
        <g stroke="var(--satcom-orbit-line)" strokeLinejoin="round">
          <rect x="40" y="20" width="20" height="16" rx="2" strokeWidth="2" />
          <rect x="8" y="24" width="26" height="8" strokeWidth="1.5" />
          <rect x="66" y="24" width="26" height="8" strokeWidth="1.5" />
          <line x1="50" y1="20" x2="50" y2="9" strokeWidth="1.5" strokeLinecap="round" />
        </g>
        <circle cx="50" cy="6" r="2.5" fill="var(--satcom-orbit-line)" />
      </svg>

      <svg
        className="absolute top-[38%] end-[6%] h-7 w-12 -rotate-12 opacity-90"
        viewBox="0 0 100 60"
        fill="none"
        aria-hidden="true"
      >
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
