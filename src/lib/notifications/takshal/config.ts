import "server-only";
import { normalizeEmail } from "@/lib/notifications/engine/recipients";

/**
 * Server-only configuration of the TAKSHAL CTRL delivery channel. Every
 * variable here is a plain server env var -- never `NEXT_PUBLIC_`, so none
 * of it can reach a browser bundle (see `boundary.test.ts`).
 *
 * - `TAKSHAL_CTRL_HUB_URL`         -- the hub's origin, e.g.
 *   `https://takshal-ctrl.vercel.app`. No default (same convention as every
 *   other external endpoint/credential in this app): unset = channel off.
 * - `TAKSHAL_CTRL_SOURCE_SECRET`   -- the shared source credential (the SAME
 *   value as TAKSHAL CTRL's `MACHLAVA_SOURCE_SECRET`). Secret: never logged,
 *   never echoed. Unset = channel off.
 * - `TAKSHAL_CTRL_TEST_RECIPIENTS` -- the temporary rollout allowlist:
 *   comma-separated verified emails that receive BOTH channels. Empty or
 *   unset = everyone stays on direct delivery only.
 *
 * A missing or broken configuration can only ever turn the channel OFF;
 * it never affects direct delivery.
 */

/** TAKSHAL CTRL's המחלבה source endpoint, relative to the hub origin. */
export const TAKSHAL_SOURCE_PATH = "/api/source/machlava/notify";

export interface TakshalConfig {
  /** Absolute URL of the hub's המחלבה source endpoint. */
  readonly endpoint: string;
  readonly sourceSecret: string;
  /** Normalized verified emails on the temporary rollout allowlist. */
  readonly testRecipients: ReadonlySet<string>;
  /** Allowlist entries that were not a plausible email and were ignored (count only -- never the values). */
  readonly ignoredTestRecipientEntries: number;
}

export type TakshalConfigResult =
  | { readonly status: "disabled" }
  /** `problem` names what is wrong -- never a configured value. */
  | { readonly status: "misconfigured"; readonly problem: string }
  | { readonly status: "ok"; readonly config: TakshalConfig };

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The hub's origin: `https` only (plain `http` only for a local `vercel dev`), no credentials/path/query. */
function parseHubOrigin(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/") return null;
  return url;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Comma/whitespace-separated list -> normalized set. Malformed entries are dropped (and counted, never echoed). */
export function parseTestRecipients(raw: string | undefined): { recipients: Set<string>; invalidCount: number } {
  const recipients = new Set<string>();
  let invalidCount = 0;
  for (const entry of (raw ?? "").split(/[\s,;]+/)) {
    if (entry === "") continue;
    const email = normalizeEmail(entry);
    if (EMAIL_SHAPE.test(email) && email.length <= 254) recipients.add(email);
    else invalidCount++;
  }
  return { recipients, invalidCount };
}

export function readTakshalConfig(env: Env = process.env): TakshalConfigResult {
  const sourceSecret = env.TAKSHAL_CTRL_SOURCE_SECRET?.trim();
  if (!sourceSecret) return { status: "disabled" };

  const hubUrl = env.TAKSHAL_CTRL_HUB_URL?.trim();
  if (!hubUrl) return { status: "misconfigured", problem: "TAKSHAL_CTRL_HUB_URL is not set" };
  const origin = parseHubOrigin(hubUrl);
  if (!origin) return { status: "misconfigured", problem: "TAKSHAL_CTRL_HUB_URL must be an https origin, e.g. https://takshal-ctrl.vercel.app" };

  const { recipients, invalidCount } = parseTestRecipients(env.TAKSHAL_CTRL_TEST_RECIPIENTS);
  return {
    status: "ok",
    config: {
      endpoint: new URL(TAKSHAL_SOURCE_PATH, origin).href,
      sourceSecret,
      testRecipients: recipients,
      ignoredTestRecipientEntries: invalidCount,
    },
  };
}
