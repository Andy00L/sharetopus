import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { resolveMcpPrincipal } from "@/lib/mcp/auth";
import type { McpPrincipal } from "@/lib/mcp/auth";
import { registerTools } from "@/lib/mcp/tools";
import { registerResources } from "@/lib/mcp/resources";
import { registerPrompts } from "@/lib/mcp/prompts";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * MCP Streamable HTTP + SSE endpoint.
 *
 * Both /api/mcp/sse and /api/mcp/streamable-http resolve here thanks
 * to the [transport] dynamic segment. The handler from mcp-handler
 * negotiates the right transport based on the client's request.
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
 * The principal is stashed in authInfo.extra so tool handlers can
 * retrieve it without re-resolving on every call.
 *
 * Called by: MCP clients (Claude Desktop, Cursor, ChatGPT, etc.)
 * Tables touched: api_keys (via resolveMcpPrincipal), mcp_sessions (read/write)
 */
const handler = createMcpHandler(
  (server) => {
    registerTools(server);
    registerResources(server);
    registerPrompts(server);
  },
  {},
  {
    basePath: "/api",
    maxDuration: 300,
    verboseLogs: process.env.NODE_ENV === "development",
  }
);

const authHandler = withMcpAuth(
  handler,
  async (_req: Request, bearerToken?: string) => {
    if (!bearerToken) return undefined;

    // resolveMcpPrincipal handles both API key and Clerk OAuth paths,
    // including the subscription gate. See src/lib/mcp/auth.ts.
    const principal = await resolveMcpPrincipal(bearerToken);
    if (!principal) return undefined;

    return {
      token: bearerToken,
      scopes: principal.scopes,
      clientId:
        principal.kind === "oauth"
          ? principal.oauthClientId
          : (principal.apiKeyId ?? ""),
      extra: { principal: principal satisfies McpPrincipal },
    };
  },
  {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  }
);

export { authHandler as GET, authHandler as POST };
