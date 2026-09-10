const DEFAULT_NEXT_PATH = "/";

/**
 * Validates a `next` redirect target from the OAuth callback so it can
 * never be used to redirect a user off המחלבה after signing in. Only an
 * internal, single-leading-slash, same-origin path is accepted; anything
 * else (an absolute URL, a protocol-relative "//host" trick, an embedded
 * "://", a backslash some browsers treat like a slash) falls back to "/".
 */
export function sanitizeNextPath(rawNext: string | null | undefined): string {
  if (!rawNext) return DEFAULT_NEXT_PATH;
  if (!rawNext.startsWith("/")) return DEFAULT_NEXT_PATH;
  if (rawNext.startsWith("//")) return DEFAULT_NEXT_PATH;
  if (rawNext.includes("://")) return DEFAULT_NEXT_PATH;
  if (rawNext.includes("\\")) return DEFAULT_NEXT_PATH;
  return rawNext;
}
