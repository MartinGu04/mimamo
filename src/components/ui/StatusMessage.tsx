import type { ReactNode } from "react";

export type StatusMessageTone = "success" | "error";

interface StatusMessageProps {
  tone: StatusMessageTone;
  children: ReactNode;
  className?: string;
  /** Lets a specific invalid field's `aria-describedby` point at this exact message instead of relying only on the surrounding page announcing it. */
  id?: string;
}

/**
 * The one shared success/error action-outcome announcement primitive
 * (Phase 2 accessibility remediation) -- extracted from a repeated pattern
 * found across the app: a visually-styled result/confirmation/validation
 * message that was silent to screen readers, solved slightly differently
 * (or not at all) at every location. `tone="success"` (and any other purely
 * informational outcome -- a copy confirmation, an action that completed)
 * gets `role="status"`, whose implicit `aria-live="polite"` announces it
 * without interrupting whatever the user is doing; `tone="error"` gets
 * `role="alert"` (implicit assertive), for a validation/action failure that
 * needs immediate attention. Neither role needs an explicit `aria-live`
 * alongside it -- both already carry the right implicit live-region
 * semantics on their own.
 *
 * Deliberately carries NO default visual styling -- every call site keeps
 * its own existing classes/markup exactly as they were, only swapping its
 * outcome container's element for this one, so appearance never changes and
 * the correct semantics can never be solved differently (or forgotten
 * entirely) at a new location.
 */
export function StatusMessage({ tone, children, className, id }: StatusMessageProps) {
  return (
    <div id={id} role={tone === "error" ? "alert" : "status"} className={className}>
      {children}
    </div>
  );
}
