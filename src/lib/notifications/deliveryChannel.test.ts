// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELIVERY_CHANNEL,
  planDeliveryChannels,
  resolveNotificationDeliveryChannel,
  testRecipientAllowlistPolicy,
  type DeliveryChannelPolicy,
  type NotificationDeliveryChannel,
} from "./deliveryChannel";

const tester = { userId: "user-tester", verifiedEmail: "tester@example.com" };
const colleague = { userId: "user-colleague", verifiedEmail: "colleague@example.com" };
const unverified = { userId: "user-unverified", verifiedEmail: null };

const fixed = (channel: NotificationDeliveryChannel): DeliveryChannelPolicy => ({ channelFor: () => channel });

describe("planDeliveryChannels", () => {
  it.each([
    ["direct", { direct: true, takshal: false }],
    ["takshal", { direct: false, takshal: true }],
    ["both", { direct: true, takshal: true }],
  ] as const)("%s -> %o", (channel, plan) => {
    expect(planDeliveryChannels(channel)).toEqual(plan);
  });

  it("the default is the existing direct-only behavior", () => {
    expect(DEFAULT_DELIVERY_CHANNEL).toBe("direct");
    expect(planDeliveryChannels(DEFAULT_DELIVERY_CHANNEL)).toEqual({ direct: true, takshal: false });
  });
});

describe("resolveNotificationDeliveryChannel", () => {
  it.each(["direct", "takshal", "both"] as const)("follows a policy that answers %s", (channel) => {
    expect(resolveNotificationDeliveryChannel(tester, fixed(channel))).toBe(channel);
  });

  it("no policy (channel not configured / nobody rolled out) -> direct", () => {
    expect(resolveNotificationDeliveryChannel(tester, null)).toBe("direct");
  });

  it.each(["takshal", "both"] as const)("a %s decision without a verified email falls back to direct -- never dropped", (channel) => {
    expect(resolveNotificationDeliveryChannel(unverified, fixed(channel))).toBe("direct");
  });

  it("a throwing policy -> direct", () => {
    const broken: DeliveryChannelPolicy = {
      channelFor: () => {
        throw new Error("preference store down");
      },
    };
    expect(resolveNotificationDeliveryChannel(tester, broken)).toBe("direct");
  });

  it.each([undefined, null, "", "TAKSHAL", "email", 1])("an unexpected policy answer (%j) -> direct", (answer) => {
    const odd = { channelFor: () => answer } as unknown as DeliveryChannelPolicy;
    expect(resolveNotificationDeliveryChannel(tester, odd)).toBe("direct");
  });
});

describe("testRecipientAllowlistPolicy (temporary rollout)", () => {
  const policy = testRecipientAllowlistPolicy(new Set(["tester@example.com"]));

  it("allowlisted test recipient -> both", () => {
    expect(resolveNotificationDeliveryChannel(tester, policy)).toBe("both");
  });

  it("everyone else -> direct", () => {
    expect(resolveNotificationDeliveryChannel(colleague, policy)).toBe("direct");
    expect(resolveNotificationDeliveryChannel(unverified, policy)).toBe("direct");
  });

  it("an empty allowlist changes nobody", () => {
    const empty = testRecipientAllowlistPolicy(new Set());
    for (const recipient of [tester, colleague, unverified]) expect(resolveNotificationDeliveryChannel(recipient, empty)).toBe("direct");
  });

  it("matches on the verified email only -- never the user id", () => {
    const byId = testRecipientAllowlistPolicy(new Set(["user-tester"]));
    expect(resolveNotificationDeliveryChannel(tester, byId)).toBe("direct");
  });
});
