# components/ui

Small, generic building blocks reused across feature areas: `Panel`
surface variants, `Badge`, `Avatar`, `Card`, `CoverageBadge`,
`IssueSeverityBadge`, `LiveClock`.

## Glass materials

`glass.ts` holds the app's glass vocabulary — `strong` / `medium` /
`subtle` / `none` — and `Panel` applies a default level per variant
(`hero` → strong, `panel` → medium, `compact` → subtle, `inline` and
`critical` → none). The material itself lives entirely in
`app/globals.css`; this layer only chooses how much of it a surface gets.

Things worth knowing before changing any of it:

- **Tune from the tokens, not the call sites.** Every level is five
  variables (`--glass-alpha-*`, `--glass-blur-*`, `--glass-saturate-*`,
  `--glass-line-*`, `--glass-highlight-*`/`--glass-depth-*`). The whole
  system can be made louder or quieter without touching a component.
- **The shape tokens are deliberately not per-theme.** Blur/saturation/
  `--glass-alpha-bump` are defined once in plain `:root` so the
  small-viewport and `prefers-reduced-transparency` overrides can win at
  matching specificity. Redefining one inside a `data-theme` block
  silently disables those — `globalsGlass.test.ts` guards this.
- **The opaque classes stay.** A glassed `Panel` keeps its
  `bg-surface-*` + `ring-*` classes; the material is layered on by an
  `@supports`-gated rule, so a browser without `backdrop-filter` renders
  exactly the surface that shipped before it.
- **Glass never nests.** A CSS guard strips the blur from any glass
  surface inside another one — a second `backdrop-filter` samples an
  already-composited layer, doubling the softness and paying for a full
  extra GPU pass to do it. Don't work around it; use `inline` (or
  `glass="none"`) for surfaces meant to sit inside another.
- **Color-as-meaning stays opaque.** `critical` ignores a passed `glass`
  outright, and `ManagerCoverageSection` picks its level from a date's
  coverage status so a staffing warning never dilutes into the canvas
  behind it. Inputs, and rows whose tone carries state, get no glass.
- **Modals separate via the scrim.** `.glass-scrim` blurs the dimming
  layer; the dialog panel above it stays solid. That is the app's one
  full-viewport blur.

Measured on the real rendered canvas (worst point inside each surface's
content box, glyphs hidden): dark ≥ 14.1:1 foreground / 6.4:1 muted,
light ≥ 15.0:1 / 5.0:1 — the light theme's own `--muted`-on-white
baseline is 5.12:1, so the material costs under a tenth of a step.

### Which surfaces are solid, and why

Every card-like surface in the app has been classified once. If you are
adding one, put it in the right bucket rather than copying whatever is
nearest:

**Glass.** Anything that sits directly on the page canvas with the SATCOM
backdrop behind it: `Panel` in any variant except `inline`/`critical`,
fairness person cards, "דורש טיפול" finding cards, potential rows, the
week strip, the countdown roster cards, and floating popovers (the person
pickers, the profile menu, the notification panel) — a popover has no
scrim of its own, so the blur is what separates it from what it covers.

**Deliberately solid.** These are not oversights:

- `critical` panels, and coverage cards whose date has a real staffing
  problem — color is the message.
- Inputs, buttons and control pills (the range selector, the category
  nav). A filled `bg-surface-1` pill means *selected*; that is state, not
  a surface.
- Rows nested inside another surface — duty rows, desk slots, timeline
  items, counterpart rows, the fairness cards' own data strip. These read
  as a solid block sitting ON the card's material, which is what keeps
  the card's identity legible through them.
- Dialog/sheet/palette panels. Their separation comes from `.glass-scrim`
  behind them, not from a second blurred layer.

**Edge cases the parameterised ring exists for.** The levels set
`box-shadow` wholesale, so a surface carrying its own accent ring or a
real `border` needs to say so: `glass-ring-primary` keeps a `ring-2
ring-primary` selection state visible through the material (today's week
card), and `glass-ring-none` suppresses the material's own edge where the
surface already draws a `border` (the countdown roster card), so the two
never stack into a doubled hairline.

- `LinkPendingWatcher.tsx` — a tiny bridge component (renders nothing)
  that reports the enclosing `next/link` `<Link>`'s own pending-navigation
  state (`useLinkStatus`) up to a parent via callback. Extracted from
  `layout/Sidebar.tsx`/`layout/BottomNav.tsx`, which previously each
  defined an identical local copy; now the ONE shared primitive, also
  used by `TabLink.tsx`. Pure de-duplication, no behavior change.
- `TabLink.tsx` — one `role="tab"` pill link with real per-tab pending-
  navigation feedback (instant `aria-busy` + small inline spinner on
  click, using `LinkPendingWatcher` above; a second click on an
  already-pending tab is a no-op via `preventDefault`, same idiom
  Sidebar/BottomNav already use for the app's main navigation). Used by
  `manager/ManagerCategoryNav.tsx` and `fairness/FairnessModeToggle.tsx`
  so both tab strips share ONE pending-state implementation instead of
  two independent copies — added because a category/mode switch stays on
  the SAME route segment (only a searchParam changes), which is exactly
  the case a route's own `loading.tsx` Suspense boundary can never fire
  for. The spinner never replaces the tab's label text (the destination
  stays nameable, no layout-shifting skeleton) and never changes
  `href`/`aria-selected`/active-styling semantics.
- `LiveClock.tsx` — the one live Asia/Jerusalem clock in the app (Design
  Pass PR #19; previously dashboard-only). Its only current caller is
  `layout/ShellUtilityBar.tsx` (the app shell's desktop-only top utility
  row), so it never appears twice on one page. Presentation-only: it never
  makes a network request and is never a source of scheduling truth (the
  read model's `LocalNow` remains that). `initialTime` is `null` when no
  server-derived value is available (e.g. a `configuration_error` shell
  render) — the component renders nothing until its own first client-side
  tick, which stays hydration-safe by construction.

## Data freshness + manual refresh (PR #17)

המחלבה does not replace Google Sheets. Google Sheets stays the working
surface and the source of truth; המחלבה is a **read-only** visibility
layer that fetches timestamped snapshots of it (`lib/google` — every
sheet read is `spreadsheets.values.batchGet`, never a write). Every read
model already carries its own `fetchedAt` (an ISO instant) recording
**when המחלבה fetched that snapshot** — never when someone last edited
the spreadsheet, and there is no separate "last modified in Sheets"
timestamp anywhere in this codebase.

- `DataFreshnessStatus.tsx` — the one shared, restrained "how fresh is
  what I'm looking at" metadata row, placed near/below each page's own
  header (never inside it — no header redesign) on every route that
  renders a read model: `/`, `/schedule`, `/duties`
  (all `PersonalScheduleReadModel.fetchedAt`), `/manager`
  (`ManagerOverviewReadModel.fetchedAt` — even on the selected-person
  sub-view, never the nested personal `fetchedAt` from that person's own
  `PersonalScheduleReadModel`), and `/manager/fairness`
  (`ManagerFairnessReadModel.fetchedAt`). It receives ONLY that one
  `fetchedAt` string prop — never a raw Google timestamp, workbook
  ranges, `sourceSheet`/`sourceCell`, the spreadsheet id, or personnel
  emails.
  - The relative-age text ("עודכן עכשיו" / "עודכן לפני 4 דקות") comes
    from `lib/presentation/dataFreshness.ts`'s pure
    `formatDataFreshnessLabel(fetchedAt, now)`, called ONLY inside a
    `useEffect` (i.e. strictly after mount) so server-rendered output and
    the browser's own clock never both render in the same pass —
    `label` starts `null` (matching exactly what the server rendered),
    avoiding any hydration mismatch. A local 30s timer re-ticks that
    DISPLAYED text only; it never triggers a network request — there is
    no automatic polling anywhere in this component.
  - The refresh control calls `router.refresh()` (wrapped in
    `useTransition` for a pending/spinner state) to rerun the CURRENT
    route's existing Server Component data loader — no new API route, no
    direct browser call to Google, no separate fetch implementation, and
    no writeback. `router.refresh()` preserves the route's own URL/query
    state (e.g. `?month=`, `?person=&range=`, `?period=`) — it is not a
    navigation. A user clicking refresh is the ONLY thing that causes an
    extra Google read; normal page loads/renders never gain an additional
    fetch just because this component exists. Once a genuinely new
    `fetchedAt` prop arrives from a real refreshed snapshot, the relative
    age naturally resets to "עודכן עכשיו" — that IS the success signal;
    there is no separate fake "הרענון הצליח" state shown before a new
    model has actually arrived.
