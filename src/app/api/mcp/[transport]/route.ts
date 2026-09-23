import { randomUUID } from "node:crypto";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { resolveMcpPrincipal } from "@/lib/mcp/auth/resolve";
import { assertExhaustiveKind, type McpPrincipal } from "@/lib/mcp/auth/types";
import { hashClientIp } from "@/lib/mcp/ipHash";
import { resolveClientIp } from "@/lib/net/clientIp";
import { registerPrompts } from "@/lib/mcp/prompts";
import { MCP_ROUTE_RATE_LIMIT } from "@/lib/mcp/rateLimits";
import { registerTools } from "@/lib/mcp/tools";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Upper bound on the body size we are willing to read to extract MCP
 * clientInfo. Real `initialize` JSON-RPC bodies are <2KB; 16KB is
 * generous. Anything larger is either non-initialize traffic (which
 * does not carry clientInfo anyway) or a malicious oversized payload.
 *
 * Without this guard, a 100MB POST would force `req.clone().text()`
 * to buffer the entire body in memory on every request, opening a
 * trivial OOM/DoS vector against the serverless function.
 */
const MAX_INITIALIZE_BODY_BYTES = 16 * 1024;

/**
 * Strips control characters and HTML/JS injection characters from MCP
 * client-supplied strings before they reach the DB. clientName and
 * clientVersion arrive raw from the MCP initialize handshake and end
 * up in mcp_oauth_clients and mcp_audit_log, both of which are read
 * back by the admin dashboard. Without this guard, a malicious client
 * could store HTML/script payloads that fire as stored-XSS the moment
 * the dashboard renders these fields as HTML.
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

/**
 * MCP Streamable HTTP endpoint, /api/mcp/mcp: mcp-handler derives it from
 * basePath "/api/mcp" through the [transport] segment.
 *
 * SSE is disabled: with a valid token, /api/mcp/sse and /api/mcp/message
 * answer 404 (auth runs first, so a request without one gets 401). The MCP
 * spec replaced SSE with Streamable HTTP in 2025-03-26, and mcp-handler's
 * SSE mode needs a redis:// URL, which this config never passes (Upstash is
 * reached over REST): without one, an SSE connect never answers.
 *
 * Auth flow:
 *   1. Per-IP ceiling (MCP_ROUTE_RATE_LIMIT) fires first, before any token
 *      handling, so probes and floods get short-circuited cheaply. It
 *      answers 429 (or 503 when the limiter is down), never 401: a 401
 *      tells an OAuth client its token is dead and starts a re-login.
 *   2. Bearer token arrives in the Authorization header.
 *   3. If it starts with stp_mcp_, we resolve it as an API key via
 *      resolveMcpPrincipal(). We return an AuthInfo object that the
 *      SDK injects into tool handler context.
 *   4. Otherwise, we try Clerk OAuth token verification. The user's
 *      Clerk userId becomes the principalId.
 *   5. If neither works, the request gets a 401.
 *
 * The principal (including cached plan tier) and a synthetic
 * requestSessionId are stashed in authInfo.extra so tool handlers
 * can retrieve them without re-resolving on every call.
 *
 * Called by: MCP clients (Claude Desktop, Cursor, ChatGPT, etc.)
 * Tables touched: api_keys (read, via resolveMcpPrincipal),
 *   mcp_sessions (UPSERT per request via logToolCall),
 *   mcp_audit_log (insert per tool call)
 * Rate limits: Upstash Redis, via checkRateLimit
 */
const handler = createMcpHandler(
  (server) => {
    registerTools(server);
    registerPrompts(server);
  },
  {
    serverInfo: {
      name: "Sharetopus",
      version: "0.1.0",
    },
  },
  {
    basePath: "/api/mcp",
    disableSse: true,
    verboseLogs: process.env.NODE_ENV === "development",
  },
);

const authHandler = withMcpAuth(
  handler,
  async (req: Request, bearerToken?: string) => {
    if (!bearerToken) return undefined;

    // Step 2: Best-effort clientInfo extraction from MCP initialize
    // requests. Only the initialize JSON-RPC body carries
    // params.clientInfo; tool-call requests do not. Extracted before
    // resolveMcpPrincipal so the OAuth trust check can use hints for
    // the first-sight INSERT into mcp_oauth_clients.
    //
    // Three guards skip the clone+read entirely when it cannot pay off:
    //   1. Body length zero/missing: nothing to parse.
    //   2. Body length above MAX_INITIALIZE_BODY_BYTES: DoS shield;
    //      initialize bodies are always <2KB so anything larger is
    //      either tool-call traffic or hostile.
    //   3. Content-Type not JSON: image uploads, multipart, etc.
    //
    // When any guard fails we skip extraction and continue auth with
    // null clientName/clientVersion. The principal still resolves; we
    // just lose the optional analytics enrichment for that request.
    //
    // Extracted values are sanitized via sanitizeClientField() before
    // they leave this scope. Both fields end up in mcp_oauth_clients
    // and mcp_audit_log, which may be rendered as HTML in the admin
    // dashboard; raw strings would be a stored-XSS vector.
    let clientName: string | null = null;
    let clientVersion: string | null = null;

    try {
      if (req.method === "POST") {
        const contentLength = Number(req.headers.get("content-length") ?? "0");
        const contentType = req.headers.get("content-type") ?? "";

        const bodySafeToRead =
          contentLength > 0 &&
          contentLength <= MAX_INITIALIZE_BODY_BYTES &&
          contentType.includes("application/json");

        if (bodySafeToRead) {
          const clonedRequest = req.clone();
          const bodyText = await clonedRequest.text();

          // Cheap substring check before JSON.parse avoids parsing
          // tool-call payloads we will never extract clientInfo from.
          if (
            bodyText.includes('"method":"initialize"') ||
            bodyText.includes('"method": "initialize"')
          ) {
            const parsed = JSON.parse(bodyText);
            if (parsed?.method === "initialize") {
              const ci = parsed?.params?.clientInfo;
              if (ci && typeof ci === "object") {
                if (typeof ci.name === "string") {
                  clientName = sanitizeClientField(ci.name, 200);
                }
                if (typeof ci.version === "string") {
                  clientVersion = sanitizeClientField(ci.version, 50);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn(
        "[mcp/route] clientInfo extraction failed:",
        err instanceof Error ? err.message : err,
      );
    }

    // Step 3: resolveMcpPrincipal handles both API key and Clerk OAuth
    // paths, including the subscription gate and (for OAuth) the
    // first-sight trust check on mcp_oauth_clients. Hints carry
    // clientInfo for that INSERT.
    const principal = await resolveMcpPrincipal(bearerToken, {
      clientName,
      clientVersion,
    });
    if (!principal) return undefined;

    // Synthetic per-request session ID. mcp-handler v1.1.0 forces stateless
    // Streamable HTTP (sessionIdGenerator is typed undefined), so the SDK
    // never produces a real session ID. This UUID serves as the session
    // identity until mcp-handler exposes real session lifecycle.
    const requestSessionId = randomUUID();

    return {
      token: bearerToken,
      scopes: principal.scopes,
      clientId: clientIdForAuthInfo(principal),
      extra: {
        principal: principal satisfies McpPrincipal,
        requestSessionId,
        clientName,
        clientVersion,
      },
    };
  },
  {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  },
);

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

  return authHandler(req);
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
