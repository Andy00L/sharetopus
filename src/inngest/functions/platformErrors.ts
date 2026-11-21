import type { Platform } from "@/db/schema";
import type { PlatformFailureReason } from "@/lib/api/_shared/platformFailure";

export type PublishFailure = {
  ok: false;
  reason: PlatformFailureReason;
  message: string;
  mayHavePublished: boolean;
};

export type PlatformPostOutcome = { ok: true; contentId: string } | PublishFailure;

export function isSafeToRetryPost(
  failure: Pick<PublishFailure, "reason" | "mayHavePublished">,
): boolean {
  if (failure.mayHavePublished) return false;
  return failure.reason === "rate_limited" || failure.reason === "transient";
}

export function buildInputRefusal(message: string): PublishFailure {
  return { ok: false, reason: "invalid_input", message, mayHavePublished: false };
}

export function buildTextClassifiedFailure(
  platform: Platform,
  message: string,
): PublishFailure {
  const reason = classifyDirectPostFailure(platform, message);
  return { ok: false, reason, message, mayHavePublished: reason !== "rate_limited" };
}

function classifyDirectPostFailure(
  platform: Platform,
  message: string | undefined,
): PlatformFailureReason {
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
