# components/ui

Small, generic building blocks reused across feature areas: `Panel`
surface variants, `Badge`, `Avatar`, `Card`, `CoverageBadge`,
`IssueSeverityBadge`, `LiveClock`.

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
