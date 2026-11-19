"use server";

import { authCheck } from "@/actions/server/authCheck";
import { revokeApiKeyForPrincipal } from "@/lib/api/revokeApiKeyForPrincipal";

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

    return await revokeApiKeyForPrincipal(userId, keyId, "rest");
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
