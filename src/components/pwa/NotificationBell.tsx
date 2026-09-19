"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Bell, BellOff, BellRing, ChevronDown, ChevronUp, Download, Loader2, RefreshCw, Settings } from "lucide-react";
import type { NotificationInboxItem } from "@/lib/readModels/notificationInboxTypes";
import { formatRecentChangeRelativeTime } from "@/lib/presentation/relativeChangeTime";
import { APP_NAME } from "@/lib/config/productName";
import { EXPAND_HIT_AREA_CLASS, EXPAND_HIT_AREA_VERTICAL_CLASS } from "@/components/ui/hitArea";
import { usePushSubscription } from "./usePushSubscription";
import { useNotificationInbox } from "./useNotificationInbox";
import { type InstallPromptOutcome, usePwaInstall } from "./PwaInstallProvider";
import { type BellOnboardingCard, type InstallGuidance, deriveBellOnboardingCard, deriveInstallGuidance } from "./bellOnboarding";
import {
  isInstallPromptDismissalActive,
  markInstallPromptDismissed,
  readInstallPromptDismissedAt,
} from "@/lib/pwa/installPromptPreference";
import { useRevealFocus } from "@/components/ui/useRevealFocus";

interface NotificationBellProps {
  /** Only affects the trigger button's own visual treatment -- the popover panel's CONTENT looks identical in every context; only its anchor side (see `PANEL_POSITION_CLASSES`) varies by variant. */
  variant: "sidebar" | "mobile" | "shell";
  /**
   * Authenticated Supabase user id, passed straight through to
   * `usePushSubscription` to key the per-user/per-device Push preference
   * -- see that hook's own docstring. `undefined` only on the (never
   * actually reached in real usage) no-`person` shell render path.
   */
  userId?: string;
}

type BellView = "inbox" | "settings";

/** `useSyncExternalStore` plumbing for the install-dismissal localStorage read below -- see that call site's own comment. */
function subscribeToNothing(): () => void {
  return () => {};
}

function noStoredDismissalOnFirstRender(): number | null {
  return null;
}

const TRIGGER_CLASSES: Record<NotificationBellProps["variant"], string> = {
  sidebar:
    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sidebar-muted transition-colors duration-150 hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
  mobile:
    "flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-overlay-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
  /**
   * The global `ShellUtilityBar` top bar (header polish pass) -- same
   * light-surface treatment as `mobile` (this bar sits on the ordinary
   * theme background, never the dark sidebar), but the `rounded-full`
   * circle shape `sidebar` already established. Release-polish pass: sized
   * up from `sidebar`'s 32px to 40px (see `ICON_SIZE_CLASSES` below for the
   * matching icon bump) -- next to the bar's other elements (the two org
   * logos at 64px/49px, the clock pill), the original 32px bell read as
   * visually undersized/out of balance.
   */
  shell:
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-overlay-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
};

/** Trigger icon size per variant -- `shell` alone grows alongside its own bigger trigger circle above; `sidebar`/`mobile` are unchanged. */
const ICON_SIZE_CLASSES: Record<NotificationBellProps["variant"], string> = {
  sidebar: "h-[16px] w-[16px]",
  mobile: "h-[16px] w-[16px]",
  shell: "h-[20px] w-[20px]",
};

/**
 * The popover's anchor side, as a LOGICAL `inset-inline-*` side -- under
 * `dir="rtl"`, `inset-inline-end` maps to physical `left` (pins the panel's
 * LEFT edge, growing further RIGHT/inward from there) and
 * `inset-inline-start` maps to physical `right` (pins the RIGHT edge,
 * growing further LEFT/outward). `sidebar`/`mobile` use `end-0` -- their
 * trigger never sits at the true physical left edge, so growing rightward
 * from a pinned left edge stays safely inside the viewport. `shell` sits
 * at the header's own physical LEFT edge (header polish pass): it also
 * needs `end-0` (pin left, grow right/inward) for the same reason -- an
 * earlier version of this used `start-0` here on the (incorrect) belief
 * that it would grow back into the bar; verified in a real browser that it
 * actually did the opposite (grew further left, off-screen, clipping the
 * panel entirely). Kept as its own map (rather than collapsing to one
 * constant) so a future variant anchored elsewhere can still differ.
 */
const PANEL_POSITION_CLASSES: Record<NotificationBellProps["variant"], string> = {
  sidebar: "end-0",
  mobile: "end-0",
  shell: "end-0",
};

/** 9+ reads as "9+", never a wrapping/overflowing three-digit badge. */
function formatBadgeCount(count: number): string {
  return count > 9 ? "9+" : String(count);
}

/**
 * The bell's primary surface (notification-center PR): the user's real
 * Hamachlava inbox (`useNotificationInbox`, reusing the existing
 * `notification_jobs` outbox -- never a second notification-rule engine),
 * newest first. Push controls (`usePushSubscription`, unchanged) moved
 * BEHIND the gear icon in the header -- push is one delivery channel
 * among possibly none, never a precondition for the inbox itself, and
 * `sendTestNotificationAction` (reached from there) stays diagnostic-only:
 * it never creates an inbox item, since it never touches
 * `notification_jobs` at all.
 *
 * Originally replacing the "בקרוב" placeholder bell from PR #28 in both
 * `Sidebar` (desktop) and `MobileIdentityBar` (mobile); the desktop
 * instance later moved into `ShellUtilityBar` (`variant="shell"`).
 * Same click-outside/Escape-to-dismiss pattern `MobileProfileMenu`
 * already uses.
 *
 * Explicitly a non-modal popover (`aria-modal="false"`, never a Tab trap):
 * the shared `useRevealFocus` hook (`components/ui/`) moves focus into the
 * panel on open and restores it to the bell trigger on close -- Escape,
 * outside click, or picking an inbox item all go through the same
 * `closePopover()` path, so all three restore focus the same way. The
 * panel's accessible name comes from `aria-labelledby`, pointing at
 * whichever view's own real visible heading (`InboxView`'s "התראות" /
 * `SettingsView`'s "הגדרות התראות") is currently rendered.
 */
export function NotificationBell({ variant, userId }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<BellView>("inbox");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const panelHeadingId = useId();

  // Non-modal popover: moves focus into the panel on open (its own
  // container, since which control should get initial focus varies by
  // view/state) and restores it to the bell on close -- whether that close
  // came from Escape, an outside click, or picking an inbox item -- without
  // trapping Tab (unlike `MoreSheet`/`CommandPalette`, this never claims
  // `aria-modal="true"`).
  useRevealFocus({ revealed: open, onRevealFocusRef: panelRef, fallbackFocusRef: triggerRef });

  const { state, errorMessage, testStatus, enable, disable, sendTest } = usePushSubscription(userId);
  const { status: inboxStatus, items, unreadCount, refresh, markRead, markAllRead, clear } = useNotificationInbox();
  const { isReady: isInstallStateReady, isStandalone, canPromptInstall, isIos, installCompleted, promptInstall } = usePwaInstall();

  // `useSyncExternalStore` rather than a plain
  // `useState(() => readInstallPromptDismissedAt(...))` initializer or a
  // `useEffect` that reads storage and calls `setState` -- same
  // SSR-safety reasoning as `PwaInstallProvider`'s own `isStandalone`/
  // `isIos` (see its docstring): a lazy `useState` initializer runs again,
  // with a real localStorage answer, on the client's first hydration
  // render, which can disagree with what the server rendered (`null`,
  // since `readInstallPromptDismissedAt` degrades safely with no
  // `window`). `getServerSnapshot` below keeps that first render at the
  // same deterministic `null` server and client agree on; React's own
  // hydration reconciliation resolves it to the real stored value right
  // after. A completely separate localStorage key from the Push
  // preference -- see `installPromptPreference.ts`'s own docstring.
  const storedInstallDismissedAt = useSyncExternalStore(
    subscribeToNothing,
    () => (userId ? readInstallPromptDismissedAt(userId) : null),
    noStoredDismissalOnFirstRender,
  );
  // An explicit "לא עכשיו" click during THIS render session is known
  // immediately (it's the click handler's own `Date.now()`, not a storage
  // re-read) and always wins over whatever the store above still reports --
  // this is an ordinary user-event-driven `setState`, not a render- or
  // effect-body read of browser state, so it carries none of the
  // SSR-safety concerns above.
  const [explicitInstallDismissedAt, setExplicitInstallDismissedAt] = useState<number | null>(null);
  const installDismissedAt = explicitInstallDismissedAt ?? storedInstallDismissedAt;

  function dismissInstallCard() {
    if (userId) markInstallPromptDismissed(userId);
    setExplicitInstallDismissedAt(Date.now());
  }

  const onboardingCard = deriveBellOnboardingCard({
    isReady: isInstallStateReady,
    isStandalone,
    pushState: state,
    isIos,
    canPromptInstall,
    installCompleted,
    installDismissalActive: isInstallPromptDismissalActive(installDismissedAt),
  });

  function closePopover() {
    setOpen(false);
    setView("inbox");
  }

  useEffect(() => {
    if (!open) return;
    // A fresh read every time the popover opens (not just once on mount)
    // -- other activity may have created new notifications since the last
    // open. No polling while closed/open: matches this app's existing
    // "no automatic polling for new data" convention (`DataFreshnessStatus`).
    refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closePopover();
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Focus restore is `useRevealFocus`'s job (fires once `open` flips
        // to false below) -- same single mechanism for every close path
        // (Escape, outside click, picking an inbox item), not a one-off
        // here.
        closePopover();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const isPushEnabled = state === "enabled" || state === "disabling";
  const TriggerIcon = isPushEnabled ? BellRing : Bell;

  function handleItemClick(item: NotificationInboxItem) {
    if (!item.isRead) markRead(item.id);
    closePopover();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={unreadCount > 0 ? `התראות, ${unreadCount} שלא נקראו` : "התראות"}
        onClick={() => setOpen((prev) => !prev)}
        // Vertical-only expansion (Phase 6): this trigger always sits in a
        // tight horizontal icon cluster (`MobileIdentityBar`'s
        // Search/Theme/Bell/Avatar row, `ShellUtilityBar`'s top bar,
        // `Sidebar`'s top row) with only a few px between neighbors --
        // expanding sideways too would make adjacent controls' hit areas
        // overlap, so only the (always free) vertical space is reclaimed.
        className={`relative ${TRIGGER_CLASSES[variant]} ${EXPAND_HIT_AREA_VERTICAL_CLASS}`}
      >
        <TriggerIcon className={ICON_SIZE_CLASSES[variant]} aria-hidden="true" strokeWidth={1.75} />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 end-[-2px] flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-none text-critical-foreground"
          >
            {formatBadgeCount(unreadCount)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={panelHeadingId}
          tabIndex={-1}
          className={`glass-medium absolute ${PANEL_POSITION_CLASSES[variant]} top-full z-50 mt-2 w-80 max-w-[calc(100vw-2.5rem)] rounded-xl bg-surface-1 p-3 text-foreground shadow-[var(--shadow-elevated)] ring-1 ring-border-strong outline-none`}
        >
          {view === "inbox" ? (
            <>
              <BellOnboardingCardView
                card={onboardingCard}
                onEnablePush={enable}
                onOpenSettings={() => setView("settings")}
                onPromptInstall={promptInstall}
                onDismissInstall={dismissInstallCard}
              />
              <InboxView
                headingId={panelHeadingId}
                status={inboxStatus}
                items={items}
                unreadCount={unreadCount}
                onOpenSettings={() => setView("settings")}
                onItemClick={handleItemClick}
                onMarkAllRead={markAllRead}
                onClear={clear}
              />
            </>
          ) : (
            <SettingsView
              headingId={panelHeadingId}
              onBack={() => setView("inbox")}
              state={state}
              errorMessage={errorMessage}
              testStatus={testStatus}
              onEnable={enable}
              onDisable={disable}
              onSendTest={sendTest}
              isInstallStateReady={isInstallStateReady}
              isStandalone={isStandalone}
              isIos={isIos}
              canPromptInstall={canPromptInstall}
              installCompleted={installCompleted}
              onPromptInstall={promptInstall}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inbox view
// ---------------------------------------------------------------------------

function InboxView({
  headingId,
  status,
  items,
  unreadCount,
  onOpenSettings,
  onItemClick,
  onMarkAllRead,
  onClear,
}: {
  headingId: string;
  status: "loading" | "ready" | "error";
  items: NotificationInboxItem[];
  unreadCount: number;
  onOpenSettings: () => void;
  onItemClick: (item: NotificationInboxItem) => void;
  onMarkAllRead: () => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 px-1">
        <p id={headingId} className="text-sm font-semibold text-foreground">התראות</p>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="הגדרות התראות"
          className={`relative flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-overlay-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${EXPAND_HIT_AREA_CLASS}`}
        >
          <Settings className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        </button>
      </div>

      {status === "loading" ? (
        <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={1.75} />
          טוען התראות...
        </div>
      ) : null}

      {status === "error" ? (
        <p className="px-1 py-6 text-center text-sm text-muted">לא ניתן לטעון כרגע את ההתראות</p>
      ) : null}

      {status === "ready" && items.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-muted">אין התראות חדשות</p>
      ) : null}

      {status === "ready" && items.length > 0 ? (
        <>
          <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs">
            <button
              type="button"
              onClick={onMarkAllRead}
              disabled={unreadCount === 0}
              className="font-medium text-primary transition-colors duration-150 hover:underline disabled:cursor-not-allowed disabled:text-muted-2 disabled:no-underline"
            >
              סמן הכל כנקרא
            </button>
            <button
              type="button"
              onClick={onClear}
              className="font-medium text-muted transition-colors duration-150 hover:text-critical"
            >
              נקה התראות
            </button>
          </div>
          <ul className="mt-1 max-h-96 overflow-y-auto">
            {items.map((item) => (
              <InboxItemRow key={item.id} item={item} onClick={onItemClick} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function InboxItemRow({ item, onClick }: { item: NotificationInboxItem; onClick: (item: NotificationInboxItem) => void }) {
  return (
    <li>
      <Link
        href={item.path}
        onClick={() => onClick(item)}
        className="flex items-start gap-2.5 rounded-xl px-1.5 py-2 transition-colors duration-200 hover:bg-overlay-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span
          aria-hidden="true"
          className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${item.isRead ? "bg-transparent" : "bg-primary"}`}
        />
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${item.isRead ? "text-muted" : "font-medium text-foreground"}`}>{item.title}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{item.body}</p>
          <p className="mt-0.5 text-[11px] text-muted-2">{formatRecentChangeRelativeTime(item.happenedAt, new Date())}</p>
        </div>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Settings view -- the EXISTING push controls (PR #29), unchanged, only
// relocated behind the gear.
// ---------------------------------------------------------------------------

function SettingsView({
  headingId,
  onBack,
  state,
  errorMessage,
  testStatus,
  onEnable,
  onDisable,
  onSendTest,
  isInstallStateReady,
  isStandalone,
  isIos,
  canPromptInstall,
  installCompleted,
  onPromptInstall,
}: {
  headingId: string;
  onBack: () => void;
  state: ReturnType<typeof usePushSubscription>["state"];
  errorMessage: string | null;
  testStatus: ReturnType<typeof usePushSubscription>["testStatus"];
  onEnable: () => void;
  onDisable: () => void;
  onSendTest: () => void;
  isInstallStateReady: boolean;
  isStandalone: boolean;
  isIos: boolean;
  canPromptInstall: boolean;
  installCompleted: boolean;
  onPromptInstall: () => Promise<InstallPromptOutcome>;
}) {
  // Spec point 6: install state must be considered BEFORE a misleading Push
  // message -- specifically, `unsupported` on an iPhone/iPad browser tab
  // usually just means "Push APIs aren't available outside standalone",
  // never a genuine device limitation. A non-iOS `unsupported` browser
  // (installing would not add Push support there either) keeps its
  // existing truthful `UnsupportedPanel` untouched. While install-state
  // detection has not finished (`!isInstallStateReady` -- see
  // `PwaInstallProvider`'s own docstring), `isIos` cannot be trusted yet,
  // so this always falls through to the ordinary, always-safe push panel
  // rather than possibly skipping it based on a not-yet-known iOS guess.
  const showPushStateSwitch = !isInstallStateReady || isStandalone || !(isIos && state === "unsupported");
  // Section 8's manual install entry point is itself install-guidance UI --
  // same rule as the bell's automatic card: never rendered before
  // detection has actually finished (see `deriveBellOnboardingCard`'s
  // identical `isReady` gate).
  const showInstallSection = isInstallStateReady && !isStandalone;

  return (
    <div>
      <div className="flex items-center gap-2 px-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="חזרה להתראות"
          className={`relative flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-overlay-soft hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${EXPAND_HIT_AREA_CLASS}`}
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        </button>
        <p id={headingId} className="text-sm font-semibold text-foreground">הגדרות התראות</p>
      </div>

      <div className="mt-2 px-1">
        {/* Section 8: a manual re-entry point into installation guidance,
            reachable from Settings whenever the app is not standalone --
            deliberately IGNORES the bell's automatic-card dismissal
            cooldown (that cooldown only suppresses the unsolicited card;
            an intentional visit here must always work). */}
        {showInstallSection ? (
          <InstallSettingsSection
            guidance={deriveInstallGuidance({ isIos, canPromptInstall, installCompleted })}
            onPromptInstall={onPromptInstall}
          />
        ) : null}

        {showPushStateSwitch ? (
          <div className={showInstallSection ? "mt-4 border-t border-border pt-3" : undefined}>
            {state === "checking" ? <CheckingPanel /> : null}
            {state === "unsupported" ? <UnsupportedPanel /> : null}
            {state === "permission_denied" ? <PermissionDeniedPanel /> : null}
            {state === "not_enabled" || state === "enabling" ? (
              <NotEnabledPanel pending={state === "enabling"} errorMessage={errorMessage} onEnable={onEnable} />
            ) : null}
            {state === "enabled" || state === "disabling" ? (
              <EnabledPanel
                disabling={state === "disabling"}
                testStatus={testStatus}
                onDisable={onDisable}
                onSendTest={onSendTest}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CheckingPanel() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={1.75} />
      בודק סטטוס התראות...
    </div>
  );
}

function UnsupportedPanel() {
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">התראות</p>
      <p className="mt-1 text-xs text-muted">התראות אינן נתמכות בדפדפן או במכשיר הזה.</p>
    </div>
  );
}

function PermissionDeniedPanel() {
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">התראות חסומות</p>
      <p className="mt-1 text-xs text-muted">
        ההתראות חסומות בהגדרות הדפדפן או המערכת. כדי להפעיל אותן, יש לאשר התראות עבור האתר בהגדרות ולנסות שוב.
      </p>
    </div>
  );
}

function NotEnabledPanel({
  pending,
  errorMessage,
  onEnable,
}: {
  pending: boolean;
  errorMessage: string | null;
  onEnable: () => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-foreground">סטטוס: כבוי</p>
      <p className="mt-1 text-xs text-muted">קבל תזכורות ועדכונים חשובים מ{APP_NAME}</p>
      <button
        type="button"
        onClick={onEnable}
        disabled={pending}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={1.75} /> : null}
        {pending ? "מפעיל..." : "הפעל התראות"}
      </button>
      {errorMessage ? <p className="mt-2 text-xs text-critical">{errorMessage}</p> : null}
    </div>
  );
}

function EnabledPanel({
  disabling,
  testStatus,
  onDisable,
  onSendTest,
}: {
  disabling: boolean;
  testStatus: "idle" | "pending" | "success" | "error";
  onDisable: () => void;
  onSendTest: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <BellRing className="h-4 w-4 text-primary" aria-hidden="true" strokeWidth={1.75} />
        <p className="text-sm font-semibold text-foreground">סטטוס: פעיל</p>
      </div>

      <button
        type="button"
        onClick={onSendTest}
        disabled={testStatus === "pending" || disabling}
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border-strong px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-overlay-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-70"
      >
        {testStatus === "pending" ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" strokeWidth={2} />
        ) : null}
        שלח התראת בדיקה
      </button>
      {testStatus === "success" ? <p className="mt-1.5 text-xs text-success">ההתראה נשלחה בהצלחה.</p> : null}
      {testStatus === "error" ? (
        <p className="mt-1.5 text-xs text-critical">שליחת ההתראה נכשלה. נסו שוב.</p>
      ) : null}

      <button
        type="button"
        onClick={onDisable}
        disabled={disabling}
        className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-critical transition-colors duration-200 hover:bg-critical/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-critical disabled:cursor-not-allowed disabled:opacity-70"
      >
        {disabling ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={1.75} />
        ) : (
          <BellOff className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        )}
        {disabling ? "מכבה..." : "כבה התראות"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contextual onboarding card (bell inbox view, spec priority A-G) -- always
// rendered ABOVE `InboxView`, never in place of it, so reading/marking/
// clearing notifications keeps working regardless of install/Push state.
// ---------------------------------------------------------------------------

function OnboardingCardShell({ children }: { children: ReactNode }) {
  return <div className="mb-3 rounded-xl bg-overlay-soft p-3 ring-1 ring-border">{children}</div>;
}

function BellOnboardingCardView({
  card,
  onEnablePush,
  onOpenSettings,
  onPromptInstall,
  onDismissInstall,
}: {
  card: BellOnboardingCard;
  onEnablePush: () => void;
  onOpenSettings: () => void;
  onPromptInstall: () => Promise<InstallPromptOutcome>;
  onDismissInstall: () => void;
}) {
  if (card.kind === "none") return null;

  if (card.kind === "enable_push") {
    // (B) standalone + Push not yet enabled -- the CTA calls the EXISTING
    // `usePushSubscription().enable()` directly; this click IS the user
    // gesture that hook's own permission-request call relies on.
    return (
      <OnboardingCardShell>
        <p className="text-sm font-semibold text-foreground">🔔 הפעילו התראות</p>
        <p className="mt-1 text-xs text-muted">קבלו תזכורות ועדכונים חשובים גם כש{APP_NAME} סגורה.</p>
        <button
          type="button"
          onClick={onEnablePush}
          className="mt-2.5 inline-flex w-full items-center justify-center rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          הפעל התראות
        </button>
      </OnboardingCardShell>
    );
  }

  if (card.kind === "push_blocked") {
    // (C) standalone + permission denied -- guidance only, never a repeated
    // `requestPermission()` call. "לפרטים" opens Settings, where
    // `PermissionDeniedPanel` already carries the full recovery copy.
    return (
      <OnboardingCardShell>
        <p className="text-sm font-semibold text-foreground">התראות חסומות</p>
        <p className="mt-1 text-xs text-muted">ההתראות חסומות בהגדרות הדפדפן או המערכת.</p>
        <button
          type="button"
          onClick={onOpenSettings}
          className="mt-2 text-xs font-medium text-primary transition-colors duration-150 hover:underline"
        >
          לפרטים
        </button>
      </OnboardingCardShell>
    );
  }

  if (card.kind === "install_completed") {
    // (F) installed this session, but the current tab itself is still not
    // standalone -- installing does not retroactively make THIS tab
    // standalone. Truthful next step only; never an auto permission prompt.
    return (
      <OnboardingCardShell>
        <p className="text-sm font-semibold text-foreground">ההתקנה הושלמה</p>
        <p className="mt-1 text-xs text-muted">עכשיו פתח/י את {APP_NAME} מהסמל במסך הבית כדי להפעיל התראות.</p>
      </OnboardingCardShell>
    );
  }

  // (D/E/G) card.kind === "install"
  return <InstallOnboardingCard guidance={card.guidance} onPromptInstall={onPromptInstall} onDismiss={onDismissInstall} />;
}

function InstallOnboardingCard({
  guidance,
  onPromptInstall,
  onDismiss,
}: {
  guidance: Exclude<InstallGuidance, "completed">;
  onPromptInstall: () => Promise<InstallPromptOutcome>;
  onDismiss: () => void;
}) {
  if (guidance === "fallback") {
    // (G) No native prompt, not iOS -- a truthful low-key note, never a
    // dead "Install" button. Never dismissible: there is no CTA here to
    // nag with in the first place.
    return <p className="mb-3 px-1 text-xs text-muted">אפשר להוסיף את {APP_NAME} למסך הבית דרך תפריט הדפדפן.</p>;
  }

  return (
    <OnboardingCardShell>
      <InstallGuidanceBody guidance={guidance} onPromptInstall={onPromptInstall} />
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 text-xs font-medium text-muted transition-colors duration-150 hover:text-foreground"
      >
        לא עכשיו
      </button>
    </OnboardingCardShell>
  );
}

/** Device-appropriate install pitch body, with no outer card chrome and no dismiss control -- shared between the bell's dismissible card (`InstallOnboardingCard`) and Settings' always-available manual entry point (`InstallSettingsSection`). */
function InstallGuidanceBody({
  guidance,
  onPromptInstall,
}: {
  guidance: Exclude<InstallGuidance, "completed">;
  onPromptInstall: () => Promise<InstallPromptOutcome>;
}) {
  if (guidance === "ios") return <IosInstallInstructions />;
  if (guidance === "native") return <NativeInstallPitch onPromptInstall={onPromptInstall} />;
  return <p className="text-xs text-muted">אפשר להוסיף את {APP_NAME} למסך הבית דרך תפריט הדפדפן.</p>;
}

/** (D) Non-iOS browser exposing a real `beforeinstallprompt` -- the ONLY place `promptInstall()` is ever invoked from, itself only ever reachable via this button's own click. */
function NativeInstallPitch({ onPromptInstall }: { onPromptInstall: () => Promise<InstallPromptOutcome> }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await onPromptInstall();
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <p className="text-sm font-semibold text-foreground">📲 התקינו את {APP_NAME}</p>
      <p className="mt-1 text-xs text-muted">הוסיפו אותה למסך הבית לחוויית אפליקציה מלאה ולהתראות אמינות.</p>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={1.75} />
        ) : (
          <Download className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        )}
        התקנה
      </button>
    </div>
  );
}

/** (E) iPhone/iPad, not standalone -- no native install API exists here, so this is instructions only, never a fake install action. Steps default collapsed; the trigger owns its own `aria-expanded`/`aria-controls`. */
function IosInstallInstructions() {
  const [expanded, setExpanded] = useState(false);
  const stepsId = useId();

  return (
    <div>
      <p className="text-sm font-semibold text-foreground">הוסיפו את {APP_NAME} למסך הבית</p>
      <p className="mt-1 text-xs text-muted">כדי להשתמש באפליקציה במסך מלא ולקבל התראות בצורה אמינה, הוסיפו אותה למסך הבית.</p>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={stepsId}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors duration-150 hover:underline"
      >
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
        )}
        איך מוסיפים למסך הבית?
      </button>
      {expanded ? (
        <ol id={stepsId} className="mt-2 list-decimal space-y-1 ps-4 text-xs text-muted">
          <li>לחצו על כפתור השיתוף</li>
          <li>בחרו „הוסף למסך הבית”</li>
          <li>פתחו את {APP_NAME} מהסמל החדש</li>
        </ol>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings view's manual installation entry point (spec point 8) -- always
// rendered whenever the app is not standalone, deliberately IGNORING the
// bell card's own dismissal cooldown (an intentional visit here must
// always work, even mid-cooldown).
// ---------------------------------------------------------------------------

function InstallSettingsSection({
  guidance,
  onPromptInstall,
}: {
  guidance: InstallGuidance;
  onPromptInstall: () => Promise<InstallPromptOutcome>;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-2">התקנת האפליקציה</p>
      <div className="mt-1.5">
        {guidance === "completed" ? (
          <div>
            <p className="text-sm font-semibold text-foreground">ההתקנה הושלמה</p>
            <p className="mt-1 text-xs text-muted">עכשיו פתח/י את {APP_NAME} מהסמל במסך הבית כדי להפעיל התראות.</p>
          </div>
        ) : (
          <InstallGuidanceBody guidance={guidance} onPromptInstall={onPromptInstall} />
        )}
      </div>
    </div>
  );
}
