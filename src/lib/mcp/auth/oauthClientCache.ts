import "server-only";

import type { TrustLevel } from "@/db/schema";

// Per-instance cache of OAuth client trust rows (blocked ones too), so each
// MCP request skips the SELECT. Other instances see a change after the TTL.
const CACHE_TTL_MS = 5 * 60 * 1000;

type OAuthClientCacheEntry = {
  trustLevel: TrustLevel;
  revokedAt: string | null;
  registeredByUserId: string | null;
  expiresAt: number;
};

const oauthClientCache = new Map<string, OAuthClientCacheEntry>();

/** Cached trust state for a client, or null when missing or expired. */
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

/** Stores a trust lookup result for CACHE_TTL_MS. */
export function setCachedOAuthClient(
  clientId: string,
  data: Omit<OAuthClientCacheEntry, "expiresAt">,
): void {
  oauthClientCache.set(clientId, {
    ...data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/** Drops every cached client a user registered (called after a subscription change). */
export function invalidateCachedOAuthClientsByUser(userId: string): void {
  for (const [clientId, entry] of oauthClientCache.entries()) {
    if (entry.registeredByUserId === userId) {
      oauthClientCache.delete(clientId);
    }
  }
}
