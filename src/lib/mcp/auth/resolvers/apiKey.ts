import "server-only";

import { waitUntil } from "@vercel/functions";
import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { api_keys, principals } from "@/db/schema";
import { extractIpHash } from "@/lib/api/context";
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
 * "unavailable" when either lookup fails: the key may well be valid.
 *
 * Side effect: `last_used_at` and `last_used_ip` are updated on every
 * successful resolution. The UPDATE runs in the background via
 * waitUntil, so the request does not block on it. See the comment
 * around the waitUntil call for the why.
 *
 * Source: extracted from src/lib/mcp/auth.ts:147-192.
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
      })
      .from(api_keys)
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

  // Belt-and-suspenders: the api_keys.principal_id FK trigger already
  // enforces kind='clerk', but a defense-in-depth check here protects
  // against future schema drift. Costs one extra SELECT on the hot path.
  const { data: principalRows, error: principalError } = await runQuery(
    db
      .select({ id: principals.id })
      .from(principals)
      .where(
        and(
          eq(principals.id, apiKeyRow.principal_id),
          eq(principals.kind, "clerk"),
        ),
      )
      .limit(1),
  );

  if (principalError) {
    console.error(
      `[resolveApiKey] Principal lookup failed for key ${apiKeyRow.id}: ${principalError.message}`,
    );
    return { status: "unavailable" };
  }
  if (!principalRows[0]) return { status: "rejected" };

  // Fire-and-forget `last_used` tracking.
  //
  // Why waitUntil instead of `await`:
  //   - `await` blocks the request ~50ms on every API key call for data
  //     the user does not care about (it is analytics, not auth).
  //   - Plain `void promise` risks the serverless runtime freezing the
  //     function before the UPDATE reaches the DB, losing 5-10% of writes.
  //   - waitUntil tells Vercel to keep the function alive until the
  //     promise resolves while still returning the response to the user
  //     immediately. Right tool for "background work after response".
  //
  // Errors are logged and swallowed: a failed tracking write should
  // never break authentication for the user.
  const ipHash = await extractIpHash();
  waitUntil(
    (async () => {
      const { error: updateError } = await runQuery(
        db
          .update(api_keys)
          .set({
            last_used_at: new Date().toISOString(),
            last_used_ip: ipHash,
          })
          .where(eq(api_keys.id, apiKeyRow.id)),
      );

      if (updateError) {
        console.error(
          `[resolveApiKey] last_used update failed for key ${apiKeyRow.id}: ${updateError.message}`,
        );
      }
    })(),
  );

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
