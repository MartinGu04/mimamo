/**
 * המחלבה -- minimal first-party Service Worker (PR #28).
 *
 * Scope of THIS file, deliberately narrow:
 *   1. Register/lifecycle correctly (install -> waiting -> activate, the
 *      browser's own ordinary timing -- no forced early activation).
 *   2. Prepare the app for a FUTURE Web Push PR: clean "push" and
 *      "notificationclick" handlers.
 *
 * What this file intentionally does NOT do:
 *   - No "fetch" event handler at all. Google Sheets is the source of
 *     truth and every authenticated route/Server Component response must
 *     always hit the real network -- this worker must never be able to
 *     serve a stale authenticated schedule from a cache. Offline support
 *     is explicitly out of scope for this PR.
 *   - No precaching of application pages/assets.
 *   - No secrets of any kind. It receives only whatever minimal JSON a
 *     future push message contains (title/body/icon/path) -- never a
 *     VAPID private key, Supabase service credential, Google credential,
 *     or auth token. Those never belong in a script this exposed (it
 *     ships as a plain public file, byte-identical to what a browser
 *     downloads and runs).
 *
 * Plain static file (no bundler), served from `/sw.js` at the root scope
 * so it can control the whole origin -- required for Push to reach every
 * page. Kept as ordinary JS (not TypeScript) since this runs directly in
 * the browser's Service Worker global scope with no build step.
 */

/** Only an in-app, same-origin, absolute path is ever navigated to -- never an arbitrary external URL from a push payload. */
var SAFE_IN_APP_PATH_PATTERN = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/;

function resolveSafeNotificationPath(rawPath) {
  if (typeof rawPath !== "string") return "/";
  if (!rawPath.startsWith("/")) return "/";
  if (rawPath.startsWith("//")) return "/"; // protocol-relative -- would escape same-origin
  if (!SAFE_IN_APP_PATH_PATTERN.test(rawPath)) return "/";
  return rawPath;
}

self.addEventListener("install", function () {
  // Deliberately does NOT call self.skipWaiting() here -- a newly
  // installed worker sits in "waiting" and activates the ordinary way the
  // browser already handles this, once every tab/client still controlled
  // by the previous worker has closed. There is no page-side "update now"
  // flow that force-activates it early (see components/pwa/
  // ServiceWorkerManager.tsx's docstring for why that was removed).
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

/**
 * Future Web Push payload shape (no real subscriptions/sending backend
 * yet -- this PR only prepares the client to receive one):
 *   { title?: string, body?: string, icon?: string, badge?: string,
 *     path?: string, tag?: string }
 * Every field is optional and defaults to something safe.
 */
self.addEventListener("push", function (event) {
  if (!event.data) return;

  var payload = {};
  try {
    payload = event.data.json();
  } catch {
    return; // Never guess at a malformed/non-JSON payload.
  }

  var title = typeof payload.title === "string" && payload.title.trim() !== "" ? payload.title : "המחלבה";
  var options = {
    body: typeof payload.body === "string" ? payload.body : "",
    icon: typeof payload.icon === "string" ? payload.icon : "/icons/icon-192.png",
    badge: typeof payload.badge === "string" ? payload.badge : "/icons/icon-192.png",
    data: { path: resolveSafeNotificationPath(payload.path) },
  };
  if (typeof payload.tag === "string" && payload.tag.trim() !== "") {
    options.tag = payload.tag;
  }

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  var path = resolveSafeNotificationPath(event.notification.data && event.notification.data.path);
  var targetUrl = new URL(path, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (allClients) {
      // Prefer an existing window already on the exact destination.
      for (var i = 0; i < allClients.length; i++) {
        if (allClients[i].url === targetUrl && "focus" in allClients[i]) {
          return allClients[i].focus();
        }
      }
      // Otherwise, focus and navigate an existing app window rather than
      // always opening a new one.
      for (var j = 0; j < allClients.length; j++) {
        var client = allClients[j];
        if ("focus" in client && "navigate" in client) {
          return client.focus().then(function () {
            return client.navigate(targetUrl);
          });
        }
      }
      // No existing window at all -- open the requested in-app path.
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
