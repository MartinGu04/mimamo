# lib/push

Pure Web Push mechanics (PR #29) -- VAPID configuration, payload shape,
subscription validation, and the actual `web-push` send call. Contains
NO Supabase/persistence code (see `lib/notifications` for that
orchestration layer) so it stays independently testable and reusable by
any future automated notification type.

- `config.ts` (server-only) / `publicConfig.ts` (client-safe) -- VAPID
  key configuration, split the same way as `lib/supabase/config.ts` splits
  public/server concerns, but for a genuine public/private asymmetric key
  pair rather than one shared value. `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`
  are plain server env vars (never `NEXT_PUBLIC_*`); only
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is meant to reach the browser. Both lazy
  (validated only when called, never at module load), so a deployment
  without VAPID configured still builds and runs -- only the notification
  UI itself degrades gracefully at that point.
- `base64url.ts` -- `urlBase64ToUint8Array`, converting the VAPID public
  key into the `Uint8Array` `PushManager.subscribe()`'s
  `applicationServerKey` requires.
- `notificationPath.ts` -- a byte-for-byte TypeScript port of
  `public/sw.js`'s own `resolveSafeNotificationPath` (that file must stay
  a plain bundler-free static script, so it can't be imported directly).
  Cross-checked against the real shipped `sw.js` in
  `notificationPath.test.ts`. Used when BUILDING an outgoing payload, so
  the server never even sends an unsafe destination -- defense in depth
  alongside the Service Worker's own check at display time.
- `deviceDescriptor.ts` (client-safe, pure) -- the COARSE, closed-enum
  description of one Push-capable installation (phone/tablet/desktop,
  iOS/Windows/..., Safari/Chrome/..., standalone yes/no) that backs
  "המכשירים שלי"'s labels. Explicitly NOT fingerprinting: the raw
  `navigator.userAgent` is read once in the browser, collapsed to a few
  bits, and discarded -- it never reaches the server, and the server
  re-validates whatever it is sent against the same closed sets
  (`parseDeviceDescriptor`), so an unrecognized value becomes `null`
  rather than free text. No version strings, no IP address, no probing.
- `payload.ts` (server-only) -- `NotificationPayload`, the one shape every
  Push send in this app goes through (`buildNotificationPayload`,
  `serializeNotificationPayload`), plus `TEST_NOTIFICATION_PAYLOAD` (PR
  #29's "שלח התראת בדיקה" copy). Future automated notification types
  should build their payload through this, not hand-assembled JSON.
- `subscriptionValidation.ts` (server-only) -- `parseBrowserSubscription`,
  validating arbitrary/untrusted client-submitted subscription JSON
  (endpoint must be `https://`, keys must be reasonably-shaped
  base64url). Fails closed -- never throws, always an explicit
  ok/reason result.
- `sendPush.ts` (server-only) -- `sendPush(subscription, payload)`, the
  one function that actually calls `web-push`'s `sendNotification`.
  Classifies the outcome (`{ ok: true }` or `{ ok: false, permanent,
  statusCode, message }`) -- HTTP 404/410 from the push service means the
  subscription is permanently gone (per RFC 8030 and every major
  provider's documented behavior); everything else (429/5xx/network) is
  transient. This module never deletes anything itself -- it only
  classifies; the caller (`lib/notifications`) decides whether to remove
  a subscription. Never logs an endpoint, encryption key, or payload
  body/title -- only a generic outcome label and status code.

## Delivery receipts

`NotificationPayload.receiptToken` is the one field `buildNotificationPayload`
never sets: it is added PER DEVICE at send time by
`lib/notifications/engine/delivery.ts`, because a token shared across a
job's devices could let one device's payload acknowledge another's
delivery. The token is derived (never random, never stored) so it stays
stable across retries -- see `lib/notifications/receiptToken.ts` -- and
`public/sw.js` POSTs it back to `/internal/notifications/receipt` after
`showNotification()` resolves. That receipt is what
`notification_deliveries.received_at` records, and it is strictly
stronger than `status = 'sent'` (which only ever meant "the push
provider accepted the request") and strictly weaker than "the user read
it", which this app does not track at all.

## Generating VAPID keys

```
npx web-push generate-vapid-keys
```

See the root `README.md`/`.env.example` and the PR #29 report for the
full environment-variable setup (local, Vercel Preview, Vercel
Production).
