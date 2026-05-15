import "server-only";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import type { GatablePrincipal } from "@/lib/types/principal";

import {
  getCachedSubscription,
  setCachedSubscription,
} from "./subscriptionCache";

/**
 * Enriches a resolved principal with plan and priceId from the active
 * Stripe subscription. Returns null when no active subscription exists
 * or the DB query throws (fails closed in both cases).
 *
 * Generic over any principal type that satisfies GatablePrincipal, so
 * both McpPrincipal and RestPrincipal pass through without casting.
 * The return type preserves the caller's concrete type (discriminant,
 * apiKeyId, oauthClientId, etc. all retained).
 *
 * Hot path: this runs on every MCP tool call. The subscriptionCache
 * layer short-circuits the stripe_subscriptions SELECT for 60s windows
 * per principal. See subscriptionCache.ts for the cache semantics.
 *
 * Source: extracted from src/lib/mcp/auth.ts:110-133.
 */
export async function applySubscriptionGate<T extends GatablePrincipal>(
  candidate: T,
): Promise<T | null> {
  const cached = getCachedSubscription(candidate.principalId);
  if (cached) {
    if (!cached.isActive) return null;
    candidate.priceId = cached.priceId;
    candidate.plan = cached.plan;
    return candidate;
  }

  try {
    const sub = await checkActiveSubscription(candidate.principalId);

    if (!sub.isActive) {
      // Cache the negative result too so probes from non-subscribers
      // do not hammer the DB. Invalidated by the Stripe webhook on
      // subscription.created.
      setCachedSubscription(candidate.principalId, {
        isActive: false,
        plan: null,
        priceId: null,
      });
      console.log(
        `[applySubscriptionGate] Principal ${candidate.principalId} has no active subscription`,
      );
      return null;
    }

    setCachedSubscription(candidate.principalId, {
      isActive: true,
      plan: sub.tier,
      priceId: sub.priceId,
    });

    candidate.priceId = sub.priceId;
    candidate.plan = sub.tier;
    return candidate;
  } catch (err) {
    // Errors are NOT cached. A transient DB blip should retry next
    // request, not lock the user out of access for 60 seconds.
    console.error(
      "[applySubscriptionGate] Subscription check failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
