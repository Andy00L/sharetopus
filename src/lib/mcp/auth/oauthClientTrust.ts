import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";

export type OAuthTrustResult =
  | { allowed: true }
  | {
      allowed: false;
      reason: "blocked" | "revoked" | "rate_limited" | "lookup_failed";
    };

const MAX_VERIFIED_CLIENTS_PER_USER = 5;

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
 *   1. SELECT mcp_oauth_clients WHERE client_id = X
 *   2a. If row exists and revoked_at IS NOT NULL -> refuse "revoked"
 *   2b. If row exists and trust_level = 'blocked' -> refuse "blocked"
 *   2c. If row exists otherwise -> allow
 *   3.  If row does NOT exist -> firstSightInsert()
 *
 * Fails OPEN on lookup errors. Blocking legitimate users because the
 * DB hiccupped is worse than allowing an unknown client briefly.
 * Clerk token verification has already succeeded.
 *
 * @param clientId   OAuth client ID from the Clerk-issued token
 * @param principalId User ID who is authenticating (consent giver)
 * @param hints      Optional metadata from MCP initialize handshake
 */
export async function checkOAuthClientTrust(
  clientId: string,
  principalId: string,
  hints: OAuthClientHints = {}
): Promise<OAuthTrustResult> {
  if (!clientId) {
    console.warn("[checkOAuthClientTrust] Empty client_id, allowing");
    return { allowed: true };
  }

  try {
    const { data: existing, error: lookupErr } = await adminSupabase
      .from("mcp_oauth_clients")
      .select("client_id, trust_level, revoked_at")
      .eq("client_id", clientId)
      .maybeSingle();

    if (lookupErr) {
      console.error(
        `[checkOAuthClientTrust] Lookup failed for ${clientId}:`,
        lookupErr.message
      );
      return { allowed: true }; // fail open
    }

    if (existing) {
      if (existing.revoked_at) {
        console.log(
          `[checkOAuthClientTrust] Refused revoked client ${clientId}`
        );
        return { allowed: false, reason: "revoked" };
      }
      if (existing.trust_level === "blocked") {
        console.log(
          `[checkOAuthClientTrust] Refused blocked client ${clientId}`
        );
        return { allowed: false, reason: "blocked" };
      }
      return { allowed: true };
    }

    return await firstSightInsert(clientId, principalId, hints);
  } catch (err) {
    console.error(
      "[checkOAuthClientTrust] Unexpected error:",
      err instanceof Error ? err.message : err
    );
    return { allowed: true }; // fail open
  }
}

/**
 * Handles first-sight INSERT: rate limit, count verified clients for
 * the registering user, decide trust_level, INSERT.
 */
async function firstSightInsert(
  clientId: string,
  principalId: string,
  hints: OAuthClientHints
): Promise<OAuthTrustResult> {
  const minLimit = await checkRateLimit("dcr_register", null, 1, 60);
  if (!minLimit.success) {
    await logRateLimitEvent("dcr_register");
    console.warn(
      `[firstSightInsert] DCR minute rate limit hit for ${clientId}`
    );
    return { allowed: false, reason: "rate_limited" };
  }

  const dayLimit = await checkRateLimit(
    "dcr_register_daily",
    null,
    10,
    86400
  );
  if (!dayLimit.success) {
    await logRateLimitEvent("dcr_register_daily");
    console.warn(
      `[firstSightInsert] DCR daily rate limit hit for ${clientId}`
    );
    return { allowed: false, reason: "rate_limited" };
  }

  const { count, error: countErr } = await adminSupabase
    .from("mcp_oauth_clients")
    .select("client_id", { count: "exact", head: true })
    .eq("registered_by_user_id", principalId)
    .eq("trust_level", "verified");

  if (countErr) {
    console.error(
      `[firstSightInsert] Verified-count query failed for ${principalId}:`,
      countErr.message
    );
    // Fall through; defaults to unverified
  }

  const verifiedCount = count ?? 0;
  const trustLevel: "verified" | "unverified" =
    verifiedCount < MAX_VERIFIED_CLIENTS_PER_USER ? "verified" : "unverified";

  // Upsert handles race condition: two simultaneous requests for the
  // same new client_id resolve to one row.
  const { error: insertErr } = await adminSupabase
    .from("mcp_oauth_clients")
    .upsert(
      {
        client_id: clientId,
        client_name: hints.clientName ?? "Unknown OAuth Client",
        redirect_uris: [],
        software_id: hints.softwareId ?? null,
        software_version: hints.softwareVersion ?? null,
        registered_by_user_id: principalId,
        trust_level: trustLevel,
        metadata: {},
      },
      { onConflict: "client_id", ignoreDuplicates: true }
    );

  if (insertErr) {
    console.error(
      `[firstSightInsert] INSERT failed for ${clientId}:`,
      insertErr.message
    );
    return { allowed: true }; // fail open after INSERT failure
  }

  console.log(
    `[firstSightInsert] Inserted ${clientId} as ${trustLevel} ` +
      `(registered_by ${principalId}, verified_count_before ${verifiedCount})`
  );
  return { allowed: true };
}

/**
 * Logs a rate-limit event for forensic analysis. The `rate_limit_events`
 * table accepts NULL principal_id for anonymous DCR attempts.
 */
async function logRateLimitEvent(scope: string): Promise<void> {
  try {
    const { extractIpHash } = await import("@/lib/mcp/context");
    const ipHash = await extractIpHash();

    await adminSupabase.from("rate_limit_events").insert({
      scope,
      ip_hash: ipHash,
      principal_id: null,
    });
  } catch (err) {
    console.error(
      "[logRateLimitEvent] Failed to record rate-limit event:",
      err instanceof Error ? err.message : err
    );
  }
}
