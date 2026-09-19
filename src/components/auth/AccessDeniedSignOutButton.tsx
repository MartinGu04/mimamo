"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/**
 * `AccessDeniedScreen`'s sign-out submit button, split into its own client
 * component so `useFormStatus` reflects the enclosing
 * `<form action={signOutAction}>`'s real pending state -- disabling the
 * button and swapping in a spinner for the network round trip, so a
 * second tap can't fire a duplicate sign-out.
 */
export function AccessDeniedSignOutButton() {
  const { pending } = useFormStatus();

  return (
    <>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-primary underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:no-underline"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={2} /> : null}
        {pending ? "מתנתק..." : "התנתקות"}
      </button>
      {/* A SIBLING of the button, not a child -- keeps its accessible name
          exactly "מתנתק..." rather than that text plus this announcement
          concatenated. */}
      {pending ? (
        <span role="status" className="sr-only">
          מתנתק, נא להמתין
        </span>
      ) : null}
    </>
  );
}
