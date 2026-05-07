import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
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
 * Checks API keys first (cheap DB lookup), falls back to Clerk OAuth tokens.
 * Used by the MCP route handler in src/app/api/mcp/[transport]/route.ts
 * before passing control to any tool handler.
 *
 * After resolving a valid API key principal, we check that the user has
 * an active Stripe subscription. MCP is a paid feature. Free users cannot
 * authenticate at all. The check runs on every request because subscription
 * state can change mid-session (user cancels, payment fails). Caching it
 * would be wrong.
 *
 * If the subscription check errors (network blip, DB down), we treat the
 * user as unsubscribed. Failing open here would let unpaid users through.
 *
 * Failure modes worth noting:
 *   1. Revoked api_keys still appear in the prefix index for a few seconds
 *      after revocation. We re-check `revoked_at IS NULL` on every call.
 *   2. Clerk JWTs can be forwarded by the OAuth client even after the user
 *      cancelled the consent. We don't get a webhook for that, so the audit
 *      log is the only source of truth on suspicious activity.
 *
 * Tables read: api_keys, principals, stripe_subscriptions
 */
export async function resolveMcpPrincipal(
  bearerToken: string | null
): Promise<McpPrincipal | null> {
  if (!bearerToken) return null;

  // Path 1: API key (cheap hash lookup)
  if (isMcpApiKeyToken(bearerToken)) {
    const principal = await resolveApiKey(bearerToken);
    if (!principal) return null;

    // MCP is a paid feature. Block access if no active subscription.
    try {
      const sub = await checkActiveSubscription(principal.principalId);
      if (!sub.isActive) {
        console.log(
          `[resolveMcpPrincipal] Blocked API key auth for ${principal.principalId}: no active subscription`
        );
        return null;
      }
    } catch (err) {
      // Treat subscription check failure as "not subscribed".
      // Failing open would let unpaid users through.
      console.error(
        `[resolveMcpPrincipal] Subscription check failed for ${principal.principalId}:`,
        err instanceof Error ? err.message : err
      );
      return null;
    }

    return principal;
  }

  // Path 2: Clerk OAuth token
  // Handled by @clerk/mcp-tools in the route handler via withMcpAuth.
  // If we reach here it means the token was not an API key, so return null
  // and let the Clerk auth layer handle it.
  return null;
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
