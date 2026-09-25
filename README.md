# המחלבה (hamachlava)

המחלבה is a Hebrew RTL, read-only scheduling companion built on top of an
existing Google Sheets scheduling workbook. Google Sheets remains the
single source of truth; המחלבה never writes back to it.

This repository currently contains the **project foundation** only:
Next.js App Router shell, Hebrew/RTL layout, and placeholder architecture
for the modules described in `CLAUDE.md`. No Google Sheets integration,
auth, or real scheduling data yet.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · Vitest · ESLint

## Scripts

```bash
npm run dev         # start the dev server
npm run build        # production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm test             # vitest
```

## Environment setup

Copy `.env.example` to `.env.local` and fill in real values -- see that
file's own comments for what each variable is and its Supabase Auth /
Web Push (VAPID) sections for the two auth-adjacent groups. Never commit
`.env.local` or any file containing a real key.

Web Push requires a one-time database migration too -- see
`supabase/README.md`. The automatic notification worker (PR #30) needs a
second migration plus `SUPABASE_SERVICE_ROLE_KEY`/
`NOTIFICATION_WORKER_SECRET` -- see `supabase/README.md` and
`src/lib/notifications/engine/README.md`.

## Project layout

```
src/app/              Next.js routes (including the internal notification worker route)
src/components/       UI (layout shell, generic building blocks, pwa/ notification UI)
src/lib/google/       Google Sheets API access (read-only)
src/lib/parsers/      raw sheet data -> typed domain objects
src/lib/domain/       scheduling business rules
src/lib/sync/         workbook-snapshot caching/freshness (30s navigation cache)
src/lib/auth/         authentication & permissions
src/lib/push/         Web Push mechanics (VAPID, payload contract, send/classify)
src/lib/notifications/ push subscription persistence (Supabase) + Server Actions
src/lib/notifications/engine/ automatic notification worker (PR #30)
supabase/migrations/  SQL migrations (push_subscriptions, notification engine)
```

See `CLAUDE.md` for the permanent engineering rules.
