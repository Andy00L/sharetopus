import "server-only";

import type { NextRequest } from "next/server";
import { after, NextResponse } from "next/server";

import { resolveRestApiKey } from "../auth/resolveRestApiKey";
import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { generateRequestId } from "@/lib/utils/generateRequestId";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { REST_ENDPOINT_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import {
  restErrorResponse,
  SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from "../errors/restErrorResponse";
import {
  writeRestAuditLog,
  type RestAuditOutcome,
  type RestAuditWriteInput,
} from "../audit/writeRestAuditLog";
import type { RestApiKeyContext } from "../auth/types";

export type RestHandlerResult =
  | NextResponse
  | { response: NextResponse; auditSummary: Record<string, unknown> };

export type WithRestEndpointConfig = {
  scopes: string[];
  rateLimitAction: string;
  handler: (
    ctx: RestApiKeyContext,
    request: NextRequest,
  ) => Promise<RestHandlerResult>;
};

export function withRestEndpoint(
  config: WithRestEndpointConfig,
): (request: NextRequest) => Promise<NextResponse> {
  return async function routeHandler(
    request: NextRequest,
  ): Promise<NextResponse> {
    const requestStartedAt = Date.now();
    const requestId = generateRequestId();
    const clientIpHash = await extractIpHash();
    const userAgent = await extractUserAgent();
    const endpoint = request.nextUrl.pathname;
    const httpMethod = request.method;

    const authorizationHeader = request.headers.get("authorization");
    if (
      !authorizationHeader ||
      !authorizationHeader.startsWith("Bearer ")
    ) {
      return restErrorResponse(
        "unauthorized",
        "Missing or malformed Authorization header",
        requestId,
      );
    }
    const bearerToken = authorizationHeader.slice("Bearer ".length).trim();

    const resolution = await resolveRestApiKey(bearerToken, clientIpHash);
    if (resolution.status === "unavailable") {
      return restErrorResponse(
        "service_unavailable",
        "Could not verify the API key right now. Retry shortly.",
        requestId,
        { retry_after_seconds: SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS },
      );
    }
    if (resolution.status === "rejected") {
      return restErrorResponse(
        "unauthorized",
        "Invalid or expired API key",
        requestId,
      );
    }
    const principal = resolution.principal;

    const restRequestContext: RestApiKeyContext = {
      principal,
      requestId,
      ipHash: clientIpHash,
      userAgent,
      endpoint,
      httpMethod,
      startedAt: requestStartedAt,
    };

    const hasRequiredScopes = config.scopes.every(
      (requiredScope) =>
        principal.scopes.includes(requiredScope) ||
        principal.scopes.includes("api:full"),
    );
    if (!hasRequiredScopes) {
      scheduleRestAuditLog({
        context: restRequestContext,
        statusCode: 403,
        outcome: "auth_error",
        errorCode: "missing_scope",
        argsPayload: { required_scopes: config.scopes },
        responseSummary: null,
      });
      return restErrorResponse(
        "forbidden",
        "API key lacks required scopes",
        requestId,
      );
    }

    const rateLimitResult = await checkRateLimit({
      operation: config.rateLimitAction,
      identifier: principal.principalId,
      rule: REST_ENDPOINT_RATE_LIMIT,
    });
    if (!rateLimitResult.success) {
      const isLimitHit = rateLimitResult.reason === "limited";
      const retryAfterSeconds = isLimitHit
        ? rateLimitResult.resetIn
        : SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS;
      scheduleRestAuditLog({
        context: restRequestContext,
        statusCode: isLimitHit ? 429 : 503,
        outcome: isLimitHit ? "rate_limited" : "internal_error",
        errorCode: isLimitHit
          ? "rate_limit_exceeded"
          : "rate_limiter_unavailable",
        argsPayload: { action: config.rateLimitAction },
        responseSummary: { retry_after_seconds: retryAfterSeconds },
      });
      return isLimitHit
        ? restErrorResponse("rate_limited", "Too many requests", requestId, {
            retry_after_seconds: retryAfterSeconds,
          })
        : restErrorResponse(
            "service_unavailable",
            "Could not check the rate limit right now. Retry shortly.",
            requestId,
            { retry_after_seconds: retryAfterSeconds },
          );
    }

    let handlerResult: RestHandlerResult;
    try {
      handlerResult = await config.handler(restRequestContext, request);
    } catch (handlerError) {
      const errorMessage =
        handlerError instanceof Error
          ? handlerError.message
          : "unknown error";
      console.error(
        `[withRestEndpoint] handler threw for ${endpoint} request_id=${requestId}:`,
        errorMessage,
      );
      scheduleRestAuditLog({
        context: restRequestContext,
        statusCode: 500,
        outcome: "internal_error",
        errorCode: "handler_exception",
        argsPayload: null,
        responseSummary: { message: errorMessage },
      });
      return restErrorResponse(
        "internal_error",
        "An unexpected error occurred",
        requestId,
      );
    }

    const handlerResponse =
      handlerResult instanceof NextResponse
        ? handlerResult
        : handlerResult.response;
    const enrichedAuditSummary =
      handlerResult instanceof NextResponse
        ? null
        : handlerResult.auditSummary;

    const responseStatusCode = handlerResponse.status;
    const outcome: RestAuditOutcome =
      responseStatusCode >= 200 && responseStatusCode < 300
        ? "success"
        : responseStatusCode === 400
          ? "validation_error"
          : responseStatusCode === 401 || responseStatusCode === 403
            ? "auth_error"
            : responseStatusCode === 429
              ? "rate_limited"
              : responseStatusCode >= 400 && responseStatusCode < 500
                ? "client_error"
                : "internal_error";

    scheduleRestAuditLog({
      context: restRequestContext,
      statusCode: responseStatusCode,
      outcome,
      errorCode: outcome === "success" ? null : "see_response",
      argsPayload: null,
      responseSummary: enrichedAuditSummary ?? { status: responseStatusCode },
    });

    return handlerResponse;
  };
}

function scheduleRestAuditLog(
  input: Omit<RestAuditWriteInput, "finishedAt">,
): void {
  const finishedAt = Date.now();
  after(() => writeRestAuditLog({ ...input, finishedAt }));
}
