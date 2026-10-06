/**
 * Outcome of one platform post attempt. Always a value; the worker
 * never throws for business-level failures.
 */
export type PlatformPostOutcome =
  | { ok: true; contentId: string; mediaUrl: string | null }
  | { ok: false; reason: PlatformErrorReason; message: string };

export type PlatformErrorReason =
  | "auth_expired"
  | "rate_limited"
  | "transient"
  | "policy_rejected"
  | "invalid_input"
  | "unknown";

/**
 * Only a rate limit is safe to retry: a 429 published nothing. A transient
 * failure may have published already (a retry could post twice), and the
 * other reasons fail the same way every time.
 */
export function isSafeToRetryPost(reason: PlatformErrorReason): boolean {
  return reason === "rate_limited";
}

/** Maps a direct-post failure message to a PlatformErrorReason for the retry decision. */
export function classifyDirectPostFailure(
  platform: import("@/db/schema").Platform,
  message: string | undefined
): PlatformErrorReason {
  const normalizedMessage = (message ?? "").toLowerCase();

  // Pinterest-specific terminal patterns
  if (platform === "pinterest") {
    if (normalizedMessage.includes("doesn't allow you to save pins")) return "policy_rejected";
    if (normalizedMessage.includes("doesn't allow")) return "policy_rejected";
  }

  // Cross-platform patterns (existing helpers return human strings)
  if (normalizedMessage.includes("no content found")) return "invalid_input";
  if (normalizedMessage.includes("no board selected")) return "invalid_input";
  if (normalizedMessage.includes("no linkedin identifier")) return "invalid_input";
  if (normalizedMessage.includes("no facebook page id")) return "invalid_input";
  if (normalizedMessage.includes("invalid token") || normalizedMessage.includes("expired"))
    return "auth_expired";
  if (normalizedMessage.includes("too many") || normalizedMessage.includes("rate limit"))
    return "rate_limited";
  if (normalizedMessage.includes("timeout") || normalizedMessage.includes("etimedout")) return "transient";
  if (normalizedMessage.includes("network") || normalizedMessage.includes("econnreset")) return "transient";

  // The youtube/x/facebook postTo helpers embed the HTTP status as
  // "... failed (429)"; classify by that suffix.
  if (normalizedMessage.includes("(401)") || normalizedMessage.includes("(403)")) return "auth_expired";
  if (normalizedMessage.includes("(429)")) return "rate_limited";
  if (
    normalizedMessage.includes("(500)") ||
    normalizedMessage.includes("(502)") ||
    normalizedMessage.includes("(503)") ||
    normalizedMessage.includes("(504)")
  ) {
    return "transient";
  }

  return "unknown";
}
