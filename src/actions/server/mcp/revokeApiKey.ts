"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/server/authCheck";

/**
 * Revokes an MCP API key by setting revoked_at.
 *
 * The key row stays in the table for audit purposes but will no longer
 * pass the auth check in resolveMcpPrincipal because we filter on
 * revoked_at IS NULL.
 *
 * Called by: src/app/(protected)/integrations/page.tsx
 * Tables touched: api_keys (update)
 */
export async function revokeApiKey(
  userId: string | null,
  keyId: string
): Promise<{ success: boolean; message: string }> {
  try {
    const authResult = await authCheck(userId);
    if (!authResult || !userId) {
      return { success: false, message: "Authentication required." };
    }

    if (!keyId) {
      return { success: false, message: "Key ID is required." };
    }

    // Verify ownership before revoking
    const { data: existing, error: fetchError } = await adminSupabase
      .from("api_keys")
      .select("id, principal_id")
      .eq("id", keyId)
      .eq("principal_id", userId)
      .eq("kind", "mcp")
      .is("revoked_at", null)
      .single();

    if (fetchError || !existing) {
      return {
        success: false,
        message: "Key not found, already revoked, or does not belong to you.",
      };
    }

    const { error: updateError } = await adminSupabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId);

    if (updateError) {
      return {
        success: false,
        message: `Failed to revoke key: ${updateError.message}`,
      };
    }

    return { success: true, message: "API key revoked." };
  } catch (err) {
    console.error(
      "[revokeApiKey] Unexpected error:",
      err instanceof Error ? err.message : err
    );
    return { success: false, message: "Unexpected error revoking API key." };
  }
}
