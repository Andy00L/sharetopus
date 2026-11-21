import "server-only";

import type { PlanTier } from "@/lib/types/plans";

const CACHE_TTL_MS = 60_000;

export const MAX_CACHED_SUBSCRIPTIONS = 5_000;

type SubscriptionCacheEntry = {
  isActive: boolean;
  plan: PlanTier | null;
  priceId: string | null;
  expiresAt: number;
};

const subscriptionCache = new Map<string, SubscriptionCacheEntry>();

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

export function setCachedSubscription(
  principalId: string,
  data: Omit<SubscriptionCacheEntry, "expiresAt">,
): void {
  subscriptionCache.delete(principalId);
  evictToFitOneMoreEntry();
  subscriptionCache.set(principalId, {
    ...data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function invalidateCachedSubscription(principalId: string): void {
  subscriptionCache.delete(principalId);
}

function evictToFitOneMoreEntry(): void {
  const nowMs = Date.now();
  for (const [principalId, entry] of subscriptionCache) {
    const isFull = subscriptionCache.size >= MAX_CACHED_SUBSCRIPTIONS;
    const isExpired = nowMs > entry.expiresAt;
    if (!isFull && !isExpired) return;
    subscriptionCache.delete(principalId);
  }
}
