import { APP_NAME } from "@/lib/config/productName";
import type { PushDeviceDescriptor } from "@/lib/push/deviceDescriptor";
import type { OwnedPushDevice } from "./deviceTypes";

/**
 * Turns a coarse `PushDeviceDescriptor` into the two-part Hebrew label
 * "המכשירים שלי" renders -- `iPhone · המחלבה`, `Chrome · Windows`.
 *
 * Pure, and deliberately the ONLY place that decides how a device reads,
 * so the bell's device list and any future surface can never disagree.
 * Every branch has a truthful fallback: a subscription registered before
 * this feature existed carries no descriptor at all and gets a plain
 * "מכשיר" rather than an invented guess.
 *
 * The split between the two lines is what the descriptor can actually
 * prove:
 *  - An INSTALLED (standalone) installation is best identified by the
 *    hardware it lives on, with the app itself as the runtime -- there
 *    is no browser chrome involved from the user's point of view, and
 *    the engine name would be noise ("iPhone · המחלבה", not
 *    "Safari · iPhone"). This is exactly the case the real incident this
 *    feature came from needed to be legible: a Home Screen install that
 *    was re-added under a new name.
 *  - An ordinary browser tab is best identified by which browser it is,
 *    on which platform -- that is what the user would recognize when
 *    deciding which of several rows to remove.
 */
export interface PushDeviceLabel {
  /** The stronger identifier -- hardware for an installed PWA, browser for a tab. */
  primary: string;
  /** The runtime/context line. `null` only when nothing truthful can be said about it. */
  secondary: string | null;
}

const FALLBACK_DEVICE = "מכשיר";

function hardwareName(descriptor: PushDeviceDescriptor): string {
  switch (descriptor.platform) {
    case "ios":
      return "iPhone";
    case "ipados":
      return "iPad";
    case "android":
      return descriptor.type === "tablet" ? "טאבלט Android" : "טלפון Android";
    case "windows":
      return "Windows";
    case "macos":
      return "Mac";
    case "linux":
      return "Linux";
    default:
      // A known-but-unnamed platform ("other") and a completely absent
      // one collapse to the same honest answer -- the device type, if we
      // have one, is still more useful than nothing.
      if (descriptor.type === "phone") return "טלפון";
      if (descriptor.type === "tablet") return "טאבלט";
      if (descriptor.type === "desktop") return "מחשב";
      return FALLBACK_DEVICE;
  }
}

function browserName(descriptor: PushDeviceDescriptor): string | null {
  switch (descriptor.browser) {
    case "safari":
      return "Safari";
    case "chrome":
      return "Chrome";
    case "edge":
      return "Edge";
    case "firefox":
      return "Firefox";
    case "samsung":
      return "Samsung Internet";
    default:
      return null;
  }
}

export function buildPushDeviceLabel(descriptor: PushDeviceDescriptor): PushDeviceLabel {
  if (descriptor.standalone === true) {
    return { primary: hardwareName(descriptor), secondary: APP_NAME };
  }

  const browser = browserName(descriptor);
  if (browser === null) {
    // No browser identified: fall back to naming the hardware, with the
    // platform line dropped rather than duplicated onto both lines.
    return { primary: hardwareName(descriptor), secondary: null };
  }

  const hardware = hardwareName(descriptor);
  return { primary: browser, secondary: hardware === FALLBACK_DEVICE ? null : hardware };
}

/** The same label as one flat string, for an `aria-label`/title where the two-line split is not available. */
export function formatPushDeviceLabel(descriptor: PushDeviceDescriptor): string {
  const label = buildPushDeviceLabel(descriptor);
  return label.secondary === null ? label.primary : `${label.primary} · ${label.secondary}`;
}

/**
 * Whether we know ANYTHING nameable about this device.
 *
 * `false` means every descriptor field that could produce a name
 * (`type`/`platform`/`browser`) is absent -- which in practice means a
 * LEGACY row: a subscription registered before device metadata existed,
 * whose owner has not opened that installation again since (the
 * heartbeat backfills those columns the moment they do -- see
 * `touch_push_subscription`).
 *
 * `standalone` deliberately does NOT count. On its own it says how the
 * app was launched, not what the device is, and `buildPushDeviceLabel`
 * can produce nothing better than "מכשיר" from it -- so treating it as
 * identifying would put an unnameable row in the main list under a label
 * indistinguishable from the legacy ones.
 */
export function isIdentifiableDevice(descriptor: PushDeviceDescriptor): boolean {
  return descriptor.type !== null || descriptor.platform !== null || descriptor.browser !== null;
}

/** What an unidentified legacy row is called. Deliberately NOT a guessed browser/platform -- "old device" is the only thing that is actually true about it. */
export const LEGACY_DEVICE_LABEL = "מכשיר ישן";

export interface GroupedPushDevices {
  /** Rendered normally, in order. Always includes the CURRENT device, whether or not it is identifiable yet. */
  identified: OwnedPushDevice[];
  /** Unidentified legacy rows, collapsed behind a count so they cannot crowd out the devices the user can actually recognize. */
  legacy: OwnedPushDevice[];
}

/**
 * Splits "המכשירים שלי" into the devices a user can recognize and the
 * legacy rows they cannot.
 *
 * The problem this solves is presentational only: an account can carry
 * many active subscriptions that predate device metadata, and a list
 * where eight identical "מכשיר" rows bury the one iPhone you were
 * looking for is worse than useless. It is explicitly NOT a cleanup
 * mechanism -- nothing is deleted, nothing is hidden permanently, and
 * age is never consulted. A `last_seen_at` of 28 days does not mean a
 * device is dead; it means someone uses their second PC occasionally,
 * and pruning it would silently stop notifications they still expect.
 *
 * The CURRENT device is never grouped, even before its own backfill has
 * landed: it is the one row a user is most likely to want to act on, and
 * burying the device you are holding behind a collapsed "old devices"
 * section would be actively confusing.
 *
 * Order is preserved within each group -- the caller already sorted by
 * `last_seen_at`.
 */
export function groupPushDevicesForDisplay(devices: readonly OwnedPushDevice[]): GroupedPushDevices {
  const identified: OwnedPushDevice[] = [];
  const legacy: OwnedPushDevice[] = [];

  for (const device of devices) {
    if (device.isCurrent || isIdentifiableDevice(device.descriptor)) identified.push(device);
    else legacy.push(device);
  }

  return { identified, legacy };
}
