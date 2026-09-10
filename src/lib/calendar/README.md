# lib/calendar

Personal ICS calendar subscription feed -- each user can enable a private,
token-gated feed of their own shifts/duties/absences that Google/Apple
Calendar (or any ICS-subscription-capable app) polls on its own schedule.
One-way sync only: המחלבה never reads or writes anything back to a
user's external calendar. Reuses the existing domain/parser layers for
every scheduling fact -- this directory contains no parallel schedule data
model, only the calendar-feed-specific plumbing around it.

- `token.ts` (server-only) -- `generateCalendarFeedToken()`, a 256-bit
  `crypto.randomBytes` base64url token. The ONLY thing that authorizes
  `GET /calendar/<token>.ics` (see `src/app/calendar/[token]/route.ts`) --
  external calendar clients never carry a Supabase session.
- `feedStore.ts` (server-only) -- RLS-scoped enable/reset/disable/status
  for the CURRENTLY authenticated user's own `calendar_feeds` row (see
  `supabase/migrations/20260820090000_create_calendar_feeds.sql`).
  Deliberately stores the token in plain text, not hashed -- see the
  migration's own comment for why (the product needs "Copy Link"/"Add to
  Google/Apple Calendar" to keep working at any time while sync stays
  enabled, not only once at creation).
- `serviceClient.ts` (server-only) -- the ONE call site for this feature's
  privileged (RLS-bypassing) Supabase access, used only by
  `feedOwnerLookup.ts`. The SECOND legitimate service-role call site in
  the whole codebase, alongside the notification worker's own
  `lib/notifications/engine/serviceClient.ts` -- see
  `src/app/notificationServiceRoleBoundary.test.ts`.
- `feedOwnerLookup.ts` (server-only) -- `resolveCalendarFeedOwnerByToken`,
  the token -> owning Supabase user's email lookup the ICS route needs
  (no session to resolve identity from otherwise).
- `loadCalendarFeedForToken.ts` (server-only) -- the ICS route's whole
  pipeline: token -> owner's email -> matching כ"א `Person` (same
  fail-closed email-only match `resolveCurrentPerson` uses for a normal
  session) -> that person's own Events -> rendered ICS text.
- `icsWindow.ts` (pure) -- the feed's date window: the last
  `ICS_FEED_PAST_WINDOW_DAYS` (30) days of history through unbounded
  future. Applied ONLY in `loadCalendarFeedForToken.ts`, as the very last
  filter before rendering -- `lib/readModels/buildPersonalScheduleReadModel.ts`'s
  own `calendarEvents` (the in-app "הלוח שלי" personal calendar) stays
  exactly as unbounded as it's always been; this is not a change to that
  read model or a second data source, just a feed-only cutoff layered on
  top of it.
- `icsItems.ts` (server-only) -- `buildCalendarItem`, turning one
  shift/duty/absence `Event` into a stable-UID, correctly-timed
  `IcsCalendarItem`. `calendarEventUid` is keyed on the Event's own
  spreadsheet origin (`sourceSheet`+`sourceCell`) -- this is what makes
  the feed a real subscription: editing an assignment's text (or its
  DESCRIPTION/roster, see `icsRoster.ts` below) keeps the same UID (an
  update, not a duplicate), and a removed/reassigned cell simply stops
  appearing in the next generation.
- `icsEmoji.ts` (pure) -- `icsEventEmoji`, ONE centralized `SUMMARY`-emoji
  mapping for this feed, keyed on typed `category`/`period`/`dutyFamily`/
  `absenceKind` fields (never raw text). Deliberately a SEPARATE table
  from `lib/presentation/emoji.ts`'s own `assignmentEmoji` (the in-app
  UI's mapping) -- a few of this feed's requested symbols intentionally
  differ from the UI's existing choices; see the file's own docstring for
  exactly which, and for every duty family/absence kind with no
  requested/fitting symbol (left unmapped -- the summary simply has no
  emoji prefix, never a guess). Has zero effect on the in-app "הלוח שלי"
  UI, which is untouched and still goes through `lib/presentation/emoji.ts`
  alone.
- `icsColor.ts` (pure) -- `icsEventColor`, the feed's best-effort RFC 7986
  §5.9 `COLOR` value. Unlike `icsEmoji.ts` above, this deliberately REUSES
  `lib/presentation/eventColor.ts`'s `eventColorKey` outright (the same
  semantic slot decision the in-app single-person calendar uses), rather
  than keeping a second, separately-reasoned mapping -- only the output
  FORMAT differs (a CSS3 extended color keyword, per RFC 7986, mapped from
  each of the 11 palette slots' hex). Best-effort only: `COLOR` is a SHOULD,
  not a MUST, and Apple Calendar reads it while Google Calendar's ICS
  subscription import ignores it -- an ignoring client sees an otherwise
  completely unaffected feed, since no other field (`UID`/timing/
  `SUMMARY`/`DESCRIPTION`) depends on it.
- `icsRoster.ts` (pure) -- `buildShiftRosterDescription`, the "איתך
  במשמרת:" roster block appended to a SHIFT Event's `DESCRIPTION` (never
  duty/absence -- those have no shift-roster concept). Reuses
  `buildShiftRoster` (`lib/domain/shiftCoverage.ts`), the SAME roster
  query the in-app "מי איתי?" panel is already built on -- no second
  roster/coverage computation. Computed fresh from the full, unfiltered,
  every-person Event set on every feed request (never persisted/
  snapshotted), so an added/removed/reassigned colleague or a role change
  is reflected on the very next fetch -- entirely independent of
  `calendarEventUid`, so a roster-only change updates the existing VEVENT,
  never creates a duplicate.
- `icsRender.ts` / `icsEncoding.ts` (pure) -- RFC 5545 VCALENDAR/VEVENT
  text rendering and escaping/line-folding, independently testable with
  no Supabase/Google/domain dependency at all. `IcsCalendarItem.color`
  (from `icsColor.ts`) emits an optional `COLOR` line per VEVENT when
  non-null, omitted entirely otherwise -- never a default/guessed value.
- `feedUrl.ts` (pure) / `requestOrigin.ts` (server-only) -- the feed's
  HTTPS/`webcal://`/Google-"add by URL" link shapes, and resolving the
  current request's own origin to build them.
- `actions.ts` (`"use server"`) -- `enableCalendarSyncAction` /
  `resetCalendarSyncAction` / `disableCalendarSyncAction`, the settings
  page's mutation entry points. Every one re-verifies the caller's
  identity itself (`getAuthenticatedIdentity()`) -- never trusts a
  client-supplied user id.

## Known calendar-provider limitations

- **Google Calendar's own refresh interval is coarse and not
  configurable** (observed anywhere from several hours to about a day),
  regardless of this feed's `REFRESH-INTERVAL`/`X-PUBLISHED-TTL` hints
  (which Google ignores entirely). This app's existing push-notification
  system remains the only channel for timely alerts -- a subscribed
  calendar is never a substitute for it.
- **Google's "add by URL" flow has no reliable one-tap mobile
  equivalent.** `googleCalendarSubscribeUrl` (the `calendar.google.com/
  calendar/r?cid=...` deep link) works reliably on desktop web; on the
  Google Calendar mobile app it does not consistently deep-link the same
  way. "Copy Link" + Google Calendar's own Settings -> Add calendar ->
  From URL screen is the safe, reliable fallback on every platform.
- **Apple's `webcal://` scheme has no such limitation** -- it triggers
  the native "Add Subscription" sheet directly on macOS/iOS.

## Known follow-up (not addressed in this PR)

`SHEET_SOURCES.potentialH1`/`potentialH2` (`lib/google/sheetSources.ts`)
are hardcoded to the two `פוטנציאל תקש"אס ...` tab names for calendar year
**2026** specifically (`1-6/2026`, `7-12/2026`) -- this is pre-existing,
not introduced here (the personal schedule read model has the exact same
hardcoding), but it means the ICS feed's synthetic Potential-duty entries
(via `buildPotentialDutyEvents`) will silently stop finding any 2027 data
once those two tabs are renamed/replaced for the next year, unless
`SHEET_SOURCES` (and every other caller of it) is updated for the
rollover. Real internal `משמרות + תורנויות` duty/shift Events are
unaffected -- only the Potential/תקשא"ס-period synthetic entries. Flagged
here deliberately rather than fixed, since resolving it properly (a
dynamic/rolling year resolution) is a cross-cutting change well beyond
this feature's scope.
