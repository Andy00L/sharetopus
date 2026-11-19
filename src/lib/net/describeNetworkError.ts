/**
 * Names a failed outbound request with its root cause. undici's fetch
 * reports every network failure as "fetch failed" and keeps the reason
 * (ECONNREFUSED, ERR_INVALID_IP_ADDRESS, a TLS error) on error.cause.
 */
export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return "unknown network error";
  const cause = error.cause;
  if (!(cause instanceof Error)) return error.message;
  const causeCode =
    "code" in cause && typeof cause.code === "string" ? cause.code : null;
  return `${error.message} (${causeCode ?? cause.message})`;
}
