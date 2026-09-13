import { describe, expect, it } from "vitest";
import { requiresNotificationFloodRecovery } from "./notificationFloodRecovery";

describe("requiresNotificationFloodRecovery", () => {
  it("requires the one-time repair for the incident week's incomplete marker", () => {
    expect(
      requiresNotificationFloodRecovery(
        { initialized: true, currentWeekStart: "2026-09-13", updatedAt: "2026-09-12T21:05:00.000Z" },
        "2026-09-13",
      ),
    ).toBe(true);
  });

  it("also repairs the first reseed that exposed jsonb key-order false positives", () => {
    expect(
      requiresNotificationFloodRecovery(
        { initialized: true, currentWeekStart: "2026-09-13", updatedAt: "2026-09-12T21:55:00.000Z" },
        "2026-09-13",
      ),
    ).toBe(true);
  });

  it("stays complete after the final successful repair advances updated_at", () => {
    expect(
      requiresNotificationFloodRecovery(
        { initialized: true, currentWeekStart: "2026-09-13", updatedAt: "2026-09-13T07:45:00.000Z" },
        "2026-09-13",
      ),
    ).toBe(false);
  });

  it("never affects any other operational week", () => {
    expect(
      requiresNotificationFloodRecovery(
        { initialized: true, currentWeekStart: "2026-09-20", updatedAt: null },
        "2026-09-20",
      ),
    ).toBe(false);
  });
});
