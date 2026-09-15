/**
 * Purely decorative SATCOM/space ambient layer for the Home dashboard --
 * two soft glow blobs, a faint orbital arc pair, a low-opacity satellite
 * dish silhouette, and a technical dot/grid wash, all masked to be
 * strongest behind the greeting header and fade out (never fully gone)
 * further down the page. Reads its colors entirely from the `--satcom-*`
 * tokens in `globals.css` (per-theme there), so it never needs its own
 * light/dark branching.
 *
 * `aria-hidden`/`pointer-events-none` and absolutely positioned at `-z-10`
 * inside the caller's `relative isolate` wrapper -- strictly behind every
 * card/panel, never inside one, and never affects layout.
 */
export function SatcomBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute -top-28 start-[-12%] h-[26rem] w-[26rem] rounded-full blur-3xl"
        style={{ background: "var(--satcom-glow-a)" }}
      />
      <div
        className="absolute -top-32 end-[-16%] h-[28rem] w-[28rem] rounded-full blur-3xl"
        style={{ background: "var(--satcom-glow-b)" }}
      />

      <svg
        className="absolute -top-16 start-1/2 h-[420px] w-[1200px] -translate-x-1/2"
        viewBox="0 0 1200 420"
        fill="none"
        aria-hidden="true"
      >
        <ellipse cx="600" cy="480" rx="640" ry="380" stroke="var(--satcom-orbit-line)" strokeWidth="1.5" />
        <ellipse cx="600" cy="520" rx="800" ry="440" stroke="var(--satcom-orbit-line)" strokeWidth="1" />
      </svg>

      <svg className="absolute -top-4 end-[-3%] h-52 w-52" viewBox="0 0 200 200" fill="none" aria-hidden="true">
        <path
          d="M100 18 C42 18 22 88 22 138 L178 138 C178 88 158 18 100 18 Z"
          fill="var(--satcom-dish)"
          stroke="var(--satcom-orbit-line)"
          strokeWidth="1.5"
        />
        <line x1="100" y1="138" x2="100" y2="182" stroke="var(--satcom-orbit-line)" strokeWidth="4" strokeLinecap="round" />
        <line x1="72" y1="182" x2="128" y2="182" stroke="var(--satcom-orbit-line)" strokeWidth="4" strokeLinecap="round" />
      </svg>

      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, var(--satcom-grid-line) 1px, transparent 1px), linear-gradient(to right, var(--satcom-grid-line) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "linear-gradient(to bottom, black 0%, black 26%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.12) 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, black 26%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.12) 100%)",
        }}
      />
    </div>
  );
}
