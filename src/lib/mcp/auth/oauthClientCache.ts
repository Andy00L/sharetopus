import "server-only";

import type { TrustLevel } from "@/lib/types/database.types";

/**
 * Per-instance in-memory cache for OAuth client trust lookups. Replaces
 * the per-request SELECT on mcp_oauth_clients with a hashmap hit for
 * 5-minute windows per client_id.
 *
 * Cache contract:
 *   - Stores ONLY rows that already exist in the DB. The first-sight
 *     INSERT path bypasses the cache because it has its own side
 *     effects (rate limit, INSERT) that must run server-side.
 *   - Stores both allow-able states (unverified/verified) AND deny-able
 *     states (blocked, revoked_at set) so repeated probes from a
 *     blocked client do not hammer the DB.
 *   - Tracks registeredByUserId so subscription-cancel and resubscribe
 *     webhooks can invalidate every client belonging to one user
 *     without flushing the whole cache.
 *
 * Cross-instance staleness:
 *   Same model as the subscription cache. A trust_level change on
 *   instance A is invisible to instance B until B's TTL expires. The
 *   5-minute window is intentional: most admin-initiated revocations
 *   are not time-critical, and we accept up to 5 min of stale access
 *   in exchange for cutting the per-call SELECT.
 *
 * No size cap: 100 bytes per entry, scales fine for the foreseeable
 * future. Revisit if OAuth client count grows past ~10k.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

type OAuthClientCacheEntry = {
  trustLevel: TrustLevel;
  revokedAt: string | null;
  registeredByUserId: string | null;
  expiresAt: number;
};

const oauthClientCache = new Map<string, OAuthClientCacheEntry>();

/**
 * Returns the cached trust state for an OAuth client, or null when no
 * entry exists or it has expired (in which case the stale row is purged).
 */
export function getCachedOAuthClient(
  clientId: string,
): OAuthClientCacheEntry | null {
  const entry = oauthClientCache.get(clientId);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    oauthClientCache.delete(clientId);
    return null;
  }

  return entry;
}

/**
 * Stores a trust lookup result. TTL is applied internally.
 */
export function setCachedOAuthClient(
  clientId: string,
  data: Omit<OAuthClientCacheEntry, "expiresAt">,
): void {
  oauthClientCache.set(clientId, {
    ...data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Drops a single client's cache entry. Use when revoking or unblocking
 * a specific client from admin tooling.
 */
export function invalidateCachedOAuthClient(clientId: string): void {
  oauthClientCache.delete(clientId);
}

/**
 * Drops every cached client registered by a specific user. Called by
 * the Stripe webhook on subscription.deleted (after the demote bulk
 * update) and subscription.created (after the promote bulk update) so
 * the trust check picks up the new trust_level on next request to this
 * instance instead of waiting for TTL.
 */
export function invalidateCachedOAuthClientsByUser(userId: string): void {
  for (const [clientId, entry] of oauthClientCache.entries()) {
    if (entry.registeredByUserId === userId) {
      oauthClientCache.delete(clientId);
    }
  }
}
