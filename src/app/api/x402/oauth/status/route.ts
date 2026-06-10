import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { handleStatusQuery } from "@/lib/x402/oauth/status/handleStatusQuery";

export const runtime = "nodejs";
export const maxDuration = 10;

const ENDPOINT_PATH = "/api/x402/oauth/status";

/**
 * GET /api/x402/oauth/status
 * Headers: Authorization: Bearer <connectionToken>
 *
 * Returns current state of an OAuth connection. Polled by agents during OAuth flow.
 *
 * Auth: HMAC-signed connectionToken issued at /connect time.
 *
 * Rate limit: 120/min per IP (x402_oauth_status_poll scope).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = performance.now();
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();

  // -- Rate limit
  const rateLimitResult = await checkRateLimit(
    "x402_oauth_status_poll",
    null,
    120,
    60
  );
  if (!rateLimitResult.success) {
    await logX402Call({
      principal: null,
      action: "connect_account",
      endpoint: ENDPOINT_PATH,
      chargeId: null,
      resultStatus: "rate_limited",
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });
    return NextResponse.json(
      {
        error: "rate_limited",
        retryAfter: rateLimitResult.resetIn ?? 60,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimitResult.resetIn ?? 60) },
      }
    );
  }

  // -- Extract Bearer token
  const authHeader = request.headers.get("authorization");
  const connectionToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (!connectionToken) {
    await logX402Call({
      principal: null,
      action: "connect_account",
      endpoint: ENDPOINT_PATH,
      chargeId: null,
      resultStatus: "error",
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });
    return NextResponse.json(
      {
        error: "missing_authorization",
        message: "Authorization: Bearer <connectionToken> header is required.",
      },
      { status: 401 }
    );
  }

  // -- Query status
  const result = await handleStatusQuery({ connectionToken }, ipHash);

  if (!result.ok) {
    const status = mapStatusErrorToHttpStatus(result.error.kind);

    await logX402Call({
      principal: null,
      action: "connect_account",
      endpoint: ENDPOINT_PATH,
      chargeId: null,
      resultStatus: "error",
      latencyMs: Math.round(performance.now() - startMs),
      ipHash,
      userAgent,
    });

    return NextResponse.json(
      { error: result.error.kind, message: result.error.message },
      { status }
    );
  }

  await logX402Call({
    principal: null,
    action: "connect_account",
    endpoint: ENDPOINT_PATH,
    chargeId: null,
    resultStatus: "ok",
    latencyMs: Math.round(performance.now() - startMs),
    ipHash,
    userAgent,
  });

  return NextResponse.json(result.payload, { status: 200 });
}

/**
 * server_misconfigured is a 500 on purpose: it means OUR HMAC secret is
 * missing, and a 401 would send well-behaved agents into a re-auth loop.
 */
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
