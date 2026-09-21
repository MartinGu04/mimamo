# lib/notifications

Supabase-backed orchestration for Web Push subscriptions (PR #29) --
the equivalent role `lib/sync` plays for the workbook snapshot cache,
but for push subscription persistence. Composes `lib/push` (pure
mechanics, no Supabase) with `lib/supabase` (the generic client
boundary) and `lib/auth` (identity).

- `subscriptionStore.ts` (server-only) -- `upsertPushSubscriptionForCurrentUser`,
  `deletePushSubscriptionForCurrentUser`, `findPushSubscriptionForCurrentUser`.
  Every function derives ownership from the current Supabase session
  (`createSupabaseServerClient()`, RLS-scoped) -- never a client-supplied
  user id. Creation/reassignment always goes through the
  `upsert_push_subscription` RPC (see `supabase/migrations/`), never a
  plain `.insert()`/`.update()`.
- `actions.ts` (`"use server"`) -- the four Server Actions the UI calls:
  `enablePushNotificationsAction`, `disablePushNotificationsAction`,
  `getPushSubscriptionStatusAction`, `sendTestNotificationAction`. Each
  checks `getAuthenticatedIdentity()` first and fails closed for an
  unauthenticated caller, malformed input, or a subscription the caller
  doesn't own -- see each function's own docstring.

`lib/auth/actions.ts`'s `signOutAction` also imports
`deletePushSubscriptionForCurrentUser` directly (not through `actions.ts`)
for best-effort logout cleanup of the current device's subscription --
see that file's own docstring for why cleanup can never block sign-out.

## Push reliability + device management

The reliability upgrade, layered on top of the PR #29 primitives above
rather than beside them. Five connected pieces, all additive:

- **Revocation, not deletion.** `push_subscriptions.revoked_at`/
  `revoked_reason` turn removing a device into a real tombstone. Deleting
  a row was never enough: the device still holds a browser
  `PushSubscription` AND a device-local `"enabled"` preference, so
  `usePushSubscription`'s silent auto-restore simply recreated it on the
  next open. The database refuses a PASSIVE upsert against a revoked row
  (`upsert_push_subscription_v2`'s `p_explicit` gate), so only an
  explicit "הפעל התראות" on that device can bring it back. The original
  four-argument `upsert_push_subscription` still exists and is wired to
  the passive intent, so an old client still open mid-rollout keeps
  working without being able to bypass the gate.
- **Heartbeat.** `touch_push_subscription` is the narrowest write in the
  schema: `last_seen_at` only, only on the caller's own non-revoked row.
  It can never create, reassign, or revive anything. Called once per app
  open, and at most once per 30 minutes of foreground activity -- no
  timer, no polling (`components/pwa/PushDeviceProvider.tsx`).
- **Device management** (`deviceTypes.ts`, `deviceLabel.ts`, plus
  `lib/push/deviceDescriptor.ts`). "המכשירים שלי" receives an opaque
  `deviceRef` handle and coarse enum metadata -- never an endpoint, key,
  row id, or raw User-Agent. Removing ANOTHER device revokes it;
  removing THIS device reuses the existing local disable flow, because
  revoking the row while leaving the browser subscribed and the local
  preference saying "enabled" is exactly the inconsistent state this
  work exists to eliminate.
- **Delivery receipts** (`receiptToken.ts`, `receiptStore.ts`,
  `src/app/internal/notifications/receipt/route.ts`).
  `notification_deliveries.received_at` records that the target Service
  Worker actually received and displayed the push -- strictly stronger
  than `status = 'sent'` (the provider accepted the request) and never a
  read receipt. A receipt also promotes a `failed_transient` delivery to
  terminal `sent`, which is what stops the worker duplicate-sending a
  push the device really did receive.
- **404/410, unchanged in meaning.** A permanently-invalid endpoint still
  leaves the active delivery set immediately -- `getActiveSubscriptionsForUser`
  filters `revoked_at is null` -- but as a tombstone rather than a
  delete, which breaks the 404 -> delete -> silent re-register -> 404
  loop. The revocation reason is what lets the next explicit enable know
  to unsubscribe and create a genuinely new browser subscription instead
  of reusing the dead one.

The one remaining DELETE path is `lib/auth/actions.ts`'s sign-out
cleanup, and it is deliberately scoped to non-revoked rows: signing out
is not a removal (the same user's remembered preference is expected to
restore push on next sign-in), but it must not destroy a tombstone
either.

## Notification preferences -- intended future extension point

This PR only supports a single global on/off per device (no per-category
preferences yet, per its own scope). When a future PR needs per-category
opt-in/out (shift reminders vs. schedule changes vs. team changes vs.
duty reminders vs. duty changes vs. constraints reminders vs. manager
coverage alerts), the natural extension is a `notification_preferences`
column (`jsonb`, defaulting to "all categories on") on
`push_subscriptions` -- or a separate small table if it needs to be
queried/updated independently of the subscription row's own lifecycle.
Whichever shape is chosen, it should NOT require re-subscribing the
browser's `PushSubscription` -- preferences are a pure server-side
filter over which category of payload gets sent to an already-persisted
subscription, decided at send time (in `lib/push`/the future
notification-rules layer), not something the client needs to
renegotiate with the push service.

Do not add this schema prematurely -- it doesn't simplify anything this
PR needs, and the actual shape should be driven by the real categories
the notification-rules PR ends up sending.

## PR #30 -- the automatic notification engine

`engine/` (server-only throughout) is the scheduled worker that turns
Google Sheet operational data into automatic push notifications, sitting
on top of this directory's PR #29 delivery primitives. See
`engine/README.md` for the module layout, and
`src/app/internal/notifications/tick/route.ts` for the secured entry
point Supabase Cron calls every 5 minutes in production.

### PR #79 + minute-level precision follow-up -- manager scheduled broadcasts

A manager can schedule a manual broadcast for a future Asia/Jerusalem
instant instead of sending it immediately. Minute-level dispatch
precision is owned PRIMARILY by a second, much narrower dedicated worker
-- `src/app/internal/notifications/scheduled/route.ts`, driven by
Supabase Cron once a MINUTE -- with the main 5-minute tick above also
still dispatching due schedules as a deliberate fallback, in case the
dedicated worker's manually-configured Cron job is ever missing,
disabled, or broken (see `engine/README.md`'s own section for why
overlapping callers of the same claim are safe). The manager's open
Notification Center ("מרכז התראות", `app/(app)/notifications/page.tsx`)
reflects a background dispatch via lightweight polling, never Realtime/
WebSocket -- "תזמון" renders `components/manager/ManagerScheduledBroadcastsSection.tsx`
directly; "היסטוריה" renders `ManagerRecentBroadcastsSection.tsx`, gated on
an equivalent "is anything currently active?" signal it derives itself
(`components/notifications/NotificationHistorySection.tsx`) since the two
sections are never mounted on the same page anymore (they used to share one
combined Manager Area category, "התחברויות והתראות").

### Fixed / Recurring Notifications Center -- the managed source of truth
for fixed system reminders + manager-created weekly recurring rules

Every EXISTING fixed/system reminder category (tomorrow shift/duty/
logistics-withdrawal, its day-before supervisor variant, the same-day
noon logistics trio, עלמ״ש check-in, and the two weekly constraints
reminders) is now a persisted, manager-visible `notification_rules` row
(`kind = 'system'`) rather than invisible code configuration -- a
manager can see, enable/disable, and retime each one from "📌 התראות
קבועות" (`components/manager/ManagerFixedNotificationsSection.tsx`, rendered
by the standalone Notification Center's own "קבועות" section).
System identity/trigger/audience logic stays entirely protected in
`engine/reminders.ts` -- this table only ever configures WHETHER and
WHEN, never WHO or WHY. A SECOND kind (`kind = 'custom_weekly'`) lets a
manager author their own weekly recurring broadcast (one weekday + local
time, V1) that reuses the existing manager broadcast/batch/job pipeline
for dispatch -- see `engine/ruleConfig.ts` (the typed loader) and
`engine/recurringRuleDispatch.ts` (occurrence resolution + dispatch,
piggybacking on the SAME once-a-minute worker that already dispatches
one-time scheduled broadcasts, never a second cron). `ruleActions.ts`
("use server") is this feature's one manager-gated CRUD surface -- see
`engine/README.md`'s own section for the full worker-integration
picture, and the migration's own doc comment for the schema.
