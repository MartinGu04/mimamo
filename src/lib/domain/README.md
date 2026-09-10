# lib/domain

Business rules operating on parsed domain objects: conflict detection,
manager reconciliation, "who is with me", derived reminders. Pure logic,
no Google API calls and no spreadsheet-cell access.

- `types.ts` — `Person`, the typed personnel record produced by
  `lib/parsers/personnel.ts`. Existing in this list does not imply a
  person is scheduled/active on a given date — no such flag is stored
  here.
- `event.ts` — the `Event` model (and its category/role/period/certainty/
  duty-family/absence-kind unions) produced by `lib/parsers/event.ts`
  from a `RawAssignment`. This — not `RawSheet`/`RawAssignment` — is
  what a future rules engine and the UI should consume.
- `shiftSchedule.ts` — builds the day/night shift schedule from the
  workbook's configured day-shift start (never falls back to a default
  time — `ShiftConfigurationError` on missing/invalid config), and
  `resolveEventShiftInterval` for a single shift `Event`'s effective
  start/end minute interval, respecting `startTimeOverride`/
  `endTimeOverride`. Deterministic minute arithmetic only, no
  `Date`/UTC — a night shift crosses midnight without touching
  `Event.date`.
- `shiftCoverage.ts` — `analyzeShiftCounterparts`, the "מי איתי?"
  counterpart matcher and structural shift-coverage engine (opposite
  role, same date/period; shadow shifts never count as primary
  coverage; partial counterpart intervals merge into full coverage;
  missing coverage is returned as machine-readable gaps). Structural
  coverage only — certainty (confirmed/tentative) is preserved
  untouched; whether tentative coverage should count as operationally
  confirmed is left to a future rules engine, not decided here. No
  alert/severity logic. Also exports `analyzeUnitShiftCoverage` (PR #14) —
  the manager overview's UNIT-WIDE date+period group coverage, evaluated
  against the canonical shift window from both roles' merged intervals
  together. Deliberately independent of any single person's identity —
  it never picks an arbitrary "target" Event the way
  `analyzeShiftCounterparts` does, so the result never depends on
  `personId`/`sourceCell` ordering. Precedence: a PROVABLY-absent role
  (zero non-shadow Events for it, not merely unresolved ones) always makes
  the group `"missing"` — with `missingIntervals` covering the ENTIRE
  canonical window — regardless of whether the other role is ambiguous,
  partial, or even fully covered; proven absence beats uncertainty
  elsewhere. Only once neither role is provably absent does ambiguity get
  checked: `"not_evaluable"` when an unresolved/invalid Event makes a
  role's true coverage impossible to honestly determine (unless resolved
  coverage alone already proves that role's window is fully covered — an
  extra unresolved duplicate Event never invalidates an already-provably-
  full result). Otherwise: `"full"` only when both roles cleanly cover the
  whole canonical window; `"partial"` otherwise, with `missingIntervals`
  being the merged union of both roles' own gaps.
- `operationalIssues.ts` — `detectOperationalIssues`, the first
  deterministic rules engine: blocking absence + active assignment,
  shift coverage missing/partial (reusing `analyzeShiftCounterparts`,
  no duplicated interval math), invalid shift-time overrides, and
  personnel capability mismatch (`Person` capabilities are only
  compared against the Event's actual scheduled role here — they are
  never used for counterpart matching). Machine-readable
  reason/severity only, no Hebrew UI copy or presentation colors in the
  domain result. Deduplicates issues built from identical evidence
  without collapsing genuinely different affected Events.
- `dutyBlocks.ts` — `buildDutyBlocks`, grouping consecutive-calendar-day
  duty Events (`category === "duty" && dutyFamily !== null` only) into
  `DutyBlock`s for one person + duty family + slot. Built purely from
  Event metadata, never Hebrew `rawValue`/`title`. Local calendar-date
  arithmetic only (`parseCalendarDate`/`isNextCalendarDay`/`dayOfWeek`) —
  no `Date`/UTC, so month/year boundaries and leap years are handled
  without timezone risk and an unparseable date can never crash
  grouping or silently join a valid run. `weekend_kitchen` gets an
  explicit `weekendCompleteness` (complete only for an actual
  Thursday-Friday-Saturday run — dates are never fabricated). Output is
  deterministically sorted; a duplicate Event reference is deduplicated
  so it can never inflate `dayCount`. `parseCalendarDate`/`dayOfWeek` are
  also reused by `lib/presentation` for Date-free Hebrew weekday display.
- `potentialDutyEvents.ts` — `buildPotentialDutyEvents`, converting Potential/
  תקשא"ס period allocations (`PotentialAllocation[]`) attributed to ONE
  person into synthetic duty `Event`s, so `buildDutyBlocks` above can group
  them exactly like a real משמרות + תורנויות duty Event -- no separate
  grouping logic. Person resolution reuses `potentialSourceOwnership.ts`'s
  `scopeManagerPotentialAllocation` outright (the SAME generic resolver
  Manager Overview already uses) -- never a name-based special case, and an
  ambiguous short name never guesses (both already fail closed inside that
  resolver). An allocation already covered by a real internal duty Event
  for the exact same `(date, dutyFamily, slot)` is dropped, so a normal
  department person's existing duties are never duplicated -- this is what
  keeps `lib/readModels/personalSchedule.ts` reusing this safely for every
  person, department or not. Always produces `certainty: "tentative"`
  (a Potential allocation is the source/framework plan, never a confirmed
  internal schedule entry) and never touches `role`/capability fields, so
  it can never affect shift-worker classification anywhere in this domain.
  `buildPotentialDutyEventsForRoster` is the SAME conversion run once per
  person across a whole roster and concatenated -- for a manager-facing,
  roster-wide projection (`buildManagerDutyEntries`'s input in
  `buildManagerOverviewReadModel.ts`) that needs every attributed תקשא"ס
  duty across the team, not just one person's own. It never
  re-implements resolution/dedup -- it's a thin loop over the
  single-person function, so the two can never define "attributed" or
  "already covered" differently.
- `dutyActions.ts` — `deriveDutyActions`, turning `DutyBlock`s into
  machine-readable `duty_check_in` action data (never an actual
  notification — no Notification API, cron, or push subscription here).
  Always local time `"13:00"`, never converted to UTC. A one-day block
  gets one same-day action; a multi-day block gets one action on every
  actual date except the final one — the same rule for every duty
  family, including `weekend_kitchen` (no separate reminder engine).
- `localNow.ts` — the `LocalNow` shape (`date` + `minuteOfDay`), a plain
  local-clock reading. Producing one from a real instant is a runtime
  boundary concern (`lib/time`), not a domain concern — this is only the
  type every domain temporal rule is expressed against.
- `assignmentTemporalState.ts` — `classifyAssignmentTemporalState`,
  classifying a shift/duty `Event` as `current`/`upcoming`/`past` relative
  to a `LocalNow` (duties: calendar date only, no invented hours; shifts:
  reuses `resolveEventShiftInterval`, comparing `now` on the shift's own
  minute timeline so an overnight shift crossing midnight is handled
  without touching `Date`/UTC). An unresolved shift interval (unspecified
  period or an invalid override) is always `not_evaluable`, on any date —
  never guessed into a bucket. `isEventStillRelevant` is the same
  overnight-carry-forward rule reused for "should this Event still show up
  in a present/future view". `resolveNowMinuteOnEventTimeline` is exported
  for `assignmentTiming.ts` to reuse the exact same "now, on this Event's
  own timeline" placement.
- `assignmentTiming.ts` — `computeAssignmentTiming`, a safe
  presentation-ready projection of a shift's resolved timing as of a
  `LocalNow`: wrapped `"HH:mm"` start/end (an overnight end past midnight
  reads e.g. `"07:30"`), duration, and elapsed/remaining/progress/
  minutes-until-start as of that instant. `not_evaluable` for every duty
  and every shift whose interval can't resolve — never an invented
  start/end/duration. The dashboard's live progress bar only ever
  advances this forward using elapsed wall-clock time; it never
  re-derives the underlying scheduling rules client-side.
- `dateRange.ts` — PR #14's `/manager` date-range machinery:
  `parseManagerRangeParam` (strict `?range=` allowlist, falls back to
  `"7d"`) and `resolveManagerDateRange`, which turns
  `today`/`7d`/`30d`/`month` + `LocalNow` into the concrete civil dates
  covered (`"month"` defaults to the month containing `LocalNow.date` on
  an invalid/missing `?month=`, via `parseMonthParam`). `addCalendarDays`/
  `formatCalendarDate` are plain integer arithmetic on `CalendarDate` —
  no `Date`/UTC, leap years and year boundaries handled correctly.
- `potentialAllocation.ts` — the domain-owned `PotentialAllocation` shape
  (the same convention as `Event`: domain defines the type,
  `lib/parsers/potential.ts` only produces values of it — domain never
  imports from `lib/parsers`).
- `potentialReconciliation.ts` — PR #14's Potential-vs-internal
  reconciliation, now against the VERIFIED real requirement schema (see
  `lib/parsers/potential.ts`'s `REQUIREMENT_COLUMNS`). **Potential is the
  source/framework allocation, never the internal actual schedule** —
  this never converts a `PotentialAllocation` into an `Event` and never
  merges the two arrays. Coverage is decided by DATE + TYPED DUTY
  REQUIREMENT, never by `sourceAllocationLabel` matching a person:
  - `guard`/`reserve` (exact-slotted internally) match by date + family +
    the EXACT internal `Event.slot`.
  - `evacuation_on_call` (single, unslotted) matches by date + family.
  - `oxid`/`daily_kitchen`/`full_kitchen`/`rasar` (numbered on the
    Potential side, but internally unslotted) reconcile by date + family
    MULTIPLICITY: every requirement for that date+family, sorted by its
    own `sourceSlot`, is paired positionally against every matching
    internal Event, sorted by a stable order (`personId`, then
    `sourceSheet`/`sourceCell`) — never a fake exact-slot identity, never
    dependent on input array order.
  `"covered"`/`"missing"` are real, produced statuses now that the schema
  is known; `"partial"` stays a real, forward-compatible status with no
  honest partial-duty semantic today; `"not_evaluable"` is reserved for a
  genuinely unknown/unsupported requirement family (defensive only — the
  parser never emits one). `sourceConflict` (a NAMED source person with a
  blocking absence the same date — identity via the personnel-roster join
  in `lib/parsers/potential.ts`, never text similarity) is computed
  INDEPENDENTLY of `status`: a requirement covered by a replacement
  internal performer stays `"covered"` even while carrying a source
  conflict worth the manager's attention — a source conflict never by
  itself downgrades an otherwise-covered requirement to `"missing"`.
- `potentialSourceOwnership.ts` — PR #16's Manager Overview scope
  cleanup. The Potential sheet contains requirements for MANY
  organizational sources (this team's own, plus others like איתן/רוקם/
  מבצעים/סייבר/מ"א/אמל"ח קצה/מנהלה) — `lib/parsers/potential.ts` keeps
  parsing all of them (broad, unchanged), but Manager Overview is
  intentionally scoped to only תקש"ל / תקשאס responsibility.
  `classifyPotentialSourceOwnership(sourceAllocationLabel, personnel)` is
  the single centralized classifier (`team_alias` / `team_person` /
  `external` / `unknown`), checked in this order:
  1. Exact team-alias match, quote-insensitive canonical comparison
     (תקש"ל / תקש״ל / תקשל all canonicalize the same; likewise
     תקשאס-family). No fuzzy matching — only quote characters are
     stripped before comparison.
  2. Exact full personnel-name match (whitespace-normalized) — the
     strongest person evidence, so it is resolved BEFORE the external
     check below (an exact full name is not a coincidental collision).
  3. A known external organizational token as the label's LEADING word
     (איתן/רוקם/מבצעים/סייבר/מא/אמלח/מנהלה) — this makes "איתן מרכז",
     "איתן צפון", "איתן דרום", bare "איתן", and "סייבר החלפה איתן" all
     `external`, even though a real team member's first name happens to
     be איתן. External-label classification always wins over
     short-name/annotated-name PERSON SHORTHAND from this point on
     (`isManagerOwnedPotentialAllocation`'s whole reason for existing).
  4. A unique short first name as the label's leading token (מרטין/איתי/
     גדעון/מארק/טוביה/...) — covers both a bare short name and a
     "name + annotation" label ("מארק - הוקפץ מא", "טוביה - החלפה
     סייבר") since only the LEADING token is ever used to resolve a
     person; no natural-language parsing beyond that. Two personnel
     sharing the same first name never resolve (fails closed, same
     convention as `lib/parsers/potential.ts`'s exact-name resolution).
  5. Otherwise `unknown` — fails closed, excluded from Manager Overview,
     never guessed either way. A source with no current `כ"א` record
     (e.g. "נדב"/"יובל"/"סטיבן") lands here like any other unrecognized
     source — Design Pass PR #21 removed the temporary special-cased
     `team_unresolved_person` ownership state that used to carve out
     נדב/יובל as a known-but-unresolved תקש"ל אתרים responsibility; המחלבה
     no longer claims that responsibility at all. If either name (or
     anyone else) is later added to `כ"א`, steps 2/4 above resolve them as
     an ordinary `team_person` automatically, with no special-casing
     required.
  `isManagerOwnedPotentialAllocation` is `true` for `team_alias`/
  `team_person` only -- a simple boolean convenience for a caller that
  doesn't need enrichment (see below). `parsePotentialSheet`
  and `PotentialAllocation.resolvedSourcePersonId` (exact full-name only,
  used for `sourceConflict`) are both left exactly as they were — this
  classifier does its own independent person resolution rather than
  changing the parser's.

  `scopeManagerPotentialAllocation(allocation, personnel)` is what
  `buildManagerOverviewReadModel.ts` actually calls, once per allocation
  (hardening pass -- classifying the same allocation twice, once via
  `isManagerOwnedPotentialAllocation` and again separately, is exactly
  what this consolidates away). It both scopes AND enriches: `team_alias`
  passes the allocation through unchanged; `team_person` returns a COPY
  with `resolvedSourcePersonId` set to the
  classifier's resolved person id (closing a real gap -- a short/annotated
  person source like "מרטין" or "מארק - הוקפץ מא" would otherwise reach
  `reconcilePotentialAllocations` with `resolvedSourcePersonId: null` from
  the parser and silently lose `sourceConflict` detection, since that
  check reads `resolvedSourcePersonId` only); `external`/`unknown` both
  return `null`. Never mutates its input. `buildManagerOverviewReadModel.ts`
  filters `potentialAllocations` through it BEFORE calling
  `reconcilePotentialAllocations` — an external/unknown source therefore
  never produces a `"missing"` row, never contributes to any manager
  problem/attention count, and never reaches reconciliation at all.
  `/manager/fairness` is a separate person-based
  domain (PR #15) and is NOT scoped by this filter.

## Fairness foundation (PR #48)

The general (future shifts + duties) Fairness foundation. Investigation
first confirmed the existing duty Fairness system (`fairnessTable.ts`/
`fairnessAnalysis.ts`/`fairnessExemptions.ts`/`fairnessPeriod.ts`, PR #15)
is complete and correct for duties — it is left completely untouched here.
These files are the SEPARATE, general primitives a future standalone
Fairness page (`[ משמרות ] [ תורנויות ]`, no combined mode in V1) can build
both modes on top of, deliberately period-SHAPE-agnostic (plain
`periodStartDate`/`periodEndDate` strings, never `FairnessPeriodKey`) so
the same primitives serve the existing h1/h2 duty period and a future
shift-fairness period without collision.

- `personnelType.ts` also now exports `classifyRoleGroup`/
  `FairnessRoleGroupKey` (`"supervisor" | "technician" | "other"`, from
  `isSupervisor`/`isTechnician` capability flags — never a job-title
  string) — co-located with `classifyPersonnelType` for the same reason
  that function lives here: `lib/presentation/roster.ts`'s
  `classifyRegularRole` and this PR's `fairnessGroups.ts` both need the
  EXACT same rule, defined once. Also exports `isShiftCapable` (same
  `isSupervisor`/`isTechnician` flags, boolean form) — the eligibility
  signal for the Manager Area's own shift snapshot section
  (`lib/readModels/shiftSnapshot.ts`), independent of
  `classifyPersonnelType`'s employment-category axis.
- `fairnessFoundation.ts` — the foundation-wide primitives: `FAIRNESS_MODEL_VERSION`
  (for a future stored historical snapshot to trust without recalculating);
  `resolveFairnessPeriodStatus` (`"current"` vs `"closed"`, from a plain
  period end date + `LocalNow` — period-shape-agnostic); `FairnessDataCompleteness`
  (`"complete" | "partial"` + a centralized, evidenced reason enum — the
  model must never manufacture certainty where source data is genuinely
  incomplete, never a placeholder for a hypothetical gap); `isFairnessWeekendDate`/
  `countFairnessWeekendDates` (Thursday-Friday-Saturday, the SAME
  convention already established twice elsewhere — `dutyBlocks.ts`'s
  `weekend_kitchen` Thursday anchor and `calendarMonth.ts`'s
  `isWeekendColumn` — centralized here as the one date-string version, so
  a future weekend metric never re-derives or drifts from either).
- `fairnessParticipation.ts` — participation/eligibility/availability,
  reusing (never re-deriving) `classifyPersonnelType` and
  `ReserveRoleParticipation`:
  - `resolveFairnessParticipationWindow` — permanent/regular ->
    `"full_period"` (this app's existing default ASSUMPTION for these two
    categories, e.g. `lib/presentation/roster.ts`'s roster listing never
    questions whether a קבע/חובה person is "still active"); reserve/
    unclassified -> `"inferred_from_events"` (bounded by actual Event
    evidence in the period) or `"unknown"` (zero evidence). `"full_period"`
    is an ASSUMPTION, not a verified fact, so `dataCompleteness` is
    `"partial"` (`"participation_assumed_full_period"`) for it too — never
    `"complete"` (follow-up fix: the initial version wrongly treated the
    assumption as verified). VERIFIED GAP: כ״א carries NO stored
    join/leave/service-window date for any person — a regular/permanent
    person joining mid-period is therefore NOT distinguishable from one
    present the whole period with today's data; this is reflected honestly
    via `dataCompleteness`, never hidden, and documented with an explicit
    test rather than invented as solved. This is the ONE genuine data gap
    this foundation cannot close without a future stored join/leave date —
    carry it into PR2.
  - `resolveFairnessRoleEligibility` — no capability -> never
    (`"not_capable"`); regular -> always once capable (`"regular_included"`,
    the only category still granted eligibility without evidence); EVERY
    other category (permanent, reserve, AND unclassified) -> capability
    alone is NOT enough, all three need the period's own Fairness-table
    evidence OR a confirmed same-role shift Event within the period
    (`"evidence_confirmed"`/`"evidence_not_found"`). Two follow-up fixes,
    both the same underlying mistake: the initial version copied
    `shiftCoverageRecommendation.ts`'s PR #39 `participatesInRoleRotation`
    rule verbatim, including "permanent (קבע) is never eligible, regardless
    of evidence" AND "unclassified personnelType is never eligible,
    regardless of evidence". Re-checked against the actual domain data:
    nothing in `lib/parsers/event.ts`/`operationalIssues.ts` prevents a
    permanent OR unclassified person from holding a real, confirmed shift
    Event, and `detectCapabilityMismatchIssues` checks capability against
    every person's Event role without regard to personnelType — so BOTH
    blanket exclusions were proven to be a policy specific to that OTHER
    feature's candidate pool (who to proactively page for a last-minute
    gap), never a domain-wide fact. Encoding either into Fairness would
    have wrongly discounted real, evidenced participation just because of
    an unrelated classification. Permanent AND unclassified personnel are
    therefore now evidence-gated exactly like reservists — never
    automatically excluded, but never assumed eligible without evidence
    either (no guessing in either direction). `dataCompleteness` always
    carries `"eligibility_undated"` — VERIFIED GAP: `isTechnician`/
    `isSupervisor` are a CURRENT snapshot only, with no effective-from
    date, so a qualification that became valid partway through the period
    can never be time-sliced today — carry this into PR2 as well.
  - `resolveFairnessShiftOpportunity` — shift-SLOT-level (not merely
    "available days") availability for one (date, period): a blocking
    absence (`BLOCKING_ABSENCE_KINDS`, reused from `operationalIssues.ts`)
    or a full-day/matching-period constraint blocks it; a `"morning"`
    constraint (verified: no canonical day/night shift-slot mapping exists
    anywhere in this codebase today) is never asserted blocked OR
    available — it returns `"unmodeled_constraint"` with `dataCompleteness`
    marked partial instead.
- `fairnessGroups.ts` — comparison groups: "people who can reasonably be
  compared for the same workload". A SEPARATE concept from the existing
  duty-fairness grouping (`lib/presentation/managerFairnessGrouping.ts`'s
  `resolveFairnessAllocationRole`, which classifies the Potential sheet's
  own "הקצאה" text and is left untouched) — a reservist אחמ״ש, or a person
  whose organizational title is ר״צ but who actually works the אחמ״ש
  rotation (`isSupervisor === true`), lands in the SAME `"supervisor"`
  group as every other אחמ״ש; `מילואים`/`ר״צ` stay contextual metadata,
  never a separate fairness group. Follow-up fix: the initial version
  reused `personnelType.ts`'s `classifyRoleGroup` (still
  `"supervisor" | "technician" | "other"`, unchanged, and still what
  `lib/presentation/roster.ts`'s roster hierarchy uses) DIRECTLY for
  Fairness, which forced every non-supervisor/non-technician person into
  one shared `"other"` comparison group — a fabricated comparability claim
  nothing in today's data supports (unlike supervisor/technician, which
  really is one shared rotation each). `resolveFairnessComparisonGroupKey`
  now translates `classifyRoleGroup`'s `"other"` into `null` instead —
  `FairnessComparisonGroup`/`buildFairnessComparisonGroups` cover ONLY
  `"supervisor"`/`"technician"`, and a person who fits neither is simply
  omitted from every group rather than bucketed into an invented one; this
  reuses `classifyRoleGroup`'s existing supervisor-over-technician
  precedence unchanged, it does not invent a new grouping rule.
  `buildFairnessPersonContext` composes one person's group (`null` when
  unassigned) + participation window + per-role eligibility + one combined
  `dataCompleteness` (carrying `"fairness_group_unassigned"` when `group`
  is `null`) — the "read-model primitive" this foundation exists to
  provide, deliberately carrying no score/workload number (future
  shift/duty scoring is explicitly out of scope for this PR).

No read-model/page/caching layer is added yet — every primitive above is
pure `lib/domain`, consumed directly by tests. PR #15's duty Fairness
read-model (`lib/readModels/managerFairness.ts` et al.) and orchestration
conventions (`getRequestX` + `unstable_cache`-backed `lib/sync`) remain the
pattern a future shift/combined Fairness read-model should follow — this
PR does not need to wire that up yet, and nothing here makes it harder to
do so later.

## Shift Fairness engine (PR #2)

`fairnessShiftEngine.ts` — the shift Fairness calculation, built entirely
on the foundation above (`buildFairnessPersonContext` is reused outright
for participation + eligibility, never re-derived). Answers, per person in
one `fairnessGroups.ts` comparison group: how much did they actually work
compared with how much it was reasonable to expect, given their
participation, eligibility, and known availability? Never a team average
and never a 0–100 score.

- **Opportunity-based target.** For every calendar date in the period, this
  treats every (day, night) as ONE canonical shift slot per role (the same
  structural model `lib/domain/shiftCoverage.ts`'s unit-wide coverage
  already assumes — a date always has exactly one day slot and one night
  slot per role, independent of who ends up assigned). A person gets a
  genuine opportunity for slot (date, period) only when ALL THREE hold:
  they're currently eligible for the role's rotation this period
  (`resolveFairnessRoleEligibility`, reused, never re-derived — permanent/
  reserve/unclassified all evidence-gated, exactly like PR #48's own
  eligibility rule); the date falls within their own participation window
  (`resolveFairnessParticipationWindow`, reused — a reservist's bounded
  evidence window genuinely narrows their opportunities, never the full
  period); and `resolveFairnessShiftOpportunity` resolves to `"available"`
  for that exact slot (never `"unmodeled_constraint"` — an unmodeled
  `"morning"` constraint is excluded from opportunities AND never silently
  asserted blocked, only flagged via `dataCompleteness`). A person's
  personal target is their SHARE of the group's total genuine
  opportunities, applied to the group's total ACTUAL shift count:
  `target = totalActual * (personOpportunities / totalOpportunities)` — so
  someone with fewer real opportunities this period (a shorter
  participation window, more constraints) is expected to have done
  proportionally LESS, never an equal split. This describes the CURRENT
  period only — a closed historical period's modelability follows a
  separate, more conservative rule (see the historical qualification audit
  below). "Actual
  shifts performed" is always counted independently of eligibility/
  opportunity (a real confirmed shift is never discarded just because
  today's eligibility evidence doesn't currently prove it) — CONFIRMED only
  (never tentative) and never a shadow ("- צל") assignment, reusing
  `shiftCoverage.ts`'s own "shadow shifts never count as primary coverage"
  convention.
- **Group membership preserves evidence past a changed capability flag
  (follow-up fix).** Comparison-group membership is `resolveFairnessComparisonGroupKey(person)
  === role` (current PRIMARY capability, "MODELABLE") **OR** the person has
  a real confirmed, non-shadow shift for `role` within the period
  (`isRoleComparisonMember`, "evidence-only"). Capability is undated
  (`"eligibility_undated"`) — if it changes, a real shift someone actually
  worked as that role must never simply vanish from the results because
  `people.filter(...)` silently dropped their row. An evidence-only
  member's `opportunityCount` stays `0` — `computePersonShiftFacts` gates
  its opportunity loop on `role` being the person's PRIMARY comparison
  group, NOT merely `resolveFairnessRoleEligibility`'s own capability check
  (which is deliberately role-symmetric and would otherwise happily grant
  real opportunities for either role of a dual-capable person — see the
  dual-capability bullet below for why that distinction matters) — a fix
  for VISIBILITY only, not a reopening of eligibility.
- **Dual-capability rotation precedence is intentional, not a bug (audited
  and clarified).** A dual-capable person (`isSupervisor && isTechnician`)
  has exactly ONE normal rotation — supervisor, the same
  supervisor-over-technician precedence `resolveFairnessComparisonGroupKey`
  already applies everywhere else in the foundation. This was deliberately
  investigated as a possible bug (an early version of this fix tried
  replacing the exclusive classifier with a per-role capability check,
  `hasFairnessRoleCapability`, so a dual-capable person would count as a
  full modelable member of BOTH groups at once) and REJECTED: in normal
  operations someone designated supervisor works supervisor shifts, and an
  occasional technician shift from a supervisor-qualified person is an
  exceptional/emergency case, not evidence they belong to the normal
  technician rotation — treating it as normal would silently grant them
  (and inflate the technician pool's totals with) opportunities nothing in
  the data actually supports. `hasFairnessRoleCapability` (added to
  `fairnessParticipation.ts`, reused inside
  `resolveFairnessRoleEligibility` itself, which was ALREADY correctly
  per-role-independent) stays as a small shared capability-check helper,
  but comparison-group MEMBERSHIP/MODELABILITY in this engine deliberately
  keeps using the EXCLUSIVE `resolveFairnessComparisonGroupKey`. A
  dual-capable person's exceptional cross-role shift is handled by the
  SAME evidence-only mechanism as a changed-capability-flag person above:
  visible `actualShifts`, `null` target/deviation/status, never
  redistributed onto the normal rotation's members.
- **An evidence-only member's real workload is never redistributed onto
  someone else's target (SECOND follow-up fix).** The first version of the
  fix above let an evidence-only member's real `actualShifts` flow into the
  group's shared `totalActual`, which the opportunity-share formula then
  redistributed onto whichever MODELABLE members held real opportunities —
  manufacturing an inflated target for people whose own availability never
  changed, since their historical opportunities can't honestly be
  reconstructed once capability isn't historically dated. `totalActual`/
  `totalOpportunity` (general AND weekend) are now summed over MODELABLE
  members ONLY, and are flagged with the new
  `"shift_target_unmodelable_evidence_only"` completeness reason — distinct
  from the group-level `"shift_target_no_group_opportunities"`, which now
  only ever reflects a genuine anomaly within the MODELABLE pool itself
  (e.g. a data inconsistency: a confirmed shift recorded alongside a
  conflicting absence/constraint the same date, for someone whose current
  capability DOES match the role).
- **An unmodelable target is `null`, never a guessed `0` (THIRD follow-up
  fix).** The second fix above initially still represented an evidence-only
  member's `target`/`weekendTarget` as `0` -- a real, computed target of
  `0` is a DIFFERENT fact from "this target cannot be modeled at all", and
  `deviation = actualShifts - 0` produced a misleading `"above"` status for
  anyone with real evidenced work. `target`/`deviation`/`status` (and their
  weekend counterparts) on `ShiftFairnessPersonResult` are now `number |
  null`/`FairnessShiftStatus | null` — `null` ONLY for an evidence-only
  member, never for a modelable member (whose target of `0` stays a real,
  meaningful `0`, e.g. someone currently capable with zero genuine
  opportunities this period). Same convention `lib/domain/fairnessAnalysis.ts`
  already established for the duty Fairness table's own score delta/gap
  ("a missing previous score is NEVER treated as zero") — reused here, not
  reinvented. `lib/readModels/shiftFairnessTypes.ts`'s
  `ShiftFairnessPersonRowView` mirrors the same nullability.
- **Historical qualification: closed periods model more conservatively than
  the current one (final, corrected conclusion).** PR #48 established that
  `isTechnician`/`isSupervisor` are a CURRENT snapshot only — כ"א carries no
  effective-from date. The current/open period may still use today's
  capability as its modelability basis (unchanged, still approved) — there
  is no "was it true back then" question for a period that hasn't finished
  yet. A CLOSED historical period is different: current capability is NOT
  treated as proof of what a person's rotation actually was during a period
  that's already over — "this is their rotation TODAY" does not establish
  "this WAS their rotation throughout that PAST period", and a single
  confirmed historical shift is real evidence of THAT shift, never proof of
  a whole period's worth of opportunities. `isRoleModelable`
  (`fairnessShiftEngine.ts`) is therefore period-status-aware: for a closed
  period, `target`/`deviation`/`status` (and their weekend counterparts) are
  real numbers ONLY where genuinely period-DATED evidence exists — the
  Fairness sheet's own allocation for THAT specific historical period,
  reused via `reserveParticipation` exactly as PR #48 already established
  it (never a new inference rule, never an invented qualification-effective
  date). Everyone else's real `actualShifts` stays visible regardless, but
  `target`/`deviation`/`status` are `null`, flagged
  `"shift_target_unmodelable_historical"` — distinct from the current
  period's `"shift_target_unmodelable_evidence_only"`, so a future UI can
  explain the two differently. `computeShiftFairnessForGroup`'s
  `periodStatus` parameter defaults to `"current"` (the pre-audit,
  still-approved behavior) so an existing caller that hasn't been updated
  to pass it keeps working unchanged; `buildShiftFairnessReadModel.ts`
  passes its already-resolved `resolveShiftFairnessPeriodStatus` result
  through explicitly.
- **Weekend fairness stays separate.** The exact same opportunity-share
  method is computed a SECOND time, restricted to weekend dates only
  (`isFairnessWeekendDate`, reused from `fairnessFoundation.ts`) — no
  arbitrary weekend weighting (e.g. "weekend shift = 1.7 normal shifts"),
  and no formula that mixes weekend and general workload together. This is
  what makes "weekend imbalance despite a balanced general total" a real,
  distinct, testable signal instead of being averaged away.
- **Balanced tolerance.** `SHIFT_FAIRNESS_BALANCED_TOLERANCE_SHIFTS = 0.5`
  — half of one shift. Shifts are discrete (nobody works a fractional
  shift) while a proportional target is generally fractional, so a real
  distribution can never land closer to its target than the nearest whole
  shift; being off by less than half a shift is the unavoidable rounding
  gap between a fractional fair share and an integer outcome, not a
  meaningful deviation. This is the smallest tolerance defensible from the
  data itself, not an arbitrary smoothing constant — `resolveFairnessShiftStatus`
  applies it inclusively (`±0.5` itself is `"balanced"`).
- **Time behavior.** `resolveShiftFairnessPeriodDates` caps the current
  month at `now.date` (never projecting into the future portion of the
  month); a past month is returned in full; a wholly future month returns
  an empty date list, which `computeShiftFairnessForGroup` handles safely
  (every member: zero actual/target/opportunity, `"balanced"`, and —
  follow-up fix — `dataCompleteness: complete`, not `"shift_target_no_group_opportunities"`;
  see the completeness bullet below for why an empty/idle period is never
  flagged as incomplete). `resolveShiftFairnessPeriodStatus` separately
  reports `"current"`/`"closed"` from the month's own real end date (never
  from the today-capped date list), so a future month still correctly
  reads `"current"`.
- **`"shift_target_no_group_opportunities"` means unallocatable, not
  merely empty (follow-up fix).** This completeness reason (see
  `fairnessFoundation.ts`) is attached ONLY when the MODELABLE pool (or its
  weekend subset) has real actual workload (`totalActual > 0`, computed
  from modelable members only — see the second follow-up fix above) that
  zero MODELABLE opportunities failed to explain — a genuine data anomaly
  even among people whose current capability matches the role (e.g. a
  confirmed shift recorded alongside a conflicting absence/constraint the
  same date). Zero opportunities WITH zero actual work (an idle group/
  subset, or an empty period) is simply nothing to distribute, and is
  never flagged incomplete. An evidence-only member's own unmodelable
  workload is a SEPARATE, per-person fact
  (`"shift_target_unmodelable_evidence_only"`), never this group-level one.
- **Period-shape-agnostic by construction.** `computeShiftFairnessForGroup`
  takes a plain `periodDates: readonly string[]` — the exact same function
  serves a calendar month OR a single week with zero engine changes, only a
  different `periodDates` array. This is what "support the future
  weekly/monthly UI cleanly" means in practice here.
- `lib/readModels/shiftFairnessTypes.ts` / `buildShiftFairnessReadModel.ts`
  — the SEPARATE, parallel shift Fairness read model (safe types, no
  `sourceSheet`/`sourceCell`, personName resolved from `Person`), following
  `buildManagerFairnessReadModel.ts`'s own pure/no-network convention. No
  Google-fetch/auth/caching orchestration layer (`loadXReadModel`,
  `getRequestX`) is added yet — there is no page to serve one, and PR #48's
  existing `loadManagerWorkbookContext`/`getWorkbookSnapshot` conventions
  are what a future page's loader should reuse when it's built.

**Verified limitation carried forward from PR #48, unchanged by this PR:**
no stored join/leave/service-window date exists for any person. This PR's
engine reflects it exactly the way PR #48 already does — a permanent/
regular person's participation window is `"full_period"`, an ASSUMPTION
(`dataCompleteness: "participation_assumed_full_period"`), and a reserve/
unclassified person's window is bounded only by heuristic Event evidence
(`"participation_inferred"`) or unknown entirely (`"participation_unknown"`).
The shift engine does not — and cannot — close this gap; it only ever
reports it honestly through `dataCompleteness`, never silently.

No standalone Fairness page, person cards, historical snapshot persistence,
analytics, or combined shift+duty scoring are added in this PR. Duty
Fairness integration is PR #3, below.

## Duty Fairness integration (PR #3)

Fairness V1 has two INDEPENDENT modes, sharing only the small foundation
primitives above (status vocabulary, period status, model version, data
completeness) — never one combined shape, never a generic
`GenericFairnessEngine<T>`:

1. **Shift Fairness** (PR #2, above) — opportunity-based, month-oriented,
   reconstructed from shift-slot availability, a ±0.5-shift tolerance band.
2. **Duty Fairness** (PR #3, this section) — workbook-score-based, H1/H2-
   oriented, the workbook's own `previousScore`/`currentScore`/comparison
   target/weekend count/exemptions flow through UNCHANGED. No tolerance band
   at all.

This PR is domain/read-model integration ONLY — it does not touch
`/manager/fairness` (still served by the original, untouched
`buildManagerFairnessReadModel.ts`/`managerFairness.ts`), does not add any
UI, and does not recalculate a single duty score. `fairnessTable.ts`/
`fairnessAnalysis.ts`/`fairnessExemptions.ts`/`fairnessPeriod.ts`/
`lib/parsers/fairness.ts` — PR #15's original duty Fairness system — are
preserved exactly; this PR only ADDS a few small primitives alongside them
and a new, parallel read-model boundary that reuses them outright.

- **`currentScore` remains authoritative — no recalculation, ever.** Every
  new value this PR computes (`delta`/`comparisonTarget`/`gapToTarget`/
  `normalizedLoad`/`status`) is analysis ON TOP of the workbook's own
  `previousScore`/`currentScore`, exactly like PR #15 already established.
  No duty scoring formula was rewritten, no shift-opportunity logic was
  applied to duties, and no weighted combined score was introduced.
- **`resolveDutyFairnessStatus` (`fairnessAnalysis.ts`) — exact comparison,
  NO tolerance.** Unlike Shift Fairness's ±0.5-shift tolerance band (which
  exists specifically because a fractional opportunity-share target can
  never be landed on exactly by a discrete shift count), the workbook's
  `currentScore` and `comparisonTarget` are both already-authoritative
  source values, not a reconstructed estimate — so `"balanced"` means
  EXACTLY equal: `currentScore < comparisonTarget` → `"below"`,
  `currentScore === comparisonTarget` → `"balanced"`,
  `currentScore > comparisonTarget` → `"above"`, and `null` whenever either
  side is unavailable (never a fake `"balanced"`, never a target/current of
  `0` standing in for unknown). `DutyFairnessStatus` and Shift Fairness's
  `FairnessShiftStatus` are both aliases of the same shared
  `FairnessStatus` (`fairnessFoundation.ts`) — the three-word vocabulary is
  shared, the computation is not.
- **Grouping is a decided domain rule, using its OWN classifier — never the
  target-eligibility one.** `buildDutyFairnessReadModel.ts`'s
  `resolveDutyFairnessGroupKey` decides which duty population
  (`"supervisor" | "technician" | "other"`) a row belongs to: 'אחמ"ש' AND
  'ר"צ' both belong to `"supervisor"` (reservist/ר״צ personnel are part of
  the אחמ"ש population — the same conclusion `fairnessGroups.ts`'s own
  capability-based Shift Fairness classifier already reaches for a
  ר״צ-titled `isSupervisor === true` person, now made explicit for the duty
  table's own allocation-label text too), "טכנאי" belongs to
  `"technician"`, everything else (e.g. "הסמכה") falls to `"other"`. This
  is DELIBERATELY a separate function from `resolveFairnessAllocationRole`
  (`fairnessAnalysis.ts`, UNCHANGED) — the narrower classifier that decides
  target eligibility, where only 'אחמ"ש'/"טכנאי" carry a deterministic X/2X
  target. Using the SAME function for both would have silently granted
  'ר"צ' a supervisor target it was never proven to have.
- **Grouping and target eligibility are separate facts, never silently
  collapsed — 'ר"צ' is the concrete case that proves why.** A `'ר"צ'`-labeled
  row lands in the `"supervisor"` GROUP with its real score/exemptions/
  weekend count fully visible, but `comparisonTarget`/`gapToTarget`/
  `normalizedLoad`/`status` all stay `null` for it — landing in a group
  never by itself grants a target. `"other"` never receives an invented
  target either.
- **Data completeness — only genuine gaps are flagged, never noise on every
  row.** Two new reasons (`fairnessFoundation.ts`): `"duty_identity_unresolved"`
  (the row's source name didn't resolve to exactly one personnel record —
  the row still fully displays, only the person-id link is missing) and
  `"duty_target_unavailable"` (the row's allocation label DOES resolve to a
  deterministic role, but the period's own X/2X target note is missing/
  malformed, so target/gap/normalizedLoad/status are all unavailable
  despite a known role). Deliberately NOT raised for a row whose allocation
  label has no deterministic role at all — `comparisonTarget: null` there is
  the normal, complete, expected outcome. Duty Fairness does NOT reuse PR
  #48's participation/eligibility completeness reasons
  (`"participation_*"`/`"eligibility_undated"`) — those model a
  RECONSTRUCTED shift-opportunity estimate; Duty Fairness's scores are
  directly sourced, so applying them here would manufacture false
  uncertainty about data that is not actually uncertain.
- **Exemptions stay descriptive.** `resolveFairnessExemptions` is reused
  unchanged — an exemption is preserved on the row, never erases
  `previousScore`/`currentScore`, never forces `currentScore` to `0`, and
  never by itself produces a Fairness status; `status` is always the plain
  `resolveDutyFairnessStatus(currentScore, comparisonTarget)` result.
- **Weekend count stays the workbook's own metric.** `weekendCount` flows
  through untouched from `FairnessPersonRow` — never replaced by, or mixed
  with, Shift Fairness's weekend opportunity calculation, and no weekend
  target/status is invented (no authoritative Duty weekend target exists
  today).
- **Totals stay two separate facts.** `reportedXTotal` (the sheet's own "סך
  הכל:" row) and `displayedXSum` (the independently computed sum of the
  currently parsed rows) are both carried through via the unchanged
  `sumDisplayedFairnessRows` — never compared, never labeled a
  "discrepancy" (PR #15's own hardening pass, reused as-is).
- **Period status via the shared foundation, not a duplicated
  computation.** `fairnessPeriod.ts` gained `fairnessPeriodEndDate`
  (h1 → `YYYY-06-30`, h2 → `YYYY-12-31`, from a `FairnessPeriodIdentity`)
  and `fairnessPeriodIdentityLabel` (the same "1–6/2026" formatting as the
  existing `fairnessPeriodLabel`, but from an already-resolved identity) —
  `buildDutyFairnessReadModel.ts` feeds the computed end date into
  `fairnessFoundation.ts`'s existing, period-shape-agnostic
  `resolveFairnessPeriodStatus`, exactly the same primitive Shift Fairness
  already uses for a calendar month. Duty Fairness itself is NOT converted
  to calendar months — it keeps H1/H2 exactly as `fairnessPeriod.ts`
  already resolves it.
- **Sorting is the existing established order, unchanged.** Lowest
  normalized load first, unavailable-target rows after every modelable row,
  stable tie-break by source name then row key — the SAME rule
  `buildManagerFairnessReadModel.ts`'s `compareFairnessRows` already
  implements, reused (not redesigned) as `compareDutyFairnessRows`. No row
  is ever labeled "מומלץ"/"הבא"/"עדיפות" — Fairness describes state, it
  does not assign the next duty.
- `lib/readModels/dutyFairnessTypes.ts` / `buildDutyFairnessReadModel.ts` —
  the SEPARATE, parallel Duty Fairness read model (presentation-safe: no
  email, no `sourceSheet`/`sourceCell`, no raw Google row; row `key` is
  derived from `personId`+row order, never a raw cell reference), following
  `buildManagerFairnessReadModel.ts`'s pure/no-network convention exactly.
  No Google-fetch/auth/caching orchestration layer is added yet — same as
  Shift Fairness, there is no standalone page to serve one yet (PR #4), and
  this read model deliberately carries no manager-only authorization
  assumption baked into its data so PR #4 can expose it to whichever users
  the future standalone page actually serves.

**`unknown != zero`** applies here exactly as it does throughout PR #48/#2:
a missing previous score is never `0`, a missing target is never `0`, an
unavailable status is never `"balanced"`.

No UI redesign, no standalone `/fairness` route, no removal of
`/manager/fairness` or its components, and no historical snapshot
persistence (PR #5) are added in this PR.
