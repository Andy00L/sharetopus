import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { after } from "next/server";

import { db, runQuery } from "@/db/client";
import { api_keys } from "@/db/schema";
import { hashToken, isApiKeyToken } from "@/lib/api/tokens";
import { applySubscriptionGate } from "@/lib/mcp/auth/resolvers/applySubscriptionGate";
import type { PrincipalResolution } from "@/lib/types/principal";
import { isLastUseStale } from "@/lib/api/isLastUseStale";
import type { RestPrincipal } from "./types";

/**
 * Resolves a Bearer token into a RestPrincipal.
 *
 * Pipeline:
 *   1. Format check (must start with "stp_rest_")
 *   2. DB lookup by token_hash (kind='rest', not revoked)
 *   3. Expiry check (expires_at > now, or null)
 *   4. Subscription gate (active subscription required)
 *   5. last_used_at + last_used_ip update after the response, at most once
 *      per LAST_USED_WRITE_INTERVAL_MS per key
 *
 * "rejected" when a check fails, "unavailable" when a database read failed
 * on the way. Never throws. The caller (HOF) answers 401 and 503.
 */
export async function resolveRestApiKey(
  bearerToken: string,
  clientIpHash: string | null,
): Promise<PrincipalResolution<RestPrincipal>> {
  try {
    if (!isApiKeyToken(bearerToken, "rest")) {
      return { status: "rejected" };
    }

    const restApiKeyHashed = hashToken(bearerToken);

    const { data: apiKeyRows, error: lookupError } = await runQuery(
      db
        .select({
          id: api_keys.id,
          principal_id: api_keys.principal_id,
          scopes: api_keys.scopes,
          expires_at: api_keys.expires_at,
          prefix: api_keys.prefix,
          last_used_at: api_keys.last_used_at,
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

    if (
      apiKeyRow.expires_at !== null &&
      new Date(apiKeyRow.expires_at).getTime() < Date.now()
    ) {
      console.warn(
        `[resolveRestApiKey] Key ${apiKeyRow.id} (prefix=${apiKeyRow.prefix}) is expired`,
      );
      return { status: "rejected" };
    }

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

    if (isLastUseStale(apiKeyRow.last_used_at, Date.now())) {
      const apiKeyId = apiKeyRow.id;
      after(() => updateLastUsedFields(apiKeyId, clientIpHash));
    }

    return gateResolution;
  } catch (unexpectedError) {
    console.error(
      "[resolveRestApiKey] Unexpected error:",
      unexpectedError instanceof Error
        ? unexpectedError.message
        : unexpectedError,
    );
    return { status: "unavailable" };
  }
}

/**
 * Sets api_keys.last_used_at to now and last_used_ip to the hashed client
 * IP. Errors are logged, never raised: last-use tracking is observability
 * data, not an auth gate, and rest_audit_log keeps the per-request trail.
 */
async function updateLastUsedFields(
  apiKeyId: string,
  clientIpHash: string | null,
): Promise<void> {
  try {
    const { error: updateError } = await runQuery(
      db
        .update(api_keys)
        .set({
          last_used_at: new Date().toISOString(),
          ...(clientIpHash ? { last_used_ip: clientIpHash } : {}),
        })
        .where(eq(api_keys.id, apiKeyId)),
    );

    if (updateError) {
      console.warn(
        "[updateLastUsedFields] failed:",
        updateError.message,
      );
    }
  } catch (unexpectedError) {
    console.warn(
      "[updateLastUsedFields] Unexpected error:",
      unexpectedError instanceof Error
        ? unexpectedError.message
        : unexpectedError,
    );
  }
}
