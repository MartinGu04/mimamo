-- Notification engine: episode-based dedupe for AGGREGATE/SUMMARY
-- notification categories (spec: fix a real production notification-spam
-- incident on the weapon/shooting-range-qualification manager alert --
-- 38 -> 40 -> 44 mismatches produced THREE separate Notification Center
-- entries and THREE pushes instead of one notification that simply
-- updates its own count, with exactly one push for the whole episode).
--
-- `weapon_qualification_summary` (`src/lib/notifications/engine/
-- weaponQualification.ts`) previously kept ONE row per manager PER TICK'S
-- CONTENT: its `dedupe_key` included a hash of the current issue set, so
-- any genuinely new issue appearing while OLDER issues were still open
-- (the common case for a recalculated aggregate -- 38 growing to 40) hashed
-- to a DIFFERENT key and inserted a brand-new `notification_jobs` row,
-- which the worker then pushed. That is a duplicate notification for the
-- SAME underlying logical issue, not a new one.
--
-- The fix is a genuine EPISODE model, reusing the existing durable outbox
-- (`notification_jobs`) rather than a second/parallel table:
--
--  - `dedupe_key` for an aggregate category is now STABLE per (category,
--    recipient) for the LIFETIME of the underlying problem -- e.g.
--    `weapon_qualification_summary:<managerUserId>` -- never re-derived
--    from the current content. One logical issue == one row, forever,
--    exactly the "manager:shooting-range-qualification-mismatch"-style
--    stable identity the spec asks for (kept per-recipient, matching
--    every other dedupe key in this codebase -- see
--    `upsert_pending_reminder_job`'s own migration for the documented
--    Production incident a SHARED-across-recipients key already caused
--    here once).
--  - `resolved_at` (new column, nullable, NULL while an episode is
--    active) marks whether that row's episode is CLOSED. While NULL, the
--    logical issue is still open: a recalculation only ever refreshes
--    the row's own title/body/source_ref content in place -- never a new
--    row, never a re-push (a `pending` row simply picks up the freshest
--    content before its existing delivery; a `completed` row is content-
--    refreshed but never revived to `pending`). Once the issue set is
--    fully empty, the row is marked resolved. The NEXT time the same
--    (category, recipient) key sees a new issue, `resolved_at IS NOT
--    NULL` is the signal that this is a genuinely NEW episode -- reset to
--    `status = 'pending'`, `resolved_at = null`, `attempts = 0`, so it is
--    pushed again, exactly once.
--
-- `upsert_aggregate_notification_job` below is the ONLY writer that opens/
-- refreshes an aggregate episode; `resolve_aggregate_notification_job` is
-- the ONLY writer that closes one. Both are real SQL functions (never a
-- plain PostgREST upsert/update) for the SAME reason
-- `upsert_pending_reminder_job` already is one (see
-- `20260819090000_fix_reminder_job_revival.sql`): a request-level
-- PostgREST filter is not a WHERE guard on an upsert's `ON CONFLICT ...
-- DO UPDATE` action, and here the guard is more than a simple column
-- match anyway -- it is a genuine branch on the EXISTING row's
-- `resolved_at`, decided under a real row lock so two concurrent/retried
-- worker ticks can never both treat the same episode's start as "new" and
-- create two initial pushes for it.
alter table notification_jobs
  add column resolved_at timestamptz;

-- ---------------------------------------------------------------------
-- upsert_aggregate_notification_job -- opens a fresh episode (no existing
-- row for `p_dedupe_key`, or the existing row's episode was already
-- resolved) or refreshes an already-open one's displayed content, per
-- this migration's own doc comment above. Returns TRUE when a fresh
-- episode was (re)opened (the row is now `pending` and will be pushed on
-- the worker's next delivery tick), FALSE when an already-open episode
-- was merely content-refreshed (no delivery-state change at all, so no
-- re-push).
--
-- Race safety: locks the target row with `select ... for update` before
-- deciding, mirroring `advance_notification_baseline`'s own row-locking
-- pattern. For a genuinely brand-new `dedupe_key` (no row to lock yet),
-- the function attempts a plain INSERT and, if it loses a concurrent race
-- to another caller inserting the identical key first (unique_violation
-- on `notification_jobs_dedupe_key_unique`), simply retries the loop --
-- the retry then finds and locks the row the winner just committed, and
-- proceeds exactly like the "existing row" case. So at most ONE caller
-- ever observes "fresh episode" (TRUE) for a given episode start, no
-- matter how many overlapping ticks race to report the same new issue.
-- ---------------------------------------------------------------------
create or replace function public.upsert_aggregate_notification_job(
  p_category text,
  p_recipient_user_id uuid,
  p_title text,
  p_body text,
  p_path text,
  p_tag text,
  p_dedupe_key text,
  p_scheduled_for timestamptz,
  p_source_ref text
)
returns boolean
language plpgsql
as $$
declare
  existing_resolved_at timestamptz;
  found_row boolean;
begin
  loop
    select resolved_at into existing_resolved_at
      from public.notification_jobs
      where dedupe_key = p_dedupe_key
      for update;
    found_row := found;
    exit when found_row;

    begin
      insert into public.notification_jobs
        (category, recipient_user_id, title, body, path, tag, dedupe_key, scheduled_for, source_ref, status, resolved_at)
      values
        (p_category, p_recipient_user_id, p_title, p_body, p_path, p_tag, p_dedupe_key, p_scheduled_for, p_source_ref, 'pending', null);
      return true;
    exception when unique_violation then
      -- Lost the race to a concurrent caller inserting this exact key --
      -- loop back around and lock the row it just committed.
    end;
  end loop;

  if existing_resolved_at is not null then
    -- A previously CLOSED episode -- this is a genuinely new one.
    update public.notification_jobs
      set category = p_category,
          recipient_user_id = p_recipient_user_id,
          title = p_title,
          body = p_body,
          path = p_path,
          tag = p_tag,
          scheduled_for = p_scheduled_for,
          source_ref = p_source_ref,
          status = 'pending',
          attempts = 0,
          claimed_at = null,
          last_error = null,
          resolved_at = null,
          updated_at = now()
      where dedupe_key = p_dedupe_key;
    return true;
  end if;

  -- Still-open episode -- refresh displayed content only. Deliberately
  -- never touches status/scheduled_for/attempts/claimed_at: an already-
  -- delivered ('completed') row must never be revived, and a still-
  -- pending undelivered row keeps its existing schedule, simply picking
  -- up the freshest content before it sends.
  update public.notification_jobs
    set title = p_title,
        body = p_body,
        path = p_path,
        tag = p_tag,
        source_ref = p_source_ref,
        updated_at = now()
    where dedupe_key = p_dedupe_key;
  return false;
end;
$$;

revoke all on function public.upsert_aggregate_notification_job(text, uuid, text, text, text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.upsert_aggregate_notification_job(text, uuid, text, text, text, text, text, timestamptz, text)
  to service_role;

-- ---------------------------------------------------------------------
-- resolve_aggregate_notification_job -- closes the currently open episode
-- for `p_dedupe_key` (sets `resolved_at = now()`) so the next
-- `upsert_aggregate_notification_job` call against the SAME key is
-- treated as a fresh episode. A plain guarded UPDATE (never an upsert),
-- so a real PostgREST-level WHERE filter would in fact be safe here too
-- -- routed through a function anyway for the same "one obvious place to
-- read the exact write semantics" reason `cancelPendingReminderJob`'s own
-- SQL-adjacent sibling functions are. Idempotent: resolving a key with no
-- row yet, or one already resolved, updates zero rows and never throws.
-- ---------------------------------------------------------------------
create or replace function public.resolve_aggregate_notification_job(p_dedupe_key text)
returns void
language sql
as $$
  update public.notification_jobs
    set resolved_at = now(), updated_at = now()
    where dedupe_key = p_dedupe_key and resolved_at is null;
$$;

revoke all on function public.resolve_aggregate_notification_job(text) from public, anon, authenticated;
grant execute on function public.resolve_aggregate_notification_job(text) to service_role;
