"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/server/authCheck";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * Resumes multiple cancelled posts at once
 *
 * This function:
 * 1. Performs a single authentication and rate limit check
 * 2. Validates and updates multiple posts in a batch operation
 * 3. Returns aggregate results of the operation
 *
 * @param postIds - Array of post IDs to resume
 * @param userId - ID of the authenticated user
 * @returns Object with success status, message, and details about the operation
 */
export async function resumeScheduledPostBatch(
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
    timeUpdated: number;
  };
}> {
  try {
    // Early validation: Check if postIds array is empty
    if (!postIds || postIds.length === 0) {
      console.error(
        `[resumeScheduledPostBatch]: No post IDs provided for resumption`
      );
      return {
        success: false,
        message: "No posts specified to resume.",
        details: {
          total: 0,
          succeeded: 0,
          failed: 0,
          timeUpdated: 0,
        },
      };
    }

    console.log(
      `[resumeScheduledPostBatch]: Starting batch resumption for ${postIds.length} posts`
    );

    // Step 1: Verify user is properly authenticated
    if (!userId) {
      console.error(`[resumeScheduledPostBatch]: Missing user ID in request`);
      return {
        success: false,
        message: "User authentication required. Please sign in to continue.",
      };
    }

    const authResult = await authCheck(userId);
    if (!authResult) {
      console.error(
        `[resumeScheduledPostBatch]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }
    console.log(
      `[resumeScheduledPostBatch]: Authentication validated for user: ${userId}`
    );

    // Step 2: Check rate limits to prevent abuse
    console.log(
      `[resumeScheduledPostBatch]: Checking rate limits for user: ${userId}`
    );
    const rateCheck = await checkRateLimit(
      "resumeScheduledPostBatch", // Unique identifier for this operation
      userId, // User identifier
      30, // Limit (30 requests)
      60 // Window (60 seconds)
    );

    if (!rateCheck.success) {
      console.warn(
        `[resumeScheduledPostBatch]: Rate limit exceeded for user: ${userId}. Reset in: ${
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
      `[resumeScheduledPostBatch]: Rate limit check passed for user: ${userId}`
    );

    // Step 3: Fetch post data to verify ownership and current status
    console.log(
      `[resumeScheduledPostBatch]: Fetching data for ${postIds.length} posts`
    );

    const { data: posts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("id, user_id, status, scheduled_at, platform")
      .in("id", postIds);
    if (fetchError) {
      console.error(
        `[resumeScheduledPostBatch]: Database error fetching posts:`,
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
        `[resumeScheduledPostBatch]: No posts found with the provided IDs`
      );
      return {
        success: false,
        message: "No posts found to resume. They may have been deleted.",
      };
    }

    if (posts.length !== postIds.length) {
      console.warn(
        `[resumeScheduledPostBatch]: Not all requested posts were found. Found ${posts.length} of ${postIds.length}`
      );
    }

    // Step 4: Verify post ownership and eligibility for resumption
    console.log(
      `[resumeScheduledPostBatch]: Verifying post ownership and eligibility`
    );

    // Check if all posts belong to the user
    const unauthorizedPosts = posts.filter((post) => post.user_id !== userId);
    if (unauthorizedPosts.length > 0) {
      console.warn(
        `[resumeScheduledPostBatch]: Security violation - User ${userId} attempted to resume ${unauthorizedPosts.length} posts owned by others`
      );
      return {
        success: false,
        message:
          "You don't have permission to resume some or all of these posts.",
      };
    }

    // Filter posts to only those in "cancelled" status that can be resumed
    const resumablePosts = posts.filter((post) => post.status === "cancelled");

    if (resumablePosts.length === 0) {
      console.warn(
        `[resumeScheduledPostBatch]: No posts are in a resumable state`
      );
      return {
        success: false,
        message:
          "None of the selected posts can be resumed. They may not be in cancelled status.",
      };
    }

    if (resumablePosts.length !== posts.length) {
      console.warn(
        `[resumeScheduledPostBatch]: Not all posts can be resumed. Only ${resumablePosts.length} of ${posts.length} are eligible`
      );
    }

    console.log(
      `[resumeScheduledPostBatch]: ${resumablePosts.length} posts verified and eligible for resumption`
    );

    // Step 5: Check which posts have dates in the past that need to be updated
    const now = new Date();
    let timeUpdatedCount = 0;

    // Group posts into two categories: those that need date updates and those that don't
    const postsNeedingTimeUpdate = [];
    const postsWithFutureDates = [];

    for (const post of resumablePosts) {
      const scheduledAt = new Date(post.scheduled_at);
      if (scheduledAt <= now) {
        postsNeedingTimeUpdate.push(post.id);
        timeUpdatedCount++;
      } else {
        postsWithFutureDates.push(post.id);
      }
    }

    console.log(
      `[resumeScheduledPostBatch]: ${timeUpdatedCount} posts need time updates, ${postsWithFutureDates.length} have future dates`
    );

    // Step 6: Update posts in two batches based on whether they need time updates
    let updateSuccessful = true;

    // First batch: Update posts that need new scheduled times (1 hour from now)
    if (postsNeedingTimeUpdate.length > 0) {
      const newTime = new Date(now.getTime() + 60 * 60 * 1000);
      console.log(
        `[resumeScheduledPostBatch]: Updating status and time to ${newTime.toISOString()} for ${
          postsNeedingTimeUpdate.length
        } posts`
      );

      const { error: pastUpdateError } = await adminSupabase
        .from("scheduled_posts")
        .update({
          status: "scheduled",
          scheduled_at: newTime.toISOString(),
        })
        .in("id", postsNeedingTimeUpdate);

      if (pastUpdateError) {
        console.error(
          `[resumeScheduledPostBatch]: Error updating posts with past dates:`,
          pastUpdateError.message,
          pastUpdateError.details
        );
        updateSuccessful = false;
      }
    }

    // Second batch: Update posts that already have future scheduled times
    if (postsWithFutureDates.length > 0) {
      console.log(
        `[resumeScheduledPostBatch]: Updating only status for ${postsWithFutureDates.length} posts with future dates`
      );

      const { error: futureUpdateError } = await adminSupabase
        .from("scheduled_posts")
        .update({
          status: "scheduled",
        })
        .in("id", postsWithFutureDates);

      if (futureUpdateError) {
        console.error(
          `[resumeScheduledPostBatch]: Error updating posts with future dates:`,
          futureUpdateError.message,
          futureUpdateError.details
        );
        updateSuccessful = false;
      }
    }

    if (!updateSuccessful) {
      return {
        success: false,
        message: "Failed to resume some or all posts due to a database error.",
        details: {
          total: postIds.length,
          succeeded: 0,
          failed: resumablePosts.length,
          timeUpdated: 0,
        },
      };
    }
    // Step 7: Return success response with details
    console.log(
      `[resumeScheduledPostBatch]: Successfully resumed ${resumablePosts.length} posts`
    );

    // Get unique platforms for better messaging
    const platforms = [...new Set(resumablePosts.map((post) => post.platform))];
    const platformText =
      platforms.length === 1
        ? platforms[0].charAt(0).toUpperCase() + platforms[0].slice(1)
        : "Social media";

    // Create appropriate success message based on the number of posts
    const successMessage =
      resumablePosts.length === 1
        ? `Your ${platformText} post has been successfully resumed${
            timeUpdatedCount > 0 ? " and rescheduled" : ""
          }.`
        : `${resumablePosts.length} posts have been successfully resumed${
            timeUpdatedCount > 0
              ? ", including " + timeUpdatedCount + " that were rescheduled"
              : ""
          }.`;

    return {
      success: true,
      message: successMessage,
      details: {
        total: postIds.length,
        succeeded: resumablePosts.length,
        failed: postIds.length - resumablePosts.length,
        timeUpdated: timeUpdatedCount,
      },
    };
  } catch (err) {
    // Step 8: Handle unexpected errors
    console.error(
      `[resumeScheduledPostBatch]: Unexpected error during batch resumption:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while resuming the posts. Please try again later.",
    };
  }
}
