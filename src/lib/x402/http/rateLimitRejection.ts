import "server-only";

/**
 * Turns a failed checkRateLimit result into the response every x402 route
 * sends. A limiter outage is ours, not the caller's, so it answers 503
 * instead of telling an agent to slow down with a 429.
 *
 * Called by: every x402 route that rate limits
 * Tables touched: none
 */

import { NextResponse } from "next/server";

import type { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";

/** Retry hint when the limiter reports no reset time, in seconds. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

export interface RateLimitRejection {
  httpStatus: 429 | 503;
  errorKind: "rate_limited" | "rate_limiter_unavailable";
  message: string;
  retryAfterSeconds: number;
  /** x402_access_log.result_status value for this rejection. */
  auditStatus: "rate_limited" | "error";
}

export function describeRateLimitRejection(
  result: Awaited<ReturnType<typeof checkRateLimit>>,
): RateLimitRejection {
  if (result.reason === "unavailable") {
    return {
      httpStatus: 503,
      errorKind: "rate_limiter_unavailable",
      message: "Rate limiting is temporarily unavailable on the server. Retry shortly.",
      retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
      auditStatus: "error",
    };
  }
  return {
    httpStatus: 429,
    errorKind: "rate_limited",
    message: result.message ?? "Rate limit exceeded.",
    retryAfterSeconds: result.resetIn ?? DEFAULT_RETRY_AFTER_SECONDS,
    auditStatus: "rate_limited",
  };
}

/**
 * The { error, retryAfter } JSON body the standalone x402 routes (status
 * polling, the public Arc facilitator) answer with.
 */
export function buildRateLimitJsonResponse(rejection: RateLimitRejection): NextResponse {
  return NextResponse.json(
    { error: rejection.errorKind, message: rejection.message, retryAfter: rejection.retryAfterSeconds },
    {
      status: rejection.httpStatus,
      headers: { "Retry-After": String(rejection.retryAfterSeconds) },
    },
  );
}
