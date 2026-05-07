"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/server/authCheck";

/**
 * Lists MCP API keys for the authenticated user.
 *
 * Returns the prefix, name, created_at, and last_used_at. Never returns
 * the token_hash or the raw key.
 *
 * Called by: src/app/(protected)/integrations/page.tsx
 * Tables read: api_keys
 */
export async function listApiKeys(
  userId: string | null
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

    const { data, error } = await adminSupabase
      .from("api_keys")
      .select("id, name, prefix, created_at, last_used_at, expires_at")
      .eq("principal_id", userId)
      .eq("kind", "mcp")
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, message: `Failed to list keys: ${error.message}` };
    }

    return {
      success: true,
      message: `Found ${data?.length ?? 0} active key(s).`,
      data: data ?? [],
    };
  } catch (err) {
    console.error(
      "[listApiKeys] Unexpected error:",
      err instanceof Error ? err.message : err
    );
    return { success: false, message: "Unexpected error listing API keys." };
  }
}
