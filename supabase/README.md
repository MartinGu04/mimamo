# supabase/

SQL migrations for the Supabase project. This repository had no
migrations at all before PR #29 (auth alone needs no custom schema --
just Supabase's own built-in `auth.users`), so this directory and its
conventions are new as of this PR.

## Applying `migrations/20260815120000_create_push_subscriptions.sql`

This has **not** been applied to any live Supabase project by this PR --
there are no real Supabase credentials in this environment. Apply it
yourself, once, against both your Preview/staging and Production Supabase
projects (they are separate databases with separate schemas), using
**one** of:

**Option A -- Supabase Dashboard SQL Editor (no CLI setup required)**
1. Open your Supabase project -> SQL Editor -> New query.
2. Paste the full contents of
   `supabase/migrations/20260815120000_create_push_subscriptions.sql`.
3. Run it.
4. Repeat for every other Supabase project this app talks to (e.g. a
   separate Preview vs. Production project, if you use one).

**Option B -- Supabase CLI, if this project is linked to a Supabase project**
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## What it creates

- `public.push_subscriptions` -- one row per browser/device Web Push
  subscription, RLS-protected so a user can only ever see/delete their
  own rows (`lib/notifications`/`lib/push` never use a service-role key,
  matching this project's existing zero-service-role convention -- see
  `src/lib/supabase/README.md`).
- `public.upsert_push_subscription(...)` -- a `SECURITY DEFINER` RPC, the
  only way a row is created or its ownership reassigned. See the
  migration file's own extensive comments for exactly why this needs
  `SECURITY DEFINER` (the shared-device/account-switch case) and why it
  is still exactly as safe as RLS (`auth.uid()` inside the function still
  resolves from the real caller's session, never a client-supplied
  value).

`src/lib/push/migration.test.ts` is a text-level regression guard on this
file's security-critical shape (RLS enabled, grants restricted to
`authenticated`, no service-role dependency, the cross-user key-match
check) -- it does not execute the SQL, so it can't prove runtime
behavior on its own.

`src/lib/push/upsertPushSubscriptionRpc.integration.test.ts` genuinely
DOES run this migration against a real PostgreSQL -- it creates a
throwaway database, stubs just enough of Supabase's `auth` schema, loads
this file verbatim, and exercises the exact reassignment/idempotency/
anonymous-denied scenarios the RPC is designed to enforce. It probes for
a reachable Postgres at import time and skips itself entirely (never
fails) when none is found, since this repository has no CI-provisioned
database -- see that file's own docstring. Point `TEST_DATABASE_URL` at
any reachable Postgres (a role with `CREATEDB`) to run it; it was run
for real against a local PostgreSQL 16 during this PR's development.

## `migrations/20260815130000_create_notification_engine.sql` (PR #30)

Durable state for the automatic notification worker: baseline/rollover
tracking, normalized semantic facts, debounced pending changes, and the
notification outbox + per-device deliveries. Apply it the same way as
above (Dashboard SQL Editor or `supabase db push`), to every Supabase
project this app talks to, AFTER the push_subscriptions migration
(`notification_deliveries` references `push_subscriptions`).

Unlike the push_subscriptions migration, this ONE migration's three
functions (`advance_notification_baseline`,
`claim_due_pending_notification_changes`, `claim_due_notification_jobs`)
are granted to `service_role` only, not `authenticated` — the worker has
no logged-in user to key `auth.uid()` off, and every one of its five
tables enables RLS with zero policies (default-deny for
anon/authenticated either way). See the migration file's own top comment
for why this is a deliberate, narrowly-scoped exception to the
zero-service-role convention above, and
`src/lib/supabase/serviceRoleClient.ts` for the one Supabase client
allowed to use it.

`src/lib/notifications/engine/migration.test.ts` is this migration's
text-level security-shape guard (same pattern as
`lib/push/migration.test.ts`).
`src/lib/notifications/engine/notificationEngineFunctions.integration.test.ts`
genuinely runs it against a real PostgreSQL, including real concurrent-
connection proofs of the `for update`/`for update skip locked` claiming
behavior — same self-skipping-when-no-database convention as
`upsertPushSubscriptionRpc.integration.test.ts`.

## `migrations/20260820090000_create_calendar_feeds.sql` (personal calendar subscription)

`public.calendar_feeds` -- one row per user with personal calendar sync
enabled (`token` authorizes `GET /calendar/<token>.ics`, see
`src/lib/calendar/README.md`). Apply it the same way as above, to every
Supabase project this app talks to; it has no dependency on either prior
migration and can be applied independently.

Unlike `push_subscriptions`, this table needs no `SECURITY DEFINER` RPC:
there is no shared-device/cross-user reassignment case here (`user_id` is
unique, and every write is already scoped to `auth.uid()`), so plain
RLS-scoped INSERT/UPDATE/DELETE policies are sufficient for the
enable/reset/disable actions (`src/lib/calendar/feedStore.ts`, all run
from the feed owner's own authenticated session). The service-role client
is still used, but only by the ICS route's token -> owner lookup
(`src/lib/calendar/feedOwnerLookup.ts`, the SECOND legitimate
service-role call site alongside the notification worker's own -- see
`src/app/notificationServiceRoleBoundary.test.ts`), since an external
calendar client fetching that URL carries no Supabase session at all.

`src/lib/calendar/migration.test.ts` is this migration's text-level
security-shape guard (same pattern as `lib/push/migration.test.ts`).

## Extending this later

Any future migration goes in this same directory, named
`<timestamp>_<description>.sql`, following the same explicit-RLS,
ownership-derived-from-`auth.uid()`-where-applicable pattern established
here — and the no-service-role convention specifically, unless a new
case has the same genuine no-user-session justification PR #30's worker
does.

## Migration history must match production exactly

Supabase records an applied migration by the **timestamp prefix of its
filename**. A file whose prefix production has never seen is treated as
un-applied and re-run on the next `supabase db push`; a migration
production ran that has no file here is invisible to every contributor
and to every local/test database built from this directory. Both are
"drift", and both have happened:

- `add_aggregate_notification_episode_dedupe` was committed here as
  `20260902130000_…` while production had applied it as
  `20260913214805_…`.
- `20260913214946_harden_aggregate_notification_rpc_search_path` had been
  applied to production but was missing from the repository entirely.

Both are reconciled: the dedupe migration now carries the timestamp
production actually applied, and the hardening migration it was followed
by is present. `src/lib/notifications/engine/aggregateNotificationRpcHardeningMigration.test.ts`
guards the filenames, their ordering, and the absence of duplicate
timestamp prefixes, so the same drift cannot be re-introduced silently.

A third instance followed immediately, from the opposite direction:
`20260921090000_push_reliability_and_device_management.sql` was edited
IN PLACE (to change `touch_push_subscription` from one argument to five)
after production had already applied it. Production would never have
re-run it, so the repository would have expected a five-argument
function that production did not have. It is restored byte-for-byte to
its applied version, and the change lives in
`20260922030413_legacy_push_device_metadata_backfill.sql` instead.

Rules that follow from this:

1. **Never rename or renumber a migration that has been applied
   anywhere.** The filename is the identity.
2. **Never edit an applied migration's contents** — not to fix it, not
   to extend it, not even while the PR that introduced it is still open
   and unmerged. "Unmerged" is not the same as "unapplied": confirm
   against the live database, not against the PR's own description.
   Add a new migration that alters what it created.
3. A migration that only changes a property of an existing object should
   use `ALTER …`, not `CREATE OR REPLACE …`. Re-declaring makes the new
   file a second source of truth for a body it does not own, and a later
   edit to the real definition is then either mirrored by hand or
   silently reverted.
4. **Create new migrations with the CLI** (`npx supabase migration new
   <name>`) rather than inventing a timestamp by hand. It is what keeps
   the ordering honest against a history that already exists remotely.
5. **Changing a function's ARITY needs an explicit `DROP`** first.
   `CREATE OR REPLACE FUNCTION` with a different argument list creates
   an OVERLOAD, and two same-named functions make PostgREST's
   by-argument-name resolution ambiguous ("Could not choose the best
   candidate function"). Dropping also discards the old grants, so the
   new signature must re-establish its own.

### Testing the chain, not just the files

`src/lib/notifications/pushMigrationChain.integration.test.ts` exists
because of rule 2's failure mode specifically. Suites that build a test
database from a hand-picked list of migration files cannot notice an
edit to an already-applied one — they assemble whatever those files
currently say, never the sequence production actually follows. That
suite applies the real ordered history two ways:

- a FRESH database from the complete chain, and
- a database at production's current state, then upgraded with only the
  pending migration,

and asserts both converge on an identical `pg_get_functiondef`. The
per-stage assertions (one-argument heartbeat before the pending
migration, five-argument and no overload after) are what would have
caught the in-place edit.

## `search_path` convention for functions

Functions are declared `set search_path to ''` (an EMPTY search_path).
Only `pg_catalog` is then searched implicitly, so every application
object must be written schema-qualified (`public.notification_jobs`,
`auth.uid()`) and nothing in `extensions` (pgcrypto's `digest`,
`gen_random_bytes`) is reachable at all. `= public` is weaker and is not
used for new functions.

This matters most for `SECURITY DEFINER` functions, where a schema the
caller controls sitting earlier in the path is worth exploiting. Every
`SECURITY DEFINER` function in this schema is pinned this way.

An unqualified reference inside a pinned function fails at **run** time,
not at `CREATE` time, so the text is not self-checking. The two
real-Postgres suites (`notificationEngineFunctions.integration.test.ts`,
`pushReliabilityRpc.integration.test.ts`) apply every migration here in
order and then execute the functions — one of them from a session whose
`search_path` points at a decoy schema containing a same-named table, to
prove the qualification is real.
