import { randomUUID } from "node:crypto";

import {
  CLIENT_INFO_META_KEY,
  type AuthInfo,
} from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { NextResponse } from "next/server";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { resolveMcpPrincipal } from "@/lib/mcp/auth/resolve";
import { assertExhaustiveKind, type McpPrincipal } from "@/lib/mcp/auth/types";
import { hashClientIp } from "@/lib/mcp/ipHash";
import { registerPrompts } from "@/lib/mcp/prompts";
import { MCP_ROUTE_RATE_LIMIT } from "@/lib/mcp/rateLimits";
import { MCP_SERVER_INSTRUCTIONS } from "@/lib/mcp/serverInstructions";
import { registerTools } from "@/lib/mcp/tools";
import { resolveClientIp } from "@/lib/net/clientIp";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Largest body read for the client name (bodies carrying it are under 2 KB); bounds the clone against huge POSTs. */
const MAX_CLIENT_INFO_BODY_BYTES = 16 * 1024;

/** Seconds a client waits before retrying when its credentials could not be checked. */
const AUTH_RETRY_AFTER_SECONDS = 30;

const MCP_AUTH_OPTIONS = {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
};

/** Strips control and HTML characters from the client name before it lands in mcp_oauth_clients (stored XSS guard). */
function sanitizeClientField(raw: string, maxLength: number): string {
  return raw.replace(/[\x00-\x1f<>'"&]/g, "").slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Client name from initialize params.clientInfo (2025 era) or the _meta envelope (2026-07-28). */
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

/** Best effort: the name only enriches the first-sight client row, so any failure returns null. */
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
 * The bearer token from the Authorization header, parsed the way withMcpAuth
 * parses it (sourceRef: node_modules/mcp-handler/dist/index.mjs, withMcpAuth).
 */
function readBearerToken(authorizationHeader: string | null): string | undefined {
  const [scheme, token] = authorizationHeader?.split(" ") ?? [];
  return scheme?.toLowerCase() === "bearer" ? token : undefined;
}

/**
 * Resolves the token before withMcpAuth: withMcpAuth answers 401 to every
 * failure, which would sign OAuth clients out during a database outage, so
 * an unreadable database answers 503 with Retry-After instead.
 */
async function authenticateMcpRequest(req: Request): Promise<Response> {
  const bearerToken = readBearerToken(req.headers.get("authorization"));
  let authInfo: AuthInfo | undefined;

  if (bearerToken) {
    const clientName = await readClientNameFromRequest(req);
    // API key or Clerk OAuth, including the subscription gate and the client trust check.
    const resolution = await resolveMcpPrincipal(bearerToken, { clientName });
    if (resolution.status === "unavailable") {
      return NextResponse.json(
        {
          error: "auth_unavailable",
          message: "Could not verify the credentials right now. Retry shortly.",
          retryAfter: AUTH_RETRY_AFTER_SECONDS,
        },
        {
          status: 503,
          headers: { "Retry-After": String(AUTH_RETRY_AFTER_SECONDS) },
        },
      );
    }
    if (resolution.status === "resolved") {
      authInfo = toAuthInfo(bearerToken, resolution.principal);
    }
  }

  return withMcpAuth(mcpHandler, async () => authInfo, MCP_AUTH_OPTIONS)(req);
}

/** The AuthInfo the SDK hands every tool as `ctx.http?.authInfo`. */
function toAuthInfo(bearerToken: string, principal: McpPrincipal): AuthInfo {
  return {
    token: bearerToken,
    scopes: principal.scopes,
    clientId: clientIdForAuthInfo(principal),
    extra: {
      principal: principal satisfies McpPrincipal,
      // Serving is stateless, so this per-request id stands in for a session id in logs.
      requestId: randomUUID(),
    },
  };
}

/**
 * The MCP server at /api/mcp/mcp: stateless Streamable HTTP, protocol
 * 2026-07-28 with a fallback for 2025-era clients. Auth: stp_mcp_ API key or
 * Clerk OAuth; a missing or bad token gets a 401 pointing at
 * /.well-known/oauth-protected-resource.
 */
const mcpHandler = createMcpHandler(
  (server) => {
    registerTools(server);
    registerPrompts(server);
  },
  {
    serverInfo: {
      name: "Sharetopus",
      version: "0.2.0",
    },
    instructions: MCP_SERVER_INSTRUCTIONS,
    // Tools never change at runtime; a listen stream would hold a Vercel function open until maxDuration.
    capabilities: {
      tools: { listChanged: false },
      prompts: { listChanged: false },
    },
    maxSubscriptions: 0,
    verboseLogs: process.env.NODE_ENV === "development",
  },
);

/**
 * Per-IP ceiling before any token handling; it answers 429 or 503, never a
 * 401 that would sign OAuth clients out. The per-user budget lives in withMcpTool.
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

  return authenticateMcpRequest(req);
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
