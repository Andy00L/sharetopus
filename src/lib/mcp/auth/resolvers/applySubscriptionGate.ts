import "server-only";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { priceIdToTier } from "@/lib/types/plans";
import type { McpPrincipal } from "../types";

/**
 * Enriches a resolved principal with plan and priceId from the active
 * Stripe subscription. Returns null if no active subscription (fails
 * closed). Returns null on error (fails closed).
 *
 * Source: extracted from src/lib/mcp/auth.ts:110-133.
 */
export async function applySubscriptionGate(
  candidate: McpPrincipal
): Promise<McpPrincipal | null> {
  try {
    const sub = await checkActiveSubscription(candidate.principalId);

    if (!sub.isActive) {
      console.log(
        `[applySubscriptionGate] Principal ${candidate.principalId} has no active subscription`
      );
      return null;
    }

    candidate.priceId = sub.plan ?? null;
    candidate.plan = priceIdToTier(sub.plan);
    return candidate;
  } catch (err) {
    console.error(
      "[applySubscriptionGate] Subscription check failed:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
