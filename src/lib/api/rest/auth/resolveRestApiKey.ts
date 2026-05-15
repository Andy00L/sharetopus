import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { hashToken, isApiKeyToken } from "@/lib/api/tokens";
import { applySubscriptionGate } from "@/lib/mcp/auth/resolvers/applySubscriptionGate";
import { extractIpHash } from "@/lib/api/context";
import { waitUntil } from "@vercel/functions";
import type { RestPrincipal } from "./types";

/**
 * Resolves a Bearer token into a RestPrincipal, or null if any check fails.
 *
 * Pipeline:
 *   1. Format check (must start with "stp_rest_")
 *   2. DB lookup by token_hash (kind='rest', not revoked)
 *   3. Expiry check (expires_at > now, or null)
 *   4. Subscription gate (active subscription required)
 *   5. Background last_used_at + last_used_ip update (fire-and-forget)
 *
 * Returns null on ANY failure. Never throws. The caller (HOF) maps null
 * to a 401 response.
 *
 * Side effects:
 *   - Updates api_keys.last_used_at and last_used_ip via waitUntil
 *     (does NOT block the request)
 *
 * Reused helpers:
 *   - hashToken: shared with MCP resolver
 *   - applySubscriptionGate: shared with MCP resolver, handles subscription
 *     cache (60s TTL + Stripe webhook invalidation)
 *   - extractIpHash: pulls hashed IP from next/headers
 */
export async function resolveRestApiKey(
  bearerToken: string,
): Promise<RestPrincipal | null> {
  try {
    // Step 1: Format check. Cheap, no DB. Reject foreign tokens early.
    if (!isApiKeyToken(bearerToken, "rest")) {
      return null;
    }

    const restApiKeyHashed = hashToken(bearerToken);

    // Step 2: DB lookup. Filters on kind='rest' and not revoked.
    const { data: apiKeyRow, error: lookupError } = await adminSupabase
      .from("api_keys")
      .select("id, principal_id, scopes, expires_at, prefix")
      .eq("token_hash", restApiKeyHashed)
      .eq("kind", "rest")
      .is("revoked_at", null)
      .maybeSingle();

    if (lookupError) {
      console.error(
        "[resolveRestApiKey] DB lookup failed:",
        lookupError.message,
      );
      return null;
    }

    if (!apiKeyRow) {
      return null;
    }

    // Step 3: Expiry check.
    if (
      apiKeyRow.expires_at !== null &&
      new Date(apiKeyRow.expires_at).getTime() < Date.now()
    ) {
      console.warn(
        `[resolveRestApiKey] Key ${apiKeyRow.id} (prefix=${apiKeyRow.prefix}) is expired`,
      );
      return null;
    }

    // Step 4: Subscription gate. Returns null if no active subscription.
    // The generic preserves RestPrincipal on the return type.
    const principalCandidate: RestPrincipal = {
      kind: "rest",
      principalId: apiKeyRow.principal_id,
      apiKeyId: apiKeyRow.id,
      scopes: apiKeyRow.scopes ?? ["api:full"],
      plan: null,
      priceId: null,
    };

    const gatedPrincipal = await applySubscriptionGate(principalCandidate);
    if (!gatedPrincipal) {
      return null;
    }

    // Step 5: Fire-and-forget last_used_at + last_used_ip update.
    // waitUntil keeps the Vercel function alive long enough for the UPDATE
    // to complete after we return the response.
    waitUntil(updateLastUsedFields(apiKeyRow.id));

    return gatedPrincipal;
  } catch (unexpectedError) {
    console.error(
      "[resolveRestApiKey] Unexpected error:",
      unexpectedError instanceof Error
        ? unexpectedError.message
        : unexpectedError,
    );
    return null;
  }
}

/**
 * Updates api_keys.last_used_at to now and last_used_ip to the hashed
 * client IP from the current request context.
 *
 * Soft-failure: errors are logged but never bubble up. last_used tracking
 * is observability data, not an auth gate.
 *
 * Runs inside waitUntil so it does NOT block the request response.
 */
async function updateLastUsedFields(apiKeyId: string): Promise<void> {
  try {
    const clientIpHash = await extractIpHash();

    const updatePayload: { last_used_at: string; last_used_ip?: string } = {
      last_used_at: new Date().toISOString(),
    };
    if (clientIpHash) {
      updatePayload.last_used_ip = clientIpHash;
    }

    const { error: updateError } = await adminSupabase
      .from("api_keys")
      .update(updatePayload)
      .eq("id", apiKeyId);

    if (updateError) {
      console.warn(
        "[resolveRestApiKey.updateLastUsedFields] failed:",
        updateError.message,
      );
    }
  } catch (unexpectedError) {
    console.warn(
      "[resolveRestApiKey.updateLastUsedFields] Unexpected error:",
      unexpectedError instanceof Error
        ? unexpectedError.message
        : unexpectedError,
    );
  }
}
