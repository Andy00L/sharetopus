import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { api_keys } from "@/db/schema";
import type { ApiKeyKind } from "@/lib/api/tokens";

const NOT_FOUND_MESSAGE =
  "Key not found, already revoked, or does not belong to you.";

/**
 * Revokes one of a principal's live API keys of the given kind by setting
 * revoked_at; the row stays for audit, and the key resolvers filter on
 * revoked_at IS NULL, so it stops working at once. One UPDATE checks
 * ownership and revokes, so nothing can change between the two.
 *
 * A failed query is reported as a failure to retry, never as "not found":
 * telling a user that a leaked key is already dead when it still works is
 * the worst answer this can give.
 *
 * Called by revokeRestApiKey (kind 'rest') and revokeApiKey (kind 'mcp').
 */
export async function revokeApiKeyForPrincipal(
  principalId: string,
  keyId: string,
  kind: ApiKeyKind,
): Promise<{ success: boolean; message: string }> {
  const { data: revokedRows, error } = await runQuery(
    db
      .update(api_keys)
      .set({ revoked_at: new Date().toISOString() })
      .where(
        and(
          eq(api_keys.id, keyId),
          eq(api_keys.principal_id, principalId),
          eq(api_keys.kind, kind),
          isNull(api_keys.revoked_at),
        ),
      )
      .returning({ id: api_keys.id }),
  );

  if (error) {
    // 22P02 (invalid_text_representation): keyId is not a uuid, so no key
    // has it. sourceRef: postgresql.org/docs/current/errcodes-appendix.html
    if (error.code === "22P02") {
      return { success: false, message: NOT_FOUND_MESSAGE };
    }
    console.error(
      `[revokeApiKeyForPrincipal] Revoke failed for ${kind} key ${keyId}:`,
      error.message,
    );
    return {
      success: false,
      message: "The key could not be revoked and may still work. Please try again.",
    };
  }

  if (revokedRows.length === 0) {
    return { success: false, message: NOT_FOUND_MESSAGE };
  }
  return { success: true, message: "API key revoked." };
}
