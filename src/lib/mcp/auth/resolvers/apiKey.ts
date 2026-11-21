import "server-only";

import { waitUntil } from "@vercel/functions";
import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { api_keys, principals } from "@/db/schema";
import { extractIpHash } from "@/lib/api/context";
import { isLastUseStale } from "@/lib/api/isLastUseStale";
import { hashToken } from "@/lib/api/tokens";
import type { PrincipalResolution } from "@/lib/types/principal";

import type { McpPrincipal } from "../types";

/**
 * Resolves a `stp_mcp_` API key token to an authenticated MCP principal.
 *
 * "rejected" when:
 *   - The token hash does not match any row
 *   - The row is revoked (revoked_at not null)
 *   - The row has expired (expires_at in the past)
 *   - The principal row is missing or not kind='clerk'
 * "unavailable" when the lookup fails: the key may well be valid.
 *
 * Side effect: `last_used_at` and `last_used_ip` are updated after the
 * response (waitUntil), at most once per LAST_USED_WRITE_INTERVAL_MS per key.
 *
 * Called by: src/lib/mcp/auth/resolve.ts (when token starts with stp_mcp_)
 */
export async function resolveApiKey(
  rawToken: string,
): Promise<PrincipalResolution<McpPrincipal>> {
  const tokenHash = hashToken(rawToken);

  const { data: apiKeyRows, error: apiKeyError } = await runQuery(
    db
      .select({
        id: api_keys.id,
        principal_id: api_keys.principal_id,
        scopes: api_keys.scopes,
        expires_at: api_keys.expires_at,
        last_used_at: api_keys.last_used_at,
      })
      .from(api_keys)
      .innerJoin(
        principals,
        and(eq(principals.id, api_keys.principal_id), eq(principals.kind, "clerk")),
      )
      .where(
        and(
          eq(api_keys.token_hash, tokenHash),
          eq(api_keys.kind, "mcp"),
          isNull(api_keys.revoked_at),
        ),
      )
      .limit(1),
  );

  if (apiKeyError) {
    console.error(`[resolveApiKey] Key lookup failed: ${apiKeyError.message}`);
    return { status: "unavailable" };
  }

  const apiKeyRow = apiKeyRows[0];
  if (!apiKeyRow) return { status: "rejected" };

  if (apiKeyRow.expires_at && new Date(apiKeyRow.expires_at) < new Date()) {
    return { status: "rejected" };
  }

  if (isLastUseStale(apiKeyRow.last_used_at, Date.now())) {
    const ipHash = await extractIpHash();
    waitUntil(recordApiKeyUse(apiKeyRow.id, ipHash));
  }

  return {
    status: "resolved",
    principal: {
      kind: "apikey",
      principalId: apiKeyRow.principal_id,
      apiKeyId: apiKeyRow.id,
      scopes: apiKeyRow.scopes ?? [],
      plan: null,
      priceId: null,
    },
  };
}

async function recordApiKeyUse(apiKeyId: string, ipHash: string | null): Promise<void> {
  try {
    const { error: updateError } = await runQuery(
      db
        .update(api_keys)
        .set({
          last_used_at: new Date().toISOString(),
          last_used_ip: ipHash,
        })
        .where(eq(api_keys.id, apiKeyId)),
    );
    if (updateError) {
      console.error(
        `[recordApiKeyUse] last_used update failed for key ${apiKeyId}: ${updateError.message}`,
      );
    }
  } catch (unexpectedError) {
    console.error(
      `[recordApiKeyUse] last_used update failed for key ${apiKeyId}:`,
      unexpectedError instanceof Error ? unexpectedError.message : unexpectedError,
    );
  }
}
