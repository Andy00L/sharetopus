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

/**
 * Outcome of turning a bearer token into a principal. "rejected" is a real
 * auth failure (unknown, revoked or expired credentials, no subscription)
 * and answers 401. "unavailable" means a database read failed: the route
 * answers 503, so the client retries with the same credentials instead of
 * dropping a token that is still valid.
 */
export type PrincipalResolution<Principal> =
  | { status: "resolved"; principal: Principal }
  | { status: "rejected" }
  | { status: "unavailable" };
