"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { GoogleGlyph } from "./GoogleGlyph";

interface GoogleSignInButtonProps {
  className?: string;
}

/**
 * The one real authentication action in the app. `pending` both drives the
 * "מתחבר..." feedback state and disables the button, so a double click (or
 * the round trip to Google) can never fire `signInWithOAuth` twice. OAuth
 * behavior itself (provider, redirect target, Supabase flow) is unchanged
 * from before the Design Pass -- this only redresses the button.
 *
 * One visual treatment at every viewport size (login redesign, real
 * production reference) -- the login route now uses a single fixed dark
 * canvas regardless of the app's light/dark preference, so the CTA never
 * needs a theme-responsive variant: a light/milky surface with a dark
 * label, a clear focal point against the midnight background at every
 * width.
 */
export function GoogleSignInButton({ className = "" }: GoogleSignInButtonProps) {
  const [pending, setPending] = useState(false);

  async function handleSignIn() {
    if (pending) return;
    setPending(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleSignIn}
        disabled={pending}
        aria-busy={pending}
        className={`flex h-[52px] w-full items-center justify-center gap-2.5 rounded-xl bg-[var(--login-cta-fixed-bg)] px-4 text-[15px] font-semibold text-[var(--login-cta-fixed-text)] shadow-[var(--shadow-login-cta-fixed)] transition-all duration-200 hover:bg-[var(--login-cta-fixed-bg-hover)] hover:shadow-[var(--shadow-login-cta-fixed-hover)] active:scale-[0.985] active:shadow-[var(--shadow-login-cta-fixed-active)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-[var(--shadow-login-cta-fixed)] disabled:hover:bg-[var(--login-cta-fixed-bg)] disabled:active:scale-100 lg:h-14 lg:gap-3 lg:rounded-2xl lg:px-5 lg:text-base xl:h-16 xl:px-6 xl:text-lg ${className}`}
      >
        {pending ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin xl:h-6 xl:w-6" aria-hidden="true" strokeWidth={2} />
            <span>מתחבר...</span>
          </>
        ) : (
          <>
            <GoogleGlyph className="h-5 w-5 xl:h-6 xl:w-6" />
            {/* "Google" marked `lang="en"` so Hebrew screen reader TTS
                switches pronunciation for this one English word instead of
                reading it with Hebrew letter-name phonetics -- the rest of
                the label stays plain Hebrew. */}
            <span>
              {"המשך עם "}
              <span lang="en">Google</span>
            </span>
          </>
        )}
      </button>
      {/* A SIBLING of the button, not a child of it -- its accessible name
          must stay exactly "מתחבר..." while pending, not that text plus
          this announcement concatenated. The visible label already changes
          for sighted users; a focused button's own text changing is not
          reliably announced without a live region, which this provides. */}
      {pending ? (
        <span role="status" className="sr-only">
          מתחבר, נא להמתין
        </span>
      ) : null}
    </>
  );
}
