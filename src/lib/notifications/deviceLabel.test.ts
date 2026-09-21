import { describe, expect, it } from "vitest";
import { APP_NAME } from "@/lib/config/productName";
import { UNKNOWN_DEVICE_DESCRIPTOR, type PushDeviceDescriptor } from "@/lib/push/deviceDescriptor";
import { buildPushDeviceLabel, formatPushDeviceLabel } from "./deviceLabel";

function descriptor(overrides: Partial<PushDeviceDescriptor> = {}): PushDeviceDescriptor {
  return { ...UNKNOWN_DEVICE_DESCRIPTOR, ...overrides };
}

describe("buildPushDeviceLabel -- installed (standalone) installations", () => {
  it("names the hardware, with the app itself as the runtime -- the exact shape the spec asks for", () => {
    expect(
      buildPushDeviceLabel(descriptor({ type: "phone", platform: "ios", browser: "safari", standalone: true })),
    ).toEqual({ primary: "iPhone", secondary: APP_NAME });
  });

  it("does not name the browser for an installed app -- from the user's point of view there is no browser", () => {
    const label = buildPushDeviceLabel(
      descriptor({ type: "desktop", platform: "windows", browser: "chrome", standalone: true }),
    );
    expect(label).toEqual({ primary: "Windows", secondary: APP_NAME });
    expect(label.secondary).not.toBe("Chrome");
  });

  it.each([
    ["ipados", "iPad"],
    ["macos", "Mac"],
    ["linux", "Linux"],
  ] as const)("names %s hardware as %s", (platform, expected) => {
    expect(buildPushDeviceLabel(descriptor({ platform, standalone: true })).primary).toBe(expected);
  });

  it("distinguishes an Android phone from an Android tablet", () => {
    expect(buildPushDeviceLabel(descriptor({ type: "phone", platform: "android", standalone: true })).primary).toBe(
      "טלפון Android",
    );
    expect(buildPushDeviceLabel(descriptor({ type: "tablet", platform: "android", standalone: true })).primary).toBe(
      "טאבלט Android",
    );
  });
});

describe("buildPushDeviceLabel -- ordinary browser tabs", () => {
  it("names the browser and the platform -- the spec's `Chrome · Windows`", () => {
    expect(
      buildPushDeviceLabel(descriptor({ type: "desktop", platform: "windows", browser: "chrome", standalone: false })),
    ).toEqual({ primary: "Chrome", secondary: "Windows" });
  });

  it("spells Samsung Internet out rather than abbreviating it", () => {
    expect(buildPushDeviceLabel(descriptor({ platform: "android", browser: "samsung" })).primary).toBe(
      "Samsung Internet",
    );
  });
});

describe("buildPushDeviceLabel -- truthful fallbacks", () => {
  it("a legacy row with no metadata at all reads as a plain 'מכשיר', never an invented device", () => {
    expect(buildPushDeviceLabel(UNKNOWN_DEVICE_DESCRIPTOR)).toEqual({ primary: "מכשיר", secondary: null });
  });

  it("uses the device type when the platform is unknown, rather than dropping to nothing", () => {
    expect(buildPushDeviceLabel(descriptor({ type: "phone", platform: "other" })).primary).toBe("טלפון");
    expect(buildPushDeviceLabel(descriptor({ type: "desktop", platform: null })).primary).toBe("מחשב");
  });

  it("never repeats the same word on both lines", () => {
    const label = buildPushDeviceLabel(descriptor({ browser: null, platform: null, type: null }));
    expect(label.secondary).toBeNull();
  });

  it("an unknown standalone flag is treated as a browser tab, never claimed as installed", () => {
    expect(
      buildPushDeviceLabel(descriptor({ platform: "windows", browser: "firefox", standalone: null })).secondary,
    ).toBe("Windows");
  });
});

describe("formatPushDeviceLabel", () => {
  it("joins the two parts with the separator the design uses", () => {
    expect(
      formatPushDeviceLabel(descriptor({ type: "desktop", platform: "windows", browser: "chrome" })),
    ).toBe("Chrome · Windows");
  });

  it("omits the separator entirely when there is no second part", () => {
    expect(formatPushDeviceLabel(UNKNOWN_DEVICE_DESCRIPTOR)).toBe("מכשיר");
  });
});
