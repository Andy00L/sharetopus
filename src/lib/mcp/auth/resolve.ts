import "server-only";
import { isMcpApiKeyToken } from "@/lib/mcp/tokens";
import { resolveApiKey } from "./resolvers/apiKey";
import { resolveOAuth, type ResolveHints } from "./resolvers/oauth";
import { applySubscriptionGate } from "./resolvers/applySubscriptionGate";
import type { McpPrincipal } from "./types";

export type { ResolveHints } from "./resolvers/oauth";

/**
 * Routes a bearer token to the correct auth strategy and applies the
 * shared subscription gate. Returns null on any failure (fails closed).
 *
 * Token dispatch:
 *   - "stp_mcp_..." -> API key resolver
 *   - anything else -> Clerk OAuth resolver
 *
 * Phase 2 adds "stp_rest_" branch. Phase 4 adds "stp_wallet_" branch.
 *
 * The optional `hints` parameter carries clientInfo from the MCP
 * initialize handshake. Only used by the OAuth path for first-sight
 * INSERT into mcp_oauth_clients.
 *
 * Source: replaces resolveMcpPrincipal from src/lib/mcp/auth.ts:67-135.
 */
export async function resolveMcpPrincipal(
  bearerToken: string | null,
  hints: ResolveHints = {}
): Promise<McpPrincipal | null> {
  if (!bearerToken) return null;

  let candidate: McpPrincipal | null;

  if (isMcpApiKeyToken(bearerToken)) {
    candidate = await resolveApiKey(bearerToken);
  } else {
    candidate = await resolveOAuth(bearerToken, hints);
  }

  if (!candidate) return null;

  return applySubscriptionGate(candidate);
}
