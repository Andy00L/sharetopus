"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/authCheck";
import { deleteSupabaseFileAction } from "../data/deleteSupabaseFileAction";
import { checkRateLimit } from "../reddis/rate-limit";

/**
 * Completely deletes a scheduled post and its associated media (if no longer used)
 *
 * This function:
 * 1. Verifies user authentication
 * 2. Performs rate limiting to prevent abuse
 * 3. Validates post ownership and retrieves media information
 * 4. Deletes the post record from the database
 * 5. Attempts to delete associated media files (if not referenced elsewhere)
 * 6. Returns a structured response with the operation result
 *
 * @param postId - ID of the scheduled post to delete
 * @param userId - ID of the authenticated user
 * @returns Object with success status, message, and optional reset time
 */
export async function deleteScheduledPost(
  postId: string,
  userId: string | null
): Promise<{ success: boolean; message: string; resetIn?: number }> {
  try {
    console.log(
      `[deleteScheduledPost]: Starting deletion process for post ID: ${postId}`
    );

    // Step 1: Verify user is properly authenticated
    if (!userId) {
      console.error(`[deleteScheduledPost]: Missing user ID in request`);
      return {
        success: false,
        message: "User authentication required. Please sign in to continue.",
      };
    }

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

    console.log(`[Delete Scheduled Post] Processing post: ${postId}`);

    // Step 2: Check rate limits to prevent abuse
    console.log(
      `[deleteScheduledPost]: Checking rate limits for user: ${userId}`
    );
    const rateCheck = await checkRateLimit(
      "deleteScheduledPost", // Unique identifier for this operation
      userId, // User identifier
      30, // Limit (30 requests)
      60 // Window (60 seconds)
    );
    if (!rateCheck.success) {
      console.warn(
        `[deleteScheduledPost]: Rate limit exceeded for user: ${userId}. Reset in: ${
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
      `[deleteScheduledPost]: Rate limit check passed for user: ${userId}`
    );
    // Step 3: Fetch post data to verify ownership and get media information
    console.log(
      `[deleteScheduledPost]: Fetching post data for verification: ${postId}`
    );
    const { data: post, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("user_id, media_storage_path, status")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      console.error(
        `[deleteScheduledPost]: Failed to find post with ID ${postId}:`,
        fetchError?.message || "Post not found"
      );
      return {
        success: false,
        message:
          "The post could not be found. It may have been already deleted.",
      };
    }
    console.log(
      `[deleteScheduledPost]: Found post data for platform, status: ${post.status}`
    );

    // Step 4: Verify post ownership (security check)
    if (post.user_id !== userId) {
      console.warn(
        `[Delete Scheduled Post] User ${userId} attempted to delete post ${postId} owned by ${post.user_id}`
      );
      return {
        success: false,
        message: "You are not authorized to delete this post.",
      };
    }
    console.log(
      `[deleteScheduledPost]: Post ownership verified for user: ${userId}`
    );

    // Step 5: Delete the post record from the database
    // This ensures that our reference check won't count this post when checking media usage
    console.log(
      `[deleteScheduledPost]: Deleting post record from database: ${postId}`
    );
    const { error: deleteError } = await adminSupabase
      .from("scheduled_posts")
      .delete()
      .eq("id", postId);

    if (deleteError) {
      console.error(
        `[deleteScheduledPost]: Database error deleting post:`,
        deleteError.message,
        deleteError.details
      );
      return {
        success: false,
        message:
          "Failed to delete the post due to a database error. Please try again.",
      };
    }
    console.log(
      `[deleteScheduledPost]: Post record successfully deleted from database: ${postId}`
    );

    // Step 6: Attempt to delete the associated media file if it exists
    if (post.media_storage_path) {
      console.log(
        `[deleteScheduledPost]: Attempting to delete associated media file: ${post.media_storage_path}`
      );
      try {
        // The deleteSupabaseFileAction automatically checks if the file
        // is still being used by other posts before deletion
        const deleteFileResult = await deleteSupabaseFileAction(
          userId,
          post.media_storage_path
        );

        if (deleteFileResult.success) {
          console.log(
            `[deleteScheduledPost]: Media file successfully deleted: ${post.media_storage_path}`
          );
        } else {
          console.log(
            `[deleteScheduledPost]: Media file not deleted: ${deleteFileResult.message}`
          );
        }
      } catch (fileError) {
        // We continue even if file deletion fails - post is already deleted
        console.error(
          `[deleteScheduledPost]: Error during file deletion attempt:`,
          fileError instanceof Error ? fileError.message : fileError
        );
      }
    } else {
      console.log(
        `[deleteScheduledPost]: No media file associated with this post`
      );
    }

    console.log(
      `[deleteScheduledPost]: Successfully completed deletion process for  post: ${postId}`
    );
    return {
      success: true,
      message: `Your post has been successfully deleted.`,
    };
  } catch (err) {
    // Step 8: Handle unexpected errors
    console.error(
      `[deleteScheduledPost]: Unexpected error during post deletion:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while deleting the post. Please try again later.",
    };
  }
}
