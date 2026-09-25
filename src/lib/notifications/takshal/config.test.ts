// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseTestRecipients, readTakshalConfig } from "./config";

const SECRET = "synthetic-source-secret-for-tests-0123456789";

describe("readTakshalConfig", () => {
  it("is disabled without a source secret -- whatever else is set", () => {
    expect(readTakshalConfig({})).toEqual({ status: "disabled" });
    expect(readTakshalConfig({ TAKSHAL_CTRL_SOURCE_SECRET: "   ", TAKSHAL_CTRL_HUB_URL: "https://hub.example", TAKSHAL_CTRL_TEST_RECIPIENTS: "a@example.com" })).toEqual({
      status: "disabled",
    });
  });

  it("reads a complete configuration and builds the source endpoint from the hub origin", () => {
    const result = readTakshalConfig({
      TAKSHAL_CTRL_HUB_URL: "https://takshal-ctrl.vercel.app/",
      TAKSHAL_CTRL_SOURCE_SECRET: ` ${SECRET} `,
      TAKSHAL_CTRL_TEST_RECIPIENTS: " Tester@Example.com , second@example.com",
    });
    expect(result).toEqual({
      status: "ok",
      config: {
        endpoint: "https://takshal-ctrl.vercel.app/api/source/machlava/notify",
        sourceSecret: SECRET,
        testRecipients: new Set(["tester@example.com", "second@example.com"]),
        ignoredTestRecipientEntries: 0,
      },
    });
  });

  it("has no default hub URL: a secret without one leaves the channel off, and says why without echoing values", () => {
    const result = readTakshalConfig({ TAKSHAL_CTRL_SOURCE_SECRET: SECRET });
    expect(result).toEqual({ status: "misconfigured", problem: expect.stringContaining("TAKSHAL_CTRL_HUB_URL") });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it.each([
    "takshal-ctrl.vercel.app",
    "http://takshal-ctrl.vercel.app",
    "https://user:pw@takshal-ctrl.vercel.app",
    "https://takshal-ctrl.vercel.app/api/source/machlava/notify",
    "https://takshal-ctrl.vercel.app/?x=1",
    "https://takshal-ctrl.vercel.app/#x",
    "javascript:alert(1)",
    "ftp://takshal-ctrl.vercel.app",
  ])("refuses hub URL %j", (hubUrl) => {
    const result = readTakshalConfig({ TAKSHAL_CTRL_SOURCE_SECRET: SECRET, TAKSHAL_CTRL_HUB_URL: hubUrl });
    expect(result.status).toBe("misconfigured");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("allows plain http only for a local hub (vercel dev)", () => {
    const result = readTakshalConfig({ TAKSHAL_CTRL_SOURCE_SECRET: SECRET, TAKSHAL_CTRL_HUB_URL: "http://localhost:3000" });
    expect(result).toMatchObject({ status: "ok", config: { endpoint: "http://localhost:3000/api/source/machlava/notify" } });
  });

  it("an absent or empty allowlist yields an empty set (nobody rolled out)", () => {
    for (const TAKSHAL_CTRL_TEST_RECIPIENTS of [undefined, "", " , ,"]) {
      const result = readTakshalConfig({ TAKSHAL_CTRL_SOURCE_SECRET: SECRET, TAKSHAL_CTRL_HUB_URL: "https://hub.example", TAKSHAL_CTRL_TEST_RECIPIENTS });
      expect(result).toMatchObject({ status: "ok", config: { testRecipients: new Set() } });
    }
  });

  it("counts malformed allowlist entries without keeping them", () => {
    const result = readTakshalConfig({ TAKSHAL_CTRL_SOURCE_SECRET: SECRET, TAKSHAL_CTRL_HUB_URL: "https://hub.example", TAKSHAL_CTRL_TEST_RECIPIENTS: "tester@example.com, tester@example" });
    expect(result).toMatchObject({ status: "ok", config: { testRecipients: new Set(["tester@example.com"]), ignoredTestRecipientEntries: 1 } });
  });

  it("never reads NEXT_PUBLIC_-prefixed copies", () => {
    expect(
      readTakshalConfig({
        NEXT_PUBLIC_TAKSHAL_CTRL_SOURCE_SECRET: SECRET,
        NEXT_PUBLIC_TAKSHAL_CTRL_HUB_URL: "https://hub.example",
        NEXT_PUBLIC_TAKSHAL_CTRL_TEST_RECIPIENTS: "tester@example.com",
      }),
    ).toEqual({ status: "disabled" });
  });
});

describe("parseTestRecipients", () => {
  it("normalizes, de-duplicates, and accepts comma/semicolon/whitespace separators", () => {
    const { recipients, invalidCount } = parseTestRecipients("A@example.com,a@EXAMPLE.com ; b@example.com\nc@example.com");
    expect(recipients).toEqual(new Set(["a@example.com", "b@example.com", "c@example.com"]));
    expect(invalidCount).toBe(0);
  });

  it("drops malformed entries and counts them", () => {
    const { recipients, invalidCount } = parseTestRecipients("ok@example.com, not-an-email, @example.com, x@y");
    expect(recipients).toEqual(new Set(["ok@example.com"]));
    expect(invalidCount).toBe(3);
  });
});
