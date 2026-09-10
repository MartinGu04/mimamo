# lib/readModels

Server-side orchestration that connects Google Sheet → parsers → domain
into a personalized, explicitly client-safe view. This is the ONLY layer
allowed to take the full server-side parsed schedule and project it down
to what one authenticated person's browser session may see.

Pipeline: Google Sheet → server-side full parse → domain analysis →
filter/project for the authenticated Person → `PersonalScheduleReadModel`.
The full schedule/personnel list must never reach the browser — only this
layer's safe projections may.

- `types.ts` — the `PersonalScheduleReadModel` shape and every safe
  projection type it's built from (`PersonalEventView`,
  `PersonalAssignmentView`, `PersonalCounterpart`, `PersonalShiftContext`,
  `PersonalIssue`, `PersonalDutyBlock`, `PersonalDutyAction`,
  `PersonalProfile`). None of these carry `sourceSheet`/`sourceCell`,
  workbook IDs, or a colleague's email/manager/capability flags; the
  authenticated person's own profile never carries their email either —
  that belongs to the auth boundary, not presentation. Every
  `PersonalEventView` carries a server-resolved `timing`
  (`lib/domain/assignmentTiming.ts`) so the dashboard's progress bar/today
  timeline never re-derives shift hours from raw text.
  `shiftCalendarEvents` is the one array that deliberately does NOT filter
  out finished history — the person's own `category === "shift"` Events,
  past/current/future — since it powers `/schedule`'s personal shift
  calendar rather than a "what's still relevant" list like
  `upcomingEvents`.
- `buildPersonalScheduleReadModel.ts` — the pure, deterministic builder.
  Takes the authenticated `Person`, the full parsed `people`/`events`, a
  `ShiftSchedule`, an explicit `LocalNow`, and (optional, defaults to `[]`)
  `potentialAllocations` — no network, no auth, no `Date`/UTC. Filters to
  the authenticated person's own Events, runs the existing
  `analyzeShiftCounterparts`/`detectOperationalIssues`/`buildDutyBlocks`/
  `deriveDutyActions` (reused, never reimplemented), and projects
  everything down to the safe types above. Colleague exposure is
  deliberately minimal: counterpart context only for the person's
  current/next shift(s), never every coworker's schedule. Every array is
  explicitly sorted — input Event order never affects output order — and
  nothing passed in is ever mutated. Also exports `toPersonalProfile`,
  reused by `personalSchedule.ts` for the `configuration_error` state
  below.

  **Duty-source completeness (Potential/תקשא"ס period sources).**
  `potentialAllocations` feeds `lib/domain/potentialDutyEvents.ts`'s
  `buildPotentialDutyEvents` (see that file's own docs), whose output is
  merged into a `personDisplayEvents` list used for EVERY duty-display
  section: `todayEvents`/`upcomingEvents`/`calendarEvents`/
  `currentAssignments`/`nextAssignmentGroup`/`dutyBlocks`/`dutyActions` —
  originally (PR #60) this only fed `dutyBlocks`/`dutyActions` (the
  personal Duties page); a later pass widened it to every place this read
  model already displays the person's own duties (the calendar, Manager
  Area's selected-person drill-down, dashboard today/upcoming), since all
  of them are built from this ONE shared function. `issues`/
  `currentShiftContexts`/`nextShiftContexts` (coverage/roster) deliberately
  keep reading the ORIGINAL, unmerged `events` — a synthetic duty Event is
  never a second source of shift/coverage truth. A person whose duties
  live only in a תקשא"ס period source (never in "משמרות + תורנויות") now
  sees them everywhere this read model is consumed, while a normal
  department person's existing duties, coverage, fairness, and
  shift-worker classification are all completely unaffected (verified —
  capability flags/`isTechnician`/`isSupervisor` are `Person` fields this
  function never derives from duty data in either direction). Every other
  caller of this function (`buildScheduleReadModel.ts`'s "self"/"person"
  perspectives, `buildManagerOverviewReadModel.ts`'s `selectedPerson`) now
  threads its own already-fetched `potentialAllocations` through, so the
  same completeness reaches the calendar and Manager Area drill-down
  without any of them reimplementing the resolution/dedup logic.
  `buildScheduleReadModel.ts`'s THIRD perspective, "all" (the shared/
  everyone calendar), doesn't call this function at all — it gets the
  identical completeness a different way: `lib/domain/potentialDutyEvents.ts`'s
  `buildPotentialDutyEventsForRoster` (the same per-person conversion, run
  once per roster member) is merged into `everyone.duties`'s input ONLY —
  `everyone.staffing` keeps reading the raw `events`, so a תקשא"ס-sourced
  duty is visible on the shared calendar as a normal duty entry but never
  affects shift staffing/coverage.
- `personalSchedule.ts` — `loadPersonalScheduleReadModel()`, the
  server-only orchestration layer. Resolves the Supabase identity first
  (a non-authenticated session never triggers a Google request),
  batch-fetches personnel + schedule + settings + potentialH1 + potentialH2
  in a single `fetchRawWorkbookSnapshot` call — the same fixed source set
  `FAIRNESS_WORKBOOK_SOURCES` already establishes — resolves the Person via
  `resolveIdentityAgainstPeople` (no second personnel fetch/parse), and
  fails closed as a typed `configuration_error` — never a default start
  time — on invalid/missing shift configuration. That state still carries
  the resolved person's safe profile (identity resolution succeeded; only
  the shift-time configuration didn't), so the app shell can render
  normally around a polished in-content error state.
- `getRequestPersonalSchedule.ts` — `cache(loadPersonalScheduleReadModel)`,
  a React request-scoped memoization. The protected `(app)` layout
  (identity/shell) and the dashboard page (content) both call this, so a
  normal request performs exactly one Google workbook batch fetch instead
  of two. Scoped to a single request's render only — never persistent
  across requests/users, never `unstable_cache`, no module-level state.

No public API route consumes this yet — PR #9's dashboard calls
`getRequestPersonalSchedule()` directly from Server Components.

## Manager overview (PR #14)

`ManagerOverviewReadModel` is a SEPARATE, manager-only read model —
`PersonalScheduleReadModel` above stays personal-only and is never
expanded to carry unit-wide data. The manager screen (`/manager`) is the
first feature that intentionally broadens scope beyond the authenticated
person's own schedule, and that broader scope is authorized, not assumed:

- `managerTypes.ts` — `ManagerOverviewReadModel` and every safe
  projection it's built from (`ManagerPersonSummary` — no email;
  `ManagerIssue` — global operational issues with `personId`/`personName`
  added, still no `sourceSheet`/`sourceCell`/raw evidence `Event[]`;
  `ManagerShiftOverviewEntry` — unit-wide coverage grouped by date+period,
  preserving every assigned person, never collapsed to one;
  `ManagerDutyEntry`/`ManagerAbsenceEntry`; `ManagerPotentialRequirementView`
  — reconciled Potential-vs-internal rows). Manager scope is broader than
  personal scope, but it is still a typed, explicitly safe projection —
  raw workbook structures, the spreadsheet ID, and Google API objects
  never reach it.
- `buildManagerOverviewReadModel.ts` — the pure, deterministic builder.
  Takes the authenticated manager `Person`, the full parsed
  `people`/`events`, combined H1+H2 `PotentialAllocation[]`, a
  `ShiftSchedule`, an explicit `LocalNow`, the resolved `ManagerDateRange`,
  and a raw (unvalidated) `selectedPersonId` — no network, no auth, no
  `Date`/UTC. Runs `detectOperationalIssues()` on the FULL manager-side
  parsed schedule (never the already-person-filtered
  `PersonalScheduleReadModel.issues`), builds the unit-wide coverage
  overview by reusing `analyzeUnitShiftCoverage` per date+period group —
  a PURE, person-order-independent group coverage algorithm (never an
  arbitrarily-chosen "target" person's perspective, and never a
  reinvented coverage algorithm) — and reconciles Potential allocations
  via `lib/domain/potentialReconciliation.ts` against the verified real
  requirement schema. Before reconciliation (PR #16), `potentialAllocations`
  is mapped through `lib/domain/potentialSourceOwnership.ts`'s
  `scopeManagerPotentialAllocation` (classifying each allocation exactly
  once) so only this team's own Potential responsibility (תקש"ל/תקשאס
  aliases + resolvable team members, short-name/annotated sources
  included) ever reaches `reconcilePotentialAllocations` — an external
  organizational source (איתן/רוקם/מבצעים/סייבר/מ"א/אמל"ח קצה/מנהלה/...)
  never produces a `"missing"` row and never affects any problem/attention
  count derived from `potentialRequirements`. That same step also enriches
  a short/annotated source's `resolvedSourcePersonId` (the parser only
  resolves exact full names) so `sourceConflict` keeps working for it. The
  selected-person section reuses
  `buildPersonalScheduleReadModel()` OUTRIGHT from the same in-memory
  `people`/`events`/`shiftSchedule` snapshot — no per-person Google
  fetch, no reimplemented current/next/counterpart/duty/issue logic. An
  invalid/unknown `selectedPersonId` falls back safely to the "everyone"
  scope rather than crashing. This call also now passes the same
  `potentialAllocations` this builder already receives, so a selected
  person's תקשא"ס-only duty appears in their `currentAssignments`/
  `nextAssignmentGroup` exactly like a real one would (see
  `buildPersonalScheduleReadModel.ts`'s own "Duty-source completeness"
  notes). The unit-wide `duties` list gets the SAME completeness
  separately: `lib/domain/potentialDutyEvents.ts`'s
  `buildPotentialDutyEventsForRoster` (the identical per-person conversion
  and dedup, just run once per roster member) is merged into the `events`
  passed to `buildManagerDutyEntries` ONLY — `coverageOverview`/`issues`/
  `potentialRequirements`/`absences` above and below all keep reading the
  raw `events`, so this never touches coverage, fairness, or the Potential
  reconciliation section.
- `managerOverviewParams.ts` — `parseManagerOverviewSearchParams`, strict
  parsing of `/manager`'s `?person=`/`?range=`/`?month=`/`?problems=`
  query params into typed, defaulted values. `person` omitted or `"all"`
  means everyone; `problems=1` is the only value that turns on the
  problems-only filter.
- `managerOverview.ts` — `loadManagerOverviewReadModel()`, the
  server-only orchestration layer and the security-critical piece of
  PR #14. Authorization itself lives in `managerWorkbookContext.ts` (see
  below) — this file does what's Overview-specific: parsing
  schedule/settings/Potential from the authorized snapshot, building the
  shift schedule, resolving the requested date range, deciding whether the
  privileged login/notification-readiness lookup is even needed (see
  `loadAdoptionReadiness` below), and building `ManagerOverviewReadModel`.
  Every stage is wrapped in `timedStage`/`timedSyncStage`
  (`lib/config/timingDiagnostics.ts`) — `managerOverview.total`,
  `manager.settings.parse`, `manager.schedule.parse`,
  `manager.potential.parse`, `manager.fairness.parse`,
  `manager.readModel.build`, `manager.adoptionReadiness`,
  `manager.rosterAvatars` — so Manager-specific latency is directly
  measurable, never guessed.
  - **Category-scoped adoption readiness (Manager category-switch
    latency).** `loadAdoptionReadiness(people, personId,
    needsAdoptionReadiness)` skips `computeNotificationReadiness()` (a
    privileged Supabase Admin API `listUsers()` + bulk `push_subscriptions`
    query) for TWO independent reasons: a person is selected (`personId
    !== null` — no category, including `"logins"`, renders it there), or
    the requested category simply isn't `"logins"`
    (`needsAdoptionReadiness === false`, decided by
    `managerCategoryNeedsAdoptionReadiness()` in
    `lib/presentation/managerUrl.ts` and threaded down from
    `app/(app)/manager/page.tsx`). Overview/Shifts/Personnel/Duties never
    pay for this I/O, even though they share the same whole-team read
    model as Logins. `getRequestManagerOverview`'s `cache()` key includes
    this flag, so a render that needs it and one that doesn't are never
    accidentally treated as the same cached call.
  - **Personnel's own, narrower roster-avatar lookup.**
    `loadRosterAvatarLookup(people, personId, needsRosterAvatars)` decorates
    the roster with real Google profile photos for the `"personnel"`
    category only (`managerCategoryNeedsRosterAvatars()`), reusing the
    SAME `fetchAllUserIdsByEmail()`/`resolvePersonIdentity()` primitives
    `recipients.ts`/`readiness.ts` already share — one bulk Admin API
    `listUsers()` call, and critically **never** `fetchAllSubscribedUserIds()`
    / `push_subscriptions` (that stays exclusive to `"logins"`'s full
    `computeNotificationReadiness()`). Same two independent skip
    conditions and same fail-soft-to-empty-map contract as
    `loadAdoptionReadiness` above, gated by its own
    `RosterAvatarLookup`/`rosterAvatarByPersonId` — see
    `buildManagerOverviewReadModel.ts`.
- `getRequestManagerOverview.ts` — `cache(loadManagerOverviewReadModel)`,
  keyed on primitive `(personId, range, month, needsAdoptionReadiness,
  needsRosterAvatars)` args (not one object literal) so React's `cache()`
  per-argument identity comparison actually dedupes multiple Server
  Components on the same `/manager` render.

**Fetch count by viewer:** a normal user (any page) → 1 Google batch
fetch (`personnel`+`schedule`+`settings`+`potentialH1`+`potentialH2`, via
`getRequestPersonalSchedule()`). A non-manager hitting `/manager` → 1
(the manager-only 5-source batch, fetched to authorize, then discarded
as `{status: "forbidden"}` before any manager data is parsed/returned —
see `managerWorkbookContext.ts` below). A manager hitting `/manager` → 2
Google batches total for the WHOLE request (the protected layout's own
personal-loader fetch via `getRequestPersonalSchedule()`, reused with the
dashboard/shell via `cache()`, PLUS the one manager-only batch) — but only
ONE live Supabase `getUser()` identity check, via
`getRequestAuthenticatedIdentity()` (see below), shared between the
layout's personal-loader call and the manager-authorization gate. Security
boundary matters more than minimizing the Google fetch count further —
see `managerWorkbookContext.ts`'s own docs for what changed here and why
it's still safe.

### Request-scoped identity memoization (`lib/auth/getRequestAuthenticatedIdentity.ts`)

`getRequestAuthenticatedIdentity = cache(getAuthenticatedIdentity)` —
React's per-request `cache()`, the exact same primitive
`getRequestPersonalSchedule`/`getRequestManagerOverview`/
`getWorkbookSnapshot`'s own in-flight dedup layer already rely on. This is
a genuinely THIRD kind of cache in this codebase, distinct from the other
two, and the distinction is documented directly in that file:
1. **This wrapper** — request-scoped, reset every new request, never
   shared across users/requests. It only stops the SAME live `getUser()`
   verification from being repeated several times within one render pass.
2. **The 30-second shared raw-workbook snapshot cache**
   (`lib/sync/workbookSnapshotCache.ts`, `unstable_cache`) — non-personal,
   shared spreadsheet data, cached ACROSS requests/users for a short TTL.
   Never holds identity/session/authorization state.
3. **Any persistent cache of authenticated/personal Manager or
   personal-schedule OUTPUT** — forbidden outright by this app's
   engineering rules, and never introduced here either.

`personalSchedule.ts` and `managerWorkbookContext.ts` (Manager Overview's
authorization gate, see below) both call this wrapper — so a manager
request's identity is verified live exactly once, shared between the
protected layout's personal-schedule load and the manager-authorization
check, instead of twice.

The client only ever receives safe roster `{id, name}[]` (see
`ManagerPersonSelector`, the one narrow Client Component this screen
uses) — never the full `ManagerOverviewReadModel`, never raw personnel
rows, never raw Potential sheets.

## Manager Fairness (PR #15)

`ManagerFairnessReadModel` is a SEPARATE, manager-only read model from
`ManagerOverviewReadModel` — Fairness and Potential reconciliation happen
to live on the same sheet tabs (`פוטנציאל תקש"אס 1-6/2026` /
`7-12/2026`) but are two different domains and are never merged into one
giant read model.

- **Shared auth/fetch boundary.** `managerWorkbookContext.ts` extracts
  the manager authorization + manager-wide fetch boundary into
  `loadManagerWorkbookContext()`, reused by Manager Overview, Manager
  Fairness, the permanent-manager Home, Schedule's manager perspective,
  and the broadcast/rule Server Actions.

  **Manager-latency pass (category-switch performance).** This used to
  gate on `getRequestPersonalSchedule()` — unconditionally parsing
  schedule/settings/Potential and building the ENTIRE
  `PersonalScheduleReadModel` (`detectOperationalIssues` included) purely
  to read `model.person.isManager` off it — and then re-resolved identity
  and re-parsed personnel a SECOND time anyway as "defense in depth". That
  was two live `getUser()` calls and two personnel parses per manager
  request, on top of a full personal-schedule build whose result was
  otherwise discarded. It now performs the minimal sequence that's
  actually necessary to prove the same four guarantees:
  1. a live authenticated Supabase user
     (`getRequestAuthenticatedIdentity()` — request-scoped `cache()`, see
     above);
  2. that user's email resolves unambiguously against personnel
     (`resolveIdentityAgainstPeople`, run against a FRESH parse of the
     manager snapshot's own personnel sheet);
  3. that resolved `Person.isManager === true`;
  4. only then is the manager-wide batch (the caller's own `sources`,
     defaulting to `MANAGER_WORKBOOK_SOURCES`) returned.

  This is still genuine defense in depth — identity is re-verified live
  and personnel is freshly re-parsed from the snapshot about to be
  returned — it just no longer duplicates a whole unrelated read-model
  build to get there. One side effect: an invalid/missing shift-schedule
  configuration no longer blocks this gate at all (it used to surface
  here as an early `configuration_error`, even for a caller like the
  broadcast-status polls that never touch `settings`) — a feature that
  actually needs `ShiftSchedule` still builds and fails closed on it
  itself, from `context.snapshot`, exactly like `managerOverview.ts`/
  `permanentManagerHome.ts`/`schedule.ts` already did. `getWorkbookSnapshot`
  is fetched with the CALLER's own `sources`, not a fixed set — a narrower
  caller (the broadcast/rule Server Actions passing `["personnel"]`)
  authorizes against, and only ever fetches, the sheets it actually needs.
  Both `/manager` and `/manager/fairness` still request the identical five
  sources, so tapping between them within the cache's short TTL reuses the
  same snapshot instead of a fresh Google request each time.
- **Lightweight polling boundary.** The same file's `loadManagerPersonnelContext()`
  is a deliberately NARROWER sibling for background/polling reads that
  only need "is this caller a manager" plus the roster (the standalone
  "מרכז התראות" Notification Center's ~17s scheduled/recent-broadcast status
  polls -- see `lib/notifications/scheduledBroadcastActions.ts`/
  `manualBroadcastActions.ts` -- and its own page-level authorization,
  `notificationCenter.ts` below). `loadManagerWorkbookContext(["personnel"])`
  now performs the SAME lightweight identity+personnel-only sequence (see
  above) — this sibling still exists, unmerged, purely because its
  narrower return type (no `snapshot`/`avatarUrl`) matches what these
  polling call sites actually need without discarding fields, not because
  of any remaining cost difference.
- **`lib/domain/fairnessTable.ts`** — `FairnessPersonRow` /
  `FairnessTotalsRow` / `FairnessTargets`, the domain-owned shapes
  `lib/parsers/fairness.ts` produces (same convention as
  `PotentialAllocation`/`lib/parsers/potential.ts`).
- **`lib/parsers/fairness.ts`** — locates each Potential sheet's separate
  Fairness table ("טבלת צדק") STRUCTURALLY, by its exact six header
  labels (שם / הקצאה / ניקוד הפוטנציאל הקודם / ניקוד לפוטנציאל הנוכחי /
  סופ"שים / פטורים) appearing together on one row — never a hard-coded
  W:AB column range. Parses person rows until the "סך הכל:" row, parses
  that total row separately, and locates the period-specific X/2X target
  note below the table by regex over each row's joined cell text (so the
  note parses whether it's one cell or split across several) — a
  missing/malformed note returns `null` targets, never a guessed default.
  "-" always means unavailable (`null`), never silently 0.
- **`lib/domain/fairnessExemptions.ts`** — centralized, exact-match-only
  known exemption → affected `DutyFamily[]` mapping (שמירות → guard;
  מטבח → daily_kitchen/full_kitchen/weekend_kitchen; רס"ר → rasar). An
  unknown exemption label is preserved raw with an empty
  `affectedDutyFamilies` — never fuzzy-matched, never dropped.
- **`lib/domain/fairnessAnalysis.ts`** — pure analysis over the sheet's
  own `currentScore`, which is NEVER replaced: `resolveComparisonTarget`
  (only טכנאי/אחמ"ש get a deterministic target — every other allocation
  label gets `null`, never invented), `computeScoreDelta` (`null` when
  there's no previous score, never treated as 0), `computeGapToTarget`,
  `computeNormalizedLoad` (`currentScore / target`, letting roles with
  different target scales compare fairly), and `sumDisplayedFairnessRows`
  (the independently computed sum of the currently parsed person rows).
  This last one is deliberately NOT a validation of the sheet's own
  reported "סך הכל:" total — the real workbook's totals can be built from
  a formula that doesn't equal a naive sum of every displayed row (a
  verified real example: H1's previous-score total is
  `=SUM(Y9:Y19)/4*6`), so `reportedXTotal` (from the parser) and
  `displayedXSum` (from this function) are two independent facts, never
  compared, never producing a "discrepancy"/"mismatch" conclusion.
- **`lib/domain/fairnessPeriod.ts`** — `FairnessPeriodKey` ("h1"/"h2"),
  `resolveFairnessPeriod` (Jan-Jun → h1, Jul-Dec → h2 from
  `LocalNow.date`, never a browser-local date; an invalid/missing
  `?period=` falls back to the period containing `now`), and
  `fairnessPeriodLabel` (year read from `now`, never hard-coded).
- **`managerFairnessTypes.ts`** — `ManagerFairnessReadModel` and its safe
  projections (`ManagerFairnessPersonRowView`,
  `ManagerFairnessExemptionView`, `ManagerFairnessTotalsView`,
  `ManagerFairnessChartSlice`). Never carries email,
  `sourceSheet`/`sourceCell`, raw Google rows, or the spreadsheet id.
  `ManagerFairnessChartSlice` (`{id, name, score, percentage}`) is the
  ONLY shape the chart's client-safe rendering ever touches.
- **`buildManagerFairnessReadModel.ts`** — the pure, deterministic
  builder: projects each `FairnessPersonRow` through the analysis
  functions above, sorts rows by normalized load ascending (rows without
  one sort after, stable tiebreak by source name) — this is relative-load
  ordering only, NEVER labeled "next up"/"recommended" (that's PR #16's
  job) — and builds the raw-`currentScore` chart slices (null-score rows
  excluded; an all-null/zero team produces an empty chart, never a
  division by zero).
- **`managerFairnessParams.ts`** — strict `?period=`/`?person=` parsing,
  same convention as `managerOverviewParams.ts`.
- **`managerFairness.ts`** — `loadManagerFairnessReadModel()`, the
  server-only orchestration layer: `loadManagerWorkbookContext()` →
  resolve the period → pick that one Potential sheet →
  `parseFairnessTable()` → `buildManagerFairnessReadModel()`.
- **`getRequestManagerFairness.ts`** — `cache(loadManagerFairnessReadModel)`,
  keyed on primitive `(period, personId)` args, same convention as
  `getRequestManagerOverview.ts`.

`/manager/fairness` (`app/(app)/manager/fairness/page.tsx`) renders this
read model entirely server-side. The only client-safe payload that ever
reaches a narrower surface is `ManagerFairnessChartSlice[]` for the donut
chart — implemented as plain server-rendered SVG (no chart library, no
client component at all). PR #15 never recommends who should be assigned
next ("הבא בתור") — that is explicitly out of scope, reserved for a
future PR #16 that adds assignment-specific eligibility.

## Manager adoption — "התחברויות" (Manager Area) + the standalone "מרכז התראות"

A management-visibility category, not an operational one: it reconciles
the SAME כ"א roster every other manager category uses against Supabase
auth + push-subscription state, so a manager can see who has logged into
המחלבה, who hasn't, and who can currently receive push notifications.
Formerly a small aside inside Overview (מצב התראות, PR #40), then a
combined "התחברויות והתראות" Manager category that ALSO hosted
notification-management UI (immediate/scheduled composer, history, fixed/
recurring rules) — that management surface has since moved to its own
standalone top-level product area, "מרכז התראות" (`/notifications`, see
below); the Manager Area's own `"logins"` category (`ManagerCategory`) now
shows ONLY this login/readiness picture, so Overview stays focused on
operational shift/duty issues. No new database schema and no parallel
personnel list — every fact here already existed, just split into the two
questions a manager actually asks instead of one collapsed engine enum.

- **Engine reuse.** `lib/notifications/engine/readiness.ts`'s
  `computeNotificationReadiness()` (the SAME bulk Supabase Admin API +
  `push_subscriptions` lookup PR #40's aside already used) is still the
  ONLY place identity/subscription state is computed — neither read model
  below ever re-queries Supabase itself. `PersonReadinessResult` also
  carries `avatarUrl` (the person's Google profile photo), read from the
  SAME already-fetched bulk `listUsers()` page via
  `lib/auth/currentUser.ts`'s `extractAvatarUrl` (exported for this reuse)
  — never a new per-user Admin API call, and never a login timestamp
  (`last_sign_in_at`/`created_at` exist on the Admin API response but
  nothing here reads them; login recency stays a possible future
  enhancement, not a fabricated approximation).
- **`managerAdoptionProjection.ts`** — the SHARED pure projection both
  `buildManagerOverviewReadModel.ts` (Manager Area's "התחברויות") and
  `notificationCenter.ts` (the standalone Notification Center, below) build
  on, so the two surfaces can never quietly compute this differently.
  `buildManagerRoster()` is the manager-safe roster projection (map + the
  by-name/id sort, no email). `toManagerAdoptionState()` narrows a caller's
  own `AdoptionReadinessLookup` (`skipped`/`unavailable`/`ok`) into the
  exported `ManagerAdoptionState`; internally, `toManagerAdoptionPerson()`
  is the one exhaustive switch over `PersonNotificationReadiness` that
  splits each person into `loginStatus`/`notificationStatus`/`dataIssue`/
  `needsNudge` (see `managerTypes.ts`'s own docs for exactly what each
  means), and `toManagerAdoptionView()` derives every summary count from
  that SAME single pass, so they can never drift out of agreement with
  `people` by construction. Every roster person survives into
  `ManagerAdoptionView.people` (unlike the old aside, which dropped every
  `ready` person).
- **`buildManagerOverviewReadModel.ts`** (Manager Area) — imports
  `buildManagerRoster`/`toManagerAdoptionState` from the shared module
  above rather than defining its own copy; `loadAdoptionReadiness()`
  (`managerOverview.ts`) is the orchestration wrapper that actually calls
  `computeNotificationReadiness()`, gated by `needsAdoptionReadiness`
  (`category === "logins"`, and never for a selected-person drilldown).
- **`notificationCenter.ts`** (standalone Notification Center) —
  `loadNotificationCenterContext(needsRosterAndAdoption)`, the completely
  separate, narrower orchestration for `/notifications`. Authorization +
  the roster come from `loadManagerPersonnelContext()`
  (`managerWorkbookContext.ts`, the SAME lightweight personnel-only,
  short-TTL-cached boundary the scheduled/recent-broadcast polls and
  notification-rule actions already use — never the heavier 5-source
  `loadManagerWorkbookContext()`, and no schedule/settings/Potential
  parsing, no `detectOperationalIssues()`, no `ShiftSchedule` at all). When
  `needsRosterAndAdoption` is true ("עכשיו"/"תזמון"/"קבועות", which all
  render an audience picker) it also calls `computeNotificationReadiness()`
  itself and narrows the result via the SAME shared projection above; when
  false ("היסטוריה", which renders no picker at all) neither the roster nor
  the readiness lookup is built at all. `getRequestNotificationCenterContext.ts`
  is the `cache()`-wrapped request-scoped memoization, keyed on that same
  boolean — same convention as `getRequestManagerOverview`.
  `NotificationCenterContext` exposes only `roster`/`adoptionPeople` — a
  narrower projection than `ManagerOverviewReadModel`, never a raw
  `Person`/Supabase `User`/email/push-subscription record.
- **`lib/presentation/managerAdoption.ts`** — `buildManagerAdoptionSectionView()`
  groups people into the four buckets the Manager Area's "התחברויות" UI
  actually renders (`notLoggedInGroup`/`notificationsOffGroup` — always
  visible, actionable; `readyGroup` — quiet, collapsed by default;
  `dataIssueGroup` — visually distinct roster-data framing), plus a
  headline sentence and the stat list for `ManagerAdoptionSummary`. The
  Notification Center's sections consume the narrower
  `ManagerAdoptionPersonView[]` directly (via `RosterPersonPicker`/
  `computeAudienceSummary`) rather than this grouped view — they're
  audience pickers, not a login-adoption report.
- **UI** — `ManagerAdoptionSummary`/`ManagerAdoptionSection`
  (`components/manager/`), rendered only for `category === "logins"` in
  `app/(app)/manager/page.tsx`. The notification-management UI
  (`ManagerBroadcastComposer`, `ManagerScheduledBroadcastsSection`,
  `ManagerRecentBroadcastsSection`, `ManagerFixedNotificationsSection`) is
  reused as-is but now renders exclusively from
  `app/(app)/notifications/page.tsx` and its `components/notifications/`
  coordinators — never from `/manager` anymore.

## Manager Area shift snapshot ("תמונת מצב משמרות")

A compact previous/current/next department shift snapshot inside the
Manager Area's own Overview category, for a manager who is themselves
shift-capable (e.g. an אחמ״ש with manager access) — as distinct from a
permanent/non-shift manager, who already gets this exact same operational
picture as their own dedicated `PermanentManagerHome` Home screen instead.
Neither existing Home experience (`PermanentManagerHome`, the normal
personal dashboard) changes; this section is additive, inside `/manager`
only.

- **`shiftSnapshot.ts`** — `resolveShiftSnapshotTriad(events, shiftSchedule,
  now)`, extracted from what was previously inlined logic in
  `buildPermanentManagerHomeReadModel.ts`. Resolves the canonical
  previous/current/next day/night shift via `resolveCurrentShiftPeriod`/
  `previousShiftPeriod`/`nextShiftPeriod` (`lib/domain/shiftSchedule.ts` —
  back-to-back 12h blocks with no gaps, so "current" always resolves for
  any valid `ShiftSchedule`), looks up each shift's roster/coverage via
  `buildShiftStaffingOverview` (falling back to an explicitly "missing,
  nobody assigned" entry via `analyzeUnitShiftCoverage([], ...)` for a
  shift with zero events, never an omitted/undefined shift), and computes
  each shift's elapsed/remaining/progress timing via
  `computeIntervalTiming` (`lib/domain/assignmentTiming.ts`) against the
  shift's own canonical hours — DST-safe, overnight/date-boundary-safe,
  never reimplemented. This is genuinely department-wide: `events` is the
  full parsed schedule, never filtered to one person, so previous/current/
  next are the actual neighboring shifts regardless of who is viewing.
  Both `buildPermanentManagerHomeReadModel.ts` and
  `buildManagerOverviewReadModel.ts` call this SAME function — zero
  duplication of shift resolution, roster/coverage lookup, or progress
  timing between the permanent-manager Home and the Manager Area section.
- **`lib/domain/personnelType.ts`'s `isShiftCapable`** — the eligibility
  signal for this section: `person.isSupervisor || person.isTechnician`,
  the same capability flags `classifyRoleGroup` already reads. Deliberately
  NOT a title-string check (e.g. matching "אחמ״ש") and deliberately
  independent of `classifyPersonnelType` (employment category, used to
  route the permanent-manager Home) — a manager can be shift-capable
  regardless of their `personnelType`.
- **`managerTypes.ts`** — `ManagerOverviewReadModel.managerShiftSnapshot:
  ShiftSnapshotTriad | null`. `buildManagerOverviewReadModel.ts` sets it via
  `isShiftCapable(manager) ? resolveShiftSnapshotTriad(events,
  shiftSchedule, now) : null` — purely in-memory over the SAME
  `events`/`shiftSchedule`/`now` Manager Overview already fetches for
  coverage/issues, so eligible managers cost zero additional Google/Supabase
  fetches.
- **UI** — `components/manager/ManagerShiftSnapshotSection.tsx` renders
  the triad via the SAME `ShiftSnapshotCard` component
  (`components/home/`) the permanent-manager Home uses, completely
  unmodified — but in a plain, equal three-column grid rather than the
  Home's hero-weighted layout with mobile reordering, so it reads as one
  compact operational section inside the Overview page rather than a
  second Home screen. Rendered in `app/(app)/manager/page.tsx` only when
  `category === "overview"` and `model.managerShiftSnapshot` is non-null;
  `null` (a permanent/non-shift manager) renders nothing extra, and every
  other Manager Area category/behavior is unaffected.

## Person avatar convention (project-wide)

**Person avatar = connected Google profile photo when available; initials
otherwise.** This is a project-wide hamachlava convention, not a
Fairness-specific or Shooting-Ranges-specific one — any feature that
displays a person's avatar resolves it this way, and reuses the SAME
primitives below rather than inventing a second Google-profile system,
fetching Google directly from the browser, or doing a per-person DB/auth
lookup:

- **`personAvatarLookup.ts`** — `fetchEmailToAvatarUrl()` (account-wide,
  roster-independent, reuses the SAME Supabase Admin API bulk
  `listUsers()` primitive `lib/notifications/engine/recipients.ts`'s
  `fetchAllUserIdsByEmail` already established for the notification worker
  and the manager-only adoption view above — never a second lookup
  mechanism) and `resolveAvatarUrlsByPersonId()` (pure, matches that map
  against one specific roster, failing closed on an ambiguous email
  exactly like every other identity resolution in this codebase). Split
  in two specifically so `fairnessWorkbookContext.ts` can kick the fetch
  off CONCURRENTLY with its own workbook fetch, instead of waiting for the
  roster to resolve first.

  This is genuinely NEW traffic to a privileged, RLS-bypassing Admin API
  call: every prior caller was either the Cron-triggered worker (no live
  user request at all) or a manager-only view. `/fairness` is a normal
  main-navigation destination every mapped user can load, so
  `fetchEmailToAvatarUrl` is wrapped in a short (30s) `unstable_cache` —
  the same TTL/convention `lib/sync/workbookSnapshotCache.ts` already
  established — so a burst of different users loading Fairness within a
  few seconds reuses one Admin API call rather than one each. Never fails
  the whole page: `fairnessWorkbookContext.ts` catches a rejected lookup
  and degrades to an empty map (every row falls back to initials).
- **`fairnessWorkbookContext.ts`** — `FairnessWorkbookContext.avatarByPersonId`
  carries the resolved map through to both `shiftFairness.ts` and
  `dutyFairness.ts`.
- **`shiftFairness.ts`/`dutyFairness.ts`** — each stamps `avatarUrl` onto
  its already-built read model's rows via a small `withAvatars()`
  post-processing step that runs strictly AFTER
  `buildShiftFairnessReadModel`/`buildDutyFairnessReadModel` — neither
  builder itself ever sets or reads `avatarUrl`, so this can never affect
  calculations, sorting, eligibility, or historical logic.
- **`lib/presentation/fairnessCards.ts`** — `ShiftFairnessCardView`/
  `DutyFairnessCardView` both carry `avatarUrl` straight through from the
  row, unchanged.
- **`shootingRangeManagerOverview.ts`** — the Shooting Ranges manager team
  overview reuses the EXACT SAME two `personAvatarLookup.ts` functions:
  `fetchEmailToAvatarUrl()` kicked off concurrently with
  `loadManagerWorkbookContext()`, then `resolveAvatarUrlsByPersonId()`
  against the eligible roster once both resolve — one bulk Admin API call
  for the whole team, never a per-person lookup. `ManagerShootingRangeRow.avatarUrl`
  carries the result through to `ShootingRangeManagerPanel`'s `TeamMemberRow`.
  This is the pattern for any NEW feature needing roster avatars too: reuse
  `personAvatarLookup.ts` directly, never copy/paste this resolution logic.
- **UI** — `ShiftFairnessCard`/`DutyFairnessCard` (`components/fairness/`)
  and `ShootingRangeManagerPanel`'s `TeamMemberRow` (`components/shootingRanges/`)
  all render it via the shared `Avatar` component (`components/ui/Avatar.tsx`,
  `size="xs"`/`"sm"` for dense-row contexts) immediately beside the
  person's name — Google photo when available, initials otherwise,
  graceful fallback on a failed image load (`Avatar`'s own `onError`
  handling — never a broken-image icon). A person absent from the resolved
  map, or with no usable photo, simply renders initials; this is the ONE
  fallback path every caller shares, never a second/parallel one.
