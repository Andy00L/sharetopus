import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/server/authCheck";
import "server-only";
import { deleteSupabaseFile } from "../data/storageFiles/deleteSupabaseFile";
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
  userId: string | null,
): Promise<{ success: boolean; message: string; resetIn?: number }> {
  try {
    console.log(
      `[Disconnect Account] Processing account: ${accountId}, user: ${userId}`,
    );

    // Verify user is properly authenticated
    if (!(await authCheck(userId))) {
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }

    // Step 2: Check rate limits to prevent abuse
    const rateCheck = await checkRateLimit(
      "disconnectSocialAccount", // Unique identifier for this operation
      userId, // User identifier
      30, // Limit (30 requests)
      60, // Window (60 seconds)
    );

    if (!rateCheck.success) {
      console.warn(
        `[fetchSocialAccounts]: Rate limit exceeded for user: ${userId}. Reset in: ${
          rateCheck.resetIn ?? "unknown"
        } seconds`,
      );
      return {
        success: false,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }

    // Step 3: fetch account, verify ownership.
    const { data: account, error: fetchError } = await adminSupabase
      .from("social_accounts")
      .select("principal_id, platform")
      .eq("id", accountId)
      .single();

    if (fetchError || !account) {
      console.error(
        `[disconnectSocialAccount]: Account fetch error:`,
        fetchError?.message || "Account not found",
      );
      return {
        success: false,
        message:
          "Failed to find the social account. It may have been already disconnected.",
      };
    }

    // Security check: ensure the account belongs to this user
    if (account.principal_id !== userId) {
      console.warn(
        `[disconnectSocialAccount]: Unauthorized access - User ${userId} attempted to disconnect account ${accountId} owned by ${account.principal_id}`,
      );
      return {
        success: false,
        message: "You are not authorized to disconnect this account.",
      };
    }

    // Step 4: collect media paths from active scheduled posts BEFORE the cascade delete wipes them.
    const { data: mediaPaths, error: postsError } = await adminSupabase
      .from("scheduled_posts")
      .select("media_storage_path")
      .eq("social_account_id", accountId)
      .in("status", ["scheduled", "processing"])
      .not("media_storage_path", "is", null);

    if (postsError) {
      console.error(
        `[disconnectSocialAccount]: Error fetching media paths:`,
        postsError.message,
      );
      // Continue anyway - we'll just not be able to clean up files
    }

    // Step 5: Extract unique file paths to check
    const filesToCheck = [
      ...new Set(
        (mediaPaths ?? [])
          .map((row) => row.media_storage_path)
          .filter((path): path is string => Boolean(path)),
      ),
    ];

    // Step 6: delete the account. FK CASCADE wipes scheduled_posts, pending_*, social_connections.
    const { error: deleteError } = await adminSupabase
      .from("social_accounts")
      .delete()
      .eq("id", accountId);

    if (deleteError) {
      console.error(
        `[disconnectSocialAccount]: Account deletion error:`,
        deleteError.message,
      );
      return {
        success: false,
        message: `Failed to disconnect the account`,
      };
    }

    // Step 7: try to delete each media file. deleteSupabaseFile re-checks all reference
    // tables (scheduled_posts, failed_posts, pending pulls, pending direct posts) and
    // preserves files still referenced.

    const deleteResults = await Promise.allSettled(
      filesToCheck.map((filePath) =>
        deleteSupabaseFile(userId!, filePath, false),
      ),
    );

    let deletedFiles = 0;
    for (const result of deleteResults) {
      if (result.status === "fulfilled" && result.value.success === true) {
        deletedFiles++;
      } else if (result.status === "rejected") {
        console.error(
          "[disconnectSocialAccount] File deletion threw:",
          result.reason,
        );
      }
    }

    const platformName =
      account.platform.charAt(0).toUpperCase() + account.platform.slice(1);

    return {
      success: true,
      message: `${platformName} account disconnected${
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
