# lib/notifications/engine

PR #30's automatic notification engine. Turns a fresh Google Sheet read
into push notifications through PR #29's delivery pipeline
(`lib/push`/`lib/notifications`), driven by Supabase Cron calling
`POST /internal/notifications/tick` every 5 minutes in production. See
`AGENTS.md`/the PR description for the full product spec this
implements; this file is the module map.

## Read / normalize / diff (pure or near-pure)

- `freshRead.ts` (server-only) -- the worker's fresh, uncached read path:
  `fetchRawWorkbookSnapshot` directly, never `lib/sync`'s 30-second
  navigation cache. Mirrors `loadPersonalScheduleReadModel`'s parse
  orchestration (personnel -> settings -> schedule -> events).
  `fetchFreshPersonnelRead()` is the same fresh path narrowed to
  personnel ONLY -- `scheduledWorker.ts`'s own dedicated read, never a
  second personnel-parsing model.
- `semanticFacts.ts` (pure) -- normalizes a week's Events into small
  JSON-serializable facts (shift/team/duty/coverage), reusing real domain
  functions (`buildShiftRoster`, `analyzeUnitShiftCoverage`) rather than
  re-deriving coverage/roster logic.
- `diffFacts.ts` (pure) -- structural diff between two fact maps. A
  change only exists when the normalized VALUE differs -- this is what
  makes it semantic diffing, not raw cell diffing.
- `copy.ts` (pure) -- Hebrew title/body/path/tag per settled change,
  reusing `lib/presentation/labels.ts`/`hebrewDate.ts` for existing
  Hebrew naming. Falls back to a concise generic message rather than
  inventing details it can't safely express.
- `logisticsWithdrawal.ts` (pure) -- detects a logistics-withdrawal
  (משיכות מהלוגיסטיקה) assignment from the ALREADY-parsed `Event` stream.
  There is no dedicated Sheet column/parser for this -- `lib/parsers/event.ts`'s
  classifier already lets unrecognized cell text fall through to
  `category: "other"` with the text preserved verbatim, and that's what
  a "משיכות" cell produces today. This module is a keyword filter over
  that existing output, nothing more -- see its own docstring.
- `logisticsCoordination.ts` (pure) -- team-coordination logic ON TOP of
  the detection above: who is the relevant אחמ"ש for the 13:00–14:00
  withdrawal window (structural, via `resolveEventShiftInterval` +
  `clipInterval` over Schedule Events -- never `Person.isSupervisor`
  alone), which technicians are eligible to help (present for the window,
  `isTechnician`, no same-date absence, no אילוץ יום), and the
  singular/plural Hebrew copy for a multi-assignee date. Never reads
  Potential H1/H2; never a second shift-time engine.

## Server-only orchestration

- `serviceClient.ts` -- the ONE call site for
  `createSupabaseServiceRoleClient` (see
  `src/lib/supabase/serviceRoleClient.ts` and the boundary guard at
  `src/app/notificationServiceRoleBoundary.test.ts`).
- `recipients.ts` -- maps כ"א `Person.email` to a Supabase auth user id
  via the Admin API. Fails closed on an ambiguous/unmapped email --
  never targets by display-name.
- `store.ts` -- the only module that talks to the five
  `notification_*`/`observed_notification_facts`/`pending_notification_changes`
  tables (see the migration). Owns the JSONB "absent value" sentinel
  encoding and the debounce reconciliation logic in
  `applyPendingChanges` -- see that function's own docstring for the
  "evening -> morning -> evening" orphaned-revert case it specifically
  handles.
- `changeDetection.ts` -- baseline init/rollover (silent, spec section
  9), diff, debounce settle, and manager-only coverage-gap gating.
- `ruleConfig.ts` -- the Fixed / Recurring Notifications Center's typed
  read boundary. `loadNotificationRuleConfig()` loads every active
  `notification_rules` row ONCE per worker tick and shapes it into
  `NotificationRuleConfig` (a `SystemRuleKey`-keyed map of system rules'
  own enabled/local-time config, plus the list of active custom weekly
  rules) -- never queried per reminder/person. Throws on failure rather
  than silently falling back to a hardcoded default; see `pipeline.ts`/
  `scheduledWorker.ts` for how each worker isolates that failure.
- `recurringRuleDispatch.ts` -- manager-created weekly recurring rules
  (`kind = 'custom_weekly'`, V1: one weekday + one local time per rule).
  `findDueCustomWeeklyOccurrences` is a cheap, read-only due-check
  (today's weekday/time match, not already dispatched); `runDueCustomWeeklyRuleDispatch`
  resolves the audience FRESH against the CURRENT roster on every
  occurrence (never a frozen one-time-broadcast-style snapshot) and
  dispatches through the EXACT SAME `manager_notification_batches`/
  `notification_jobs` pipeline `manualBroadcast.ts`/`scheduledBroadcast.ts`
  already use -- never a second delivery mechanism. Occurrence identity
  (and therefore at-most-once dispatch, safe under overlapping workers)
  is the batch's own `idempotency_key = "recurring:<ruleId>:<localDate>"`,
  reusing the SAME idempotent-insert + idempotent-job-creation machinery
  every other manager broadcast already relies on -- no separate
  occurrence table. Piggybacks on the SAME once-a-minute worker that
  already dispatches one-time scheduled broadcasts (`scheduledWorker.ts`),
  never a second cron; `pipeline.ts`'s 5-minute tick is the same kind of
  deliberate fallback it already is for scheduled broadcasts.
- `reminders.ts` -- tomorrow shift/duty/logistics-withdrawal reminders
  (cross week boundaries, upsert-or-cancel semantics -- a moved
  assignment cancels the old recipient's job and creates the new
  recipient's, since dedupe_key includes the resolved user id) and
  weekly constraints reminders (Sunday/Monday only, recipient source is
  every CURRENTLY-ROSTERED person who is NOT
  `classifyPersonnelType(...) === "permanent"`, mapped to a real auth
  user id via `resolveNonPermanentConstraintsRecipients` -- permanent
  (קבע) staff never receive either constraints reminder; an account that
  can't be proven non-permanent is excluded, never accidentally
  included). Every one of these ten categories' enabled/disabled state
  and local send time now comes from `ruleConfig.ts`'s
  `NotificationRuleConfig` (the Fixed Notifications Center's own managed
  configuration, loaded once per tick and passed in as `RemindersInput.ruleConfig`)
  -- never a hardcoded constant; a disabled rule upserts zero jobs this
  tick, which lets the SAME upsert-or-cancel-by-prefix sweep below
  cancel its own already-pending job. Also
  the logistics-withdrawal team-coordination reminders built
  on `logisticsCoordination.ts`: a day-before (20:00) supervisor
  notification (informed of the assignee, or an anti-spam-only warning
  if still unassigned -- never a technician-wide push that evening), and
  a same-day (12:00) trio -- the assigned technician's personal reminder,
  a supervisor warning ONLY if still unassigned, and a consolidated
  teammate notification (excludes the assignee and any supervisor
  recipient, per the "one push per purpose" precedence rule). Every one
  of these categories reuses the SAME upsert-or-cancel-by-prefix model as
  the shift/duty reminders -- every tick recomputes fresh from the
  current Schedule truth, so a reassignment, a newly-proven/lost
  supervisor, or a technician's eligibility change all resolve correctly
  before the job is ever delivered. The עלמ״ש check-in reminder
  (`almash_check_in`, שמירה/עתודה/אוקסיד only) is the same same-day model
  again, built directly on `lib/domain/dutyBlocks.ts`/`dutyActions.ts`
  (never a re-derivation of check-in dates from `Event`s) -- 12:45 on a
  weekday/Friday, or the real astronomical מוצ״ש for that Saturday
  (`lib/time/motzashShabbat.ts`) when the check-in date is a Saturday.
  See `reminders.ts`'s own `runAlmashCheckInReminders` docstring.
- `delivery.ts` -- claims due outbox jobs, fans out to every active
  subscription per recipient, reuses PR #29's `sendPush` classification
  (permanent 404/410 -> delete subscription; transient -> never delete,
  bounded retry via the job's own `attempts`/`max_attempts`).
- `pipeline.ts` -- the top-level orchestrator
  (`runNotificationWorkerTick(mode)`). `mode: "dry_run"` computes the
  same summary shape while skipping every mutating store call and the
  entire delivery phase; `mode: "send"` is the real path. Loads
  `ruleConfig.ts`'s rule config and runs `reminders.ts` inside their own
  isolated try/catch -- a rule-config/reminders failure never blocks
  scheduled-broadcast or recurring-rule dispatch/delivery below in the
  SAME tick. Also runs manager scheduled-broadcast dispatch AND custom
  weekly recurring rule dispatch as FALLBACKs -- see below.
- `scheduledWorker.ts` -- the minute-level-precision follow-up's own
  orchestrator (`runScheduledBroadcastWorkerTick()`), driving
  `POST /internal/notifications/scheduled`, Supabase Cron's once-a-minute
  job. Has THREE jobs: dispatching due scheduled broadcasts, dispatching
  due custom weekly recurring rules (`recurringRuleDispatch.ts` -- the
  Fixed Notifications Center's own manager-created rules, reusing this
  SAME minute worker rather than a second cron), AND acting as the
  <=1-minute fallback for any already-due `notification_job` that
  wasn't picked up yet (chiefly a manual "Send Now" broadcast whose own
  best-effort immediate `after()` delivery kick -- see
  `manualBroadcastActions.ts` -- never ran or failed). A cheap Supabase
  pre-check first, considering ALL THREE kinds of work in parallel
  (`peekAnyManagerScheduledBroadcastWorkDue`, `peekDueJobsCount`, and a
  rule-config load + `findDueCustomWeeklyOccurrences`, the last pair
  isolated in its own try/catch so a rule-config failure can never take
  down this worker's scheduled-broadcast/due-job responsibilities) -- on
  a genuinely quiet minute (all three empty) this returns immediately
  with NO Google/workbook read, no dispatch, no delivery at all. When
  there are due jobs but no due/recoverable scheduled broadcast or
  recurring occurrence, it skips the personnel read and dispatch
  entirely and calls `runDelivery()` directly. Only when a due/
  recoverable scheduled broadcast or recurring occurrence exists does it
  do a personnel-ONLY fresh read (`freshRead.ts`'s
  `fetchFreshPersonnelRead`), then the EXACT SAME
  `runDueScheduledBroadcastDispatch`/`dispatchScheduledBroadcast`
  (`scheduledBroadcast.ts`) PR #79 built and/or `runDueCustomWeeklyRuleDispatch`
  (`recurringRuleDispatch.ts`), then `runDelivery()` in the SAME
  invocation so a freshly-dispatched job doesn't wait for a separate
  delivery pass. This is the PRIMARY, minute-precision owner of
  scheduled-broadcast dispatch, custom weekly recurring rule dispatch,
  AND the primary <=1-minute fallback for stranded due jobs;
  `pipeline.ts`'s main 5-minute tick ALSO still calls
  `runDueScheduledBroadcastDispatch`/`runDueCustomWeeklyRuleDispatch`/
  `runDelivery()`, as a deliberate final fallback in case this worker's
  manually-configured Cron job is ever missing, disabled, or broken --
  independently-scheduled callers of the same claim functions are safe
  by construction (see `runDueScheduledBroadcastDispatch`'s own doc
  comment: it claims and
  dispatches ONE row at a time, so `claim_due_manager_scheduled_broadcasts`'s
  uniform `claimed_at`-vs-90-second-lease eligibility is always what a
  row's lease is actually measured against, never a stale bulk-claim
  timestamp). Calling `runDelivery()` from this worker, the main tick,
  AND a manual broadcast's own `after()` kick is likewise safe by
  construction (`for update skip locked` claiming + per-device terminal
  delivery states, see `delivery.ts`) -- the only effect is an
  already-due job of any category delivering somewhat sooner.

## Concurrency

Every mutating operation is safe under overlapping worker invocations
via database-level claiming/locking (`for update` / `for update skip
locked` in the migration's three functions), never an in-memory/
module-level lock. See
`notificationEngineFunctions.integration.test.ts` for real-Postgres
proof of the concurrency guarantees, and `migration.test.ts` for the
text-level security-shape guard (mirrors `lib/push/migration.test.ts`'s
pattern).
