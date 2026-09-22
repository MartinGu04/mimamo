-- Legacy device metadata backfill.
--
-- Follow-up to `20260921090000_push_reliability_and_device_management.sql`,
-- which is ALREADY APPLIED IN PRODUCTION and must therefore never be
-- edited again -- Supabase records a migration as applied by its
-- timestamp prefix and will never re-run it, so an in-place edit there
-- is invisible to production forever and silently drifts the schema away
-- from the repository. This file exists precisely because that earlier
-- attempt was wrong; everything the follow-up needs from the database
-- lives here instead.
--
-- THE PROBLEM. Every `push_subscriptions` row registered before that
-- migration has NULL `device_type`/`device_platform`/`device_browser`/
-- `device_standalone`, so "המכשירים שלי" can only ever call it "מכשיר".
-- Those rows are repaired progressively and naturally: when that exact
-- installation is opened again, its own heartbeat carries the coarse
-- descriptor the client already computed, and the `coalesce` writes
-- below fill ONLY the columns still missing.
--
-- `coalesce(existing, incoming)` is the whole safety property, and the
-- argument order is load-bearing: a column that already holds a value
-- keeps it, always. A device whose platform was recorded as `windows`
-- but whose browser is NULL gets only the browser filled -- a client can
-- never use the heartbeat to rewrite metadata that is already there,
-- which is what keeps this a repair path rather than a second write API.
--
-- One honest imprecision that follows from first-write-wins: on desktop
-- Chromium an installed PWA and an ordinary tab share one Service Worker
-- registration, and therefore ONE push endpoint and one row. Whichever
-- launch mode heartbeats first is the `device_standalone` that sticks.
-- That is accepted deliberately -- the alternative is letting the
-- heartbeat overwrite stored metadata, which is exactly the property
-- this design refuses to give up for a cosmetic label. Both labels name
-- the same real device either way.
--
-- Piggy-backing on the heartbeat rather than adding a request of its own
-- is deliberate: the heartbeat already fires exactly once per app open
-- (deduplicated and throttled by the single shared `PushDeviceProvider`,
-- see its docstring) and already runs only once the endpoint has been
-- server-verified as this user's active subscription -- which is
-- precisely the precondition a backfill needs. A separate call would
-- have re-introduced the duplicate-status-machine problem that provider
-- exists to prevent.
--
-- EVERYTHING THE HEARTBEAT COULD NEVER DO, IT STILL CANNOT. The
-- `where` clause below is unchanged from the deployed version: it can
-- only ever touch a row that is ALREADY owned by the calling user
-- (`user_id = auth.uid()`, derived server-side, never a parameter) and
-- is NOT revoked. So this function still cannot create a row, reassign
-- ownership, revive a revoked device, clear `revoked_at`, or touch
-- another user's row -- and an unknown, foreign or revoked endpoint
-- stays indistinguishable in the return value (`false`), so it is not
-- an endpoint-existence oracle either. It also leaves `last_received_at`,
-- `endpoint`, `p256dh`, `auth`, `user_id`, `device_ref` and every other
-- column completely untouched.
--
-- `updated_at` is deliberately NOT bumped: the heartbeat's own field is
-- `last_seen_at`, and filling in metadata that was always meant to be
-- there is a repair of the record, not a change to the subscription.
--
-- ROLLOUT ORDER. This changes the function's ARITY, so the schema must
-- be applied BEFORE the app that calls it. In the window between the two
-- (new schema, old app still running) the old bundle's one-argument
-- heartbeat call simply fails -- and a heartbeat already fails quietly
-- by design, costing at most one `last_seen_at` refresh. Nothing about
-- delivery, revocation or the receipt path depends on it.

-- ---------------------------------------------------------------------
-- The deployed one-argument heartbeat, dropped EXPLICITLY.
--
-- `create or replace function` with a different argument list creates an
-- OVERLOAD rather than replacing, and two `touch_push_subscription`
-- functions would make PostgREST's by-argument-name resolution ambiguous
-- -- callers would start getting "Could not choose the best candidate
-- function" instead of a heartbeat. Dropping first is what guarantees
-- exactly one remains.
--
-- `if exists` so this migration is also safe on a database that never
-- received `20260921090000` (a fresh local/test database builds the
-- whole chain in order and does have it; a hypothetical partial one does
-- not). Dropping the function also drops its grants, which is why the
-- new signature re-establishes its own below.
-- ---------------------------------------------------------------------
drop function if exists public.touch_push_subscription(text);

create or replace function public.touch_push_subscription(
  p_endpoint text,
  p_device_type text,
  p_device_platform text,
  p_device_browser text,
  p_device_standalone boolean
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  touched integer;
  v_type text;
  v_platform text;
  v_browser text;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- The SAME closed-enum normalization `upsert_push_subscription_v2`
  -- applies, for the same reason: anything outside these sets becomes
  -- NULL rather than being stored, so a raw User-Agent (or any other
  -- free text) can never reach these columns through this path either.
  -- The CHECK constraints on the table are the second line of defense,
  -- never the first.
  v_type := case when p_device_type in ('phone', 'tablet', 'desktop') then p_device_type else null end;
  v_platform := case
    when p_device_platform in ('ios', 'ipados', 'android', 'windows', 'macos', 'linux', 'other') then p_device_platform
    else null
  end;
  v_browser := case
    when p_device_browser in ('safari', 'chrome', 'edge', 'firefox', 'samsung', 'other') then p_device_browser
    else null
  end;

  update public.push_subscriptions
    set last_seen_at = now(),
        device_type = coalesce(device_type, v_type),
        device_platform = coalesce(device_platform, v_platform),
        device_browser = coalesce(device_browser, v_browser),
        device_standalone = coalesce(device_standalone, p_device_standalone)
    where endpoint = p_endpoint
      and user_id = auth.uid()
      and revoked_at is null;

  get diagnostics touched = row_count;
  return touched > 0;
end;
$$;

-- Re-established for the NEW signature: the drop above took the old
-- function's grants with it. Same posture as every other function in
-- this schema -- revoked from `public` first, then granted only to
-- `authenticated`, never to `anon`.
revoke all on function public.touch_push_subscription(text, text, text, text, boolean) from public;
grant execute on function public.touch_push_subscription(text, text, text, text, boolean) to authenticated;
