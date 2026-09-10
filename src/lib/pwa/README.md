# lib/pwa

PWA foundation (PR #28): installability + the client-side groundwork a
future Web Push PR will build on. Read-only, same as the rest of the app —
nothing here writes to Google Sheets, and nothing here requests
notification permission or subscribes to push yet.

- `capabilities.ts` — pure feature detection (`supportsServiceWorker`,
  `supportsPushManager`, `supportsNotifications`, `getPwaCapabilities`).
  Always checks for the real API's presence, never a User-Agent/browser
  guess. Safe to import anywhere; every check degrades to `false` under
  SSR (no `window`/`navigator`) instead of throwing. This is READ-ONLY
  detection — a future opt-in UI uses it to decide what to even offer;
  it never triggers a permission prompt or registration itself.

Related pieces living elsewhere, by existing layering convention:

- `app/manifest.ts` — the Web App Manifest (Next's file-convention route),
  using `lib/config/productName.ts` for name/description and
  `public/icons/` for the installable icon set (resized from the real
  supplied `public/brand/icon.png` artwork, never redrawn).
- `public/sw.js` — the actual Service Worker. A plain static file (no
  build step, no bundler) so it can never accidentally inline a secret —
  it must not and does not receive VAPID private keys, Supabase service
  credentials, Google credentials, or auth tokens. Deliberately has **no
  `fetch` handler and no offline page/data caching** — Google Sheets stays
  the source of truth and every authenticated route must always hit the
  real network; the server-side workbook-snapshot cache (`lib/sync`)
  already owns short-lived freshness, and this worker must never be able
  to serve a stale authenticated schedule instead. It only implements
  lifecycle (`install`/`activate`, no forced early activation -- a
  waiting worker activates the ordinary way once old clients close) and
  two forward-looking, currently-inert-until-a-backend-exists handlers:
  `push` (shows a notification from a small JSON payload) and
  `notificationclick` (closes it and navigates to an in-app path —
  restricted to a same-origin, absolute path via
  `resolveSafeNotificationPath`; an arbitrary/external URL in a payload is
  never opened).
- `components/pwa/ServiceWorkerManager.tsx` — registers `/sw.js` once at
  the application root (mounted in `app/layout.tsx`, so it covers
  `/login`/`/auth/callback` too and never re-registers on client-side
  navigation). Never calls `Notification.requestPermission()`. No
  user-facing "new version available" flow — a previous version drove a
  manual "Update now" banner whose "wait for controllerchange, then
  reload" step could get stuck pending indefinitely; it was removed
  outright rather than patched. A waiting worker now activates the
  ordinary way the browser already handles this (once every client still
  controlled by the old worker has closed) — see that component's
  docstring.

## What this PR deliberately does NOT do

No actual push subscriptions, no sending backend, and no user-facing
opt-in UI — the architecture is ready for it, nothing more. The **next**
Push Notifications PR will likely need to add:

- VAPID public/private key generation and configuration
  (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, a server-only `VAPID_PRIVATE_KEY`).
- The `web-push` server dependency, used only in a Server Action —
  never in the Service Worker or any client bundle.
- Persisting each authenticated user's `PushSubscription` — a Supabase
  table/schema, scoped by user, supporting **multiple devices per user**
  (a subscription per browser/device, not one-per-account).
- `subscribeUser`/`unsubscribeUser` Server Actions (mirroring the
  existing `"use server"` pattern already used in `lib/auth/actions.ts`
  and `lib/sync/actions.ts`), called only after explicit user opt-in —
  never automatically.
- An explicit, discoverable opt-in UI (a settings/preferences surface),
  including per-notification-type preferences if/when more than one
  notification type exists.
- Expired/invalid subscription cleanup (a push send that comes back
  `410 Gone`/`404` must remove that stored subscription, not retry it
  forever).
- The actual notification-trigger rules — what real product event causes
  a push to be sent, and to whom — which is itself a scheduling-domain
  design question, not just a delivery-mechanism one.

None of the above is implemented in this PR.
