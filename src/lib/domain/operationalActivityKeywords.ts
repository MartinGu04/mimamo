import type { Event } from "./event";

/**
 * Narrow, explicit keyword detectors for the small, fixed set of
 * "other"-category schedule-cell activities this app treats as real,
 * presence-implying operational facts even though `classify()` has no
 * dedicated category/`DutyFamily` for any of them (see `parseEvent`'s own
 * docstring: unrecognized text simply falls through to `category:
 * "other"`, preserved verbatim in `Event.title`).
 *
 * Originally private to `lib/domain/reportOne.ts` ("דוח 1" was the first
 * consumer); extracted here once the team-week matrix
 * (`lib/readModels/buildScheduleTeamWeekView.ts`) became a SECOND
 * domain/readModels-layer consumer that needs the exact same three
 * keywords -- so a bug fix, or a future fourth keyword, is never applied
 * twice and can never quietly drift between the two call sites.
 *
 * Deliberately still NOT imported from
 * `lib/notifications/engine/logisticsWithdrawal.ts`'s own
 * `isLogisticsWithdrawalEvent` (the historical origin of the `משיכות`
 * keyword/rule) -- this module stays domain-layer only, and a feature
 * layer built ON TOP of domain (the notifications engine) is never
 * something domain imports from (see this repo's engineering rules on
 * layer separation). That module's own detector is kept in sync with this
 * one BY INSPECTION, not import, exactly as it always has been.
 *
 * Every check here is a plain substring match (never a full-string
 * match), so a longer real phrasing ("משיכות מהלוגיסטיקה", "מטווח בוקר")
 * is still caught by its one short keyword -- `event.title` is already
 * whitespace/dash-normalized by `parseEvent`, so none of this needs to
 * redo that normalization itself.
 */
export const WITHDRAWAL_KEYWORD = "משיכות";
/** "הסמכה" -- a certification activity. Same "other"-category situation as `WITHDRAWAL_KEYWORD`: no dedicated `DutyFamily`/column exists for it either. */
export const CERTIFICATION_KEYWORD = "הסמכה";
/**
 * "מטווח" -- a shooting range activity. Matched on the singular (a
 * substring of the plural "מטווחים" too, so both spellings are caught by
 * one `.includes()` check).
 */
const SHOOTING_RANGE_KEYWORD = "מטווח";

/** True for an `Event` whose free-text "other" classification names a logistics-withdrawal assignment ("משיכות"/"משיכות מהלוגיסטיקה"). */
export function isWithdrawalEvent(event: Event): boolean {
  return event.category === "other" && event.title.includes(WITHDRAWAL_KEYWORD);
}

/** Same shape/rule as `isWithdrawalEvent`, for the sibling `הסמכה` keyword. */
export function isCertificationEvent(event: Event): boolean {
  return event.category === "other" && event.title.includes(CERTIFICATION_KEYWORD);
}

/** Same shape/rule as `isWithdrawalEvent`, for the sibling `מטווח`/`מטווחים` keyword. */
export function isShootingRangeEvent(event: Event): boolean {
  return event.category === "other" && event.title.includes(SHOOTING_RANGE_KEYWORD);
}

/**
 * True for ANY of the three narrow "other"-category exceptions above --
 * the one call a consumer that doesn't care WHICH specific activity it is
 * (only "is this a recognized real operational activity, not arbitrary
 * unrecognized 'other' text") should make. Used by the team-week matrix's
 * own category filter so a real activity like "מטווחים" survives into the
 * matrix alongside a same-day shift/duty/absence, without opening the
 * door to every unrelated `category: "other"` string.
 */
export function isRecognizedOperationalActivityEvent(event: Event): boolean {
  return isWithdrawalEvent(event) || isCertificationEvent(event) || isShootingRangeEvent(event);
}
