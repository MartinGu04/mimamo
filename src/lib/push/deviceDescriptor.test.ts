import { describe, expect, it } from "vitest";
import {
  UNKNOWN_DEVICE_DESCRIPTOR,
  describeDevice,
  parseDeviceDescriptor,
  type PushDeviceDescriptor,
} from "./deviceDescriptor";

function ua(userAgent: string, overrides: Partial<Parameters<typeof describeDevice>[0]> = {}) {
  return describeDevice({ userAgent, platform: "", maxTouchPoints: 0, standalone: false, ...overrides });
}

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0";
const ANDROID_PHONE_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const LINUX_FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0";
const SAMSUNG_INTERNET =
  "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36";

describe("describeDevice -- platform", () => {
  it("recognizes an iPhone", () => {
    expect(ua(IPHONE_SAFARI).platform).toBe("ios");
  });

  it("recognizes a classic iPad by its UA token", () => {
    expect(ua("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Version/17.0 Safari/604.1").platform).toBe("ipados");
  });

  it("recognizes modern desktop-class iPadOS, which is indistinguishable from a Mac by UA alone", () => {
    // Same MacIntel + touch-points distinction `lib/pwa/installState.ts`
    // already makes for install guidance -- never a second heuristic.
    expect(ua(MAC_SAFARI, { platform: "MacIntel", maxTouchPoints: 5 }).platform).toBe("ipados");
  });

  it("does NOT mistake a real Mac (no touch points) for an iPad", () => {
    expect(ua(MAC_SAFARI, { platform: "MacIntel", maxTouchPoints: 0 }).platform).toBe("macos");
  });

  it.each([
    [ANDROID_PHONE_CHROME, "android"],
    [WINDOWS_CHROME, "windows"],
    [LINUX_FIREFOX, "linux"],
  ])("recognizes %s as %s", (userAgent, expected) => {
    expect(ua(userAgent).platform).toBe(expected);
  });

  it("reports null rather than guessing for an empty User-Agent", () => {
    expect(ua("").platform).toBeNull();
    expect(ua("").browser).toBeNull();
    expect(ua("").type).toBeNull();
  });

  it("reports 'other' for a real but unrecognized platform -- never a fabricated one", () => {
    expect(ua("SomeFutureBrowser/1.0 (SomeFutureOS)").platform).toBe("other");
  });
});

describe("describeDevice -- device type", () => {
  it("an iPhone is a phone, an iPad a tablet", () => {
    expect(ua(IPHONE_SAFARI).type).toBe("phone");
    expect(ua("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1").type).toBe("tablet");
  });

  it("uses Android's own documented Mobile token to split phone from tablet", () => {
    expect(ua(ANDROID_PHONE_CHROME).type).toBe("phone");
    expect(ua(ANDROID_TABLET_CHROME).type).toBe("tablet");
  });

  it("Windows/macOS/Linux are desktops", () => {
    expect(ua(WINDOWS_CHROME).type).toBe("desktop");
    expect(ua(MAC_SAFARI).type).toBe("desktop");
    expect(ua(LINUX_FIREFOX).type).toBe("desktop");
  });
});

describe("describeDevice -- browser (token precedence is load-bearing)", () => {
  it("Edge is Edge, not Chrome, even though its UA contains 'Chrome'", () => {
    expect(ua(WINDOWS_EDGE).browser).toBe("edge");
  });

  it("Chrome is Chrome, not Safari, even though its UA contains 'Safari'", () => {
    expect(ua(WINDOWS_CHROME).browser).toBe("chrome");
  });

  it("Samsung Internet is not reported as Chrome", () => {
    expect(ua(SAMSUNG_INTERNET).browser).toBe("samsung");
  });

  it("Safari is Safari", () => {
    expect(ua(IPHONE_SAFARI).browser).toBe("safari");
  });

  it("Firefox is Firefox on desktop and on iOS (FxiOS)", () => {
    expect(ua(LINUX_FIREFOX).browser).toBe("firefox");
    expect(ua("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) FxiOS/130.0 Mobile/15E148 Safari/605.1.15").browser).toBe(
      "firefox",
    );
  });
});

describe("describeDevice -- privacy shape", () => {
  it("returns ONLY the four coarse fields -- no version, no raw UA, nothing else", () => {
    const descriptor = ua(WINDOWS_EDGE, { standalone: true });
    expect(Object.keys(descriptor).sort()).toEqual(["browser", "platform", "standalone", "type"]);
  });

  it("never echoes any part of the User-Agent string back into its output", () => {
    const descriptor = ua(WINDOWS_EDGE);
    const serialized = JSON.stringify(descriptor);
    expect(serialized).not.toContain("Mozilla");
    expect(serialized).not.toContain("537.36");
    expect(serialized).not.toContain("129");
  });

  it("carries only a few bits in total -- too little to distinguish two people on the same kind of device", () => {
    const oneUser = ua(WINDOWS_CHROME, { standalone: false });
    const anotherUserOnTheSameKindOfMachine = describeDevice({
      // A genuinely different machine: different Chrome build, different
      // Windows build. A fingerprint would tell these apart; this must
      // not.
      userAgent:
        "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36",
      platform: "Win32",
      maxTouchPoints: 0,
      standalone: false,
    });
    expect(anotherUserOnTheSameKindOfMachine).toEqual(oneUser);
  });
});

describe("parseDeviceDescriptor -- the server's validation boundary", () => {
  it("accepts a well-formed descriptor unchanged", () => {
    const input: PushDeviceDescriptor = { type: "phone", platform: "ios", browser: "safari", standalone: true };
    expect(parseDeviceDescriptor(input)).toEqual(input);
  });

  it("discards a raw User-Agent smuggled into any field rather than storing it", () => {
    expect(
      parseDeviceDescriptor({
        type: IPHONE_SAFARI,
        platform: IPHONE_SAFARI,
        browser: IPHONE_SAFARI,
        standalone: true,
      }),
    ).toEqual({ type: null, platform: null, browser: null, standalone: true });
  });

  it("discards values outside each closed enum, field by field, keeping the valid ones", () => {
    expect(
      parseDeviceDescriptor({ type: "phone", platform: "haiku", browser: "chrome", standalone: "yes" }),
    ).toEqual({ type: "phone", platform: null, browser: "chrome", standalone: null });
  });

  it.each([null, undefined, "not an object", 42, []])("degrades to the unknown descriptor for %j", (raw) => {
    expect(parseDeviceDescriptor(raw)).toEqual(UNKNOWN_DEVICE_DESCRIPTOR);
  });

  it("ignores extra properties entirely -- a client cannot widen the stored shape", () => {
    const parsed = parseDeviceDescriptor({
      type: "desktop",
      platform: "windows",
      browser: "chrome",
      standalone: false,
      userAgent: WINDOWS_CHROME,
      ipAddress: "203.0.113.7",
      fingerprint: "abc123",
    });
    expect(Object.keys(parsed).sort()).toEqual(["browser", "platform", "standalone", "type"]);
    expect(JSON.stringify(parsed)).not.toContain("203.0.113.7");
  });
});
