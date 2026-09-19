"use client";

import { useId, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { StatusMessage } from "@/components/ui/StatusMessage";
import { submitSelfReportShootingRangeAction } from "@/lib/shootingRanges/actions";

const ERROR_LABELS: Record<string, string> = {
  unauthenticated: "יש להתחבר מחדש.",
  missing_email: "לא נמצא מייל משויך למשתמש/ת שלך.",
  unmapped: "המשתמש/ת שלך אינו/ה מזוהה/ת בכ״א.",
  ambiguous_identity: "המייל שלך משויך ליותר מרשומה אחת בכ״א.",
  invalid_date: "יש לבחור תאריך תקין.",
  date_in_future: "לא ניתן לדווח על מטווח בתאריך עתידי.",
  invalid_notes: "ההערה ארוכה מדי.",
};

function errorLabel(error: string): string {
  return ERROR_LABELS[error] ?? "השליחה נכשלה. נסה/י שוב.";
}

/** Server errors that are specifically about the "תאריך ביצוע" field -- everything else (auth/identity errors) isn't tied to any one input here. */
const DATE_FIELD_ERRORS = new Set(["invalid_date", "date_in_future"]);

/** "ביצעתי מטווח" -- the user's own self-report. Always lands as pending; only a manager's approval renews the qualification baseline (see `submitSelfReportShootingRangeAction`'s own docs). */
export function SelfReportForm() {
  const [open, setOpen] = useState(false);
  const [performedOn, setPerformedOn] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const errorId = useId();
  const dateInvalid = error !== null && DATE_FIELD_ERRORS.has(error);

  if (submitted) {
    return (
      <Panel variant="inline">
        <StatusMessage tone="success" className="text-center text-sm text-success">
          🟡 הדיווח נשלח וממתין לאישור מנהל.
        </StatusMessage>
      </Panel>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-strong"
      >
        ביצעתי מטווח
      </button>
    );
  }

  return (
    <Panel variant="compact" className="flex w-full max-w-sm flex-col gap-3 text-start">
      <p className="text-sm font-semibold text-foreground">דיווח ביצוע מטווח</p>

      <label className="flex flex-col gap-1 text-xs text-muted">
        תאריך ביצוע
        <input
          type="date"
          value={performedOn}
          onChange={(event) => setPerformedOn(event.target.value)}
          aria-invalid={dateInvalid || undefined}
          aria-describedby={dateInvalid ? errorId : undefined}
          className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-foreground"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted">
        הערות (לא חובה)
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={500}
          rows={2}
          className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm text-foreground"
        />
      </label>

      {error ? (
        <StatusMessage tone="error" id={errorId} className="text-xs text-critical">
          {errorLabel(error)}
        </StatusMessage>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isPending || !performedOn}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await submitSelfReportShootingRangeAction(performedOn, notes.trim() || null);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setSubmitted(true);
            });
          }}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-strong disabled:opacity-50"
        >
          {isPending ? "שולח..." : "שלח דיווח"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
        >
          ביטול
        </button>
      </div>
    </Panel>
  );
}
