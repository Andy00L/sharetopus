import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/server/authCheck";
import "server-only";
import { deleteSupabaseFileAction } from "../data/deleteSupabaseFileAction";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * Disconnects a social media account from the user's profile and cleans up associated resources
 *
 * This function:
 * 1. Verifies user authentication and ownership of the account
 * 2. Performs rate limiting to prevent abuse (max 30 requests per minute)
 * 3. Identifies media files used by scheduled posts for this account
 * 4. Removes the social account from the database
 * 5. Deletes orphaned media files no longer used by any posts
 * 6. Returns a structured response with the operation result
 *
 * @param accountId - ID of the social account to disconnect
 * @param userId - ID of the authenticated user
 * @returns Object with success status, message, and optional reset time
 */
export async function disconnectSocialAccount(
  accountId: string,
  userId: string | null
): Promise<{ success: boolean; message: string; resetIn?: number }> {
  try {
    console.log(`[Disconnect Account] Processing account: ${accountId}`);

    // Verify user is properly authenticated
    const authResult = await authCheck(userId);
    if (!authResult) {
      console.error(
        `[fetchSocialAccounts]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }
    console.log(
      `[fetchSocialAccounts]: Authentication validated for user: ${userId}`
    );

    // Step 2: Check rate limits to prevent abuse
    console.log(
      `[fetchSocialAccounts]: Checking rate limits for user: ${userId}`
    );
    const rateCheck = await checkRateLimit(
      "disconnectSocialAccount", // Unique identifier for this operation
      userId, // User identifier
      30, // Limit (30 requests)
      60 // Window (60 seconds)
    );
    if (!rateCheck.success) {
      console.warn(
        `[fetchSocialAccounts]: Rate limit exceeded for user: ${userId}. Reset in: ${
          rateCheck.resetIn ?? "unknown"
        } seconds`
      );
      return {
        success: false,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }
    console.log(
      `[fetchSocialAccounts]: Rate limit check passed for user: ${userId}`
    );

    // Step 3: Verify account exists and belongs to user
    console.log(
      `[disconnectSocialAccount]: Verifying account ownership for account: ${accountId}`
    );
    const { data: account, error: fetchError } = await adminSupabase
      .from("social_accounts")
      .select("user_id, platform")
      .eq("id", accountId)
      .single();

    if (fetchError || !account) {
      console.error(
        `[disconnectSocialAccount]: Account fetch error:`,
        fetchError?.message || "Account not found"
      );
      return {
        success: false,
        message:
          "Failed to find the social account. It may have been already disconnected.",
      };
    }

    // Security check: ensure the account belongs to this user
    if (account.user_id !== userId) {
      console.warn(
        `[disconnectSocialAccount]: Unauthorized access - User ${userId} attempted to disconnect account ${accountId} owned by ${account.user_id}`
      );
      return {
        success: false,
        message: "You are not authorized to disconnect this account.",
      };
    }
    console.log(
      `[disconnectSocialAccount]: Account ownership verified for platform: ${account.platform}`
    );

    // Step 4: Find all media paths for scheduled posts for this account
    console.log(
      `[disconnectSocialAccount]: Finding media files used by this account's posts`
    );
    const { data: mediaPaths, error: postsError } = await adminSupabase
      .from("scheduled_posts")
      .select("media_storage_path")
      .eq("social_account_id", accountId)
      .in("status", ["scheduled", "pending"])
      .filter("media_storage_path", "neq", null);

    if (postsError) {
      console.error(
        `[disconnectSocialAccount]: Error fetching media paths:`,
        postsError.message
      );
      // Continue anyway - we'll just not be able to clean up files
    }

    // Step 5: Extract unique file paths to check
    const filesToCheck = mediaPaths
      ? [...new Set(mediaPaths.map((post) => post.media_storage_path))]
      : [];

    console.log(
      `[Disconnect Account] Found ${filesToCheck.length} unique files to check`
    );

    // Step 6: Delete the account record from the database
    console.log(
      `[disconnectSocialAccount]: Removing account ${accountId} from database`
    );
    const { error: deleteError } = await adminSupabase
      .from("social_accounts")
      .delete()
      .eq("id", accountId);

    if (deleteError) {
      console.error(
        `[disconnectSocialAccount]: Account deletion error:`,
        deleteError.message
      );
      return {
        success: false,
        message: `Failed to disconnect the account`,
      };
    }
    console.log(
      `[disconnectSocialAccount]: Account successfully removed from database`
    );

    // Step 7: Check if each file is still being used by other scheduled posts
    console.log(`[disconnectSocialAccount]: Checking for orphaned media files`);
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
          `[disconnectSocialAccount]: File no longer in use, marked for deletion: ${filePath}`
        );
        filesForDeletion.push(filePath);
      } else {
        console.log(
          `[Disconnect Account] File still in use by ${count} posts, keeping: ${filePath}`
        );
      }
    }

    // Step 8: Delete each file that's no longer needed
    console.log(
      `[disconnectSocialAccount]: Found ${filesForDeletion.length} orphaned files to delete`
    );
    let deletedFiles = 0;
    for (const filePath of filesForDeletion) {
      const result = await deleteSupabaseFileAction(userId, filePath);
      if (result.success) {
        deletedFiles++;
      }
      if (!result.success) {
        console.error(
          `[disconnectSocialAccount]: Error deleting file  ${filePath}, ${result.message}:`
        );
        continue;
      }
      console.log(
        `[disconnectSocialAccount]: File deletion result for ${filePath}:`,
        result.success ? "Success" : `Failed: ${result.message}`
      );
    }
    // Step 9: Return success with details about the operation
    const platformName =
      account.platform.charAt(0).toUpperCase() + account.platform.slice(1);
    console.log(
      `[disconnectSocialAccount]: Successfully disconnected ${platformName} account`
    );

    return {
      success: true,
      message: `${platformName} account disconnected successfully${
        deletedFiles > 0
          ? ` and ${deletedFiles} unused media files cleaned up.`
          : "."
      }`,
    };
  } catch (err) {
    // Step 10: Handle unexpected errors
    console.error(`[disconnectSocialAccount]: Unexpected error:`, err);
    return {
      success: false,
      message:
        "An unexpected error occurred while disconnecting the account. Please try again or contact support.",
    };
  }
}
