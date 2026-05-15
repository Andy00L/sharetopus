import "server-only";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveRestApiKey } from "../auth/resolveRestApiKey";
import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { generateRequestId } from "@/lib/utils/generateRequestId";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { restErrorResponse } from "../errors/restErrorResponse";
import {
  writeRestAuditLog,
  type RestAuditOutcome,
} from "../audit/writeRestAuditLog";
import type { RestApiKeyContext } from "../auth/types";

/**
 * Union return type for REST handlers.
 *
 * Handlers may return a plain NextResponse (backward-compatible with
 * Phase 2) or an object pairing the response with an enriched audit
 * summary. The HOF dispatches on `instanceof NextResponse`.
 */
export type RestHandlerResult =
  | NextResponse
  | { response: NextResponse; auditSummary: Record<string, unknown> };

export type WithRestEndpointConfig = {
  /** Required scopes. For Phase 2 MVP, all routes use ["api:full"]. */
  scopes: string[];
  /** Action key used by checkRateLimit (e.g. "rest.posts.create"). */
  rateLimitAction: string;
  /**
   * Route handler. Receives resolved context and raw Next.js request.
   * Does its own JSON body parsing and Zod validation. Returns a
   * NextResponse (legacy) or { response, auditSummary } for enriched
   * audit logging.
   *
   * Convention: never throw. Use restErrorResponse for any 4xx/5xx.
   * HOF wraps in try/catch as defense; uncaught throws produce a 500
   * with outcome="internal_error".
   */
  handler: (
    ctx: RestApiKeyContext,
    request: NextRequest,
  ) => Promise<RestHandlerResult>;
};

/**
 * Wraps a Next.js route handler with shared REST boilerplate:
 *   1. Generate requestId, capture ipHash, userAgent, endpoint, method, startedAt
 *   2. Validate Authorization header is "Bearer ..."
 *   3. Resolve the bearer via resolveRestApiKey
 *   4. Check the principal has required scopes
 *   5. Apply per-principal rate limit via checkRateLimit
 *   6. Call the handler with full context and the raw request
 *   7. After handler returns (or throws), write to rest_audit_log
 *
 * Handler is responsible for body parsing, Zod validation, and
 * returning NextResponse for all outcomes (success, 404, conflict).
 * Keeps the HOF free of generics.
 */
export function withRestEndpoint(
  config: WithRestEndpointConfig,
): (request: NextRequest) => Promise<NextResponse> {
  return async function routeHandler(
    request: NextRequest,
  ): Promise<NextResponse> {
    // Step 1: build base envelope. Available even on auth failure.
    const requestStartedAt = Date.now();
    const requestId = generateRequestId();
    const clientIpHash = await extractIpHash();
    const userAgent = await extractUserAgent();
    const endpoint = new URL(request.url).pathname;
    const httpMethod = request.method;

    // Step 2: validate Authorization header shape.
    const authorizationHeader = request.headers.get("authorization");
    if (
      !authorizationHeader ||
      !authorizationHeader.startsWith("Bearer ")
    ) {
      // No audit row for anonymous probes (no principal to attribute).
      return restErrorResponse(
        "unauthorized",
        "Missing or malformed Authorization header",
        requestId,
      );
    }
    const bearerToken = authorizationHeader.slice("Bearer ".length).trim();

    // Step 3: resolve bearer to RestPrincipal.
    const principal = await resolveRestApiKey(bearerToken);
    if (!principal) {
      return restErrorResponse(
        "unauthorized",
        "Invalid or expired API key",
        requestId,
      );
    }

    const restRequestContext: RestApiKeyContext = {
      principal,
      requestId,
      ipHash: clientIpHash,
      userAgent,
      endpoint,
      httpMethod,
      startedAt: requestStartedAt,
    };

    // Step 4: scope check. "api:full" satisfies every scope for MVP.
    const hasRequiredScopes = config.scopes.every(
      (requiredScope) =>
        principal.scopes.includes(requiredScope) ||
        principal.scopes.includes("api:full"),
    );
    if (!hasRequiredScopes) {
      await writeRestAuditLog({
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

    // Step 5: per-principal rate limit.
    const rateLimitResult = await checkRateLimit(
      config.rateLimitAction,
      principal.principalId,
    );
    if (!rateLimitResult.success) {
      await writeRestAuditLog({
        context: restRequestContext,
        statusCode: 429,
        outcome: "rate_limited",
        errorCode: "rate_limit_exceeded",
        argsPayload: { action: config.rateLimitAction },
        responseSummary: {
          retry_after_seconds: rateLimitResult.resetIn ?? null,
        },
      });
      return restErrorResponse(
        "rate_limited",
        "Too many requests",
        requestId,
        {
          retry_after_seconds: rateLimitResult.resetIn ?? null,
        },
      );
    }

    // Step 6: call handler. Handler returns RestHandlerResult. If it
    // throws, we still write an audit row and convert to a 500.
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
      await writeRestAuditLog({
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

    // Unwrap: plain NextResponse (Phase 2 compat) vs enriched result.
    const handlerResponse =
      handlerResult instanceof NextResponse
        ? handlerResult
        : handlerResult.response;
    const enrichedAuditSummary =
      handlerResult instanceof NextResponse
        ? null
        : handlerResult.auditSummary;

    // Step 7: audit the outcome derived from handler's status code.
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
              : "internal_error";

    await writeRestAuditLog({
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
