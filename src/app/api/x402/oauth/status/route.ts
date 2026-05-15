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
    const status =
      result.error.kind === "missing_token" ||
      result.error.kind === "invalid_token" ||
      result.error.kind === "token_expired"
        ? 401
        : result.error.kind === "connection_not_found"
          ? 404
          : 500;

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
