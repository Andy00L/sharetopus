import "server-only";

import { isApiKeyToken } from "@/lib/api/tokens";

import { resolveApiKey } from "./resolvers/apiKey";
import { applySubscriptionGate } from "./resolvers/applySubscriptionGate";
import {
  assertOAuthClientTrust,
  verifyOAuthToken,
  type ResolveHints,
} from "./resolvers/oauth";
import type { McpPrincipal } from "./types";

export type { ResolveHints } from "./resolvers/oauth";

/**
 * Routes a bearer token to the correct auth strategy and applies the
 * shared subscription gate. Returns null on any failure (fails closed).
 *
 * Token dispatch:
 *   - "stp_mcp_..." -> API key resolver (single function, fully gated
 *     internally)
 *   - anything else -> Clerk OAuth path, split into three ordered steps:
 *       1. verifyOAuthToken (no DB writes)
 *       2. applySubscriptionGate (rejects free users early)
 *       3. assertOAuthClientTrust (only runs for paying users, so the
 *          mcp_oauth_clients table never accumulates rows for traffic
 *          that gets 401'd at the subscription gate)
 *
 * The optional `hints` parameter carries clientInfo from the MCP
 * initialize handshake. Only used by the OAuth trust check on the
 * first-sight INSERT into mcp_oauth_clients.
 *
 * Phase 2 adds "stp_rest_" branch. Phase 4 adds "stp_wallet_" branch.
 *
 * Source: replaces resolveMcpPrincipal from src/lib/mcp/auth.ts:67-135.
 */
export async function resolveMcpPrincipal(
  bearerToken: string | null,
  hints: ResolveHints = {},
): Promise<McpPrincipal | null> {
  if (!bearerToken) return null;

  // API key path: single resolver runs verify + (its own light)
  // tracking, then we apply the shared subscription gate.
  if (isApiKeyToken(bearerToken, "mcp")) {
    const apiKeyCandidate = await resolveApiKey(bearerToken);
    if (!apiKeyCandidate) return null;
    return applySubscriptionGate(apiKeyCandidate);
  }

  // OAuth path: split into three steps so the subscription gate fires
  // before the trust-check side effect.
  const verifiedToken = await verifyOAuthToken(bearerToken);
  if (!verifiedToken) return null;

  // Build a candidate McpPrincipal for the subscription gate. Plan
  // starts at null and gets overwritten inside applySubscriptionGate
  // once the active row is found.
  const oauthCandidate: McpPrincipal = {
    kind: "oauth",
    principalId: verifiedToken.principalId,
    oauthClientId: verifiedToken.oauthClientId,
    scopes: verifiedToken.scopes,
    plan: null,
    priceId: null,
  };

  const gatedCandidate = await applySubscriptionGate(oauthCandidate);
  if (!gatedCandidate) return null;

  // Subscription is active. Now safe to record/verify the OAuth client.
  // The trust check is the only step that can INSERT into
  // mcp_oauth_clients; running it last means non-paying users never
  // leave a row behind.
  const trustOk = await assertOAuthClientTrust(
    verifiedToken.oauthClientId,
    verifiedToken.principalId,
    hints,
  );
  if (!trustOk) return null;

  return gatedCandidate;
}
