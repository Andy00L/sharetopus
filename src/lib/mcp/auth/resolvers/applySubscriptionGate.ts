import "server-only";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import type {
  GatablePrincipal,
  PrincipalResolution,
} from "@/lib/types/principal";

import {
  getCachedSubscription,
  setCachedSubscription,
} from "./subscriptionCache";

/**
 * Enriches a resolved principal with plan and priceId from the active
 * Stripe subscription. "rejected" when no active subscription exists,
 * "unavailable" when it could not be read; both fail closed. Only a
 * completed read is cached: a transient DB blip must not lock a paying user
 * out for the whole TTL.
 *
 * Generic over any principal type that satisfies GatablePrincipal, so
 * both McpPrincipal and RestPrincipal pass through without casting.
 * The resolved principal keeps the caller's concrete type (discriminant,
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
): Promise<PrincipalResolution<T>> {
  const cached = getCachedSubscription(candidate.principalId);
  if (cached) {
    if (!cached.isActive) return { status: "rejected" };
    candidate.priceId = cached.priceId;
    candidate.plan = cached.plan;
    return { status: "resolved", principal: candidate };
  }

  const sub = await checkActiveSubscription(candidate.principalId);

  if (sub.status === "unavailable") {
    // Not cached, so the next request reads again.
    console.error(
      `[applySubscriptionGate] Subscription check failed for ${candidate.principalId}`,
    );
    return { status: "unavailable" };
  }

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
    return { status: "rejected" };
  }

  setCachedSubscription(candidate.principalId, {
    isActive: true,
    plan: sub.tier,
    priceId: sub.priceId,
  });

  candidate.priceId = sub.priceId;
  candidate.plan = sub.tier;
  return { status: "resolved", principal: candidate };
}
