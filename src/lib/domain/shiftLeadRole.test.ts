import { describe, expect, it } from "vitest";
import { isShiftLeadRoleToken } from "./shiftLeadRole";

describe("isShiftLeadRoleToken", () => {
  it.each([
    'אחמ"ש',
    "אחמש",
    'אחמ"שית',
    "אחמשית",
    "אחמ״ש", // Hebrew gershayim
    "אחמ׳ש", // Hebrew geresh
    "אחמ'ש", // ASCII apostrophe
    "אחמ-ש", // hyphen in place of a quote
    "אחמ-שית",
  ])("recognizes '%s' as a shift-lead role token", (token) => {
    expect(isShiftLeadRoleToken(token)).toBe(true);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(isShiftLeadRoleToken('  אחמ"ש  ')).toBe(true);
    expect(isShiftLeadRoleToken(" אחמשית ")).toBe(true);
  });

  it.each(["טכנאי", "טכנאית", "אחמד", "אחמ", "אחמששית", 'אחמ"שיתת', "", "אחמ ש"])(
    "does not recognize '%s' as a shift-lead role token",
    (token) => {
      expect(isShiftLeadRoleToken(token)).toBe(false);
    },
  );
});
