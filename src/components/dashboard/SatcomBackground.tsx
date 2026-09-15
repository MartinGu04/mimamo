/**
 * Purely decorative SATCOM/space ambient layer for the Home dashboard --
 * a recognizable satellite dish silhouette (elliptical rim + bowl curve +
 * feed mast + tripod), a tiny satellite silhouette, a few faint orbital/
 * communication-path arcs, and a technical dot/grid wash spanning the
 * full content height (strongest near the greeting header, softer --
 * never gone -- further down). Reads its colors entirely from the
 * `--satcom-*` tokens in `globals.css` (per-theme there), so it never
 * needs its own light/dark branching.
 *
 * `aria-hidden`/`pointer-events-none` and absolutely positioned at `-z-10`
 * inside the caller's `relative isolate` wrapper -- strictly behind every
 * card/panel, never inside one, and never affects layout. Deliberately no
 * large blurred blobs (they read as generic decoration, not SATCOM) --
 * every glow here is small and tied to a specific silhouette.
 */
export function SatcomBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* Technical grid -- spans the full content height. Softer toward the
          bottom, but the floor stays high enough that the lower half of
          the page still reads as the same SATCOM canvas, not a fade to
          plain background. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, var(--satcom-grid-line) 1px, transparent 1px), linear-gradient(to right, var(--satcom-grid-line) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "linear-gradient(to bottom, black 0%, black 20%, rgba(0,0,0,0.72) 50%, rgba(0,0,0,0.6) 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, black 20%, rgba(0,0,0,0.72) 50%, rgba(0,0,0,0.6) 100%)",
        }}
      />

      {/* Small, tight glow halos -- tied to the dish/satellite below, never
          a freestanding blob. */}
      <div
        className="absolute -top-8 end-[3%] h-40 w-40 rounded-full blur-2xl"
        style={{ background: "var(--satcom-glow-a)" }}
      />
      <div
        className="absolute top-12 start-[12%] h-24 w-24 rounded-full blur-2xl"
        style={{ background: "var(--satcom-glow-b)" }}
      />

      {/* A third, equally small glow echoing the two above but in the
          lower half -- same tight/tied-down visual language, not a new
          freestanding blob, just keeping the ambient light from reading
          as top-only. */}
      <div
        className="absolute top-[52%] end-[10%] h-28 w-28 rounded-full opacity-80 blur-2xl"
        style={{ background: "var(--satcom-glow-a)" }}
      />

      {/* Primary orbital/communication-path arcs, upper background. */}
      <svg
        className="absolute -top-10 start-1/2 h-[380px] w-[1100px] -translate-x-1/2"
        viewBox="0 0 1100 380"
        fill="none"
        aria-hidden="true"
      >
        <ellipse cx="550" cy="420" rx="600" ry="360" stroke="var(--satcom-orbit-line)" strokeWidth="1.25" />
        <ellipse
          cx="550"
          cy="460"
          rx="740"
          ry="410"
          stroke="var(--satcom-orbit-line)"
          strokeWidth="1"
          strokeDasharray="1 11"
        />
      </svg>

      {/* A second, fainter arc further down the page -- only its crest
          pokes into view, echoing the top pair so the atmosphere reads as
          continuous rather than confined to the header. Kept thin and
          restrained, but visible enough that the lower half doesn't feel
          like the theme has dropped out entirely. */}
      <svg
        className="absolute top-[54%] start-1/2 h-[280px] w-[1300px] -translate-x-1/2 opacity-90"
        viewBox="0 0 1300 280"
        fill="none"
        aria-hidden="true"
      >
        <ellipse cx="650" cy="-60" rx="720" ry="340" stroke="var(--satcom-orbit-line)" strokeWidth="1.25" />
      </svg>

      {/* Satellite dish -- elliptical rim (in perspective) + bowl curve +
          feed mast + support pole/tripod, a real reflector silhouette
          rather than a filled blob. */}
      <svg className="absolute -top-2 end-[1%] h-48 w-48 sm:h-56 sm:w-56" viewBox="0 0 200 200" fill="none" aria-hidden="true">
        <path
          d="M22 66 C22 104 58 132 100 132 C142 132 178 104 178 66 Z"
          fill="var(--satcom-dish)"
          stroke="none"
        />
        <g stroke="var(--satcom-orbit-line)" strokeWidth="2" strokeLinecap="round" fill="none">
          <ellipse cx="100" cy="66" rx="78" ry="16" />
          <path d="M22 66 C22 104 58 132 100 132 C142 132 178 104 178 66" />
          <line x1="100" y1="90" x2="100" y2="24" />
          <line x1="100" y1="132" x2="100" y2="176" />
          <line x1="100" y1="176" x2="72" y2="196" />
          <line x1="100" y1="176" x2="128" y2="196" />
        </g>
        <circle cx="100" cy="20" r="4" fill="var(--satcom-orbit-line)" />
      </svg>

      {/* Tiny satellite silhouette -- body + two solar-panel wings + a
          short antenna, in the open gap between the dish cluster and the
          header text (never under bare text -- hidden below `sm:`, where
          that gap disappears and the header text spans the full width). */}
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
    </div>
  );
}
