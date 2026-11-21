import "server-only";

import type { TrustLevel } from "@/db/schema";

const CACHE_TTL_MS = 5 * 60 * 1000;

type OAuthClientCacheEntry = {
  trustLevel: TrustLevel;
  revokedAt: string | null;
  registeredByUserId: string | null;
  expiresAt: number;
};

const oauthClientCache = new Map<string, OAuthClientCacheEntry>();

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

export function setCachedOAuthClient(
  clientId: string,
  data: Omit<OAuthClientCacheEntry, "expiresAt">,
): void {
  oauthClientCache.set(clientId, {
    ...data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

export function invalidateCachedOAuthClientsByUser(userId: string): void {
  for (const [clientId, entry] of oauthClientCache.entries()) {
    if (entry.registeredByUserId === userId) {
      oauthClientCache.delete(clientId);
    }
  }
}
