import { randomUUID } from "node:crypto";
import type { McpPrincipal } from "@/lib/mcp/auth";
import { resolveMcpPrincipal } from "@/lib/mcp/auth";
import { registerPrompts } from "@/lib/mcp/prompts";
import { registerResources } from "@/lib/mcp/resources";
import { registerTools } from "@/lib/mcp/tools";
import { createMcpHandler, withMcpAuth } from "mcp-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * MCP Streamable HTTP + SSE endpoint.
 *
 * The [transport] dynamic segment routes both transports to this file.
 * mcp-handler derives endpoints from basePath "/api/mcp":
 *   - Streamable HTTP: /api/mcp/mcp
 *   - SSE:             /api/mcp/sse
 *
 * Auth flow:
 *   1. Bearer token arrives in the Authorization header.
 *   2. If it starts with stp_mcp_, we resolve it as an API key via
 *      resolveMcpPrincipal(). We return an AuthInfo object that the
 *      SDK injects into tool handler context.
 *   3. Otherwise, we try Clerk OAuth token verification. The user's
 *      Clerk userId becomes the principalId.
 *   4. If neither works, the request gets a 401.
 *
 * The principal (including cached plan tier) and a synthetic
 * requestSessionId are stashed in authInfo.extra so tool handlers
 * can retrieve them without re-resolving on every call.
 *
 * Called by: MCP clients (Claude Desktop, Cursor, ChatGPT, etc.)
 * Tables touched: api_keys (read, via resolveMcpPrincipal),
 *   mcp_sessions (UPSERT per request via logToolCall),
 *   mcp_audit_log (insert per tool call)
 */
const handler = createMcpHandler(
  (server) => {
    registerTools(server);
    registerResources(server);
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
    maxDuration: 300,
    verboseLogs: process.env.NODE_ENV === "development",
  },
);

const authHandler = withMcpAuth(
  handler,
  async (_req: Request, bearerToken?: string) => {
    if (!bearerToken) return undefined;

    // resolveMcpPrincipal handles both API key and Clerk OAuth paths,
    // including the subscription gate. See src/lib/mcp/auth.ts.
    const principal = await resolveMcpPrincipal(bearerToken);
    if (!principal) return undefined;

    // Synthetic per-request session ID. mcp-handler v1.1.0 forces stateless
    // Streamable HTTP (sessionIdGenerator is typed undefined), so the SDK
    // never produces a real session ID. This UUID serves as the session
    // identity until mcp-handler exposes real session lifecycle.
    const requestSessionId = randomUUID();

    return {
      token: bearerToken,
      scopes: principal.scopes,
      clientId:
        principal.kind === "oauth"
          ? principal.oauthClientId
          : (principal.apiKeyId ?? ""),
      extra: {
        principal: principal satisfies McpPrincipal,
        requestSessionId,
      },
    };
  },
  {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  },
);

export { authHandler as GET, authHandler as POST };
