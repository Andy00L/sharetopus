import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { auth } from "@clerk/nextjs/server";
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

    // Path 1: MCP API key
    const apiKeyPrincipal = await resolveMcpPrincipal(bearerToken);
    if (apiKeyPrincipal) {
      return {
        token: bearerToken,
        scopes: apiKeyPrincipal.scopes,
        clientId: apiKeyPrincipal.apiKeyId ?? "",
        extra: { principal: apiKeyPrincipal satisfies McpPrincipal },
      };
    }

    // Path 2: Clerk OAuth token
    try {
      const clerkAuth = await auth({ acceptsToken: "oauth_token" });
      const authInfo = verifyClerkToken(clerkAuth, bearerToken);
      if (authInfo) {
        // Build our McpPrincipal from the Clerk auth info
        const userId = (authInfo.extra?.userId as string) ?? "";
        const clerkClientId = authInfo.clientId ?? "";
        const oauthPrincipal: McpPrincipal = {
          kind: "oauth",
          principalId: userId,
          oauthClientId: clerkClientId,
          scopes: authInfo.scopes ?? [],
        };
        return {
          token: authInfo.token,
          scopes: authInfo.scopes ?? [],
          clientId: clerkClientId,
          extra: {
            ...authInfo.extra,
            principal: oauthPrincipal,
          },
        };
      }
    } catch (err) {
      console.error(
        "[mcp/route] Clerk token verification failed:",
        err instanceof Error ? err.message : err
      );
    }

    return undefined;
  },
  {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  }
);

export { authHandler as GET, authHandler as POST };
