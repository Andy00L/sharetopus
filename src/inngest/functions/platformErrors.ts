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

export function isSafeToRetryPost(reason: PlatformErrorReason): boolean {
  return reason === "rate_limited";
}

export function classifyDirectPostFailure(
  platform: import("@/db/schema").Platform,
  message: string | undefined
): PlatformErrorReason {
  const normalizedMessage = (message ?? "").toLowerCase();

  if (platform === "pinterest") {
    if (normalizedMessage.includes("doesn't allow you to save pins")) return "policy_rejected";
    if (normalizedMessage.includes("doesn't allow")) return "policy_rejected";
  }

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
