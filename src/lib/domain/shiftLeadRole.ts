/**
 * Canonical recognizer for the אחמ"ש ("אחראי משמרת" -- shift lead) role
 * family in free-text role labels, so every raw-text classifier in this
 * codebase (schedule-cell parsing, Duty Fairness allocation labels, ...)
 * recognizes the SAME spellings instead of each growing its own isolated
 * exact-string check -- exactly the drift that let a masculine-only check
 * in `lib/parsers/event.ts` silently drop every feminine-form shift lead
 * (`אחמשית`) from "who is on shift with me".
 *
 * Covers the masculine (אחמ"ש / אחמש) and feminine (אחמ"שית / אחמשית)
 * forms, any quote-character variant that shows up interchangeably in the
 * real workbook (ASCII ", Hebrew gershayim ״, curly double/single quotes,
 * a straight apostrophe) or an optional hyphen in the quote's place, or no
 * separator at all between אחמ and ש.
 *
 * Classification only -- never returns/rewrites the matched text itself.
 * Callers keep whichever original raw text they already had for display.
 */
const QUOTE_OR_HYPHEN_CLASS = `["'׳״‘’“”-]`;
const SHIFT_LEAD_TOKEN_RE = new RegExp(`^אחמ${QUOTE_OR_HYPHEN_CLASS}?ש(ית)?$`);

/**
 * Whether `token` -- a single already-isolated word (leading/trailing
 * whitespace only, no surrounding sentence) -- is one of the recognized
 * אחמ"ש spelling variants. `false` for anything else, including a
 * superstring like `'אחמ"ש 2'` (callers isolate the role word first, e.g.
 * by splitting on the first space) or an unrelated role (`טכנאי`).
 */
export function isShiftLeadRoleToken(token: string): boolean {
  return SHIFT_LEAD_TOKEN_RE.test(token.trim());
}
