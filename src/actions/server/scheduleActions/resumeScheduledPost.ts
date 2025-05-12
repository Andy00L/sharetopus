"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/authCheck";
import { checkRateLimit } from "../reddis/rate-limit";

/**
 * Resumes a previously cancelled post by setting it back to "scheduled" status
 *
 * This function:
 * 1. Verifies user authentication
 * 2. Performs rate limiting to prevent abuse
 * 3. Validates post ownership and eligibility for resuming
 * 4. Updates the post status to "scheduled"
 * 5. Ensures the scheduled time is in the future
 * 6. Returns a structured response with the operation result
 *
 * @param postId - ID of the post to resume
 * @param userId - ID of the authenticated user
 * @returns Object with success status, message, and optional reset time
 */
export async function resumeScheduledPost(
  postId: string,
  userId: string | null
): Promise<{ success: boolean; message: string; resetIn?: number }> {
  try {
    console.log(
      `[resumeScheduledPost]: Starting resume process for post ID: ${postId}`
    );

    // Step 1: Verify user is properly authenticated
    if (!userId) {
      console.error(`[resumeScheduledPost]: Missing user ID in request`);
      return {
        success: false,
        message: "User authentication required. Please sign in to continue.",
      };
    }

    const authResult = await authCheck(userId);
    if (!authResult) {
      console.error(
        `[resumeScheduledPost]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }
    console.log(
      `[resumeScheduledPost]: Authentication validated for user: ${userId}`
    );

    // Step 2: Check rate limits to prevent abuse
    console.log(
      `[resumeScheduledPost]: Checking rate limits for user: ${userId}`
    );
    const rateCheck = await checkRateLimit(
      "resumeScheduledPost", // Unique identifier for this operation
      userId, // User identifier
      30, // Limit (30 requests)
      60 // Window (60 seconds)
    );

    if (!rateCheck.success) {
      console.warn(
        `[resumeScheduledPost]: Rate limit exceeded for user: ${userId}. Reset in: ${
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
      `[resumeScheduledPost]: Rate limit check passed for user: ${userId}`
    );

    // Step 3: Fetch post data to verify ownership and current status
    console.log(
      `[resumeScheduledPost]: Fetching post data for verification: ${postId}`
    );
    const { data: post, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("user_id, status, scheduled_at")
      .eq("id", postId)
      .single();

    if (fetchError || !post) {
      console.error(
        `[resumeScheduledPost]: Failed to find post with ID ${postId}:`,
        fetchError?.message || "Post not found"
      );
      return {
        success: false,
        message: "The post could not be found. It may have been deleted.",
      };
    }

    console.log(
      `[resumeScheduledPost]: Found post data for platform, status: ${post.status}`
    );

    // Step 4: Verify post ownership (security check)
    if (post.user_id !== userId) {
      console.warn(
        `[resumeScheduledPost]: Security violation - User ${userId} attempted to resume post ${postId} owned by ${post.user_id}`
      );
      return {
        success: false,
        message: "You don't have permission to resume this post.",
      };
    }
    console.log(
      `[resumeScheduledPost]: Post ownership verified for user: ${userId}`
    );

    // Step 5: Verify post is in a resumable state
    if (post.status !== "cancelled") {
      console.warn(
        `[resumeScheduledPost]: Cannot resume post in "${post.status}" status: ${postId}`
      );
      return {
        success: false,
        message: `This post cannot be resumed because it is in "${post.status}" status. Only cancelled posts can be resumed.`,
      };
    }

    console.log(
      `[resumeScheduledPost]: Post is eligible for resuming: ${postId}`
    );

    // Step 6: Ensure the scheduled time is in the future
    const scheduledAt = new Date(post.scheduled_at);
    const now = new Date();
    let timeUpdated = false;

    if (scheduledAt <= now) {
      // If the scheduled time is in the past, set it to 1 hour from now
      console.log(
        `[resumeScheduledPost]: Original scheduled time ${scheduledAt.toISOString()} is in the past, rescheduling`
      );
      scheduledAt.setTime(now.getTime() + 60 * 60 * 1000);
      timeUpdated = true;
      console.log(
        `[resumeScheduledPost]: New scheduled time set to ${scheduledAt.toISOString()}`
      );
    }

    // Step 7: Update post status to "scheduled" and update time if needed
    console.log(
      `[resumeScheduledPost]: Updating post status to "scheduled": ${postId}`
    );
    const { error: updateError } = await adminSupabase
      .from("scheduled_posts")
      .update({
        status: "scheduled",
        scheduled_at: scheduledAt.toISOString(),
      })
      .eq("id", postId);

    if (updateError) {
      console.error(
        `[resumeScheduledPost]: Database error updating post status:`,
        updateError.message,
        updateError.details
      );
      return {
        success: false,
        message:
          "Failed to resume the post due to a database error. Please try again.",
      };
    }

    // Step 8: Return success response
    const scheduledTime = scheduledAt.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    });
    console.log(`[resumeScheduledPost]: Successfully resumed post: ${postId}`);

    return {
      success: true,
      message: timeUpdated
        ? `Your  post has been resumed and rescheduled for ${scheduledTime}.`
        : `Your} post has been resumed and will be published at ${scheduledTime}.`,
    };
  } catch (err) {
    // Step 9: Handle unexpected errors
    console.error(
      `[resumeScheduledPost]: Unexpected error during post resumption:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while resuming the post. Please try again later.",
    };
  }
}
