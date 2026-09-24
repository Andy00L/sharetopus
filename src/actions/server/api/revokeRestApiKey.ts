"use server";

import { and, eq, isNull } from "drizzle-orm";

import { authCheck } from "@/actions/server/authCheck";
import { db, runQuery } from "@/db/client";
import { api_keys } from "@/db/schema";

/**
 * Revokes a REST API key by setting revoked_at.
 *
 * The key row stays in the table for audit purposes but will no longer
 * pass the auth check in resolveRestApiKey because we filter on
 * revoked_at IS NULL.
 *
 * Mirrors src/actions/server/mcp/revokeApiKey.ts but filters on
 * kind='rest' instead of kind='mcp'.
 */
export async function revokeRestApiKey(
  userId: string | null,
  keyId: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const authResult = await authCheck(userId);
    if (!authResult || !userId) {
      return { success: false, message: "Authentication required." };
    }

    if (!keyId) {
      return { success: false, message: "Key ID is required." };
    }

    // Verify ownership before revoking. A malformed keyId fails the uuid
    // cast in Postgres and lands in the same not-found answer.
    const { data: existingKeys, error: fetchError } = await runQuery(
      db
        .select({ id: api_keys.id })
        .from(api_keys)
        .where(
          and(
            eq(api_keys.id, keyId),
            eq(api_keys.principal_id, userId),
            eq(api_keys.kind, "rest"),
            isNull(api_keys.revoked_at),
          ),
        )
        .limit(1),
    );

    if (fetchError || !existingKeys[0]) {
      return {
        success: false,
        message:
          "Key not found, already revoked, or does not belong to you.",
      };
    }

    const { error: updateError } = await runQuery(
      db
        .update(api_keys)
        .set({ revoked_at: new Date().toISOString() })
        .where(eq(api_keys.id, keyId)),
    );

    if (updateError) {
      return {
        success: false,
        message: `Failed to revoke key: ${updateError.message}`,
      };
    }

    return { success: true, message: "API key revoked." };
  } catch (err) {
    console.error(
      "[revokeRestApiKey] Unexpected error:",
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      message: "Unexpected error revoking API key.",
    };
  }
}
