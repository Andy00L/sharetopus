import "server-only";

import { after, NextResponse, type NextRequest } from "next/server";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { logX402Call, type X402AuditEntry } from "@/lib/x402/audit/logX402Call";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";
import { handleStatusQuery } from "@/lib/x402/oauth/status/handleStatusQuery";

export const runtime = "nodejs";
export const maxDuration = 10;

const ENDPOINT_PATH = "/api/x402/oauth/status";

/**
 * GET /api/x402/oauth/status
 * Headers: Authorization: Bearer <connectionToken>
 *
 * Returns current state of an OAuth connection. Polled by agents during the
 * OAuth flow, so it is the busiest x402 route: a routine successful poll
 * writes only its poll counter, and audit rows are kept for rejections and
 * written after the response is sent.
 *
 * Auth: HMAC-signed connectionToken issued at /connect time.
 * Rate limit: 120/min per IP (x402_oauth_status_poll scope).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = performance.now();
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();

  const auditRejection = (resultStatus: X402AuditEntry["resultStatus"]): void => {
    const auditEntry: X402AuditEntry = {
      principal: null,
      action: "connect_account",
      endpoint: ENDPOINT_PATH,
      chargeId: null,
      resultStatus,
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    };
    after(() => logX402Call(auditEntry));
  };

  // Step 1: rate limit per IP.
  const rateLimitResult = await checkRateLimit("x402_oauth_status_poll", null, 120, 60);
  if (!rateLimitResult.success) {
    const rejection = describeRateLimitRejection(rateLimitResult);
    auditRejection(rejection.auditStatus);
    return buildRateLimitJsonResponse(rejection);
  }

  // Step 2: bearer token.
  const authHeader = request.headers.get("authorization");
  const connectionToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!connectionToken) {
    auditRejection("error");
    return NextResponse.json(
      {
        error: "missing_authorization",
        message: "Authorization: Bearer <connectionToken> header is required.",
      },
      { status: 401 },
    );
  }

  // Step 3: verify the token and read the connection.
  const result = await handleStatusQuery({ connectionToken }, ipHash);

  if (!result.ok) {
    auditRejection("error");
    return NextResponse.json(
      { error: result.error.kind, message: result.error.message },
      { status: mapStatusErrorToHttpStatus(result.error.kind) },
    );
  }

  return NextResponse.json(result.payload, { status: 200 });
}

/** Maps handleStatusQuery error kinds to HTTP status codes. */
function mapStatusErrorToHttpStatus(
  kind:
    | "missing_token"
    | "invalid_token"
    | "token_expired"
    | "server_misconfigured"
    | "poll_limit_exceeded"
    | "connection_not_found"
    | "db_error"
): number {
  switch (kind) {
    case "missing_token":
    case "invalid_token":
    case "token_expired":
      return 401;
    case "poll_limit_exceeded":
      return 429;
    case "connection_not_found":
      return 404;
    case "server_misconfigured":
    case "db_error":
      return 500;
  }
}
