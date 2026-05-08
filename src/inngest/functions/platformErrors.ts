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

export function isRetryableReason(reason: PlatformErrorReason): boolean {
  return (
    reason === "auth_expired" ||
    reason === "rate_limited" ||
    reason === "transient"
  );
}

/**
 * The directPostFor{Platform}Accounts functions return ScheduleResult:
 *   { success: boolean; count: number; message?: string }
 * which is too coarse to drive retry decisions. This function maps
 * the message string to a PlatformErrorReason.
 *
 * Pinterest specific: code 1 ("Sorry! This site doesn't allow you to
 * save Pins.") is policy_rejected, NOT transient.
 */
export function classifyDirectPostFailure(
  platform: import("@/lib/types/database.types").Platform,
  message: string | undefined
): PlatformErrorReason {
  const m = (message ?? "").toLowerCase();

  // Pinterest-specific terminal patterns
  if (platform === "pinterest") {
    if (m.includes("doesn't allow you to save pins")) return "policy_rejected";
    if (m.includes("doesn't allow")) return "policy_rejected";
  }

  // Cross-platform patterns (existing helpers return human strings)
  if (m.includes("no content found")) return "invalid_input";
  if (m.includes("no board selected")) return "invalid_input";
  if (m.includes("no linkedin identifier")) return "invalid_input";
  if (m.includes("invalid token") || m.includes("expired"))
    return "auth_expired";
  if (m.includes("too many") || m.includes("rate limit"))
    return "rate_limited";
  if (m.includes("timeout") || m.includes("etimedout")) return "transient";
  if (m.includes("network") || m.includes("econnreset")) return "transient";
  if (m.includes("history")) return "invalid_input";
  if (m.length === 0) return "unknown";
  return "unknown";
}
