import "server-only";

import type { PlanTier } from "@/lib/types/plans";

/**
 * Per-instance in-memory cache for Stripe subscription lookups. Cuts the
 * per-request SELECT against stripe_subscriptions down to one query per
 * principal per TTL window.
 *
 * Why in-memory and not Redis:
 *   - The cache lives in the serverless function instance memory. Each
 *     Vercel cold-start gets a fresh empty Map, which is fine: the first
 *     request on a fresh instance pays one DB hit, every subsequent
 *     request in the same TTL window is a hashmap lookup.
 *   - Cross-instance staleness is bounded by TTL (60s). A user who
 *     cancels their subscription sees access loss within 60s on any
 *     instance that has not yet observed the webhook invalidation.
 *   - The Stripe webhook calls invalidateCachedSubscription() on
 *     created/updated/deleted, so instances that handle the webhook
 *     see the change instantly. Other instances catch up at TTL.
 *
 * We cache BOTH active and inactive results. A non-subscriber probing
 * the endpoint would otherwise hammer the DB; caching the negative
 * result means those probes are bounded to one DB hit per principal
 * per TTL too.
 *
 * Tradeoff: a brand-new subscriber whose initial 401 was cached has to
 * wait up to TTL for the webhook to fire and invalidate. In practice
 * Stripe webhooks land within 1-5s, well inside the TTL window.
 *
 * No size cap. With ~100 bytes per entry, 10k principals cached fits
 * in 1MB. Revisit if user count grows past that scale.
 */

const CACHE_TTL_MS = 60_000;

type SubscriptionCacheEntry = {
  isActive: boolean;
  plan: PlanTier | null;
  priceId: string | null;
  expiresAt: number;
};

const subscriptionCache = new Map<string, SubscriptionCacheEntry>();

/**
 * Returns the cached entry for a principal, or null when no entry
 * exists or it has expired (in which case the stale row is purged).
 */
export function getCachedSubscription(
  principalId: string,
): SubscriptionCacheEntry | null {
  const entry = subscriptionCache.get(principalId);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    subscriptionCache.delete(principalId);
    return null;
  }

  return entry;
}

/**
 * Stores a subscription lookup result. TTL is applied internally; the
 * caller passes the raw data only.
 */
export function setCachedSubscription(
  principalId: string,
  data: Omit<SubscriptionCacheEntry, "expiresAt">,
): void {
  subscriptionCache.set(principalId, {
    ...data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Drops a single principal's cache entry. Called by the Stripe webhook
 * on subscription.created/updated/deleted so changes are visible to
 * the next request on the same instance instead of waiting for TTL.
 */
export function invalidateCachedSubscription(principalId: string): void {
  subscriptionCache.delete(principalId);
}
