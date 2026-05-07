import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { auth } from "@clerk/nextjs/server";
import { verifyClerkToken } from "@clerk/mcp-tools/next";
import { hashToken, isMcpApiKeyToken } from "./tokens";

/**
 * The resolved identity behind an MCP request.
 *
 * Every tool handler receives this after the route-level auth check passes.
 * The `kind` discriminant tells you whether the caller authenticated with
 * a Sharetopus API key or a Clerk OAuth token.
 */
export type McpPrincipal =
  | {
      kind: "apikey";
      principalId: string;
      apiKeyId: string;
      scopes: string[];
      oauthClientId?: undefined;
    }
  | {
      kind: "oauth";
      principalId: string;
      oauthClientId: string;
      scopes: string[];
      apiKeyId?: undefined;
    };

/**
 * Resolves the Bearer token on an MCP request to a Sharetopus principal.
 *
 * Both auth paths (API key and Clerk OAuth) are resolved here so the
 * subscription gate runs exactly once, after whichever path succeeds.
 * Free users do not get MCP access at all. Per-tool plan tier checks
 * via entitlementFor are the second line, but this gate is the first.
 *
 * Flow:
 *   1. If the token starts with stp_mcp_, resolve via api_keys table.
 *   2. Otherwise, try Clerk OAuth token verification.
 *   3. If neither produced a principal, return null.
 *   4. Call checkActiveSubscription. Return null if inactive or on error.
 *   5. Return the principal.
 *
 * The subscription check runs on every request because subscription state
 * can change mid-session (cancellation, payment failure). Caching would
 * be wrong. If the check errors (network blip, DB down), we treat the
 * user as unsubscribed. Failing open would let unpaid users through.
 *
 * Failure modes worth noting:
 *   1. Revoked api_keys still appear in the prefix index for a few seconds
 *      after revocation. We re-check `revoked_at IS NULL` on every call.
 *   2. Clerk JWTs can be forwarded by the OAuth client even after the user
 *      cancelled the consent. We don't get a webhook for that, so the audit
 *      log is the only source of truth on suspicious activity.
 *
 * Tables read: api_keys, principals, stripe_subscriptions
 * Called by: src/app/api/mcp/[transport]/route.ts
 */
export async function resolveMcpPrincipal(
  bearerToken: string | null
): Promise<McpPrincipal | null> {
  if (!bearerToken) return null;

  let candidate: McpPrincipal | null = null;

  // Path 1: API key (cheap hash lookup)
  if (isMcpApiKeyToken(bearerToken)) {
    candidate = await resolveApiKey(bearerToken);
  } else {
    // Path 2: Clerk OAuth token
    try {
      const clerkAuth = await auth({ acceptsToken: "oauth_token" });
      const authInfo = verifyClerkToken(clerkAuth, bearerToken);
      if (authInfo) {
        // principalId is the Clerk user id, not the OAuth client id.
        // The client id identifies the calling application. The user id
        // is the human who authorized it. The subscription check needs
        // the user id.
        const userId = (authInfo.extra?.userId as string) ?? "";
        const clerkClientId = authInfo.clientId ?? "";
        if (userId) {
          candidate = {
            kind: "oauth",
            principalId: userId,
            oauthClientId: clerkClientId,
            scopes: authInfo.scopes ?? [],
          };
        }
      }
    } catch (err) {
      console.error(
        "[resolveMcpPrincipal] Clerk token verification failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  if (!candidate) return null;

  // Subscription gate. Runs for BOTH auth paths.
  // MCP is a paid feature. Free users are blocked here.
  try {
    const sub = await checkActiveSubscription(candidate.principalId);
    if (!sub.isActive) {
      console.log(
        `[resolveMcpPrincipal] Blocked ${candidate.kind} auth for ${candidate.principalId}: no active subscription`
      );
      return null;
    }
  } catch (err) {
    // Treat any error as "not subscribed". Failing open would let
    // unpaid users through on a network blip.
    console.error(
      `[resolveMcpPrincipal] Subscription check failed for ${candidate.principalId}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }

  return candidate;
}

/**
 * Looks up an MCP API key by hashing the raw token and matching against
 * api_keys.token_hash. Only returns a principal if the key is:
 *   - kind = 'mcp'
 *   - not revoked (revoked_at IS NULL)
 *   - not expired (expires_at is null or in the future)
 *   - linked to a clerk principal (the trigger enforces this, but we double-check)
 *
 * Also updates last_used_at as a side effect.
 */
async function resolveApiKey(rawToken: string): Promise<McpPrincipal | null> {
  const hash = hashToken(rawToken);

  const { data: key, error } = await adminSupabase
    .from("api_keys")
    .select("id, principal_id, kind, scopes, revoked_at, expires_at")
    .eq("token_hash", hash)
    .eq("kind", "mcp")
    .is("revoked_at", null)
    .single();

  if (error || !key) return null;

  // Check expiration
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return null;
  }

  // Verify the principal is a Clerk user (the trigger enforces this,
  // but belt-and-suspenders)
  const { data: principal } = await adminSupabase
    .from("principals")
    .select("id, kind")
    .eq("id", key.principal_id)
    .eq("kind", "clerk")
    .single();

  if (!principal) return null;

  // Fire-and-forget: update last_used_at
  adminSupabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id)
    .then(() => {});

  return {
    kind: "apikey",
    principalId: key.principal_id,
    apiKeyId: key.id,
    scopes: key.scopes ?? [],
  };
}
