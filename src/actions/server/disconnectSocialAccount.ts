"use server";

import { adminSupabase } from "@/actions/api/supabase-client";

/**
 * Disconnect a social media account from the user's profile
 *
 * @param accountId ID of the social account to disconnect
 * @param userId ID of the authenticated user
 * @returns Object with success status and message
 */
export async function disconnectSocialAccount(
  accountId: string,
  userId: string | null
): Promise<{ success: boolean; message: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  try {
    // First, get the account to check ownership
    const { data: account, error: fetchError } = await adminSupabase
      .from("social_accounts")
      .select("user_id, platform")
      .eq("id", accountId)
      .single();

    if (fetchError || !account) {
      console.error("[Disconnect Account] Fetch error:", fetchError);
      return {
        success: false,
        message: "Failed to find the social account.",
      };
    }

    // Security check: ensure the account belongs to this user
    if (account.user_id !== userId) {
      console.warn(
        `[Disconnect Account] User ${userId} attempted to disconnect account ${accountId} owned by ${account.user_id}`
      );
      return {
        success: false,
        message: "You are not authorized to disconnect this account.",
      };
    }

    // Delete the account record from the database
    const { error: deleteError } = await adminSupabase
      .from("social_accounts")
      .delete()
      .eq("id", accountId);

    if (deleteError) {
      console.error("[Disconnect Account] Delete error:", deleteError);
      return {
        success: false,
        message: `Failed to disconnect the account: ${deleteError.message}`,
      };
    }

    return {
      success: true,
      message: `${
        account.platform.charAt(0).toUpperCase() + account.platform.slice(1)
      } account disconnected successfully.`,
    };
  } catch (err) {
    console.error("[Disconnect Account] Unexpected error:", err);
    return {
      success: false,
      message: "An unexpected error occurred.",
    };
  }
}
