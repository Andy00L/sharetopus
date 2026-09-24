import "server-only";

import { and, eq } from "drizzle-orm";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { db, runQuery } from "@/db/client";
import { mcp_oauth_clients, rate_limit_events } from "@/db/schema";

import { getCachedOAuthClient, setCachedOAuthClient } from "./oauthClientCache";

export type OAuthTrustResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: "blocked" | "revoked" | "rate_limited" | "lookup_failed";
    };

const MAX_VERIFIED_CLIENTS_PER_USER = 5;

/**
 * New OAuth clients one user may bring, per minute and per day. A client
 * id is the URL of the client's metadata document (CIMD), so one user can
 * still point Sharetopus at many of them. Keyed on the user, not the IP:
 * hosted clients (Claude, ChatGPT) call this route from shared egress IPs,
 * so a per-IP limit refused every user of the same client after the first
 * few. The first-sight insert only runs after Clerk verified the token and
 * the subscription gate passed, so the user is always known here.
 */
const NEW_CLIENTS_PER_USER_PER_MINUTE = 3;
const NEW_CLIENTS_PER_USER_PER_DAY = 10;

export type OAuthClientHints = {
  clientName?: string | null;
  softwareId?: string | null;
  softwareVersion?: string | null;
};

/**
 * Checks the trust state of an OAuth client and lazily populates
 * `mcp_oauth_clients` on first sight.
 *
 * Flow:
 *   1. Cache hit -> return based on cached trust_level + revoked_at
 *   2. Cache miss -> SELECT mcp_oauth_clients WHERE client_id = X
 *   3a. If row exists and revoked_at IS NOT NULL -> refuse "revoked"
 *   3b. If row exists and trust_level = 'blocked' -> refuse "blocked"
 *   3c. If row exists otherwise -> allow + cache
 *   4.  If row does NOT exist -> firstSightInsert() (not cached)
 *
 * Fails CLOSED on lookup errors. Clerk token verification and the
 * subscription gate have already passed; this trust check is the
 * admin override layer (blocked / revoked enforcement). A DB hiccup
 * briefly denying a legit client is acceptable; bypassing an admin
 * block is not.
 *
 * @param clientId   OAuth client ID from the Clerk-issued token
 * @param principalId User ID who is authenticating (consent giver)
 * @param hints      Optional client name the route read from the request
 *                   (2025-era initialize, or the 2026 _meta envelope)
 */
export async function checkOAuthClientTrust(
  clientId: string,
  principalId: string,
  hints: OAuthClientHints = {},
): Promise<OAuthTrustResult> {
  if (!clientId) {
    console.warn("[checkOAuthClientTrust] Empty client_id, allowing");
    return { allowed: true };
  }

  const cached = getCachedOAuthClient(clientId);
  if (cached) {
    if (cached.revokedAt) {
      return { allowed: false, reason: "revoked" };
    }
    if (cached.trustLevel === "blocked") {
      return { allowed: false, reason: "blocked" };
    }
    return { allowed: true };
  }

  try {
    const { data: existingRows, error: lookupErr } = await runQuery(
      db
        .select({
          trust_level: mcp_oauth_clients.trust_level,
          revoked_at: mcp_oauth_clients.revoked_at,
          registered_by_user_id: mcp_oauth_clients.registered_by_user_id,
        })
        .from(mcp_oauth_clients)
        .where(eq(mcp_oauth_clients.client_id, clientId))
        .limit(1),
    );

    if (lookupErr) {
      console.error(
        `[checkOAuthClientTrust] Lookup failed for ${clientId}:`,
        lookupErr.message,
      );
      // Fail CLOSED. Clerk token + subscription gate already passed.
      // Trust check is the admin override layer; err on enforcement.
      // Do NOT cache so the next request retries the SELECT.
      return { allowed: false, reason: "lookup_failed" };
    }

    const existing = existingRows[0];
    if (existing) {
      // Cache both allow and deny outcomes. A repeatedly-probing
      // revoked or blocked client otherwise hammers the DB.
      setCachedOAuthClient(clientId, {
        trustLevel: existing.trust_level,
        revokedAt: existing.revoked_at,
        registeredByUserId: existing.registered_by_user_id,
      });

      if (existing.revoked_at) {
        console.log(
          `[checkOAuthClientTrust] Refused revoked client ${clientId}`,
        );
        return { allowed: false, reason: "revoked" };
      }
      if (existing.trust_level === "blocked") {
        console.log(
          `[checkOAuthClientTrust] Refused blocked client ${clientId}`,
        );
        return { allowed: false, reason: "blocked" };
      }
      return { allowed: true };
    }

    return await firstSightInsert(clientId, principalId, hints);
  } catch (err) {
    console.error(
      "[checkOAuthClientTrust] Unexpected error:",
      err instanceof Error ? err.message : err,
    );
    return { allowed: false, reason: "lookup_failed" };
  }
}

/**
 * Handles first-sight INSERT: per-user new-client limits, count verified
 * clients for the registering user, decide trust_level, INSERT.
 *
 * Populates the cache with the freshly-inserted row so the next
 * request on this instance is a cache hit.
 */
async function firstSightInsert(
  clientId: string,
  principalId: string,
  hints: OAuthClientHints,
): Promise<OAuthTrustResult> {
  const newClientLimits = [
    { scope: "oauth_client_first_sight", limit: NEW_CLIENTS_PER_USER_PER_MINUTE, windowSeconds: 60 },
    { scope: "oauth_client_first_sight_daily", limit: NEW_CLIENTS_PER_USER_PER_DAY, windowSeconds: 86400 },
  ];
  for (const { scope, limit, windowSeconds } of newClientLimits) {
    const limitResult = await checkRateLimit(scope, principalId, limit, windowSeconds);
    if (!limitResult.success && limitResult.reason === "limited") {
      await logRateLimitEvent(scope, principalId);
      console.warn(`[firstSightInsert] ${scope} limit hit for ${clientId}`);
      return { allowed: false, reason: "rate_limited" };
    }
    // A limiter outage fails open: Clerk and the subscription gate
    // already vetted this user, and a Redis incident should not stop
    // paying users from connecting a new client.
    if (!limitResult.success) {
      console.warn(
        `[firstSightInsert] Rate limiter ${limitResult.reason} for ${scope}; continuing.`,
      );
    }
  }

  const { data: count, error: countErr } = await runQuery(
    db.$count(
      mcp_oauth_clients,
      and(
        eq(mcp_oauth_clients.registered_by_user_id, principalId),
        eq(mcp_oauth_clients.trust_level, "verified"),
      ),
    ),
  );

  if (countErr) {
    console.error(
      `[firstSightInsert] Verified-count query failed for ${principalId}:`,
      countErr.message,
    );
    // Falls through to unverified: an unknown count grants no verified slot.
  }

  const trustLevel: "verified" | "unverified" =
    count !== null && count < MAX_VERIFIED_CLIENTS_PER_USER
      ? "verified"
      : "unverified";

  // ON CONFLICT DO NOTHING handles the race: two simultaneous requests
  // for the same new client_id resolve to one row.
  const { error: insertErr } = await runQuery(
    db
      .insert(mcp_oauth_clients)
      .values({
        client_id: clientId,
        client_name: hints.clientName ?? "Unknown OAuth Client",
        redirect_uris: [],
        software_id: hints.softwareId ?? null,
        software_version: hints.softwareVersion ?? null,
        registered_by_user_id: principalId,
        trust_level: trustLevel,
        metadata: {},
      })
      .onConflictDoNothing({ target: mcp_oauth_clients.client_id }),
  );

  if (insertErr) {
    console.error(
      `[firstSightInsert] INSERT failed for ${clientId}:`,
      insertErr.message,
    );
    return { allowed: false, reason: "lookup_failed" };
  }

  // Cache the freshly-inserted row so the next request from this
  // client on the same instance skips the SELECT round-trip.
  setCachedOAuthClient(clientId, {
    trustLevel,
    revokedAt: null,
    registeredByUserId: principalId,
  });

  console.log(
    `[firstSightInsert] Inserted ${clientId} as ${trustLevel} ` +
      `(registered_by ${principalId}, verified_count_before ${count ?? "unknown"})`,
  );
  return { allowed: true };
}

/**
 * Logs a rate-limit event for forensic analysis, with the user who hit
 * the limit and the hashed IP they came from.
 */
async function logRateLimitEvent(
  scope: string,
  principalId: string,
): Promise<void> {
  try {
    const { extractIpHash } = await import("@/lib/api/context");
    const ipHash = await extractIpHash();

    const { error: insertError } = await runQuery(
      db.insert(rate_limit_events).values({
        scope,
        ip_hash: ipHash,
        principal_id: principalId,
      }),
    );
    if (insertError) {
      console.error(
        "[logRateLimitEvent] Failed to record rate-limit event:",
        insertError.message,
      );
    }
  } catch (err) {
    console.error(
      "[logRateLimitEvent] Failed to record rate-limit event:",
      err instanceof Error ? err.message : err,
    );
  }
}
