import type {
  AbsenceKind,
  DutyFamily,
  Event,
  EventCategory,
  EventPeriod,
  EventRole,
} from "@/lib/domain/event";
import { isShiftLeadRoleToken } from "@/lib/domain/shiftLeadRole";
import type { RawAssignment } from "./types";

/**
 * Turns one structurally-extracted RawAssignment into a typed, semantically
 * classified Event. `rawValue` is passed through completely untouched;
 * everything else is derived from a normalized copy of the text used only
 * for classification/display.
 *
 * Classification runs in a fixed priority order (see classify() below) so
 * e.g. a change-note string is never accidentally read as an active duty
 * just because it starts with a known duty name.
 */
export function parseEvent(raw: RawAssignment): Event {
  const trimmedRaw = raw.rawValue.trim();
  const tentative = trimmedRaw.endsWith("?");
  const withoutTentativeMarker = tentative ? trimmedRaw.slice(0, -1).trim() : trimmedRaw;
  const normalizedText = normalizeText(withoutTentativeMarker);

  const classification = classify(normalizedText);
  const title = normalizedText !== "" ? normalizedText : trimmedRaw;

  return {
    personId: raw.personId,
    personName: raw.personName,
    date: raw.date,
    title,
    rawValue: raw.rawValue,
    category: classification.category,
    certainty: tentative ? "tentative" : "confirmed",
    role: classification.role ?? null,
    period: classification.period ?? "unspecified",
    sourceSheet: raw.sourceSheet,
    sourceCell: raw.sourceCell,
    slot: classification.slot ?? null,
    shadow: classification.shadow ?? false,
    startTimeOverride: classification.startTimeOverride ?? null,
    endTimeOverride: classification.endTimeOverride ?? null,
    changeNote: classification.changeNote ?? null,
    dutyFamily: classification.dutyFamily ?? null,
    absenceKind: classification.absenceKind ?? null,
  };
}

// ---------------------------------------------------------------------------
// Text normalization (classification/display only — never applied to rawValue)
// ---------------------------------------------------------------------------

/** Unicode dash variants that show up interchangeably with a plain "-". */
const DASH_VARIANTS_RE = /[‐‑‒–—―־]/g;

function normalizeText(text: string): string {
  return text.replace(DASH_VARIANTS_RE, "-").replace(/\s+/g, " ").trim();
}

function normalizeTime(raw: string): string {
  const [hourPart, minutePart] = raw.split(":");
  const hour = hourPart.padStart(2, "0");
  const minute = (minutePart ?? "00").padStart(2, "0");
  return `${hour}:${minute}`;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

interface ClassificationResult {
  category: EventCategory;
  role?: EventRole;
  period?: EventPeriod;
  shadow?: boolean;
  startTimeOverride?: string | null;
  endTimeOverride?: string | null;
  dutyFamily?: DutyFamily | null;
  slot?: number | null;
  changeNote?: string | null;
  absenceKind?: AbsenceKind | null;
}

/**
 * Priority order: change note > shift/duty > absence/constraint >
 * status/context > other/unknown. Each tier is a small structured matcher,
 * not a giant exact-string switch, and none of them do fuzzy matching —
 * unrecognized text simply falls through to "other".
 */
function classify(text: string): ClassificationResult {
  if (text === "") {
    return { category: "unknown" };
  }

  if (isChangeNote(text)) {
    return { category: "change_note", changeNote: text };
  }

  const shift = parseShift(text);
  if (shift) return { category: "shift", ...shift };

  const duty = parseDuty(text);
  if (duty) return { category: "duty", ...duty };

  const absenceKind = ABSENCE_KIND_BY_PHRASE[text];
  if (absenceKind) {
    return { category: "absence", absenceKind };
  }

  const constraintPeriod = parseConstraint(text);
  if (constraintPeriod) {
    return { category: "constraint", period: constraintPeriod };
  }

  if (STATUS_PHRASES.has(text) || RIVUACH_RE.test(text)) {
    return { category: "status" };
  }

  if (CONTEXT_PHRASES.has(text)) {
    return { category: "context" };
  }

  return { category: "other" };
}

// --- 1. Change note ---------------------------------------------------------

/** e.g. "אוקסיד - הוחלף עם ..." — a note about a swap, not an active duty. */
const CHANGE_NOTE_MARKER = "הוחלף";

function isChangeNote(text: string): boolean {
  return text.includes(CHANGE_NOTE_MARKER);
}

// --- 2a. Shift ---------------------------------------------------------------

const TECHNICIAN_TOKENS = ["טכנאי", "טכנאית"];
const SHIFT_PERIOD_TOKENS: Record<string, EventPeriod> = { יום: "day", לילה: "night" };
/** "- צל" or "צל" -- the hyphen before צל is cosmetic and optional. */
const SHADOW_MODIFIER_RE = /^-?\s*צל$/;
/** "מ-12", "מ- 12:00", "מ 12", "עד 12", "עד 12:00" */
const PARTIAL_TIME_RE = /^(מ|עד)-?\s*(\d{1,2}(?::\d{2})?)$/;

interface ShiftMatch {
  role: EventRole;
  period: EventPeriod;
  shadow: boolean;
  startTimeOverride: string | null;
  endTimeOverride: string | null;
}

function parseShift(text: string): ShiftMatch | null {
  const roleMatch = matchLeadingRoleToken(text);
  if (!roleMatch) return null;

  const { role, rest } = roleMatch;

  if (rest === "") {
    return { role, period: "unspecified", shadow: false, startTimeOverride: null, endTimeOverride: null };
  }

  const periodMatch = stripLeadingToken(rest, Object.keys(SHIFT_PERIOD_TOKENS));
  if (!periodMatch) return null;

  const period = SHIFT_PERIOD_TOKENS[periodMatch.token];
  const modifier = periodMatch.rest;

  if (modifier === "") {
    return { role, period, shadow: false, startTimeOverride: null, endTimeOverride: null };
  }

  if (SHADOW_MODIFIER_RE.test(modifier)) {
    return { role, period, shadow: true, startTimeOverride: null, endTimeOverride: null };
  }

  const timeMatch = modifier.match(PARTIAL_TIME_RE);
  if (timeMatch) {
    const [, prefix, time] = timeMatch;
    const normalizedTime = normalizeTime(time);
    return {
      role,
      period,
      shadow: false,
      startTimeOverride: prefix === "מ" ? normalizedTime : null,
      endTimeOverride: prefix === "עד" ? normalizedTime : null,
    };
  }

  return null;
}

/**
 * The leading role word of a shift cell (`text` up to the first space, or
 * all of `text` when there's no space) classified via the canonical
 * `isShiftLeadRoleToken` for the shift-lead family (any אחמ"ש spelling
 * variant, masculine or feminine) and the fixed `TECHNICIAN_TOKENS` list
 * otherwise. Returns the resolved role and whatever comes after that one
 * separating space. Unlike `stripLeadingToken`, the matched token's length
 * is never assumed in advance -- the shift-lead family has more than one
 * valid spelling length -- so the split happens on the first space instead.
 */
function matchLeadingRoleToken(text: string): { role: EventRole; rest: string } | null {
  const spaceIndex = text.indexOf(" ");
  const token = spaceIndex === -1 ? text : text.slice(0, spaceIndex);
  const rest = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

  if (isShiftLeadRoleToken(token)) return { role: "supervisor", rest };
  if (TECHNICIAN_TOKENS.includes(token)) return { role: "technician", rest };
  return null;
}

/**
 * If `text` is exactly one of `tokens`, or starts with one of them followed
 * by a space, returns the matched token and whatever comes after it
 * (trimmed of that one separating space). Otherwise null.
 */
function stripLeadingToken(
  text: string,
  tokens: readonly string[],
): { token: string; rest: string } | null {
  for (const token of tokens) {
    if (text === token) return { token, rest: "" };
    if (text.startsWith(`${token} `)) return { token, rest: text.slice(token.length + 1) };
  }
  return null;
}

// --- 2b. Duty ----------------------------------------------------------------

const EXACT_DUTY_PHRASES: Record<string, DutyFamily> = {
  "כונן פינויים": "evacuation_on_call",
  "מטבח מלא": "full_kitchen",
  "מטבח יומי": "daily_kitchen",
  'סופ"ש מטבח': "weekend_kitchen",
  'רס"ר': "rasar",
  'ררס"ר': "rasar",
  אוקסיד: "oxid",
  'הקפצה - רס"ר': "callup",
  "הקפצת פסח": "callup",
};

/** "שומר 1" / "שומר2" — same family, the number is just a slot. */
const GUARD_RE = /^שומר\s*(\d+)$/;
/** "עתודה 1" / "עתודה2" — same family, the number is just a slot. */
const RESERVE_RE = /^עתודה\s*(\d+)$/;

interface DutyMatch {
  dutyFamily: DutyFamily;
  slot: number | null;
}

function parseDuty(text: string): DutyMatch | null {
  const exactFamily = EXACT_DUTY_PHRASES[text];
  if (exactFamily) return { dutyFamily: exactFamily, slot: null };

  const guardMatch = text.match(GUARD_RE);
  if (guardMatch) return { dutyFamily: "guard", slot: Number(guardMatch[1]) };

  const reserveMatch = text.match(RESERVE_RE);
  if (reserveMatch) return { dutyFamily: "reserve", slot: Number(reserveMatch[1]) };

  return null;
}

// --- 3. Absence / constraint --------------------------------------------------

const ABSENCE_KIND_BY_PHRASE: Record<string, AbsenceKind> = {
  חופש: "vacation",
  'חו"ל': "abroad",
  גימלים: "medical",
  "יום ד": "day_off",
  אפטר: "after",
  הפנייה: "referral",
  הפניה: "referral",
};

const CONSTRAINT_TOKEN = "אילוץ";
const CONSTRAINT_PERIOD_TOKENS: Record<string, EventPeriod> = {
  יום: "day",
  לילה: "night",
  בוקר: "morning",
};

function parseConstraint(text: string): EventPeriod | null {
  if (text === CONSTRAINT_TOKEN) return "unspecified";
  const match = stripLeadingToken(text, [CONSTRAINT_TOKEN]);
  if (!match || match.rest === "") return null;
  return CONSTRAINT_PERIOD_TOKENS[match.rest] ?? null;
}

// --- 4. Status / context -------------------------------------------------------

const STATUS_PHRASES = new Set(["סוגר"]);
/** "ריווח" / "ריווח 1" — planning/status, not a duty. */
const RIVUACH_RE = /^ריווח(?:\s+\d+)?$/;

const CONTEXT_PHRASES = new Set(["מלחמה"]);
