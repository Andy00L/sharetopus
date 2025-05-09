"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { validateUserAuthorization } from "@/actions/authentificationCheck";
import { deleteSupabaseFileAction } from "../data/deleteSupabaseFileAction";

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
  const isAuth = await validateUserAuthorization(userId);
  if (!isAuth) {
    return {
      success: false,
      message: "You are not authorized to disconnect this account.",
    };
  }

  try {
    console.log(`[Disconnect Account] Processing account: ${accountId}`);

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
    // 1. Find all media paths for scheduled posts for this account
    // Only request the media_storage_path field we need
    const { data: mediaPaths, error: postsError } = await adminSupabase
      .from("scheduled_posts")
      .select("media_storage_path")
      .eq("social_account_id", accountId)
      .in("status", ["scheduled", "pending"])
      .filter("media_storage_path", "neq", null);

    if (postsError) {
      console.error(
        "[Disconnect Account] Error fetching media paths:",
        postsError
      );
      // Continue anyway - we'll just not be able to clean up files
    }

    // 2. Extract unique file paths to check
    const filesToCheck = mediaPaths
      ? [...new Set(mediaPaths.map((post) => post.media_storage_path))]
      : [];

    console.log(
      `[Disconnect Account] Found ${filesToCheck.length} unique files to check`
    );

    // 3 Delete the account record from the database
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

    // 4. Check if each file is still being used by other scheduled posts
    const filesForDeletion = [];
    for (const filePath of filesToCheck) {
      if (!filePath) continue;

      // Only request count, not actual data - optimized query
      const { count, error: checkError } = await adminSupabase
        .from("scheduled_posts")
        .select("media_storage_path", { count: "exact", head: true })
        .eq("media_storage_path", filePath)
        .in("status", ["scheduled", "pending"]);

      if (checkError) {
        console.error(
          `[Disconnect Account] Error checking references for file ${filePath}:`,
          checkError
        );
        continue;
      }

      // If count is 0, no posts reference this file
      if (count === 0) {
        console.log(
          `[Disconnect Account] File no longer in use, will delete: ${filePath}`
        );
        filesForDeletion.push(filePath);
      } else {
        console.log(
          `[Disconnect Account] File still in use by ${count} posts, keeping: ${filePath}`
        );
      }
    }

    // 5. Delete each file that's no longer needed
    for (const filePath of filesForDeletion) {
      const result = await deleteSupabaseFileAction(userId, filePath);
      console.log(
        `[Disconnect Account] File deletion result for ${filePath}:`,
        result
      );
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
