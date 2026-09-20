"use client";

import { useFormStatus } from "react-dom";
import { Loader2, LogOut } from "lucide-react";
import { unsubscribeCurrentPushSubscription } from "@/lib/push/browserSubscription";
import { clearUserScopedDevicePreferences } from "@/lib/auth/clearUserScopedDevicePreferences";

interface IdentityFooterSignOutButtonProps {
  /** The signing-out user's own id -- see `clearUserScopedDevicePreferences`'s own docstring for why this must be exactly this user's id, never a client-supplied/guessed value. */
  userId: string;
}

/**
 * `IdentityFooter`'s sign-out submit button, split into its own client
 * component so `useFormStatus` reflects the enclosing
 * `<form action={signOutAction}>`'s real pending state -- disabling the
 * button and swapping in a spinner for the network round trip, so a
 * second tap can't fire a duplicate sign-out.
 *
 * The `onClick` fires two best-effort, fire-and-forget local cleanups
 * ALONGSIDE the normal form submission -- `unsubscribeCurrentPushSubscription()`
 * (PR #29) and, since Privacy Phase 9B,
 * `clearUserScopedDevicePreferences(userId)` (removes this user's
 * `localStorage`-scoped push/install-prompt/setup-card preferences so
 * they don't linger on a shared device after sign-out). Neither ever
 * calls `preventDefault()`, so neither can delay or block sign-out. Both
 * are independent of (and race harmlessly with) `signOutAction`'s own
 * server-side subscription-row cleanup: these only touch the browser's
 * local Service Worker/push state and `localStorage`, never this app's
 * own session/cookies.
 */
export function IdentityFooterSignOutButton({ userId }: IdentityFooterSignOutButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      onClick={() => {
        clearUserScopedDevicePreferences(userId);
        unsubscribeCurrentPushSubscription();
      }}
      aria-label={pending ? "מתנתק..." : "התנתקות"}
      aria-busy={pending}
      disabled={pending}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-critical/80 transition-colors duration-200 hover:bg-critical/10 hover:text-critical focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-critical disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? (
        <Loader2 className="h-[16px] w-[16px] animate-spin" aria-hidden="true" strokeWidth={1.75} />
      ) : (
        <LogOut className="h-[16px] w-[16px]" aria-hidden="true" strokeWidth={1.75} />
      )}
    </button>
  );
}
