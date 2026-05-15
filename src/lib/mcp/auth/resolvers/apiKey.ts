import "server-only";

import { waitUntil } from "@vercel/functions";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { extractIpHash } from "@/lib/api/context";
import { hashToken } from "@/lib/mcp/tokens";

import type { McpPrincipal } from "../types";

/**
 * Resolves a `stp_mcp_` API key token to an authenticated MCP principal.
 *
 * Returns null when:
 *   - The token hash does not match any row
 *   - The row is revoked (revoked_at not null)
 *   - The row has expired (expires_at in the past)
 *   - The principal row is missing or not kind='clerk'
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
): Promise<McpPrincipal | null> {
  const tokenHash = hashToken(rawToken);

  const { data: apiKeyRow, error: apiKeyError } = await adminSupabase
    .from("api_keys")
    .select("id, principal_id, kind, scopes, revoked_at, expires_at")
    .eq("token_hash", tokenHash)
    .eq("kind", "mcp")
    .is("revoked_at", null)
    .single();

  if (apiKeyError || !apiKeyRow) return null;

  if (apiKeyRow.expires_at && new Date(apiKeyRow.expires_at) < new Date()) {
    return null;
  }

  // Belt-and-suspenders: the api_keys.principal_id FK trigger already
  // enforces kind='clerk', but a defense-in-depth check here protects
  // against future schema drift. Costs one extra SELECT on the hot path.
  const { data: principalRow } = await adminSupabase
    .from("principals")
    .select("id, kind")
    .eq("id", apiKeyRow.principal_id)
    .eq("kind", "clerk")
    .single();

  if (!principalRow) return null;

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
      const { error: updateError } = await adminSupabase
        .from("api_keys")
        .update({
          last_used_at: new Date().toISOString(),
          last_used_ip: ipHash,
        })
        .eq("id", apiKeyRow.id);

      if (updateError) {
        console.error(
          `[resolveApiKey] last_used update failed for key ${apiKeyRow.id}: ${updateError.message}`,
        );
      }
    })(),
  );

  return {
    kind: "apikey",
    principalId: apiKeyRow.principal_id,
    apiKeyId: apiKeyRow.id,
    scopes: apiKeyRow.scopes ?? [],
    plan: null,
    priceId: null,
  };
}
