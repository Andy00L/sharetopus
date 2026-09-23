import { randomUUID } from "node:crypto";

import {
  CLIENT_INFO_META_KEY,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { resolveMcpPrincipal } from "@/lib/mcp/auth/resolve";
import { assertExhaustiveKind, type McpPrincipal } from "@/lib/mcp/auth/types";
import { hashClientIp } from "@/lib/mcp/ipHash";
import { registerPrompts } from "@/lib/mcp/prompts";
import { MCP_ROUTE_RATE_LIMIT } from "@/lib/mcp/rateLimits";
import { registerTools } from "@/lib/mcp/tools";
import { resolveClientIp } from "@/lib/net/clientIp";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Upper bound on the body size we are willing to read to extract the
 * client's name. The bodies that carry it (a 2025-era `initialize`, or a
 * 2026-07-28 request's `_meta` envelope) are under 2KB unless they are
 * large tool calls, which we skip. Without this guard a 100MB POST would
 * force `req.clone().text()` to buffer the whole body on every request, a
 * trivial OOM/DoS vector against the serverless function.
 */
const MAX_CLIENT_INFO_BODY_BYTES = 16 * 1024;

/**
 * Strips control characters and HTML/JS injection characters from MCP
 * client-supplied strings before they reach the DB. The client name
 * arrives raw from the client and ends up in mcp_oauth_clients.client_name
 * (first-sight INSERT), which the admin dashboard reads back. Without
 * this guard, a malicious client could store HTML/script payloads that
 * fire as stored-XSS the moment the dashboard renders the field as HTML.
 *
 * Removed character classes:
 *   - 0x00-0x1f: ASCII control chars (null bytes, tabs, escape)
 *   - < > ' " &: HTML/attribute injection vectors
 *
 * The output is also length-capped per the column constraints upstream.
 */
function sanitizeClientField(raw: string, maxLength: number): string {
  return raw.replace(/[\x00-\x1f<>'"&]/g, "").slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the client's name from a parsed JSON-RPC body. 2025-era clients
 * send it once, in `initialize` params.clientInfo; 2026-07-28 clients send
 * it on every request, in the `_meta` envelope under CLIENT_INFO_META_KEY.
 */
function readClientName(parsedBody: unknown): string | null {
  if (!isRecord(parsedBody) || !isRecord(parsedBody.params)) return null;
  const { params } = parsedBody;
  const envelope: Record<string, unknown> = isRecord(params._meta)
    ? params._meta
    : {};
  const clientInfo = params.clientInfo ?? envelope[CLIENT_INFO_META_KEY];
  return isRecord(clientInfo) && typeof clientInfo.name === "string"
    ? clientInfo.name
    : null;
}

/**
 * Best-effort: the client name only enriches the first-sight row in
 * mcp_oauth_clients, so any failure returns null and auth continues. The
 * guards skip the clone+read when it cannot pay off: no body, a body above
 * MAX_CLIENT_INFO_BODY_BYTES, or a non-JSON content type.
 */
async function readClientNameFromRequest(req: Request): Promise<string | null> {
  if (req.method !== "POST") return null;

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  const contentType = req.headers.get("content-type") ?? "";
  const isBodySafeToRead =
    contentLength > 0 &&
    contentLength <= MAX_CLIENT_INFO_BODY_BYTES &&
    contentType.includes("application/json");
  if (!isBodySafeToRead) return null;

  try {
    const bodyText = await req.clone().text();
    // Cheap substring check before JSON.parse skips payloads that carry
    // no client info.
    if (
      !bodyText.includes('"initialize"') &&
      !bodyText.includes(CLIENT_INFO_META_KEY)
    ) {
      return null;
    }
    const clientName = readClientName(JSON.parse(bodyText));
    return clientName === null ? null : sanitizeClientField(clientName, 200);
  } catch (err) {
    console.warn(
      "[readClientNameFromRequest] clientInfo extraction failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Steps 2 to 5 of the auth flow: resolves the bearer token to a principal
 * and returns the AuthInfo the SDK hands every tool as
 * `ctx.http?.authInfo`. Returning undefined makes withMcpAuth answer 401.
 */
async function verifyMcpBearerToken(
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;

  // Read before resolveMcpPrincipal: the OAuth trust check uses it for
  // the first-sight INSERT into mcp_oauth_clients.
  const clientName = await readClientNameFromRequest(req);

  // Handles both the API key and the Clerk OAuth paths, including the
  // subscription gate and the OAuth client trust check.
  const principal = await resolveMcpPrincipal(bearerToken, { clientName });
  if (!principal) return undefined;

  return {
    token: bearerToken,
    scopes: principal.scopes,
    clientId: clientIdForAuthInfo(principal),
    extra: {
      principal: principal satisfies McpPrincipal,
      // Per-request correlation ID for logs and mcp_audit_log.session_id.
      // Serving is stateless on both protocol eras, so no session id exists.
      requestId: randomUUID(),
    },
  };
}

/**
 * MCP endpoint at /api/mcp/mcp, the URL every client is configured with.
 *
 * mcp-handler 2.x serves the 2026-07-28 protocol revision natively and
 * falls back to stateless Streamable HTTP for 2025-era clients, from this
 * one handler. It serves whatever path it is mounted on, so this is a
 * plain route: /api/mcp/sse and any other path under /api/mcp answer 404.
 * The HTTP+SSE transport no longer exists in 2.x.
 *
 * Auth flow:
 *   1. Per-IP ceiling (MCP_ROUTE_RATE_LIMIT) fires first, before any token
 *      handling, so probes and floods get short-circuited cheaply. It
 *      answers 429 (or 503 when the limiter is down), never 401: a 401
 *      tells an OAuth client its token is dead and starts a re-login.
 *   2. Bearer token arrives in the Authorization header.
 *   3. If it starts with stp_mcp_, resolveMcpPrincipal() resolves it as
 *      an API key.
 *   4. Otherwise, it tries Clerk OAuth token verification. The user's
 *      Clerk userId becomes the principalId.
 *   5. If neither works, the request gets a 401 whose WWW-Authenticate
 *      header points at /.well-known/oauth-protected-resource.
 *
 * Called by: MCP clients (Claude, Cursor, ChatGPT, etc.)
 * Tables touched: api_keys (read, via resolveMcpPrincipal),
 *   mcp_audit_log (insert per tool call, via withMcpTool)
 * Rate limits: Upstash Redis, via checkRateLimit
 */
const mcpHandler = createMcpHandler(
  (server) => {
    registerTools(server);
    registerPrompts(server);
  },
  {
    serverInfo: {
      name: "Sharetopus",
      version: "0.1.0",
    },
    // Tools and prompts never change at runtime, so nothing is announced
    // and no subscriptions/listen streams are served: on Vercel each one
    // would hold a function open until maxDuration.
    capabilities: {
      tools: { listChanged: false },
      prompts: { listChanged: false },
    },
    maxSubscriptions: 0,
    verboseLogs: process.env.NODE_ENV === "development",
  },
);

const authenticatedMcpHandler = withMcpAuth(mcpHandler, verifyMcpBearerToken, {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

/**
 * Step 1 of the auth flow: the per-IP ceiling, applied before the request
 * reaches token verification. Requests with no resolvable IP (synthetic
 * load tests, internal calls) skip it, because checkRateLimit needs a key.
 * The per-user tool-call budget is enforced later, in withMcpTool.
 */
async function handleMcpRequest(req: Request): Promise<Response> {
  const clientIpHash = hashClientIp(resolveClientIp(req.headers));

  if (clientIpHash) {
    const routeLimit = await checkRateLimit(
      "mcp_route",
      clientIpHash,
      MCP_ROUTE_RATE_LIMIT.requests,
      MCP_ROUTE_RATE_LIMIT.windowSeconds,
    );
    if (!routeLimit.success) {
      const rejection = describeRateLimitRejection(routeLimit);
      console.warn(
        `[handleMcpRequest] ${rejection.errorKind} for ip_hash=${clientIpHash} ` +
          `(retry in ${rejection.retryAfterSeconds}s)`,
      );
      return buildRateLimitJsonResponse(rejection);
    }
  }

  return authenticatedMcpHandler(req);
}

export { handleMcpRequest as GET, handleMcpRequest as POST };

function clientIdForAuthInfo(principal: McpPrincipal): string {
  switch (principal.kind) {
    case "oauth":
      return principal.oauthClientId;
    case "apikey":
      return principal.apiKeyId ?? "";
    default:
      return assertExhaustiveKind(principal);
  }
}
