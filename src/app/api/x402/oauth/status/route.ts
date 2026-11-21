import "server-only";

import { after, NextResponse, type NextRequest } from "next/server";

import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { X402_OAUTH_STATUS_POLL_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import { logX402Call, type X402AuditEntry } from "@/lib/x402/audit/logX402Call";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";
import { handleStatusQuery, type StatusQueryResult } from "@/lib/x402/oauth/status/handleStatusQuery";

export const runtime = "nodejs";
export const maxDuration = 10;

const ENDPOINT_PATH = "/api/x402/oauth/status";

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

  const rateLimitResult = await checkRateLimit({
    operation: "x402_oauth_status_poll",
    identifier: null,
    rule: X402_OAUTH_STATUS_POLL_RATE_LIMIT,
  });
  if (!rateLimitResult.success) {
    const rejection = describeRateLimitRejection(rateLimitResult);
    auditRejection(rejection.auditStatus);
    return buildRateLimitJsonResponse(rejection);
  }

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

function mapStatusErrorToHttpStatus(
  kind: Extract<StatusQueryResult, { ok: false }>["error"]["kind"],
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
