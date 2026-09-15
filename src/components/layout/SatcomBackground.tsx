/**
 * The SATCOM canvas for the Home page -- a page-level visual layer, not a
 * dashboard-content decoration.
 *
 * MOUNTING: this belongs to `AppShell`'s main column (see `HomeBackdrop`),
 * NOT to any component rendered inside `main`. Mounted deeper it would be
 * boxed in twice over: `main`'s inner `mx-auto max-w-[1440px]` wrapper caps
 * its width, and the page content's own box caps its height at whatever the
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
 * COMPOSITION: a distributed environment rather than a poster with one
 * subject -- base wash, starfield, an Earth limb toward the upper right, a
 * modest dish toward the upper left, arcs sweeping the full width at five
 * heights, small glows and tiny satellites seeded across left/center/right
 * and upper/middle/lower. Decorative placement uses PHYSICAL sides
 * (left/right, not start/end): it mirrors the reference composition, which
 * is a picture, not text that should flip with direction.
 *
 * Colors come entirely from the `--satcom-*` tokens in `globals.css`
 * (cinematic deep space in dark mode, the same composition translated to
 * white/pale-blue in light mode), so there is no light/dark branching here.
 */
export function SatcomBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* Base wash: space at the top settling back into the ordinary page
          background further down, so the lower page blends seamlessly. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to bottom, var(--satcom-bg-from) 0%, var(--satcom-bg-via) 22%, var(--satcom-bg-via) 44%, var(--background) 76%)",
        }}
      />

      {/* Atmospheric lighting, weighted to the upper right (the Earth side)
          with a cooler counter-light low on the left, so the page is lit
          from more than one place. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(70% 34% at 86% -6%, var(--satcom-horizon-glow), transparent 64%)" }}
      />
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(52% 30% at 8% 74%, var(--satcom-glow-b), transparent 68%)" }}
      />

      {/* Starfield: evenly seeded and tiled, so every region of the page
          carries some of it rather than one quadrant reading busier. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
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
          ].join(", "),
          backgroundSize: "900px 760px",
          backgroundRepeat: "repeat",
        }}
      />

      {/* Earth limb, upper right: a faint body plus a soft-glowing edge. */}
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

      {/* Technical grid: the full page height, easing off lower down but
          never disappearing. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, var(--satcom-grid-line) 1px, transparent 1px), linear-gradient(to right, var(--satcom-grid-line) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
          maskImage: "linear-gradient(to bottom, black 0%, black 24%, rgba(0,0,0,0.78) 55%, rgba(0,0,0,0.6) 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, black 24%, rgba(0,0,0,0.78) 55%, rgba(0,0,0,0.6) 100%)",
        }}
      />

      {/* Communication/orbital paths: full-width sweeps at five heights, so
          the motif travels the page instead of ringing the header. */}
      {[
        { top: "-top-16", height: "h-[380px]", cy: -120, ry: 300, dash: undefined, opacity: "opacity-100" },
        { top: "top-[22%]", height: "h-[300px]", cy: -60, ry: 260, dash: "2 9", opacity: "opacity-85" },
        { top: "top-[44%]", height: "h-[300px]", cy: -70, ry: 270, dash: undefined, opacity: "opacity-80" },
        { top: "top-[66%]", height: "h-[280px]", cy: -80, ry: 260, dash: "3 10", opacity: "opacity-75" },
        { top: "top-[86%]", height: "h-[260px]", cy: -90, ry: 250, dash: undefined, opacity: "opacity-65" },
      ].map((arc) => (
        <svg
          key={arc.top}
          className={`absolute ${arc.top} ${arc.height} left-1/2 w-[150%] -translate-x-1/2 ${arc.opacity}`}
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
        </svg>
      ))}

      {/* Small ambient glows seeded across every region -- six modest halos
          rather than one bright center of mass. */}
      <div className="absolute top-4 left-[2%] h-32 w-32 rounded-full blur-2xl" style={{ background: "var(--satcom-glow-a)" }} />
      <div className="absolute top-[18%] left-[38%] h-24 w-24 rounded-full opacity-80 blur-2xl" style={{ background: "var(--satcom-glow-b)" }} />
      <div className="absolute top-[34%] left-[6%] h-28 w-28 rounded-full opacity-90 blur-2xl" style={{ background: "var(--satcom-glow-b)" }} />
      <div className="absolute top-[46%] right-[5%] h-32 w-32 rounded-full opacity-90 blur-2xl" style={{ background: "var(--satcom-glow-a)" }} />
      <div className="absolute top-[68%] left-[44%] h-32 w-32 rounded-full opacity-80 blur-2xl" style={{ background: "var(--satcom-glow-a)" }} />
      <div className="absolute top-[88%] right-[22%] h-28 w-28 rounded-full opacity-70 blur-2xl" style={{ background: "var(--satcom-glow-b)" }} />

      {/* Satellite dish, upper left -- deliberately modest: one motif in the
          environment, never the subject of it. */}
      <svg className="absolute top-6 left-[1%] h-40 w-40 sm:h-48 sm:w-48" viewBox="0 0 200 200" fill="none" aria-hidden="true">
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

      {/* Tiny satellites in three different regions. The first is desktop
          only: below `lg` the header text spans the full width and there is
          no open gap there to sit in. */}
      <svg className="absolute top-[132px] left-[45%] hidden h-8 w-14 lg:block" viewBox="0 0 100 60" fill="none" aria-hidden="true">
        <g stroke="var(--satcom-orbit-line)" strokeLinejoin="round">
          <rect x="40" y="20" width="20" height="16" rx="2" strokeWidth="2" />
          <rect x="8" y="24" width="26" height="8" strokeWidth="1.5" />
          <rect x="66" y="24" width="26" height="8" strokeWidth="1.5" />
          <line x1="50" y1="20" x2="50" y2="9" strokeWidth="1.5" strokeLinecap="round" />
        </g>
        <circle cx="50" cy="6" r="2.5" fill="var(--satcom-orbit-line)" />
      </svg>

      <svg className="absolute top-[40%] right-[14%] h-7 w-12 rotate-6 opacity-90" viewBox="0 0 100 60" fill="none" aria-hidden="true">
        <g stroke="var(--satcom-orbit-line)" strokeLinejoin="round">
          <rect x="40" y="20" width="20" height="16" rx="2" strokeWidth="2" />
          <rect x="8" y="24" width="26" height="8" strokeWidth="1.5" />
          <rect x="66" y="24" width="26" height="8" strokeWidth="1.5" />
          <line x1="50" y1="20" x2="50" y2="9" strokeWidth="1.5" strokeLinecap="round" />
        </g>
        <circle cx="50" cy="6" r="2.5" fill="var(--satcom-orbit-line)" />
      </svg>

      <svg className="absolute top-[78%] left-[20%] h-6 w-11 -rotate-6 opacity-75" viewBox="0 0 100 60" fill="none" aria-hidden="true">
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
