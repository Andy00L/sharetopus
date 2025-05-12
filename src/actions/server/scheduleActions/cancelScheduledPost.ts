"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/authCheck";
import { checkRateLimit } from "../reddis/rate-limit";

/**
 * Cancels a scheduled post that hasn't been published yet
 *
 * This function:
 * 1. Verifies user authentication
 * 2. Performs rate limiting to prevent abuse
 * 3. Validates post ownership and eligibility for cancellation
 * 4. Updates the post status to "cancelled" in the database
 * 5. Returns a structured response with the operation result
 *
 * @param postId - ID of the scheduled post to cancel
 * @param userId - ID of the authenticated user attempting the cancellation
 * @returns Object with success status, message, and optional reset time
 */
export async function cancelScheduledPost(
  postId: string,
  userId: string | null
): Promise<{ success: boolean; message: string; resetIn?: number }> {
  try {
    console.log(
      `[cancelScheduledPost]: Starting cancellation process for post ID: ${postId}`
    );

    // Step 1: Verify user is properly authenticated
    if (!userId) {
      console.error(`[cancelScheduledPost]: Missing user ID in request`);
      return {
        success: false,
        message: "User authentication required. Please sign in to continue.",
      };
    }
    const authResult = await authCheck(userId);
    if (!authResult) {
      console.error(
        `[cancelScheduledPost]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }
    console.log(
      `[cancelScheduledPost]: Authentication validated for user: ${userId}`
    );
    // Step 2: Check rate limits to prevent abuse
    console.log(
      `[cancelScheduledPost]: Checking rate limits for user: ${userId}`
    );
    const rateCheck = await checkRateLimit(
      "cancelScheduledPost", // Unique identifier for this operation
      userId, // User identifier
      30, // Limit (30 requests)
      60 // Window (60 seconds)
    );

    if (!rateCheck.success) {
      console.warn(
        `[cancelScheduledPost]: Rate limit exceeded for user: ${userId}. Reset in: ${
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
      `[cancelScheduledPost]: Rate limit check passed for user: ${userId}`
    );

    // Step 3: Retrieve the post to verify ownership and status
    console.log(
      `[cancelScheduledPost]: Fetching post data to verify ownership: ${postId}`
    );
    const { data: post, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("user_id, media_storage_path, status")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      console.error(
        `[cancelScheduledPost]: Failed to find post with ID ${postId}:`,
        fetchError?.message || "Post not found"
      );
      return {
        success: false,
        message:
          "The scheduled post could not be found. It may have been already deleted.",
      };
    }

    // Step 4: Verify post ownership (security check)
    if (post.user_id !== userId) {
      console.warn(
        `[cancelScheduledPost]: Security violation - User ${userId} attempted to cancel post ${postId} owned by ${post.user_id}`
      );
      return {
        success: false,
        message: "You don't have permission to cancel this post.",
      };
    }
    console.log(
      `[cancelScheduledPost]: Post ownership verified for user: ${userId}`
    );

    // Step 5: Check if post is in a cancellable state
    if (post.status !== "scheduled") {
      console.warn(
        `[cancelScheduledPost]: Cannot cancel post in "${post.status}" status: ${postId}`
      );
      return {
        success: false,
        message: `This post cannot be cancelled because it is already in "${post.status}" status.`,
      };
    }
    console.log(
      `[cancelScheduledPost]: Post is eligible for cancellation: ${postId}`
    );

    // Step 6: Update post status to "cancelled"
    console.log(
      `[cancelScheduledPost]: Updating post status to "cancelled": ${postId}`
    );
    const { error: updateError } = await adminSupabase
      .from("scheduled_posts")
      .update({ status: "cancelled" })
      .eq("id", postId);

    if (updateError) {
      console.error(
        `[cancelScheduledPost]: Database error updating post status:`,
        updateError.message,
        updateError.details
      );
      return {
        success: false,
        message:
          "Failed to cancel the post due to a database error. Please try again.",
      };
    }

    // Step 7: Return success response
    console.log(
      `[cancelScheduledPost]: Successfully cancelled post: ${postId}`
    );
    return {
      success: true,
      message: `Your post has been successfully cancelled.`,
    };
  } catch (err) {
    // Step 8: Handle unexpected errors
    console.error(
      `[cancelScheduledPost]: Unexpected error cancelling post:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while cancelling the post. Please try again later.",
    };
  }
}
