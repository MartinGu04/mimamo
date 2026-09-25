// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildTakshalNotification, clampText, eventFingerprint, takshalEventIdForJob, TAKSHAL_LIMITS, toTakshalTag, toTakshalTarget } from "./notification";

const job = {
  id: "3f7a0c52-1d7e-4c1b-9a53-0d6b2f1e8c11",
  title: "שינוי במשמרת",
  body: "המשמרת שלך ביום ראשון עודכנה.",
  path: "/schedule",
  tag: "shift-change-p1-2026-09-27",
};

describe("event id", () => {
  it("is the job id, namespaced -- deterministic, so every retry of the job carries the same one", () => {
    expect(takshalEventIdForJob(job.id)).toBe("job:3f7a0c52-1d7e-4c1b-9a53-0d6b2f1e8c11");
    expect(takshalEventIdForJob(job.id)).toBe(takshalEventIdForJob(job.id));
    expect(buildTakshalNotification(job, "tester@example.com")?.eventId).toBe(buildTakshalNotification({ ...job, title: "retry" }, "tester@example.com")?.eventId);
  });

  it("fits the hub's event id format", () => {
    expect(takshalEventIdForJob(job.id)).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
  });

  it("is only ever logged as a short tail", () => {
    expect(eventFingerprint(takshalEventIdForJob(job.id))).toBe("…1e8c11");
  });
});

describe("target path mapping", () => {
  it.each([
    ["/schedule", "/schedule"],
    ["/duties", "/duties"],
    ["/shooting-ranges/manager", "/shooting-ranges/manager"],
    ["/", "/"],
  ])("keeps the job's own in-app path %s", (path, target) => {
    expect(toTakshalTarget(path)).toBe(target);
  });

  it.each([
    "https://evil.example/",
    "//evil.example",
    "javascript:alert(1)",
    "schedule",
    "/sched ule",
    "/schedule?x=<script>",
    "",
    null,
    undefined,
  ])("never sends anything but a safe relative path: %j -> /", (path) => {
    expect(toTakshalTarget(path)).toBe("/");
  });

  it("falls back to / for a path longer than the hub accepts", () => {
    expect(toTakshalTarget(`/${"a".repeat(TAKSHAL_LIMITS.target)}`)).toBe("/");
  });
});

describe("tag mapping", () => {
  it("is stable per job tag, fits the hub's pattern, and carries no id from the original", () => {
    const tag = toTakshalTag("tomorrow-duty-2026-09-27-3f7a0c52-1d7e-4c1b-9a53-0d6b2f1e8c11-shmira-evening");
    expect(tag).toMatch(/^machlava-[0-9a-f]{23}$/);
    expect(tag).toBe(toTakshalTag("tomorrow-duty-2026-09-27-3f7a0c52-1d7e-4c1b-9a53-0d6b2f1e8c11-shmira-evening"));
    expect(tag).not.toBe(toTakshalTag("tomorrow-duty-2026-09-28-3f7a0c52-1d7e-4c1b-9a53-0d6b2f1e8c11-shmira-evening"));
    expect(tag).not.toContain("3f7a0c52");
  });

  it("is omitted when the job has none", () => {
    expect(toTakshalTag(null)).toBeUndefined();
    expect(buildTakshalNotification({ ...job, tag: null }, "tester@example.com")).not.toHaveProperty("tag");
  });
});

describe("text", () => {
  it("passes the job's title and body through unchanged when within the hub's limits", () => {
    expect(buildTakshalNotification(job, "tester@example.com")).toEqual({
      eventId: "job:3f7a0c52-1d7e-4c1b-9a53-0d6b2f1e8c11",
      recipientEmail: "tester@example.com",
      title: "שינוי במשמרת",
      body: "המשמרת שלך ביום ראשון עודכנה.",
      target: "/schedule",
      tag: toTakshalTag(job.tag),
    });
  });

  it("shortens only what exceeds the hub's limits", () => {
    const built = buildTakshalNotification({ ...job, title: "t".repeat(200), body: "b".repeat(900) }, "tester@example.com")!;
    expect(built.title).toHaveLength(TAKSHAL_LIMITS.title);
    expect(built.title.endsWith("…")).toBe(true);
    expect(built.body).toHaveLength(TAKSHAL_LIMITS.body);
  });

  it("never splits an emoji when shortening", () => {
    const text = `${"x".repeat(8)}🐮🐮`;
    const clamped = clampText(text, 10);
    expect(clamped).toBe(`${"x".repeat(8)}…`);
    expect(() => encodeURIComponent(clamped)).not.toThrow();
  });

  it("is null when there is nothing to send (never an invalid request)", () => {
    expect(buildTakshalNotification({ ...job, title: "   " }, "tester@example.com")).toBeNull();
    expect(buildTakshalNotification({ ...job, body: "" }, "tester@example.com")).toBeNull();
  });
});
