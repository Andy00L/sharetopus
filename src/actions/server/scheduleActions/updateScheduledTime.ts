"use server";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/authCheck";
import { checkRateLimit } from "../reddis/rate-limit";

/**
 * Updates the scheduled time for multiple posts at once
 *
 * This function:
 * 1. Performs a single authentication and rate limit check
 * 2. Validates and updates multiple posts in a batch operation
 * 3. Returns aggregate results of the operation
 *
 * @param postIds - Array of post IDs to update
 * @param newScheduledTime - New scheduled time for all posts
 * @param userId - ID of the authenticated user
 * @returns Object with success status, message, and details about the operation
 */
export async function updateScheduledTimeBatch(
  postIds: string[],
  newScheduledTime: string | Date,
  userId: string | null
): Promise<{
  success: boolean;
  message: string;
  resetIn?: number;
  details?: {
    total: number;
    succeeded: number;
    failed: number;
    resumedCount: number;
  };
}> {
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
        resumedCount: 0,
      },
    };
  }
  try {
    console.log(
      `[updateScheduledTimeBatch]: Starting batch rescheduling for ${postIds.length} posts`
    );

    // Step 1: Perform authentication and rate limit check once for the entire batch
    if (!userId) {
      console.error(`[updateScheduledTimeBatch]: Missing user ID in request`);
      return {
        success: false,
        message: "User authentication required. Please sign in to continue.",
      };
    }

    const authResult = await authCheck(userId);
    if (!authResult) {
      console.error(
        `[updateScheduledTimeBatch]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }
    console.log(
      `[updateScheduledTimeBatch]: Authentication validated for user: ${userId}`
    );

    // Step 2: Check rate limits to prevent abuse
    console.log(
      `[updateScheduledTimeBatch]: Checking rate limits for user: ${userId}`
    );
    const rateCheck = await checkRateLimit(
      "updateScheduledTimeBatch", // Unique identifier for this operation
      userId, // User identifier
      30, // Limit (30 requests)
      60 // Window (60 seconds)
    );

    if (!rateCheck.success) {
      console.warn(
        `[updateScheduledTimeBatch]: Rate limit exceeded for user: ${userId}. Reset in: ${
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
      `[updateScheduledTimeBatch]: Rate limit check passed for user: ${userId}`
    );

    // Step 3: Validate new scheduled time is in the future
    const scheduledTime = new Date(newScheduledTime);
    const now = new Date();

    if (isNaN(scheduledTime.getTime())) {
      console.error(
        `[updateScheduledTimeBatch]: Invalid date format provided: ${newScheduledTime}`
      );
      return {
        success: false,
        message:
          "The provided date format is invalid. Please use a valid date format.",
      };
    }

    if (scheduledTime <= now) {
      console.error(
        `[updateScheduledTimeBatch]: Attempted to schedule in the past: ${scheduledTime.toISOString()}`
      );
      return {
        success: false,
        message:
          "Scheduled time must be in the future. Please select a future date and time.",
      };
    }
    console.log(
      `[updateScheduledTimeBatch]: New scheduled time validated: ${scheduledTime.toISOString()}`
    );

    // Step 4: Fetch post data to verify ownership and status
    console.log(
      `[updateScheduledTimeBatch]: Fetching post data for verification`
    );

    const { data: posts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("id, user_id, status, platform")
      .in("id", postIds);

    if (fetchError) {
      console.error(
        `[updateScheduledTimeBatch]: Database error fetching posts:`,
        fetchError.message,
        fetchError.details
      );
      return {
        success: false,
        message: "Failed to retrieve post information. Please try again.",
      };
    }
    // Check if we found all the requested posts
    if (!posts || posts.length === 0) {
      console.error(
        `[updateScheduledTimeBatch]: No posts found with the provided IDs`
      );
      return {
        success: false,
        message: "No posts found to reschedule. They may have been deleted.",
      };
    }

    if (posts.length !== postIds.length) {
      console.warn(
        `[updateScheduledTimeBatch]: Not all requested posts were found. Found ${posts.length} of ${postIds.length}`
      );
    }
    // Step 5: Verify post ownership (security check) and eligibility
    console.log(
      `[updateScheduledTimeBatch]: Verifying post ownership and eligibility`
    );

    // Check if all posts belong to the user
    const unauthorizedPosts = posts.filter((post) => post.user_id !== userId);
    if (unauthorizedPosts.length > 0) {
      console.warn(
        `[updateScheduledTimeBatch]: Security violation - User ${userId} attempted to update ${unauthorizedPosts.length} posts owned by others`
      );
      return {
        success: false,
        message:
          "You don't have permission to reschedule some or all of these posts.",
      };
    }
    console.log(
      `[updateScheduledTimeBatch]: Post ownership verified for user: ${userId}`
    );

    // Filter posts to only those in a reschedulable state (scheduled or cancelled)
    const reschedulablePosts = posts.filter(
      (post) => post.status === "scheduled" || post.status === "cancelled"
    );

    if (reschedulablePosts.length === 0) {
      console.warn(
        `[updateScheduledTimeBatch]: No posts are in a reschedulable state`
      );
      return {
        success: false,
        message:
          "None of the selected posts can be rescheduled due to their current status.",
      };
    }

    if (reschedulablePosts.length !== posts.length) {
      console.warn(
        `[updateScheduledTimeBatch]: Not all posts can be rescheduled. Only ${reschedulablePosts.length} of ${posts.length} are eligible`
      );
    }

    console.log(
      `[updateScheduledTimeBatch]: ${reschedulablePosts.length} posts verified and eligible for rescheduling`
    );

    // Step 6: Split posts by current status for efficient batch updates
    const scheduledPostIds = reschedulablePosts
      .filter((post) => post.status === "scheduled")
      .map((post) => post.id);

    const cancelledPostIds = reschedulablePosts
      .filter((post) => post.status === "cancelled")
      .map((post) => post.id);

    // Count how many posts will be resumed
    const resumedCount = cancelledPostIds.length;

    console.log(
      `[updateScheduledTimeBatch]: Processing ${scheduledPostIds.length} scheduled posts and ${cancelledPostIds.length} cancelled posts`
    );

    // Step 7: Update posts in two batches based on status
    let updateSuccessful = true;

    // Update scheduled posts (only time changes)
    if (scheduledPostIds.length > 0) {
      const { error: scheduledUpdateError } = await adminSupabase
        .from("scheduled_posts")
        .update({
          scheduled_at: scheduledTime.toISOString(),
        })
        .in("id", scheduledPostIds);

      if (scheduledUpdateError) {
        console.error(
          `[updateScheduledTimeBatch]: Error updating scheduled posts:`,
          scheduledUpdateError.message,
          scheduledUpdateError.details
        );
        updateSuccessful = false;
      }
    }

    // Update cancelled posts (change status to scheduled and update time)
    if (cancelledPostIds.length > 0) {
      const { error: cancelledUpdateError } = await adminSupabase
        .from("scheduled_posts")
        .update({
          scheduled_at: scheduledTime.toISOString(),
          status: "scheduled",
        })
        .in("id", cancelledPostIds);

      if (cancelledUpdateError) {
        console.error(
          `[updateScheduledTimeBatch]: Error updating cancelled posts:`,
          cancelledUpdateError.message,
          cancelledUpdateError.details
        );
        updateSuccessful = false;
      }
    }

    if (!updateSuccessful) {
      return {
        success: false,
        message: "Failed to update some or all posts due to a database error.",
        details: {
          total: postIds.length,
          succeeded: 0,
          failed: reschedulablePosts.length,
          resumedCount: 0,
        },
      };
    }

    // Step 8: Return success response
    const formattedDate = scheduledTime.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    });
    // Get unique platforms for better messaging
    const platforms = [
      ...new Set(reschedulablePosts.map((post) => post.platform)),
    ];
    const platformText =
      platforms.length === 1
        ? platforms[0].charAt(0).toUpperCase() + platforms[0].slice(1)
        : "Social media";
    console.log(
      `[updateScheduledTimeBatch]: Successfully rescheduled ${reschedulablePosts.length} posts`
    );

    const successMessage =
      reschedulablePosts.length === 1
        ? resumedCount === 1
          ? `Your ${platformText} post has been resumed and rescheduled for ${formattedDate}.`
          : `Your ${platformText} post has been rescheduled for ${formattedDate}.`
        : resumedCount > 0
        ? `${reschedulablePosts.length} posts have been rescheduled for ${formattedDate}, including ${resumedCount} that were resumed.`
        : `${reschedulablePosts.length} posts have been rescheduled for ${formattedDate}.`;

    return {
      success: true,
      message: successMessage,
      details: {
        total: postIds.length,
        succeeded: reschedulablePosts.length,
        failed: postIds.length - reschedulablePosts.length,
        resumedCount: resumedCount,
      },
    };
  } catch (err) {
    // Step 9: Handle unexpected errors
    console.error(
      `[updateScheduledTimeBatch]: Unexpected error during rescheduling:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while rescheduling your post. Please try again later.",
    };
  }
}
