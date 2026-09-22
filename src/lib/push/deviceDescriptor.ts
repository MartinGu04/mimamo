/**
 * The COARSE, deliberately low-entropy description of one Push-capable
 * installation -- everything "המכשירים שלי" needs to render a useful
 * label (`iPhone · המחלבה`, `Chrome · Windows`) and nothing more.
 *
 * This is explicitly NOT fingerprinting, and the difference is
 * structural rather than a matter of intent:
 *  - Every field is a small CLOSED enum (mirrored by CHECK constraints
 *    on `push_subscriptions`), so the whole descriptor carries only a
 *    few bits -- far too little to distinguish two people using the same
 *    kind of device, which is the entire point.
 *  - The raw `navigator.userAgent` NEVER leaves the browser. It is read
 *    once, right here, collapsed to those few bits, and discarded. No
 *    version numbers, no build strings, no screen/timezone/language/font
 *    probing, no canvas, no IP address (this module cannot see one, and
 *    nothing server-side records one either).
 *  - The result is only ever attached to a subscription the user
 *    EXPLICITLY created by pressing "הפעל התראות" on that device.
 *
 * Pure and environment-agnostic: `describeDevice` takes its inputs as
 * plain values so it is deterministically testable, and the server
 * re-validates whatever a client sends through `parseDeviceDescriptor`
 * rather than trusting it -- an unrecognized value becomes `null`, never
 * a free-text passthrough that could smuggle a real User-Agent into the
 * database.
 */

export type PushDeviceType = "phone" | "tablet" | "desktop";
export type PushDevicePlatform = "ios" | "ipados" | "android" | "windows" | "macos" | "linux" | "other";
export type PushDeviceBrowser = "safari" | "chrome" | "edge" | "firefox" | "samsung" | "other";

/** Every field is independently nullable -- "we could not tell" is always a legitimate, truthfully-representable answer (and is exactly what every row registered before this feature existed reports). */
export interface PushDeviceDescriptor {
  type: PushDeviceType | null;
  platform: PushDevicePlatform | null;
  browser: PushDeviceBrowser | null;
  /** Whether this installation was registered from an installed/standalone PWA window rather than an ordinary browser tab. */
  standalone: boolean | null;
}

export const UNKNOWN_DEVICE_DESCRIPTOR: PushDeviceDescriptor = {
  type: null,
  platform: null,
  browser: null,
  standalone: null,
};

const DEVICE_TYPES: readonly string[] = ["phone", "tablet", "desktop"];
const DEVICE_PLATFORMS: readonly string[] = ["ios", "ipados", "android", "windows", "macos", "linux", "other"];
const DEVICE_BROWSERS: readonly string[] = ["safari", "chrome", "edge", "firefox", "samsung", "other"];

export interface DescribeDeviceInput {
  userAgent: string;
  /** `navigator.platform` -- only ever consulted for the one case a UA string genuinely cannot answer (modern iPadOS, below). */
  platform: string;
  maxTouchPoints: number;
  /** The caller's own already-computed standalone/installed answer (`lib/pwa/installState.ts`), never re-derived here. */
  standalone: boolean;
}

/**
 * Modern iPadOS reports itself as desktop-class Safari on a Mac
 * (`platform === "MacIntel"`, no "iPad" anywhere in the UA), so the
 * touch-point check is the only way to tell it apart from an actual Mac
 * -- the same, already-established distinction
 * `lib/pwa/installState.ts`'s `isIosInstallableDevice` makes for install
 * guidance. Kept a separate platform value from `ios` because the label
 * it produces differs ("iPad" vs. "iPhone"), never because anything
 * behaves differently.
 */
function resolvePlatform(input: DescribeDeviceInput): PushDevicePlatform | null {
  const ua = input.userAgent;
  if (/iPad/.test(ua)) return "ipados";
  if (input.platform === "MacIntel" && input.maxTouchPoints > 1) return "ipados";
  if (/iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/CrOS|X11|Linux/.test(ua)) return "linux";
  if (ua.trim() === "") return null;
  return "other";
}

function resolveType(platform: PushDevicePlatform | null, userAgent: string): PushDeviceType | null {
  if (platform === "ios") return "phone";
  if (platform === "ipados") return "tablet";
  // Android's own convention: a "Mobile" token means phone, its absence
  // means tablet. This is the documented signal, not a heuristic guess.
  if (platform === "android") return /Mobile/.test(userAgent) ? "phone" : "tablet";
  if (platform === "windows" || platform === "macos" || platform === "linux") return "desktop";
  return null;
}

/**
 * Order matters and is load-bearing: Edge's UA contains "Chrome", every
 * Chromium UA contains "Safari", and both iOS Chrome ("CriOS") and iOS
 * Firefox ("FxiOS") are WebKit underneath but should still be named
 * after the browser the user actually opened. Most specific token first.
 */
function resolveBrowser(userAgent: string): PushDeviceBrowser | null {
  if (userAgent.trim() === "") return null;
  if (/Edg[A-Z]?\//.test(userAgent)) return "edge";
  if (/SamsungBrowser/.test(userAgent)) return "samsung";
  if (/Firefox\/|FxiOS/.test(userAgent)) return "firefox";
  if (/Chrome\/|CriOS|Chromium/.test(userAgent)) return "chrome";
  if (/Safari\//.test(userAgent)) return "safari";
  return "other";
}

export function describeDevice(input: DescribeDeviceInput): PushDeviceDescriptor {
  const platform = resolvePlatform(input);
  return {
    type: resolveType(platform, input.userAgent),
    platform,
    browser: resolveBrowser(input.userAgent),
    standalone: input.standalone,
  };
}

/**
 * Reads the CURRENT browser's descriptor. Degrades to the fully-unknown
 * descriptor with no `window`/`navigator` (SSR, or a non-browser test
 * environment) rather than throwing -- same convention as
 * `lib/pwa/capabilities.ts` and `lib/pwa/installState.ts`.
 *
 * `standalone` is supplied by the caller rather than re-derived here, so
 * this module never duplicates `isStandaloneDisplayMode`'s own logic and
 * the two can never drift apart.
 */
export function readCurrentDeviceDescriptor(standalone: boolean): PushDeviceDescriptor {
  if (typeof navigator === "undefined") return UNKNOWN_DEVICE_DESCRIPTOR;
  return describeDevice({
    userAgent: navigator.userAgent ?? "",
    platform: navigator.platform ?? "",
    maxTouchPoints: typeof navigator.maxTouchPoints === "number" ? navigator.maxTouchPoints : 0,
    standalone,
  });
}

function parseEnum<T extends string>(value: unknown, allowed: readonly string[]): T | null {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : null;
}

/**
 * The SERVER's validation boundary for a client-supplied descriptor.
 * Never trusts the client: anything that is not one of the exact
 * enumerated values becomes `null`, so a malicious or simply outdated
 * client cannot write arbitrary text (a real User-Agent string, say)
 * into `push_subscriptions`. Deliberately fails soft rather than
 * rejecting the whole enable -- a device label is cosmetic, and losing
 * it must never stop someone turning notifications on.
 *
 * The database independently enforces the same closed sets via CHECK
 * constraints, so this is defense in depth rather than the only guard.
 */
export function parseDeviceDescriptor(raw: unknown): PushDeviceDescriptor {
  if (typeof raw !== "object" || raw === null) return UNKNOWN_DEVICE_DESCRIPTOR;
  const candidate = raw as Record<string, unknown>;
  return {
    type: parseEnum<PushDeviceType>(candidate.type, DEVICE_TYPES),
    platform: parseEnum<PushDevicePlatform>(candidate.platform, DEVICE_PLATFORMS),
    browser: parseEnum<PushDeviceBrowser>(candidate.browser, DEVICE_BROWSERS),
    standalone: typeof candidate.standalone === "boolean" ? candidate.standalone : null,
  };
}
