import type { PlanTier } from "@/lib/types/plans";
import type { GatablePrincipal } from "@/lib/types/principal";

/**
 * Authenticated principal for a REST API request. Resolved from the
 * Bearer token via resolveRestApiKey.
 *
 * `kind: "rest"` is the discriminant. Reserved for future principal kinds
 * (e.g. `"wallet"` for x402) that may share endpoints.
 */
export type RestPrincipal = GatablePrincipal & {
  kind: "rest";
  apiKeyId: string;
  scopes: string[];
  plan: PlanTier | null;
  priceId: string | null;
};

/**
 * Full request context built by the withRestEndpoint HOF in Phase 2.
 * Defined here in Phase 1 so the resolver and HOF agree on shape from
 * the start.
 */
export type RestApiKeyContext = {
  principal: RestPrincipal;
  requestId: string;
  ipHash: string | null;
  userAgent: string | null;
  endpoint: string;
  httpMethod: string;
  startedAt: number;
};
