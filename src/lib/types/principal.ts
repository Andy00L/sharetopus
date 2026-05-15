import type { PlanTier } from "@/lib/types/plans";

/**
 * Shared interface for any principal that can pass through the subscription
 * gate. Both McpPrincipal and RestPrincipal satisfy this contract.
 *
 * The gate only needs principalId (to look up the subscription), and plan +
 * priceId (to hydrate after lookup). All other fields (kind, scopes, etc.)
 * are preserved by the generic return type on applySubscriptionGate.
 */
export interface GatablePrincipal {
  principalId: string;
  plan: PlanTier | null;
  priceId: string | null;
}
