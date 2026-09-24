import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { api_keys } from "@/db/schema";
import { hashToken, isApiKeyToken } from "@/lib/api/tokens";
import { applySubscriptionGate } from "@/lib/mcp/auth/resolvers/applySubscriptionGate";
import { extractIpHash } from "@/lib/api/context";
import type { PrincipalResolution } from "@/lib/types/principal";
import { waitUntil } from "@vercel/functions";
import type { RestPrincipal } from "./types";

/**
 * Resolves a Bearer token into a RestPrincipal.
 *
 * Pipeline:
 *   1. Format check (must start with "stp_rest_")
 *   2. DB lookup by token_hash (kind='rest', not revoked)
 *   3. Expiry check (expires_at > now, or null)
 *   4. Subscription gate (active subscription required)
 *   5. Background last_used_at + last_used_ip update (fire-and-forget)
 *
 * "rejected" when a check fails, "unavailable" when a database read failed
 * on the way. Never throws. The caller (HOF) answers 401 and 503.
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
): Promise<PrincipalResolution<RestPrincipal>> {
  try {
    // Step 1: Format check. Cheap, no DB. Reject foreign tokens early.
    if (!isApiKeyToken(bearerToken, "rest")) {
      return { status: "rejected" };
    }

    const restApiKeyHashed = hashToken(bearerToken);

    // Step 2: DB lookup. Filters on kind='rest' and not revoked.
    // token_hash is unique, so one row is the most there can be.
    const { data: apiKeyRows, error: lookupError } = await runQuery(
      db
        .select({
          id: api_keys.id,
          principal_id: api_keys.principal_id,
          scopes: api_keys.scopes,
          expires_at: api_keys.expires_at,
          prefix: api_keys.prefix,
        })
        .from(api_keys)
        .where(
          and(
            eq(api_keys.token_hash, restApiKeyHashed),
            eq(api_keys.kind, "rest"),
            isNull(api_keys.revoked_at),
          ),
        )
        .limit(1),
    );

    if (lookupError) {
      console.error(
        "[resolveRestApiKey] DB lookup failed:",
        lookupError.message,
      );
      return { status: "unavailable" };
    }

    const apiKeyRow = apiKeyRows[0];
    if (!apiKeyRow) {
      return { status: "rejected" };
    }

    // Step 3: Expiry check.
    if (
      apiKeyRow.expires_at !== null &&
      new Date(apiKeyRow.expires_at).getTime() < Date.now()
    ) {
      console.warn(
        `[resolveRestApiKey] Key ${apiKeyRow.id} (prefix=${apiKeyRow.prefix}) is expired`,
      );
      return { status: "rejected" };
    }

    // Step 4: Subscription gate. Rejects without an active subscription.
    // The generic preserves RestPrincipal on the resolved principal.
    const principalCandidate: RestPrincipal = {
      kind: "rest",
      principalId: apiKeyRow.principal_id,
      apiKeyId: apiKeyRow.id,
      scopes: apiKeyRow.scopes ?? ["api:full"],
      plan: null,
      priceId: null,
    };

    const gateResolution = await applySubscriptionGate(principalCandidate);
    if (gateResolution.status !== "resolved") {
      return gateResolution;
    }

    // Step 5: Fire-and-forget last_used_at + last_used_ip update.
    // waitUntil keeps the Vercel function alive long enough for the UPDATE
    // to complete after we return the response.
    waitUntil(updateLastUsedFields(apiKeyRow.id));

    return gateResolution;
  } catch (unexpectedError) {
    console.error(
      "[resolveRestApiKey] Unexpected error:",
      unexpectedError instanceof Error
        ? unexpectedError.message
        : unexpectedError,
    );
    // Our failure, not the key's: a 401 would tell the caller the key is bad.
    return { status: "unavailable" };
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

    const { error: updateError } = await runQuery(
      db.update(api_keys).set(updatePayload).where(eq(api_keys.id, apiKeyId)),
    );

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
