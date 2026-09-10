# lib/auth

Authentication and personnel-permission boundary. Google Sheets/service
identity (`lib/google`) and Supabase Auth (`lib/supabase`) are unrelated
concerns kept fully separate — this module is the only place that
connects "who signed in" to "which כ"א Person that is."

- `currentUser.ts` — `getAuthenticatedIdentity()`, the server-only
  authenticated identity (`userId`, `email`). Uses Supabase's `getUser()`
  (which revalidates against the Supabase Auth server), never
  `getSession()` — a browser-submitted email is never trusted. Returns
  `null` for no session or for an account with no usable email; never
  falls back to name matching.
- `resolveCurrentPerson.ts` — `resolveCurrentPerson()` maps the
  authenticated email to a parsed כ"א `Person` (fetching the workbook
  snapshot and running the existing personnel parser — no duplicated
  Google access or parsing). `findPersonByEmail` is the pure, directly
  testable email-matching step (trimmed, case-insensitive, nothing
  fuzzier). A valid Google/Supabase login does not by itself grant
  access: an authenticated email absent from כ"א resolves to
  `{ status: "unmapped" }`, not a Person. `Person.isManager` is the only
  source of manager status — no separate allowlist exists.
  `resolveIdentityAgainstPeople(identity, people)` is the same mapping
  factored out as a pure function of an already-resolved identity and an
  already-parsed personnel list, and `resolveCurrentPersonFromPeople(people)`
  is the async wrapper over it — both exist so a caller that has already
  fetched/parsed כ"א for its own purposes (e.g. `lib/readModels`) can reuse
  the exact same fail-closed behavior without a second Google personnel
  request or a second parse. `resolveCurrentPerson` itself now delegates to
  `resolveIdentityAgainstPeople` too, so there is exactly one place this
  mapping logic lives.
- `safeRedirect.ts` — `sanitizeNextPath`, validating the OAuth callback's
  `next` redirect target so it can only ever point back into המחלבה.
- `actions.ts` — `signOutAction`, a Server Action that signs out
  server-side and redirects to `/login`.

No caching here: identity/person resolution runs fresh on every call, so
a resolved result can never leak between requests or users through a
shared cache.
