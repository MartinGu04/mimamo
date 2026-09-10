import type { AbsenceKind, DutyFamily, EventCategory, EventPeriod } from "@/lib/domain/event";

/**
 * A small, FIXED 11-slot semantic color palette for calendar events --
 * "which of the small set of recognizable meanings is this", never a
 * color per raw `dutyFamily`/`absenceKind` enum member. Same input
 * contract as `emoji.ts`'s `AssignmentEmojiInput` (typed domain fields
 * only, never `rawValue`/`title` free text), and the SAME precedence
 * order (absence kind -> duty family -> shift period) -- but this is its
 * own, separately-reasoned mapping, not derived from the emoji choices.
 *
 * Originally an 8-slot palette (shift day/night, vacation, after,
 * referral, evacuation on-call, guard, kitchen); a follow-up pass added
 * 3 more slots for the remaining meaningful types that previously fell
 * back to neutral: `reserve`+`callup` share one "military/reserve" color,
 * `medical`+`day_off` share one "medical/rest" color, and shift
 * `period: "morning"` got its own color. Still deliberately NOT every
 * `DutyFamily`/`AbsenceKind`/`EventPeriod` value -- `rasar`/`oxid` (duty)
 * and shift `period: "unspecified"` stay unmapped (`null`), same
 * graceful-degradation contract as `assignmentEmoji`: there is no
 * existing semantic color/emoji for these anywhere else in the codebase
 * to reuse, and "a small, coherent palette" was the explicit brief, not
 * a rainbow of one color per enum value. `null` always means "no color",
 * never a guessed/generic one.
 *
 * The 11 hues/hex values themselves live in `globals.css` as `--event-*`
 * tokens (light+dark), reusing this repo's own dataviz categorical-color
 * method (CVD/contrast-validated against hamachlava's real light AND dark
 * calendar surfaces) rather than hand-picked ones. The original 8 hues
 * (blue/orange/aqua/yellow/magenta/green/violet/red) fully occupy that
 * method's validated 8-hue set, so the 3 added slots (an olive/khaki,
 * a teal, and a plum/orchid) are additional hues chosen and validated the
 * same way -- checked pairwise against all 8 original hues (and each
 * other) for CVD separation/contrast on both real surfaces. Every new
 * hue clears the full check against every ORIGINAL slot in light mode;
 * a small number of close-but-passing pairs remain among the crowded
 * 11-hue set (documented on each token in `globals.css`) -- an accepted,
 * clearly-flagged tradeoff, same as this palette's own pre-existing
 * contrast-WARN tradeoffs, mitigated by this color always being a
 * SECONDARY cue layered on top of the emoji + label, never the sole way
 * to tell two events apart.
 *
 * Applied ONLY as a soft background tint on the existing indicator chip
 * (`eventColorBgClassName`) -- never on text, never the sole identity
 * carrier. The emoji + short label stay the primary way to recognize an
 * event; color is a secondary "at a glance" scanning aid layered on top,
 * matching this app's existing restrained `--status-*-soft` tinting
 * convention (see `globals.css`).
 */
export interface EventColorInput {
  category: EventCategory;
  period: EventPeriod;
  dutyFamily: DutyFamily | null;
  absenceKind: AbsenceKind | null;
}

/** The 11 fixed semantic slots -- see the module doc for why exactly these 11 and not one per raw enum value. */
export type EventColorKey =
  | "shift-day"
  | "shift-night"
  | "shift-morning"
  | "vacation"
  | "after"
  | "referral"
  | "medical-rest"
  | "evacuation"
  | "guard"
  | "reserve"
  | "kitchen";

const DUTY_FAMILY_COLOR: Partial<Record<DutyFamily, EventColorKey>> = {
  guard: "guard",
  reserve: "reserve",
  callup: "reserve",
  evacuation_on_call: "evacuation",
  full_kitchen: "kitchen",
  daily_kitchen: "kitchen",
  weekend_kitchen: "kitchen",
  // rasar/oxid: no existing semantic color/emoji anywhere else in the
  // codebase to reuse, and outside the coherent palette this small set
  // is meant to stay -- left unmapped rather than inventing one.
};

const ABSENCE_COLOR: Partial<Record<AbsenceKind, EventColorKey>> = {
  vacation: "vacation",
  abroad: "vacation",
  after: "after",
  referral: "referral",
  medical: "medical-rest",
  day_off: "medical-rest",
};

/**
 * The semantic color slot for one event, or `null` when nothing in the
 * 11-slot palette applies (an unmapped duty family -- rasar/oxid -- a
 * shift with `period: "unspecified"`, or any non-calendar category).
 * Precedence: absence kind -> duty family -> shift period, same order as
 * `assignmentEmoji`.
 */
export function eventColorKey(input: EventColorInput): EventColorKey | null {
  if (input.category === "absence" && input.absenceKind) {
    return ABSENCE_COLOR[input.absenceKind] ?? null;
  }
  if (input.category === "duty" && input.dutyFamily) {
    return DUTY_FAMILY_COLOR[input.dutyFamily] ?? null;
  }
  if (input.category === "shift") {
    if (input.period === "day") return "shift-day";
    if (input.period === "night") return "shift-night";
    if (input.period === "morning") return "shift-morning";
    // unspecified: outside the palette -- left unmapped.
  }
  return null;
}

const EVENT_COLOR_SOFT_BG_CLASS: Record<EventColorKey, string> = {
  "shift-day": "bg-event-shift-day-soft",
  "shift-night": "bg-event-shift-night-soft",
  "shift-morning": "bg-event-shift-morning-soft",
  vacation: "bg-event-vacation-soft",
  after: "bg-event-after-soft",
  referral: "bg-event-referral-soft",
  "medical-rest": "bg-event-medical-rest-soft",
  evacuation: "bg-event-evacuation-soft",
  guard: "bg-event-guard-soft",
  reserve: "bg-event-reserve-soft",
  kitchen: "bg-event-kitchen-soft",
};

/**
 * The Tailwind soft-background-tint class for one event's semantic
 * color, or `null` for an unmapped event -- the caller then keeps its
 * own existing neutral background unchanged. Never a text color class:
 * this app's convention (see `globals.css`'s `--status-*` tokens) keeps
 * text on its own neutral ink tokens, colored marks/tints carry identity.
 */
export function eventColorBgClassName(input: EventColorInput): string | null {
  const key = eventColorKey(input);
  return key ? EVENT_COLOR_SOFT_BG_CLASS[key] : null;
}
