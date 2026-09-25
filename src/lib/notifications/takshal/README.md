# lib/notifications/takshal

TAKSHAL CTRL as an **additional** delivery channel for המחלבה notifications
(server-only throughout). TAKSHAL CTRL's notification hub owns a second,
TAKSHAL-branded Web Push subscription on the user's devices; this module
lets the notification worker hand it a notification that the existing
pipeline has already fully built.

```
                                     ┌── existing direct Web Push + inbox   (unchanged, authoritative)
notification_jobs row ── runDelivery ┤
 (recipient, title, body, path)      └── TAKSHAL CTRL hub → Web Push        (optional, fail-open)
```

Nothing here replaces, migrates or alters the direct pipeline: no
subscription, preference, inbox, dedupe, retry, receipt or job-status
behavior changes. `processJob` in `engine/delivery.ts` -- the direct
fan-out -- is untouched; the channel attaches one level up, in
`runDelivery`, after a job's recipient and content are final.

## Modules

- `config.ts` -- the ONLY reader of `TAKSHAL_CTRL_HUB_URL`,
  `TAKSHAL_CTRL_SOURCE_SECRET`, `TAKSHAL_CTRL_TEST_RECIPIENTS` (guarded by
  `boundary.test.ts`). Missing/broken configuration only turns the
  channel off.
- `notification.ts` -- pure mapping of a claimed job to the hub's v1
  request: event id, relative target, hashed tag, text limits.
- `client.ts` -- one bounded HTTP call (3.5 s timeout, no redirects);
  never throws, every outcome is a value.
- `dispatcher.ts` -- per-run scheduling: fire-and-forget queue, at most 4
  requests in flight, circuit breaker after 3 consecutive failures,
  bounded settle (4 s), one sanitized summary log line.
- `../deliveryChannel.ts` -- THE channel decision
  (`resolveNotificationDeliveryChannel`): `direct` / `takshal` / `both`.
- `../engine/takshalChannel.ts` -- wires the above into one worker run.

## Channel decision (`direct` / `takshal` / `both`)

One resolver, one policy interface (`DeliveryChannelPolicy`). This phase's
policy is a temporary server-side rollout allowlist:

| Recipient | Channel |
| --- | --- |
| verified email in `TAKSHAL_CTRL_TEST_RECIPIENTS` | `both` |
| everyone else (and everyone when the list is empty/unset) | `direct` |

A persisted per-user preference replaces the allowlist later by
implementing the same `DeliveryChannelPolicy` -- `runDelivery` already
follows all three plans:

- `direct` -- the existing path, byte-for-byte.
- `both` -- the hub request is queued, then the existing direct path runs
  unchanged. The direct pipeline stays authoritative for job status,
  retries and receipts.
- `takshal` -- (no policy produces it yet) no direct push; the hub's
  answer settles the job through the existing bounded job-level retry
  (`completed` / `skipped` when the user has no TAKSHAL device / left
  `pending` for the next tick / `failed` once `max_attempts` is spent).

The resolver always fails safe toward `direct`: no policy, a policy that
throws or answers nonsense, or a recipient without a verified email all
resolve to `direct` -- a notification is never dropped by this decision.
With the channel unconfigured or nobody allowlisted, `runDelivery` does no
extra work at all (not even an identity lookup).

## Recipient identity

The hub addresses users by **verified email** (both systems sign in with
Google). The address comes from Supabase Auth's own record of the job's
`recipient_user_id` -- `fetchVerifiedEmailsByUserId` in
`engine/recipients.ts`, one bulk Admin API pass per run (bounded by a 3 s
timeout), only addresses with `email_confirmed_at` -- never from the
sheet's `Person.email` and never from anything a browser sent. Normalized
with the engine's single `normalizeEmail` rule. On TAKSHAL CTRL, the
recipient must have opened TAKSHAL CTRL while signed in, which records
their verified email there; until then the hub answers
`no_active_subscription` (not an error).

## Event id -- `job:<notification_jobs.id>`

Stable and deterministic, so the hub pushes each job at most once:

- A `notification_jobs` row is ONE logical notification for ONE recipient,
  created idempotently by `dedupe_key`; every retry, stuck-claim recovery
  and overlapping worker re-claims the SAME id. So the job id already *is*
  "job + recipient identity".
- A `notification_deliveries.id` is deliberately NOT used: those rows
  exist once per DIRECT device (none at all for a user without one), not
  once per recipient.
- Never random: a fresh id per attempt would defeat the hub's dedupe.
- An aggregate episode (e.g. `weapon_qualification_summary`) that
  re-opens reuses its job row, and its direct delivery rows for devices
  that already received it stay `sent`; the hub's dedupe mirrors that
  same "a job reaches each target once" behavior.

## Reliability trade-off

The hub request never sits on the direct critical path. The only addition
to it is one bulk identity lookup per worker run (bounded by 3 s), and only
while someone is on the allowlist:

- It is queued before the job's direct fan-out and runs alongside it
  (bounded concurrency), never before or instead of it.
- Every failure mode -- timeout, network, HTTP error, malformed reply,
  identity lookup failure, missing configuration -- is logged (sanitized)
  and swallowed. Job status, retries and receipts never see it.
- `runDelivery` waits at most ~4 s at the end of a run for requests still
  in flight (so a serverless invocation does not freeze them); after 3
  consecutive failures the rest of the run skips the hub.
- **No separate outbox/retry for the hub.** A hub failure is not
  retried on its own; it gets another chance only when the direct
  pipeline itself retries the job (same event id, deduplicated by the
  hub). So if TAKSHAL CTRL is down while a job's direct delivery
  succeeds, that TAKSHAL notification is lost -- acceptable while TAKSHAL
  CTRL is an additional channel. Before `takshal`-only is offered to
  users this is already covered (that path uses the job-level retry); a
  durable per-job hub outcome would be the next step if `both` ever needs
  guaranteed delivery.

## Logging

`[takshal] …` lines carry an outcome label (`timeout`, `network`,
`http_503`, `invalid_response`), a 6-character event-id tail and counts.
Never the source secret, the recipient email, a push endpoint/key, or
notification text (asserted in the tests).

## Configuration

| Variable | Scope | Value |
| --- | --- | --- |
| `TAKSHAL_CTRL_HUB_URL` | server | hub origin; production `https://takshal-ctrl.vercel.app`. No default. |
| `TAKSHAL_CTRL_SOURCE_SECRET` | **server secret** | same value as TAKSHAL CTRL's `MACHLAVA_SOURCE_SECRET` (`openssl rand -hex 32`) |
| `TAKSHAL_CTRL_TEST_RECIPIENTS` | server | comma-separated verified emails that get `both`; empty = nobody |

None is ever `NEXT_PUBLIC_`; none reaches a client bundle.

## Manual acceptance test (real devices)

Uses the existing targeted manager broadcast (audience "אדם מסוים") --
no fake broadcast, nobody else notified.

1. **TAKSHAL CTRL side.** On the test user's phone: open TAKSHAL CTRL
   (installed Home Screen app), sign in with the test Google account,
   enable notifications, and send its own test push to confirm it arrives.
   Opening the bell panel while signed in records the verified email for
   the hub.
2. **Allowlist.** In the המחלבה Vercel project set
   `TAKSHAL_CTRL_TEST_RECIPIENTS` to ONLY that account's email.
3. **Secret.** Generate one value (`openssl rand -hex 32`) and set it as
   `MACHLAVA_SOURCE_SECRET` in TAKSHAL CTRL and as
   `TAKSHAL_CTRL_SOURCE_SECRET` in המחלבה; set `TAKSHAL_CTRL_HUB_URL` in
   המחלבה.
4. **Deploy** TAKSHAL CTRL (after applying its
   `20260925200000_source_ingress.sql` migration) and המחלבה, in the same
   environment pair (production↔production, or preview↔preview).
5. **Send** from המחלבה (as a manager): מרכז התראות → "עכשיו" → audience
   "אדם מסוים" = the test user only → "שלח התראה".
6. **Confirm** the test user receives:
   - the existing המחלבה notification (direct), and
   - a second one from TAKSHAL CTRL titled `המחלבה · <title>` with the
     המחלבה icon.
   The המחלבה Vercel log shows `[takshal] run requested=1 accepted=1
   devices=N`; the TAKSHAL CTRL log shows `source: machlava event …xxxxxx
   delivered=N`.
7. **Tap** the TAKSHAL notification.
8. **Confirm** it opens TAKSHAL CTRL `/open?app=machlava&target=/` and
   continues to `https://luzly.vercel.app/` (a manager broadcast's own
   destination is `/`; reminders/changes carry theirs, e.g. `/schedule`).
9. **Confirm** nobody else received a TAKSHAL notification: המחלבה logs
   show `requested=` only for runs containing the test user's jobs, and
   TAKSHAL CTRL logs show no other `source: machlava` deliveries.

Rollback at any time: clear `TAKSHAL_CTRL_TEST_RECIPIENTS` (or
`TAKSHAL_CTRL_SOURCE_SECRET`) and redeploy -- delivery is direct-only again
with no other change.
