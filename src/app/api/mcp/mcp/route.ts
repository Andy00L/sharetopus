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
import { isJsonObject, type JsonObject } from "@/lib/utils/jsonObject";
import {
  buildRateLimitJsonResponse,
  describeRateLimitRejection,
} from "@/lib/x402/http/rateLimitRejection";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_CLIENT_INFO_BODY_BYTES = 16 * 1024;

const AUTH_RETRY_AFTER_SECONDS = 30;

const MCP_AUTH_OPTIONS = {
  required: true,
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
};

function sanitizeClientField(raw: string, maxLength: number): string {
  return raw.replace(/[\x00-\x1f<>'"&]/g, "").slice(0, maxLength);
}

/** Client name from initialize params.clientInfo (2025 era) or the _meta envelope (2026-07-28). */
function readClientName(parsedBody: unknown): string | null {
  if (!isJsonObject(parsedBody) || !isJsonObject(parsedBody.params)) return null;
  const { params } = parsedBody;
  const envelope: JsonObject = isJsonObject(params._meta)
    ? params._meta
    : {};
  const clientInfo = params.clientInfo ?? envelope[CLIENT_INFO_META_KEY];
  return isJsonObject(clientInfo) && typeof clientInfo.name === "string"
    ? clientInfo.name
    : null;
}

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

// Parsed the way mcp-handler's withMcpAuth parses it (node_modules/mcp-handler/dist/index.mjs withMcpAuth).
function readBearerToken(authorizationHeader: string | null): string | undefined {
  const [scheme, token] = authorizationHeader?.split(" ") ?? [];
  return scheme?.toLowerCase() === "bearer" ? token : undefined;
}

// mcp-handler's withMcpAuth answers 401 to every verify failure (dist/index.mjs withMcpAuth), which signs OAuth
// clients out, so a database outage is answered here before it.
async function authenticateMcpRequest(req: Request): Promise<Response> {
  const bearerToken = readBearerToken(req.headers.get("authorization"));
  let authInfo: AuthInfo | undefined;

  if (bearerToken) {
    const clientName = await readClientNameFromRequest(req);
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

function toAuthInfo(bearerToken: string, principal: McpPrincipal): AuthInfo {
  return {
    token: bearerToken,
    scopes: principal.scopes,
    clientId: clientIdForAuthInfo(principal),
    extra: {
      principal: principal satisfies McpPrincipal,
      requestId: randomUUID(),
    },
  };
}

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
    // A listen stream holds the Vercel function open until maxDuration.
    capabilities: {
      tools: { listChanged: false },
      prompts: { listChanged: false },
    },
    maxSubscriptions: 0,
    verboseLogs: process.env.NODE_ENV === "development",
  },
);

async function handleMcpRequest(req: Request): Promise<Response> {
  const clientIpHash = hashClientIp(resolveClientIp(req.headers));

  if (clientIpHash) {
    const routeLimit = await checkRateLimit({
      operation: "mcp_route",
      identifier: clientIpHash,
      rule: {
        limit: MCP_ROUTE_RATE_LIMIT.requests,
        windowSeconds: MCP_ROUTE_RATE_LIMIT.windowSeconds,
      },
    });
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
