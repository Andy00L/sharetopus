/**
 * Why one post in a batch was refused.
 * - invalid_input: a field rule (missing media, a media path outside the
 *   caller's folder, Pinterest board, caption length)
 * - not_owned: the account is not the caller's, or was deleted
 * - platform_mismatch: the account is on another platform than the post
 */
export type PostRejectionCode = "invalid_input" | "not_owned" | "platform_mismatch";

/**
 * One refused post. The web UI, the MCP tools and x402 show `reason`; the
 * REST API maps `code` to an HTTP status.
 */
export type PostRejection = {
  socialAccountId: string;
  code: PostRejectionCode;
  reason: string;
};

/**
 * Why a whole batch failed.
 * - rejected: every post was refused; details.rejected says why
 * - invalid_request: the batch itself was malformed (empty, too large)
 * - unauthenticated: the web caller has no valid session
 * - rate_limited: too many batch calls; resetIn says when to retry
 * - quota_exceeded: the platform's daily scheduling cap was reached
 * - unavailable: a check could not run (rate limiter, ownership or quota
 *   read); nothing was written, so a retry is safe
 * - internal: a write or dispatch failed, or something unexpected happened
 */
export type PostBatchFailure =
  | "rejected"
  | "invalid_request"
  | "unauthenticated"
  | "rate_limited"
  | "quota_exceeded"
  | "unavailable"
  | "internal";
