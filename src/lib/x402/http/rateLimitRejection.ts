import "server-only";

import { NextResponse } from "next/server";

import type { RateLimitRefusal } from "@/actions/server/rateLimit/checkRateLimit";
import type { X402AuditEntry } from "@/lib/x402/audit/logX402Call";

const DEFAULT_RETRY_AFTER_SECONDS = 60;

export interface RateLimitRejection {
  httpStatus: 429 | 503;
  errorKind: "rate_limited" | "rate_limiter_unavailable";
  message: string;
  retryAfterSeconds: number;
  auditStatus: Extract<X402AuditEntry["resultStatus"], "rate_limited" | "error">;
}

export function describeRateLimitRejection(
  result: RateLimitRefusal,
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
    message: result.message,
    retryAfterSeconds: result.resetIn ?? DEFAULT_RETRY_AFTER_SECONDS,
    auditStatus: "rate_limited",
  };
}

export function buildRateLimitJsonResponse(rejection: RateLimitRejection): NextResponse {
  return NextResponse.json(
    { error: rejection.errorKind, message: rejection.message, retryAfter: rejection.retryAfterSeconds },
    {
      status: rejection.httpStatus,
      headers: { "Retry-After": String(rejection.retryAfterSeconds) },
    },
  );
}
