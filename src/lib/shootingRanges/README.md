# מטווחים (shooting-range qualification)

## Scope: regular (חובה) or permanent (קבע) personnel who are also אחמ"ש/טכנאי

Product decision: this feature applies ONLY to personnel for whom
`isEligibleForShootingRanges(person)` (`lib/domain/shootingRangeQualification.ts`)
is true -- `classifyPersonnelType(person.personnelType)` is `"regular"` or
`"permanent"` AND `isShiftCapable(person)` (i.e. `isSupervisor || isTechnician`).
Both are the EXISTING canonical classifiers from `lib/domain/personnelType.ts`;
`isEligibleForShootingRanges` composes them and is the ONE place this
feature's eligibility rule is decided -- never a second/ad-hoc inference
from name/role/text, and never duplicated at each call site. Reserve
(מילואים) personnel, and a regular/permanent person who is neither אחמ"ש
nor טכנאי, are all equally out of scope, not merely hidden from the UI --
every server entry point re-checks eligibility itself:

- **Personal loader** (`shootingRangeQualification.ts`): an ineligible
  person gets `{status: "not_applicable"}` before the "מטווחים" sheet is
  even parsed or any app-owned table is read. `person`/`avatarUrl` are
  still carried on that result so the page can still show identity chrome
  and the manager-overview link for an ineligible MANAGER (e.g. a מילואים
  person overseeing eligible personnel is a real case).
- **Manager overview** (`shootingRangeManagerOverview.ts`): the roster is
  filtered to eligible personnel BEFORE building any per-person model --
  everyone else never appears in `rows`, is never counted in `summary`,
  and never appears in `pendingSelfReports`. Name resolution against the
  "מטווחים" sheet (`parseShootingRangesSheet`'s fail-closed ambiguity
  check) still runs against the FULL roster first, so a name ambiguous
  against an ineligible namesake too still fails closed -- filtering
  happens only after resolution, never before it.
- **Self-report submission** (`submitSelfReportShootingRangeAction`):
  re-checks the freshly-resolved caller's own eligibility server-side; an
  ineligible person can never create a self-report even by calling the
  action directly (hiding the UI button is not the enforcement).
- **Planned-range scheduling** (`createPlannedShootingRangeAction`):
  re-validates every submitted person id against a freshly-fetched roster
  AND `isEligibleForShootingRanges(...)` in the same filter -- an
  ineligible id is silently dropped from the scheduled set, exactly like a
  foreign/non-roster id, and therefore never receives a scheduled/reminder
  notification and can never become a target of bulk confirmation either
  (confirmation only ever resolves occurrences that were actually
  created).

**This eligibility scope applies ONLY to the מטווחים feature/UI surfaces
above -- it does NOT apply to the weapon-qualification manager alert.**
See the dedicated section below.

## Weapon-qualification manager alert is activity-driven, never role-scoped

The "דורש טיפול" / notification-worker rule that flags someone assigned to
a weapon-requiring activity (שמירה/עתודה/אוקסיד, `requiresWeaponQualification`
in `lib/domain/shootingRangeQualification.ts`) with an invalid qualification
is a SEPARATE product concern from the מטווחים feature's own UI scope above,
and is deliberately NOT gated by `isEligibleForShootingRanges`:

> If a person is assigned to an event where `requiresWeaponQualification(dutyFamily)`
> is true, their qualification must be evaluated for that event's own date --
> regardless of service category (regular/permanent/reserve) or role
> (supervisor/technician/neither).

`buildWeaponQualificationIndex` (`lib/readModels/shootingRangeQualification.ts`)
therefore builds a `WeaponQualificationInfo` entry for the FULL roster
passed to it, never pre-filtered by eligibility -- both of its callers
(`lib/notifications/engine/weaponQualification.ts`'s `runWeaponQualificationCheck`
and `lib/readModels/managerOverview.ts`'s `loadWeaponQualificationIndex`,
feeding "דורש טיפול") fetch completions for and pass in every roster person,
not just eligible ones. `detectWeaponQualificationIssues`
(`lib/domain/operationalIssues.ts`) itself never knew or needed to know
about eligibility -- it purely looks up `qualificationByPersonId` by the
assigned person's id and evaluates the activity's own date; the fix lives
entirely in what population the index is BUILT from, never in that
detection function.

A person with genuinely no baseline/completion data still gets a real
index entry (`expiryDate: null`), which `classifyQualificationStatus`
resolves to `"none"` -- `detectWeaponQualificationIssues` treats `"none"`
exactly like `"expired"`, so missing qualification data for someone
assigned a weapon-requiring activity is flagged, never silently dropped
because "no map entry exists". A person is absent from the index only as a
genuine data-integrity edge case (not part of the roster snapshot the
index was built from), never because of their role or service category.

The one thing that still overrides this alert per person is the same
`רלוונטיות` sheet exemption the rest of this feature already honors (an
explicit `לא רלוונטי` row) -- a genuine, pre-existing per-person domain
concept, not a new exemption invented for this rule. `isEligibleForShootingRanges`
is untouched by any of this and keeps gating the מטווחים UI/write-path
surfaces listed in the section above exactly as before.

## Source-of-truth precedence

1. The most recent **approved** `shooting_range_completions` row for a
   person (by `performed_on`) -- unconditionally wins over the Google
   Sheet baseline, regardless of dates. A later sheet refresh can never
   revert an app-approved baseline.
2. Otherwise, the person's most recent "מטווחים" Google Sheet row whose
   `תאריך ביצוע מטווח` is today or earlier (parsed by
   `lib/parsers/shootingRanges.ts`, selected by
   `lib/readModels/shootingRangeQualification.ts`'s
   `selectSheetBaselineForPerson`).
3. Otherwise, no qualification data (`baselineDate: null`) -- never a
   fabricated expiry.

Expiry = baseline + 6 **calendar** months
(`lib/domain/shootingRangeQualification.ts`), valid through the end of
that calendar day in Asia/Jerusalem. See that module's own docs for the
month-add/leap-year semantics.

## רלוונטיות / סיבה / הערה -- applicability wins over stale baseline data

The precedence above decides WHAT baseline a person has; `רלוונטיות`
decides WHETHER that baseline is even a live concern for them right now,
and it wins unconditionally. Parsed independently from the completion
date by `lib/parsers/shootingRanges.ts`'s `parseShootingRangeRelevanceSheet`
(a `לא רלוונטי` row carries no completion-date requirement at all -- unlike
`parseShootingRangesSheet`, a blank/malformed `תאריך ביצוע מטווחים` cell
never causes this row to be skipped), and selected per person by
`lib/readModels/shootingRangeQualification.ts`'s `selectRelevanceRecordForPerson`.

- **רלוונטי + a valid completion date** -- the normal baseline/expiry/status
  computation above, unaffected.
- **רלוונטי + no completion date** -- `status: "none"` ("אין מידע כשירות"),
  same as if רלוונטיות didn't exist at all -- this is genuinely missing
  data that may need attention.
- **לא רלוונטי** (with or without a completion date, however recent or
  stale) -- `status: "not_relevant"`, a distinct `QualificationStatus`
  value, never collapsed into `"none"`/`"expired"`/qualified.
  `buildShootingRangeQualificationReadModel` nulls out `baselineDate`/
  `baselineSource`/`expiryDate` entirely in this branch (never left
  populated-but-unused) and carries `notRelevantReason` (the `סיבה / הערה`
  text, optional -- `null` when absent). `history` is untouched either way:
  it is a factual record of what happened, independent of current
  applicability.
- Relevance is inferred **only** from the explicit `רלוונטיות` cell text
  (`"רלוונטי"` / `"לא רלוונטי"`, exact match) -- never from the `סיבה / הערה`
  text, and a blank/unrecognized cell is "no signal" (treated exactly like
  before this feature existed), never guessed as either value.

**Manager summary semantics**: `ManagerShootingRangeSummary.notRelevantCount`
is its own field -- a `not_relevant` row is excluded from
`qualifiedCount`/`notQualifiedCount` both (never silently folded into
either), and `requiresAttention` is unconditionally `false` for it
regardless of a stale baseline or even a past-due planned occurrence.
`ManagerShootingRangeRow` still appears in its correct אחמ"ש/טכנאי role
section -- role/service eligibility (`isEligibleForShootingRanges`) is the
only thing that removes someone from the roster entirely; relevance only
changes how an included row is classified.

**Write path**: a `לא רלוונטי` person can no longer be newly scheduled for
a planned range -- `createPlannedShootingRangeAction` re-fetches the
"מטווחים" sheet and silently drops a `לא רלוונטי` id from the scheduled
set, exactly like a foreign/non-roster id (never a partial-failure error;
see `ShootingRangeManagerPanel`'s own picker roster, which excludes them
up front so a manager can't select someone here only to see the returned
`scheduledCount` come back lower with no explanation). `submitSelfReportShootingRangeAction`
re-checks the CALLER's own relevance the same way and rejects with
`error: "not_relevant"`. Both re-checks are product decisions with the
same posture as the existing `isEligibleForShootingRanges` re-checks
elsewhere in this file -- hiding the UI is never the enforcement.

**Personal page**: an otherwise-eligible person whose own row is
`לא רלוונטי` sees a calm dedicated state ("לא רלוונטי לכשירות מטווח" +
the reason, if present) instead of the countdown/ring/self-report card --
see `app/(app)/shooting-ranges/page.tsx`'s `NotRelevantView`, a sibling to
the existing `NotApplicableView` (which is about role/service scope, not
this person's own sheet data).

## Planned ranges: a deliberate architecture decision

The product spec describes planned ranges as "the schedule/workbook
contains a future shooting-range assignment." Before building this
feature we checked: `lib/domain/event.ts`'s `DutyFamily` has no
shooting-range duty type, and the "משמרות + תורנויות" schedule parser
recognizes no such assignment. There is currently **no real upstream data
source** (sheet or schedule) that represents a future shooting-range
assignment for a person.

Given that, planned ranges are modeled as their own hamachlava-owned concept:
a manager schedules people for a range date directly through this feature
(`createPlannedShootingRangeAction`), which writes rows into
`shooting_range_planned_occurrences`. This table -- not any Google Sheet
column -- is the actual source for "who is scheduled" and "what is pending
manager confirmation" everywhere in this feature.

**Consequence worth knowing:** if the real "מטווחים" sheet tab ever gains
forward-dated rows (people already scheduled for a future range, tracked
manually in the sheet before this feature existed), those rows are
currently invisible to the planned-range UI -- `parseShootingRangesSheet`
only interprets a sheet row's date as a completed baseline candidate
(`selectSheetBaselineForPerson` only ever looks at rows dated today or
earlier). A future-dated sheet row today is neither shown as planned nor
counted as a baseline; it is simply not read for either purpose. If real
forward-scheduling data starts appearing in the sheet, teach
`selectSheetBaselineForPerson`'s caller to also surface those rows as
planned occurrences (read-through, same idea as the baseline itself) --
this is a one-function change, not a redesign.

## Real-world Sheet-data robustness

Two hardening fixes, both proven with regression tests, address a
real-world report of an eligible person with a genuine "מטווחים" row
rendering as "אין מידע כשירות":

- **`lib/parsers/date.ts`'s `parseLocalDate`** now tolerates (and
  discards) a trailing time-of-day component ("29/06/2026 0:00:00",
  "2026-06-29T00:00:00"). Google Sheets' `FORMATTED_STRING` rendering
  includes one whenever a column's cell format is "Date time" rather than
  plain "Date" -- a real, common workbook-authoring inconsistency (a
  column typed as dates can still end up formatted as datetime). Without
  this, every row in an affected column would silently fail to parse.
  Shared by every parser that reads dates, not מטווחים-specific.
- **`lib/parsers/shootingRanges.ts`'s name normalization** now applies
  Unicode NFC composition and strips invisible bidi/formatting marks
  (LTR/RTL marks, bidi embedding/override/isolate controls) and
  non-breaking spaces before comparison, on BOTH the sheet's name text and
  every כ"א personnel name. Real spreadsheet text pasted from different
  sources/apps can carry these completely invisible differences -- a name
  that looks byte-for-byte identical to a human can otherwise fail a
  strict equality check. Still exact-match only: a genuine spelling/
  word-order difference still fails closed to `null`, never fuzzy-matched.

**Diagnostic visibility**: `ShootingRangeManagerReadModel.unresolvedSheetRowCount`
(computed by `shootingRangeManagerOverview.ts` from the raw parsed sheet,
against the FULL roster, independent of the eligibility filter) counts
"מטווחים" rows that still never resolved to exactly one person after the
hardening above. Rendered as a small warning banner in the manager panel
so a real remaining name mismatch is visibly different from "nobody has
data" -- per the identity-matching spec's own principle ("surface
parser/data issues rather than guessing"), never silently indistinguishable
from a genuine no-data case.

## Personal <-> manager navigation

`components/shootingRanges/ViewSwitchLink.tsx` is the ONE shared link
component for the reciprocal "תצוגת מנהל" (on `/shooting-ranges`, manager
only) / "לתצוגה האישית" (on `/shooting-ranges/manager`, always) pair --
same visual treatment on both sides, plain text link, no new primary
action. Authorization for `/shooting-ranges/manager` is unaffected by this
link's presence -- it is still gated entirely server-side by
`loadShootingRangeManagerOverview`'s manager check; the link is just a
convenience, never a boundary.

## Three states, never collapsed

- **Verified / completed**: `shooting_range_completions.status = 'approved'`.
  Only this can update the baseline.
- **Planned**: `shooting_range_planned_occurrences.status = 'planned'`
  with `range_date` still in the future.
- **Pending confirmation**: the same `'planned'` status, but `range_date`
  has passed -- derived purely by date comparison at read time
  (`buildShootingRangeQualificationReadModel`'s `selectPlannedRangeView`),
  never a third stored status.

## Bulk manager confirmation is one atomic database statement

`confirmPlannedShootingRangeAction` does NOT read the planned occurrences,
decide confirm/reject in application code, then issue separate
update/insert calls -- that shape has a real TOCTOU race: two concurrent
confirmations of the same occurrence (a double-click, two manager tabs, a
retried request) could each read the same "still planned" rows and each
independently insert an approved `shooting_range_completions` row, a
genuine duplicate baseline record.

Instead, the whole operation -- transitioning `shooting_range_planned_occurrences`
out of `'planned'` AND inserting the resulting `shooting_range_completions`
rows -- happens inside the single `confirm_shooting_range_occurrences` SQL
function (`supabase/migrations/20260825130000_add_confirm_shooting_range_occurrences_rpc.sql`,
wrapped by `lib/shootingRanges/store.ts`'s `confirmShootingRangeOccurrences`).
Each completion insert is driven by its own update's own `RETURNING` set,
so a concurrent call that loses the race (its `where status = 'planned'`
no longer matches, once the winner has committed) affects zero rows and
therefore creates zero completions -- idempotent and race-safe by
construction, not by an application-side pre-check. This also means a
foreign/stale person id in the confirmed list can never fabricate a
completion: the database itself only ever resolves rows that are
genuinely `'planned'` for that exact date.

Proven against a real PostgreSQL (not just mocked) in
`confirmShootingRangeOccurrencesRpc.integration.test.ts`, including two
genuinely concurrent connections racing over the same occurrence.

## Notifications

All job creation goes through the existing `notification_jobs` outbox
(`lib/notifications/engine/store.ts`) via
`lib/notifications/engine/shootingRanges.ts` -- no second scheduler, no
direct Push call. See that file's own docs, especially the per-manager
`dedupeKey` note on `scheduleManagerConfirmationRequiredJob` (a shared key
across recipients would silently drop all but the last manager's job --
a real incident class this codebase has hit before with
`upsertPendingReminderJob`).
