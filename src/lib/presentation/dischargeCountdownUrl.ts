/**
 * "עד מתי???"'s view state lives in the URL, not in client tab state --
 * the same convention `FairnessModeToggle`/`fairnessUrl` already follow, so
 * each view stays directly linkable, shareable and back-button-safe. It is
 * also what gives the overview its "way back": browser Back returns from a
 * person's countdown to the roster for free, alongside the explicit link.
 */
export type DischargeCountdownView = "personal" | "everyone";

/**
 * Strict parse of `?view=` -- anything else (including missing) falls back
 * to the personal countdown, which is both the default and the safe answer
 * for a viewer who may not be allowed the roster at all.
 */
export function parseDischargeCountdownView(raw: string | string[] | null | undefined): DischargeCountdownView {
  return raw === "everyone" ? "everyone" : "personal";
}

/** Strict parse of `?person=` -- only a single, non-empty value is a selection. */
export function parseDischargeCountdownPersonId(raw: string | string[] | null | undefined): string | null {
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

/**
 * The personal countdown: a bare `/countdown` with no query at all, the same
 * "omit the default" idiom `fairnessShiftsHref` uses for its own default
 * mode.
 */
export function countdownPersonalHref(): string {
  return "/countdown";
}

/** The "כולם" overview. `view=everyone` is always explicit -- it is never the resolved default. */
export function countdownEveryoneHref(): string {
  return "/countdown?view=everyone";
}

/**
 * One person's full countdown, opened from the overview. Keeps `view=everyone`
 * alongside the person so the page knows this was reached from the roster and
 * can offer the way back to it.
 */
export function countdownPersonHref(personId: string): string {
  const search = new URLSearchParams({ view: "everyone", person: personId });
  return `/countdown?${search.toString()}`;
}
