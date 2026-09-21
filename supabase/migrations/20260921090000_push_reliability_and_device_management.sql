-- Push Reliability + Device Management.
--
-- Strictly ADDITIVE over PR #29's `push_subscriptions` and PR #30's
-- `notification_deliveries` -- no existing migration is edited, no
-- column is dropped or renamed, and every new column is nullable (or
-- backfilled before being made NOT NULL) so an app instance running the
-- PREVIOUS code keeps working unchanged against this schema.
--
-- Four problems this solves, in one schema pass:
--
--  1. REVOCATION (the "silent resurrection" bug). Deleting a
--     `push_subscriptions` row was never enough to stop a device coming
--     back: the device still holds a browser `PushSubscription` AND a
--     device-local `"enabled"` preference, so `usePushSubscription`'s
--     silent auto-restore path recreated the exact same row the next
--     time that device opened. `revoked_at`/`revoked_reason` turn
--     removal into a real tombstone that a passive heartbeat and a
--     silent auto-restore both refuse to clear -- only an EXPLICIT
--     "הפעל התראות" click on that device may (see
--     `upsert_push_subscription_v2`'s `p_explicit`).
--
--  2. DEVICE MANAGEMENT ("המכשירים שלי"). `device_ref` plus four
--     COARSE, non-identifying descriptor columns are everything the UI
--     needs to render `iPhone · המחלבה` / `Chrome · Windows` without
--     ever seeing the endpoint, the encryption keys, the row's own
--     primary key, or a raw User-Agent string. Deliberately NOT a
--     fingerprint: each column is a small closed enum (see the CHECK
--     constraints), so the stored value carries no more entropy than
--     the label it renders. No IP address is stored anywhere.
--
--  3. REAL RECEIPTS. `notification_deliveries.status = 'sent'` only ever
--     meant "the Web Push provider ACCEPTED the request". `received_at`
--     is the genuinely stronger signal: the target Service Worker
--     received the Push payload and successfully reached
--     `showNotification()`. It is NOT "the user saw/read it" -- see
--     `record_notification_delivery_receipt` below.
--
--  4. PER-DEVICE RECEIPT VISIBILITY. `push_subscriptions.last_received_at`
--     is the same fact projected onto the device, so "המכשירים שלי" can
--     show when that installation last actually acknowledged a Push.

-- ---------------------------------------------------------------------
-- push_subscriptions -- new columns
-- ---------------------------------------------------------------------

alter table public.push_subscriptions
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_reason text,
  add column if not exists last_received_at timestamptz,
  add column if not exists device_ref text,
  add column if not exists device_type text,
  add column if not exists device_platform text,
  add column if not exists device_browser text,
  add column if not exists device_standalone boolean;

comment on column public.push_subscriptions.revoked_at is
  'Non-null = this installation is no longer an active delivery target. Set by an explicit remote removal, a device-local disable, or a permanent (404/410) push failure. A heartbeat and a silent auto-restore must NEVER clear it -- only an explicit user enable on that device (upsert_push_subscription_v2 with p_explicit = true).';

comment on column public.push_subscriptions.last_received_at is
  'Last time THIS installation''s Service Worker acknowledged actually receiving and displaying a Push (record_notification_delivery_receipt). Never "the user read it".';

comment on column public.push_subscriptions.device_ref is
  'Opaque per-row handle the device-management UI addresses a device by. Deliberately NOT the row''s primary key and never derived from the endpoint/keys, so no internal identifier is exposed to the client.';

-- `gen_random_uuid()` is core Postgres (13+), unlike pgcrypto's
-- `gen_random_bytes` -- which on a real Supabase project lives in the
-- `extensions` schema and would therefore NOT resolve under a pinned
-- `search_path = public`. This is a fresh random value per row, entirely
-- independent of the row's own `id`.
update public.push_subscriptions
  set device_ref = replace(gen_random_uuid()::text, '-', '')
  where device_ref is null;

alter table public.push_subscriptions
  alter column device_ref set default replace(gen_random_uuid()::text, '-', '');

alter table public.push_subscriptions
  alter column device_ref set not null;

create unique index if not exists push_subscriptions_device_ref_key
  on public.push_subscriptions (device_ref);

-- Active-delivery-target lookups (`getActiveSubscriptionsForUser`,
-- `fetchAllSubscribedUserIds`) all filter `revoked_at is null`, so the
-- index they actually use is the partial one.
create index if not exists push_subscriptions_active_user_idx
  on public.push_subscriptions (user_id)
  where revoked_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'push_subscriptions_revoked_reason_check'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_revoked_reason_check
      check (
        (revoked_at is null and revoked_reason is null)
        or (revoked_at is not null and revoked_reason in ('user_removed', 'self_disabled', 'permanent_push_failure'))
      );
  end if;

  -- Each descriptor column is a small CLOSED enum. An unknown/absent
  -- value is always NULL (legacy rows registered before this migration)
  -- -- never a free-text passthrough, so no raw User-Agent string can
  -- ever land here even if a client tried to send one.
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_device_type_check') then
    alter table public.push_subscriptions
      add constraint push_subscriptions_device_type_check
      check (device_type is null or device_type in ('phone', 'tablet', 'desktop'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_device_platform_check') then
    alter table public.push_subscriptions
      add constraint push_subscriptions_device_platform_check
      check (device_platform is null or device_platform in ('ios', 'ipados', 'android', 'windows', 'macos', 'linux', 'other'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_device_browser_check') then
    alter table public.push_subscriptions
      add constraint push_subscriptions_device_browser_check
      check (device_browser is null or device_browser in ('safari', 'chrome', 'edge', 'firefox', 'samsung', 'other'));
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- notification_deliveries -- new columns
--
-- `receipt_token_hash` is sha256(receipt token), never the token itself.
-- The token is derived server-side, per delivery, and only ever exists
-- in memory and inside that ONE device's encrypted Web Push payload.
-- The table keeps zero RLS policies (RLS default-deny, as established by
-- the PR #30 migration), so this column is unreachable from any browser
-- client; the only way to act on a receipt is
-- `record_notification_delivery_receipt` below.
-- ---------------------------------------------------------------------

alter table public.notification_deliveries
  add column if not exists received_at timestamptz,
  add column if not exists receipt_token_hash text;

comment on column public.notification_deliveries.received_at is
  'The target Service Worker received this exact Push payload and successfully reached showNotification(). STRICTLY stronger than status = ''sent'' (which only means the push provider accepted the request) and STRICTLY weaker than "the user saw/read the notification", which this app does not track.';

create unique index if not exists notification_deliveries_receipt_token_hash_key
  on public.notification_deliveries (receipt_token_hash)
  where receipt_token_hash is not null;

-- ---------------------------------------------------------------------
-- upsert_push_subscription_v2 -- supersedes the PR #29 four-argument
-- `upsert_push_subscription` (which is REDEFINED below as a
-- revocation-safe wrapper rather than dropped, so an old deployed client
-- still mid-rollout keeps working AND still cannot revive a revoked
-- device).
--
-- Everything PR #29's function already guaranteed is preserved verbatim:
-- identity comes from `auth.uid()` (never a client-supplied user id),
-- `search_path` is pinned, the row is locked with `for update` before the
-- ownership decision, a brand-new-endpoint insert race falls through to
-- the same branches, and reassigning an endpoint owned by a DIFFERENT
-- user still requires the supplied p256dh AND auth to match what is
-- already stored (the shared-device/account-switch case), failing closed
-- with one generic message otherwise.
--
-- What is NEW is `p_explicit`, the single most important flag in this
-- migration:
--
--   p_explicit = false  (a PASSIVE call: the silent auto-restore path)
--       Never clears `revoked_at`. A revoked row is left EXACTLY as it
--       is and the call fails closed, so a device whose owner removed it
--       from another device -- or whose endpoint the push service
--       already reported permanently gone (404/410) -- can never come
--       back merely because that device was opened again while its
--       device-local preference still said "enabled".
--
--   p_explicit = true   (the user pressed "הפעל התראות" on THIS device)
--       The one and only path allowed to clear `revoked_at`. This is a
--       deliberate, in-person user action on the device being
--       reactivated, which is exactly the bar the revocation semantics
--       are meant to enforce.
--
-- `p_explicit` can never be inferred, defaulted, or widened server-side:
-- it has no DEFAULT, so every caller must state its intent explicitly.
--
-- The four descriptor arguments are COARSE enum values validated against
-- the same closed sets as the CHECK constraints above; anything else is
-- normalized to NULL/'other' rather than stored, so a client cannot use
-- them as a free-text side channel. They are only ever written on an
-- explicit enable (a passive refresh has no new user intent to record,
-- and a stale descriptor is never worth a write).
-- ---------------------------------------------------------------------
create or replace function public.upsert_push_subscription_v2(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_expiration_time timestamptz,
  p_explicit boolean,
  p_device_type text,
  p_device_platform text,
  p_device_browser text,
  p_device_standalone boolean
)
returns public.push_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.push_subscriptions;
  result public.push_subscriptions;
  v_type text;
  v_platform text;
  v_browser text;
begin
  if auth.uid() is null then
    raise exception 'upsert_push_subscription requires an authenticated user';
  end if;

  if p_explicit is null then
    raise exception 'upsert_push_subscription requires an explicit intent flag';
  end if;

  v_type := case when p_device_type in ('phone', 'tablet', 'desktop') then p_device_type else null end;
  v_platform := case
    when p_device_platform in ('ios', 'ipados', 'android', 'windows', 'macos', 'linux', 'other') then p_device_platform
    else null
  end;
  v_browser := case
    when p_device_browser in ('safari', 'chrome', 'edge', 'firefox', 'samsung', 'other') then p_device_browser
    else null
  end;

  select * into existing from public.push_subscriptions where endpoint = p_endpoint for update;

  if not found then
    begin
      insert into public.push_subscriptions (
        user_id, endpoint, p256dh, auth, expiration_time, last_seen_at,
        device_type, device_platform, device_browser, device_standalone
      )
      values (
        auth.uid(), p_endpoint, p_p256dh, p_auth, p_expiration_time, now(),
        v_type, v_platform, v_browser, p_device_standalone
      )
      returning * into result;
      return result;
    exception when unique_violation then
      -- Lost a race with a concurrent first-time insert for this exact
      -- endpoint -- re-select (now locking the row the other transaction
      -- just committed) and fall through to the branches below.
      select * into existing from public.push_subscriptions where endpoint = p_endpoint for update;
    end;
  end if;

  -- REVOCATION GATE. Evaluated BEFORE any ownership branch, so it
  -- applies identically to "my own revoked device" and to a revoked row
  -- being legitimately reassigned on a shared device. A passive caller
  -- never gets past here; nothing is written at all, so `last_seen_at`
  -- itself cannot be used to keep a tombstone looking fresh.
  if existing.revoked_at is not null and not p_explicit then
    raise exception 'push subscription is revoked on this device';
  end if;

  if existing.user_id = auth.uid() then
    -- Idempotent refresh for the caller's own endpoint. `revoked_at`/
    -- `revoked_reason` are cleared only on an explicit enable (and, by
    -- the gate above, this branch is only reachable at all for a revoked
    -- row when `p_explicit` is true).
    update public.push_subscriptions
      set p256dh = p_p256dh,
          auth = p_auth,
          expiration_time = p_expiration_time,
          updated_at = now(),
          last_seen_at = now(),
          revoked_at = case when p_explicit then null else revoked_at end,
          revoked_reason = case when p_explicit then null else revoked_reason end,
          device_type = case when p_explicit then v_type else device_type end,
          device_platform = case when p_explicit then v_platform else device_platform end,
          device_browser = case when p_explicit then v_browser else device_browser end,
          device_standalone = case when p_explicit then p_device_standalone else device_standalone end
      where id = existing.id
      returning * into result;
    return result;
  end if;

  if existing.p256dh = p_p256dh and existing.auth = p_auth then
    -- Genuine shared-device/account-switch reassignment: the caller has
    -- proven possession of the same physical browser subscription. The
    -- new owner starts from a clean, non-revoked state (the previous
    -- owner's revocation was about THEIR account, not this browser), but
    -- only ever via an explicit enable -- the gate above already
    -- rejected the passive case.
    update public.push_subscriptions
      set user_id = auth.uid(),
          expiration_time = p_expiration_time,
          updated_at = now(),
          last_seen_at = now(),
          revoked_at = case when p_explicit then null else revoked_at end,
          revoked_reason = case when p_explicit then null else revoked_reason end,
          device_type = case when p_explicit then v_type else device_type end,
          device_platform = case when p_explicit then v_platform else device_platform end,
          device_browser = case when p_explicit then v_browser else device_browser end,
          device_standalone = case when p_explicit then p_device_standalone else device_standalone end,
          -- Receipt history belongs to the PREVIOUS owner's deliveries,
          -- never to whoever the device is handed to next.
          last_received_at = null
      where id = existing.id
      returning * into result;
    return result;
  end if;

  -- Keys DO NOT match: fail closed. Deliberately generic -- never
  -- confirms the endpoint's existence, its current owner, or any stored
  -- value to the caller.
  raise exception 'push subscription could not be registered';
end;
$$;

revoke all on function public.upsert_push_subscription_v2(text, text, text, timestamptz, boolean, text, text, text, boolean) from public;
grant execute on function public.upsert_push_subscription_v2(text, text, text, timestamptz, boolean, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- upsert_push_subscription (PR #29's original four-argument signature)
-- -- REDEFINED, not dropped, purely for rollout safety.
--
-- During a deploy window the new schema is live before every client has
-- the new code, and an already-open tab keeps running the OLD bundle for
-- as long as the user leaves it open. That old bundle calls THIS
-- signature, and it cannot distinguish an explicit enable from its own
-- silent auto-restore -- so the only safe answer is to treat every call
-- through this entry point as PASSIVE (`p_explicit := false`). An old
-- client therefore keeps working exactly as before for an ordinary
-- active subscription, and simply fails (surfacing as "couldn't enable")
-- against a revoked one, rather than silently reviving a device the user
-- removed.
--
-- Note this is deliberately a HARD failure, not a quiet no-op returning
-- the revoked row: a quiet success would make an old client report
-- "סטטוס: פעיל" for a device the server will never deliver to.
-- ---------------------------------------------------------------------
create or replace function public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_expiration_time timestamptz
)
returns public.push_subscriptions
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.push_subscriptions;
begin
  -- Deliberately plpgsql rather than a one-line SQL body: `select (f()).*`
  -- would re-evaluate `f()` once per output column (running the whole
  -- upsert nine times), and a bare `select f()` returning a composite is
  -- not a portable way to satisfy a composite RETURNS clause.
  result := public.upsert_push_subscription_v2(
    p_endpoint, p_p256dh, p_auth, p_expiration_time,
    false, null, null, null, null
  );
  return result;
end;
$$;

revoke all on function public.upsert_push_subscription(text, text, text, timestamptz) from public;
grant execute on function public.upsert_push_subscription(text, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- touch_push_subscription -- the subscription heartbeat.
--
-- Turns `last_seen_at` into a real "this installation was actually
-- opened and is still holding this exact subscription" signal, instead
-- of only ever being a side effect of registration.
--
-- Deliberately the narrowest possible write in this schema. It can ONLY
-- bump `last_seen_at`, ONLY on a row that is ALREADY owned by the
-- calling user (`user_id = auth.uid()`, derived server-side), and ONLY
-- while that row is not revoked. It therefore can never create a row,
-- never reassign ownership, never revive a revoked device, and never
-- touch another user's row -- an unknown or foreign endpoint is
-- indistinguishable from a revoked one in the return value (`false`),
-- so it is not an endpoint-existence oracle either.
--
-- SECURITY DEFINER because `push_subscriptions` deliberately grants
-- `authenticated` no UPDATE policy at all (see the PR #29 migration):
-- every write goes through a narrow, auditable function instead.
-- ---------------------------------------------------------------------
create or replace function public.touch_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  update public.push_subscriptions
    set last_seen_at = now()
    where endpoint = p_endpoint
      and user_id = auth.uid()
      and revoked_at is null;

  get diagnostics touched = row_count;
  return touched > 0;
end;
$$;

revoke all on function public.touch_push_subscription(text) from public;
grant execute on function public.touch_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------
-- revoke_push_subscription -- "הסר מכשיר" / "כבה התראות".
--
-- Addressed by `device_ref` (the opaque handle the UI holds), never by
-- endpoint or row id, and scoped to `user_id = auth.uid()` derived
-- server-side -- so a caller can only ever revoke one of their OWN
-- devices, and a `device_ref` belonging to someone else is
-- indistinguishable from one that does not exist (`false`).
--
-- Revoking, rather than deleting, is the whole point: the row survives
-- as a tombstone that blocks the silent auto-restore path, and the
-- device's `notification_deliveries` history (which cascades on delete)
-- survives with it. Re-revoking an already-revoked device is a no-op
-- that reports `true` -- the caller asked for a state that already
-- holds.
-- ---------------------------------------------------------------------
create or replace function public.revoke_push_subscription(
  p_device_ref text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  touched integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- A caller never gets to invent a reason string: anything outside the
  -- three known reasons collapses to 'user_removed', so this column can
  -- never become a free-text side channel. The reason is descriptive
  -- metadata about the caller's OWN device (it only ever changes what
  -- that device's next explicit enable does locally -- see
  -- `endpointDead` in `getPushSubscriptionStatusAction`), never an
  -- authorization input, so there is nothing to gain by claiming one
  -- reason over another.
  v_reason := case
    when p_reason in ('self_disabled', 'permanent_push_failure') then p_reason
    else 'user_removed'
  end;

  update public.push_subscriptions
    set revoked_at = coalesce(revoked_at, now()),
        revoked_reason = coalesce(revoked_reason, v_reason),
        updated_at = now()
    where device_ref = p_device_ref
      and user_id = auth.uid();

  get diagnostics touched = row_count;
  return touched > 0;
end;
$$;

revoke all on function public.revoke_push_subscription(text, text) from public;
grant execute on function public.revoke_push_subscription(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- record_notification_delivery_receipt -- the Service Worker's ACK.
--
-- WHAT A RECEIPT MEANS, precisely: the target Service Worker received
-- this exact Push payload and successfully reached the
-- notification-display step. It does NOT mean the user saw, read, or
-- opened anything.
--
-- The ACK has to work while the PWA is closed and no page exists, so it
-- cannot ride on a Supabase session. It is instead authorized by a
-- single-purpose bearer credential: a high-entropy receipt token derived
-- server-side per delivery, placed ONLY in that one device's encrypted
-- Web Push payload. This function is handed `sha256(token)` (computed by
-- the same-origin receipt route from the token the Service Worker
-- presents), and matches it against the stored verifier.
--
-- Why this is safe to expose to `anon`:
--   * It takes a token verifier and NOTHING else -- no delivery id, no
--     user id, no device id -- so a caller cannot address a delivery it
--     does not already hold the token for. Supplying a `delivery_id` is
--     never sufficient (and never even possible).
--   * `returns void`. Valid token, already-acknowledged token, and
--     complete nonsense are all indistinguishable to the caller, so this
--     is not an oracle for whether a delivery, user, or device exists.
--   * It can write exactly three facts (`received_at`, a status
--     promotion, and the owning device's `last_received_at`) about
--     exactly the ONE delivery that token identifies -- it is not, and
--     cannot be widened into, a general delivery-update API.
--   * It is idempotent: `received_at` is pinned with `coalesce` to the
--     FIRST acknowledgement, so a repeated ACK (Push retried by the
--     provider, Service Worker replay) changes nothing.
--
-- The status promotion is what closes the transient-send race: the
-- server may have recorded `failed_transient` for a send the device
-- actually received. A genuine receipt is stronger evidence than the
-- HTTP outcome, so the delivery becomes terminal ('sent') and the
-- worker's existing "terminal states are never retried" rule stops it
-- being sent twice. A `failed_permanent` delivery is deliberately left
-- at its own terminal status (its subscription has already been revoked
-- for a 404/410); only `received_at` is recorded for it.
-- ---------------------------------------------------------------------
create or replace function public.record_notification_delivery_receipt(p_token_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription_id uuid;
begin
  if p_token_hash is null or p_token_hash = '' then
    return;
  end if;

  update public.notification_deliveries
    set received_at = coalesce(received_at, now()),
        status = case when status = 'failed_permanent' then status else 'sent' end,
        updated_at = now()
    where receipt_token_hash = p_token_hash
    returning push_subscription_id into v_subscription_id;

  if v_subscription_id is null then
    return;
  end if;

  update public.push_subscriptions
    set last_received_at = now()
    where id = v_subscription_id
      and (last_received_at is null or last_received_at < now());
end;
$$;

revoke all on function public.record_notification_delivery_receipt(text) from public;
grant execute on function public.record_notification_delivery_receipt(text) to anon;
grant execute on function public.record_notification_delivery_receipt(text) to authenticated;
