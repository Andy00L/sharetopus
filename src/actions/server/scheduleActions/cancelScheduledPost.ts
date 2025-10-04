"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/server/authCheck";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * Cancels multiple scheduled posts at once
 *
 * This function:
 * 1. Performs a single authentication and rate limit check
 * 2. Validates and updates multiple posts in a batch operation
 * 3. Returns aggregate results of the operation
 *
 * @param postIds - Array of post IDs to cancel
 * @param userId - ID of the authenticated user attempting the cancellation
 * @returns Object with success status, message, and details about the operation
 */
export async function cancelScheduledPostBatch(
  postIds: string[],
  userId: string | null
): Promise<{
  success: boolean;
  message: string;
  resetIn?: number;
  details?: {
    total: number;
    succeeded: number;
    failed: number;
  };
}> {
  try {
    // Early validation: Check if postIds array is empty
    if (!postIds || postIds.length === 0) {
      console.error(
        `[cancelScheduledPostBatch]: No post IDs provided for cancellation`
      );
      return {
        success: false,
        message: "No posts specified for cancellation.",
        details: {
          total: 0,
          succeeded: 0,
          failed: 0,
        },
      };
    }
    console.log(
      `[cancelScheduledPostBatch]: Starting batch cancellation for ${postIds.length} posts`
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
      `[cancelScheduledPostBatch]: Fetching data for ${postIds.length} posts`
    );

    const { data: posts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("id,user_id, status, platform")
      .in("id", postIds);

    if (fetchError) {
      console.error(
        `[cancelScheduledPostBatch]: Database error fetching posts:`,
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
        `[cancelScheduledPostBatch]: No posts found with the provided IDs`
      );
      return {
        success: false,
        message: "No posts found to cancel. They may have been deleted.",
      };
    }

    if (posts.length !== postIds.length) {
      console.warn(
        `[cancelScheduledPostBatch]: Not all requested posts were found. Found ${posts.length} of ${postIds.length}`
      );
    }

    // Step 4: Verify post ownership and eligibility for cancellation
    console.log(
      `[cancelScheduledPostBatch]: Verifying post ownership and eligibility`
    );
    // Check if all posts belong to the user
    const unauthorizedPosts = posts.filter((post) => post.user_id !== userId);
    if (unauthorizedPosts.length > 0) {
      console.warn(
        `[cancelScheduledPostBatch]: Security violation - User ${userId} attempted to cancel ${unauthorizedPosts.length} posts owned by others`
      );
      return {
        success: false,
        message:
          "You don't have permission to cancel some or all of these posts.",
      };
    }
    // Filter posts to only those in "scheduled" status that can be cancelled
    const cancellablePosts = posts.filter(
      (post) => post.status === "scheduled"
    );

    if (cancellablePosts.length === 0) {
      console.warn(
        `[cancelScheduledPostBatch]: No posts are in a cancellable state`
      );
      return {
        success: false,
        message:
          "None of the selected posts can be cancelled. They may already be cancelled, processed, or posted.",
      };
    }

    if (cancellablePosts.length !== posts.length) {
      console.warn(
        `[cancelScheduledPostBatch]: Not all posts can be cancelled. Only ${cancellablePosts.length} of ${posts.length} are eligible`
      );
    }
    console.log(
      `[cancelScheduledPostBatch]: ${cancellablePosts.length} posts verified and eligible for cancellation`
    );

    // Step 5: Update all eligible posts to "cancelled" in a single operation
    const postIdsToCancel = cancellablePosts.map((post) => post.id);
    console.log(
      `[cancelScheduledPostBatch]: Cancelling ${postIdsToCancel.length} posts`
    );
    const { error: updateError } = await adminSupabase
      .from("scheduled_posts")
      .update({ status: "cancelled" })
      .in("id", postIdsToCancel);

    if (updateError) {
      console.error(
        `[cancelScheduledPostBatch]: Database error cancelling posts:`,
        updateError.message,
        updateError.details
      );
      return {
        success: false,
        message: "Failed to cancel posts due to a database error.",
        details: {
          total: postIds.length,
          succeeded: 0,
          failed: cancellablePosts.length,
        },
      };
    }
    // Step 6: Return success response with details
    console.log(
      `[cancelScheduledPostBatch]: Successfully cancelled ${cancellablePosts.length} posts`
    );

    // Get unique platforms for better messaging
    const platforms = [
      ...new Set(cancellablePosts.map((post) => post.platform)),
    ];
    const platformText =
      platforms.length === 1
        ? platforms[0].charAt(0).toUpperCase() + platforms[0].slice(1)
        : "Social media";

    // Create appropriate success message based on the number of posts
    const successMessage =
      cancellablePosts.length === 1
        ? `Your ${platformText} post has been successfully cancelled.`
        : `${cancellablePosts.length} posts have been successfully cancelled.`;

    return {
      success: true,
      message: successMessage,
      details: {
        total: postIds.length,
        succeeded: cancellablePosts.length,
        failed: postIds.length - cancellablePosts.length,
      },
    };
  } catch (err) {
    // Step 7: Handle unexpected errors
    console.error(
      `[cancelScheduledPostBatch]: Unexpected error during batch cancellation:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while cancelling the posts. Please try again later.",
    };
  }
}
