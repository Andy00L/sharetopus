"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/authCheck";
import { deleteSupabaseFileAction } from "../data/deleteSupabaseFileAction";
import { checkRateLimit } from "../reddis/rate-limit";

/**
 * Batch deletes multiple scheduled posts and their associated media (if no longer used)
 *
 * This function:
 * 1. Performs a single authentication and rate limit check
 * 2. Validates and deletes multiple posts in a batch operation
 * 3. Handles media deletion for all posts as needed
 * 4. Returns aggregate results of the operation
 *
 * @param postIds - Array of post IDs to delete
 * @param userId - ID of the authenticated user
 * @returns Object with success status, message, and details about the operation
 */
export async function deleteScheduledPostBatch(
  postIds: string[],
  userId: string | null,
  isCronJob?: boolean
): Promise<{
  success: boolean;
  message: string;
  resetIn?: number;
  details?: {
    total: number;
    succeeded: number;
    failed: number;
    mediaDeleted: number;
  };
}> {
  try {
    // Early validation: Check if postIds array is empty
    if (!postIds || postIds.length === 0) {
      console.error(
        `[deleteScheduledPostBatch]: No post IDs provided for deletion`
      );
      return {
        success: false,
        message: "No posts specified to delete.",
        details: {
          total: 0,
          succeeded: 0,
          failed: 0,
          mediaDeleted: 0,
        },
      };
    }
    console.log(
      `[deleteScheduledPostBatch]: Starting batch deletion for ${postIds.length} posts`
    );

    // Verify user is properly authenticated
    const authResult = await authCheck(userId, {
      isCronJob: isCronJob,
      cronSecret: process.env.CRON_SECRET_KEY,
    });
    if (!authResult) {
      console.error(
        `[deleteScheduledPostBatch]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }

    console.log(
      `[deleteScheduledPostBatch]: Authentication validated for user: ${userId}`
    );
    // Step 2: Check rate limits to prevent abuse
    console.log(
      `[deleteScheduledPostBatch]: Checking rate limits for user: ${userId}`
    );
    const rateCheck = await checkRateLimit(
      "deleteScheduledPostBatch", // Unique identifier for this operation
      userId, // User identifier
      30, // Limit (30 requests)
      60 // Window (60 seconds)
    );
    if (!rateCheck.success) {
      console.warn(
        `[deleteScheduledPostBatch]: Rate limit exceeded for user: ${userId}. Reset in: ${
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
      `[deleteScheduledPostBatch]: Rate limit check passed for user: ${userId}`
    );
    // Step 3: Fetch post data to verify ownership and get media information
    console.log(
      `[deleteScheduledPostBatch]: Fetching data for ${postIds.length} posts`
    );
    const { data: posts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("id, user_id, media_storage_path, platform, status")
      .in("id", postIds);

    if (fetchError) {
      console.error(
        `[deleteScheduledPostBatch]: Database error fetching posts:`,
        fetchError.message,
        fetchError.details
      );
      return {
        success: false,
        message: "Failed to retrieve post information. Please try again.",
      };
    }

    // Check if we found any posts
    if (!posts || posts.length === 0) {
      console.error(
        `[deleteScheduledPostBatch]: No posts found with the provided IDs`
      );
      return {
        success: false,
        message:
          "No posts found to delete. They may have been deleted already.",
      };
    }

    if (posts.length !== postIds.length) {
      console.warn(
        `[deleteScheduledPostBatch]: Not all requested posts were found. Found ${posts.length} of ${postIds.length}`
      );
    }

    // Step 4: Verify post ownership
    // Check if all posts belong to the user
    const unauthorizedPosts = posts.filter((post) => post.user_id !== userId);
    if (unauthorizedPosts.length > 0) {
      console.warn(
        `[deleteScheduledPostBatch]: Security violation - User ${userId} attempted to delete ${unauthorizedPosts.length} posts owned by others`
      );
      return {
        success: false,
        message:
          "You don't have permission to delete some or all of these posts.",
      };
    }

    console.log(
      `[deleteScheduledPostBatch]: ${posts.length} posts verified and eligible for deletion`
    );
    // Step 5: Delete all posts in a single batch operation
    console.log(
      `[deleteScheduledPostBatch]: Performing batch deletion of ${posts.length} posts`
    );

    const postIdsToDelete = posts.map((post) => post.id);
    const { error: deleteError } = await adminSupabase
      .from("scheduled_posts")
      .delete()
      .in("id", postIdsToDelete);

    if (deleteError) {
      console.error(
        `[deleteScheduledPostBatch]: Database error deleting posts:`,
        deleteError.message,
        deleteError.details
      );
      return {
        success: false,
        message:
          "Failed to delete the posts due to a database error. Please try again.",
      };
    }

    console.log(
      `[deleteScheduledPostBatch]: Successfully deleted ${posts.length} posts from database`
    );

    // Step 6: Handle media file deletion - simplified approach
    console.log(`[deleteScheduledPostBatch]: Processing media file deletion`);

    // All posts in a batch share the same media file, so we can just use the first post's media path
    const mediaPath = posts[0]?.media_storage_path;
    let mediaDeletedCount = 0;

    if (!mediaPath) {
      console.log(
        `[deleteScheduledPostBatch]: No media file found for these posts`
      );
    } else {
      try {
        console.log(
          `[deleteScheduledPostBatch]: Checking if media can be deleted: ${mediaPath}`
        );

        // The deleteSupabaseFileAction already checks if the file
        // is still being used by other posts before deletion
        const deleteFileResult = await deleteSupabaseFileAction(
          userId,
          mediaPath
        );

        if (deleteFileResult.success) {
          mediaDeletedCount = 1;
          console.log(
            `[deleteScheduledPostBatch]: Media file successfully deleted: ${mediaPath}`
          );
        } else {
          console.log(
            `[deleteScheduledPostBatch]: Media file not deleted: ${deleteFileResult.message}`
          );
        }
      } catch (fileError) {
        // We continue even if file deletion fails - posts are already deleted
        console.error(
          `[deleteScheduledPostBatch]: Error during file deletion attempt:`,
          fileError instanceof Error ? fileError.message : fileError
        );
      }
    }

    console.log(
      `[deleteScheduledPostBatch]: Media processing complete. ${mediaDeletedCount} media files deleted`
    );

    // Step 7: Return success response with details
    // Get unique platforms for better messaging
    const platforms = [...new Set(posts.map((post) => post.platform))];
    const platformText =
      platforms.length === 1
        ? platforms[0].charAt(0).toUpperCase() + platforms[0].slice(1)
        : "Social media";

    // Create appropriate success message based on the number of posts
    let successMessage = "";
    if (posts.length === 1) {
      successMessage = `Your ${platformText} post has been successfully deleted.`;
    } else {
      // Since we're processing posts from one batch at a time in BatchedPostCard,
      // these will all be from the same batch
      successMessage = `Your batch of ${posts.length} posts has been successfully deleted.`;
    }

    return {
      success: true,
      message: successMessage,
      details: {
        total: postIds.length,
        succeeded: posts.length,
        failed: postIds.length - posts.length,
        mediaDeleted: mediaDeletedCount,
      },
    };
  } catch (err) {
    // Step 8: Handle unexpected errors
    console.error(
      `[deleteScheduledPostBatch]: Unexpected error during post deletion:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while deleting the post. Please try again later.",
    };
  }
}
