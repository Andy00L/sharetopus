"use server";

import { and, desc, eq, isNull } from "drizzle-orm";

import { authCheck } from "@/actions/server/authCheck";
import { db, runQuery } from "@/db/client";
import { api_keys } from "@/db/schema";

/**
 * Lists REST API keys for the authenticated user.
 *
 * Returns the prefix, name, created_at, and last_used_at. Never returns
 * the token_hash or the raw key.
 *
 * Mirrors src/actions/server/mcp/listApiKeys.ts but filters on
 * kind='rest' instead of kind='mcp'.
 */
export async function listRestApiKeys(
  userId: string | null,
): Promise<{
  success: boolean;
  message: string;
  data?: Array<{
    id: string;
    name: string;
    prefix: string;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
  }>;
}> {
  try {
    const authResult = await authCheck(userId);
    if (!authResult || !userId) {
      return { success: false, message: "Authentication required." };
    }

    const { data, error } = await runQuery(
      db
        .select({
          id: api_keys.id,
          name: api_keys.name,
          prefix: api_keys.prefix,
          created_at: api_keys.created_at,
          last_used_at: api_keys.last_used_at,
          expires_at: api_keys.expires_at,
        })
        .from(api_keys)
        .where(
          and(
            eq(api_keys.principal_id, userId),
            eq(api_keys.kind, "rest"),
            isNull(api_keys.revoked_at),
          ),
        )
        .orderBy(desc(api_keys.created_at)),
    );

    if (error) {
      return {
        success: false,
        message: `Failed to list keys: ${error.message}`,
      };
    }

    return {
      success: true,
      message: `Found ${data.length} active key(s).`,
      data,
    };
  } catch (err) {
    console.error(
      "[listRestApiKeys] Unexpected error:",
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      message: "Unexpected error listing API keys.",
    };
  }
}
