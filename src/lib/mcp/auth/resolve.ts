import "server-only";

import { isApiKeyToken } from "@/lib/api/tokens";
import type { PrincipalResolution } from "@/lib/types/principal";

import { resolveApiKey } from "./resolvers/apiKey";
import { applySubscriptionGate } from "./resolvers/applySubscriptionGate";
import {
  assertOAuthClientTrust,
  verifyOAuthToken,
  type ResolveHints,
} from "./resolvers/oauth";
import type { McpPrincipal } from "./types";

export type { ResolveHints } from "./resolvers/oauth";

export async function resolveMcpPrincipal(
  bearerToken: string,
  hints: ResolveHints = {},
): Promise<PrincipalResolution<McpPrincipal>> {
  if (isApiKeyToken(bearerToken, "mcp")) {
    const apiKeyResolution = await resolveApiKey(bearerToken);
    if (apiKeyResolution.status !== "resolved") return apiKeyResolution;
    return applySubscriptionGate(apiKeyResolution.principal);
  }

  const verifiedToken = await verifyOAuthToken(bearerToken);
  if (!verifiedToken) return { status: "rejected" };

  const oauthCandidate: McpPrincipal = {
    kind: "oauth",
    principalId: verifiedToken.principalId,
    oauthClientId: verifiedToken.oauthClientId,
    scopes: verifiedToken.scopes,
    plan: null,
    priceId: null,
  };

  const gateResolution = await applySubscriptionGate(oauthCandidate);
  if (gateResolution.status !== "resolved") return gateResolution;

  const trust = await assertOAuthClientTrust(
    verifiedToken.oauthClientId,
    verifiedToken.principalId,
    hints,
  );
  if (trust === "unavailable") return { status: "unavailable" };
  if (trust === "refused") return { status: "rejected" };

  return gateResolution;
}
