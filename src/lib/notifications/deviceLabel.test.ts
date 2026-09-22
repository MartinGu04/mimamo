import { describe, expect, it } from "vitest";
import { APP_NAME } from "@/lib/config/productName";
import { UNKNOWN_DEVICE_DESCRIPTOR, type PushDeviceDescriptor } from "@/lib/push/deviceDescriptor";
import type { OwnedPushDevice } from "./deviceTypes";
import {
  buildPushDeviceLabel,
  formatPushDeviceLabel,
  groupPushDevicesForDisplay,
  isIdentifiableDevice,
} from "./deviceLabel";

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

describe("isIdentifiableDevice", () => {
  it("is true as soon as ANY nameable field is present", () => {
    expect(isIdentifiableDevice(descriptor({ type: "phone" }))).toBe(true);
    expect(isIdentifiableDevice(descriptor({ platform: "windows" }))).toBe(true);
    expect(isIdentifiableDevice(descriptor({ browser: "chrome" }))).toBe(true);
  });

  it("is false for a legacy row with no descriptor at all", () => {
    expect(isIdentifiableDevice(UNKNOWN_DEVICE_DESCRIPTOR)).toBe(false);
  });

  it("does NOT count `standalone` alone -- it says how the app launched, not what the device is", () => {
    // `buildPushDeviceLabel` can produce nothing better than "מכשיר"
    // from it, so treating it as identifying would put an unnameable row
    // in the main list under a label indistinguishable from the legacy
    // ones.
    expect(isIdentifiableDevice(descriptor({ standalone: true }))).toBe(false);
    expect(buildPushDeviceLabel(descriptor({ standalone: true })).primary).toBe("מכשיר");
  });
});

describe("groupPushDevicesForDisplay", () => {
  function device(overrides: Partial<OwnedPushDevice> & Pick<OwnedPushDevice, "deviceRef">): OwnedPushDevice {
    return {
      descriptor: UNKNOWN_DEVICE_DESCRIPTOR,
      lastSeenAt: "2026-09-01T00:00:00.000Z",
      lastReceivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      isCurrent: false,
      ...overrides,
    };
  }

  const iphone = device({
    deviceRef: "iphone",
    descriptor: { type: "phone", platform: "ios", browser: "safari", standalone: true },
  });
  const windows = device({
    deviceRef: "windows",
    descriptor: { type: "desktop", platform: "windows", browser: "chrome", standalone: false },
  });
  const legacyA = device({ deviceRef: "legacy-a" });
  const legacyB = device({ deviceRef: "legacy-b" });

  it("keeps identified devices in the main list", () => {
    const grouped = groupPushDevicesForDisplay([iphone, windows]);
    expect(grouped.identified.map((d) => d.deviceRef)).toEqual(["iphone", "windows"]);
    expect(grouped.legacy).toEqual([]);
  });

  it("moves unidentified legacy rows into their own group", () => {
    const grouped = groupPushDevicesForDisplay([iphone, legacyA, windows, legacyB]);
    expect(grouped.identified.map((d) => d.deviceRef)).toEqual(["iphone", "windows"]);
    expect(grouped.legacy.map((d) => d.deviceRef)).toEqual(["legacy-a", "legacy-b"]);
  });

  it("NEVER groups the current device, even before its own backfill has landed", () => {
    const currentLegacy = device({ deviceRef: "current", isCurrent: true });
    const grouped = groupPushDevicesForDisplay([currentLegacy, legacyA]);

    expect(grouped.identified.map((d) => d.deviceRef)).toEqual(["current"]);
    expect(grouped.legacy.map((d) => d.deviceRef)).toEqual(["legacy-a"]);
  });

  it("loses nothing -- every input device appears in exactly one group", () => {
    const all = [iphone, legacyA, windows, legacyB, device({ deviceRef: "current", isCurrent: true })];
    const grouped = groupPushDevicesForDisplay(all);

    const refs = [...grouped.identified, ...grouped.legacy].map((d) => d.deviceRef).sort();
    expect(refs).toEqual(all.map((d) => d.deviceRef).sort());
  });

  it("never consults age -- an old but identified device stays in the main list, and an old legacy one is grouped rather than dropped", () => {
    const ancientButNamed = device({
      deviceRef: "ancient-pc",
      descriptor: { type: "desktop", platform: "macos", browser: "firefox", standalone: false },
      lastSeenAt: "2020-01-01T00:00:00.000Z",
    });
    const ancientLegacy = device({ deviceRef: "ancient-legacy", lastSeenAt: "2020-01-01T00:00:00.000Z" });

    const grouped = groupPushDevicesForDisplay([ancientButNamed, ancientLegacy]);

    expect(grouped.identified.map((d) => d.deviceRef)).toEqual(["ancient-pc"]);
    expect(grouped.legacy.map((d) => d.deviceRef)).toEqual(["ancient-legacy"]);
  });

  it("preserves the caller's ordering within each group", () => {
    const grouped = groupPushDevicesForDisplay([legacyB, windows, legacyA, iphone]);
    expect(grouped.identified.map((d) => d.deviceRef)).toEqual(["windows", "iphone"]);
    expect(grouped.legacy.map((d) => d.deviceRef)).toEqual(["legacy-b", "legacy-a"]);
  });

  it("handles an empty list", () => {
    expect(groupPushDevicesForDisplay([])).toEqual({ identified: [], legacy: [] });
  });
});
