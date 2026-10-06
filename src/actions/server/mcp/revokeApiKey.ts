"use server";

import { authCheck } from "@/actions/server/authCheck";
import { revokeApiKeyForPrincipal } from "@/lib/api/revokeApiKeyForPrincipal";

/** Revokes one of the caller's MCP API keys; the row stays for audit and stops authenticating at once. */
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

    return await revokeApiKeyForPrincipal(userId, keyId, "mcp");
  } catch (err) {
    console.error(
      "[revokeApiKey] Unexpected error:",
      err instanceof Error ? err.message : err
    );
    return { success: false, message: "Unexpected error revoking API key." };
  }
}
