import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/config/productName";
import { ThemeProvider } from "@/lib/theme/ThemeProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme/themeScript";
import { A11yPreferencesProvider } from "@/lib/a11y/A11yPreferencesProvider";
import { A11Y_INIT_SCRIPT } from "@/lib/a11y/preferences";
import { ServiceWorkerManager } from "@/components/pwa/ServiceWorkerManager";
import { PwaInstallProvider } from "@/components/pwa/PwaInstallProvider";
import { PrivacySafeAnalytics } from "@/components/privacy/PrivacySafeAnalytics";
import "./globals.css";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_DESCRIPTION,
  /**
   * iOS standalone-launch metadata (PR #28) -- `capable: true` is what
   * lets a Home Screen install open without Safari's browser chrome;
   * `title` is the name shown under the Home Screen icon (falls back to
   * the page title otherwise, which could get truncated differently).
   * `statusBarStyle: "default"` keeps the system status bar text dark on
   * a light background rather than forcing a fixed color scheme.
   */
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
};

/**
 * `themeColor` follows the SAME light/dark tokens as globals.css
 * (`--background`), so the browser/PWA chrome (address bar, task
 * switcher card) matches whichever theme is actually in effect. This is
 * Next's native per-scheme metadata support (resolved server-side to two
 * `<meta name="theme-color" media="...">` tags) -- not a client hook, so
 * there is nothing here for React to hydrate differently. It only tracks
 * `prefers-color-scheme`, same as the CSS `@media` rule; an explicit
 * in-app theme override (`data-theme`) intentionally does not change
 * these tags -- the PWA manifest's own fixed `theme_color` (see
 * `app/manifest.ts`) already gives installed icons/splash a single stable
 * brand color regardless of scheme, so this only needs to be "close
 * enough" for browser chrome, never a source of a fragile client hack.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f141a" },
  ],
};

/**
 * The app shell (sidebar/nav) is rendered by the (app) route group's own
 * layout, not here — /login and /auth/callback must never show it, and
 * must never be gated behind the auth check that route group performs.
 *
 * The inline script must be the very first thing in `<body>` so it runs
 * before the browser paints anything, setting `data-theme` on `<html>`
 * before first paint -- this is what avoids a visible flash of the wrong
 * theme. It only ever sets a DOM attribute (see `themeScript.ts`); no
 * React component renders differently based on it, so there is no
 * server/client hydration mismatch to worry about.
 *
 * `ServiceWorkerManager` is mounted once here, at the true application
 * root, so it registers exactly once per full page load (not once per
 * client-side route) and covers /login and /auth/callback too -- a
 * standalone-installed PWA needs the login/callback flow to work
 * identically to the browser tab. It is a self-contained, feature-detected
 * client component; see `components/pwa` for why it never interferes with
 * authentication redirects (it renders nothing but an optional update
 * banner, and touches no auth/navigation state).
 *
 * `PwaInstallProvider` wraps `children` (rather than sitting as a sibling
 * like `ServiceWorkerManager`) for the same "mount at the true root" reason
 * -- the non-standard `beforeinstallprompt` event can fire at any point
 * after the page loads, well before the user ever opens the notification
 * bell (`NotificationBell`'s own contextual install card, several route
 * transitions later, is what actually consumes this state) -- so its
 * listener attaches from this component's own mount effect, the earliest
 * point in this app's client tree a React effect can run, rather than
 * lazily once some deeper component happens to mount. That is not a claim
 * that no earlier-firing event could ever be missed -- an effect only
 * runs after this render has committed/hydrated, and there is deliberately
 * no inline pre-hydration script here to close that theoretical gap (see
 * `PwaInstallProvider`'s own docstring for why, and for how its
 * `isStandalone`/`isIos` avoid a hydration mismatch of their own). Kept
 * entirely separate from Push subscription state (`usePushSubscription`)
 * and from `ServiceWorkerManager` itself -- installability and Service
 * Worker registration are different concerns.
 *
 * Deliberately NO `h-full`/`height: 100%` here on `<html>`/`<body>` --
 * that used to be a percentage-height chain rooted at the true document
 * root, which on mobile Safari resolves against the LARGE/static
 * viewport (chrome collapsed), the exact same phantom-scroll failure
 * mode `AppShell`'s own `min-h-dvh` was already written to avoid (see
 * its docstring). Since it's `height` (a fixed box), not `min-height`,
 * `<body>` stayed pinned at that inflated size even once the visible
 * dynamic viewport (chrome shown) was genuinely shorter -- on a SHORT
 * page (nothing else tall enough to need real scrolling) that gap was
 * the entire scrollable area: a large empty region below real content,
 * everywhere in the app, most visible on short pages (Manager Area
 * being a common one) since there's no real content to fill it and hide
 * the discrepancy. Every actual page root already independently
 * guarantees its own "at least one viewport tall" background via its
 * OWN `min-h-dvh` wrapper (`AppShell`, `/login`, `error.tsx`,
 * `AccessDeniedScreen`) — `<html>`/`<body>` never needed a height rule
 * of their own for that; removing it costs nothing and closes the gap
 * at its true source instead of clipping it with `overflow: hidden`.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} antialiased`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: A11Y_INIT_SCRIPT }} />
        <ThemeProvider>
          <A11yPreferencesProvider>
            <PwaInstallProvider>
              {children}
              <ServiceWorkerManager />
            </PwaInstallProvider>
          </A11yPreferencesProvider>
        </ThemeProvider>
        <PrivacySafeAnalytics />
      </body>
    </html>
  );
}
