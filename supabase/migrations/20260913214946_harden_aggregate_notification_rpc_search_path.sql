-- Pins the search_path of the two aggregate-episode RPCs introduced by
-- `20260913214805_add_aggregate_notification_episode_dedupe.sql`.
--
-- Both were created without a `SET search_path`, which leaves them with a
-- MUTABLE search_path resolved from whatever the calling session happens
-- to have set (Supabase's database linter reports exactly this as
-- `function_search_path_mutable`). Pinning it is the standard hardening
-- for the pattern -- the same reason `upsert_push_subscription` has
-- carried a pin since PR #29's own migration.
--
-- `TO ''` (an EMPTY search_path) rather than `= public`:
--   * Nothing is resolved implicitly at all, so a schema the caller
--     controls can never shadow a referenced object -- not `public`, and
--     not a temp schema, which `= public` still leaves ahead of it in
--     some session configurations.
--   * `pg_catalog` remains implicitly searched regardless, so built-ins
--     (`now()`, `coalesce`, the base types) keep resolving.
--   * Both function bodies already qualify every application object they
--     touch (`public.notification_jobs`), so an empty search_path changes
--     nothing about what they resolve -- only what they COULD have
--     resolved. The `notificationEngineFunctions.integration.test.ts`
--     suite applies every migration in this directory in order and then
--     exercises both functions for real, so that claim is executed, not
--     merely asserted.
--
-- ALTER FUNCTION, deliberately, rather than re-declaring the functions
-- with CREATE OR REPLACE: this changes ONLY the configuration setting and
-- leaves each function's body exactly as the previous migration left it.
-- Re-declaring would make this migration a second, duplicate source of
-- truth for those bodies, and any future edit to the real definition
-- would have to be mirrored here or silently reverted by it.
--
-- Neither function is SECURITY DEFINER (both run as the caller, and both
-- are granted to `service_role` only -- see the previous migration's own
-- REVOKE/GRANT lines), so this is defense in depth rather than a fix for
-- a live privilege-escalation path. The grants are deliberately not
-- restated here; ALTER FUNCTION does not disturb them.

alter function public.upsert_aggregate_notification_job(
  text, uuid, text, text, text, text, text, timestamptz, text
) set search_path to '';

alter function public.resolve_aggregate_notification_job(text) set search_path to '';
