// Updated getScheduledPosts.ts
import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/server/authCheck";
import { ScheduledPost } from "@/lib/types/dbTypes";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * Retrieves all scheduled posts for the authenticated user
 *
 * @param userId - ID of the user whose scheduled posts to retrieve
 * @returns Structured response with success status, message, and optional post data
 */
export async function getScheduledPosts(userId: string | null): Promise<{
  success: boolean;
  message: string;
  data?: ScheduledPost[];
  resetIn?: number;
}> {
  try {
    //Verify authentication
    const authResult = await authCheck(userId);

    if (!authResult) {
      console.error(
        `[getScheduledPosts]: Authentication check failed for user ID: ${userId}`
      );
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }

    // Check rate limits
    const rateCheck = await checkRateLimit("getScheduledPosts", userId, 60, 60);

    if (!rateCheck.success) {
      console.warn(
        `[getScheduledPosts]: Rate limit exceeded for user: ${userId}, reset in: ${rateCheck.resetIn}s`
      );
      return {
        success: false,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }

    // Fetch scheduled posts with social account details
    const { data, error } = await adminSupabase
      .from("scheduled_posts")
      .select(
        `
        id,
        scheduled_at,
        status,
        platform,
        post_title,
        post_description,
        error_message,
        media_type,
        media_storage_path,
        batch_id,
        social_accounts:social_account_id (
          id,
          display_name,
          avatar_url
        )
      `
      )
      .eq("user_id", userId)
      .order("scheduled_at", { ascending: true });

    // Step 4: Handle database errors
    if (error) {
      console.error(
        `[getScheduledPosts]: Database error fetching scheduled posts:`,
        error.message,
        error.details
      );
      return {
        success: false,
        message:
          "Failed to retrieve your scheduled posts. Please try again later.",
      };
    }

    const postsCount = data?.length || 0;
    console.log(
      `[getScheduledPosts]: Successfully retrieved ${postsCount} scheduled posts for user: ${userId}`
    );
    return {
      success: true,
      message:
        postsCount > 0
          ? `Successfully retrieved ${postsCount} scheduled posts.`
          : "No scheduled posts found.",
      data: data || [],
    };
  } catch (err) {
    // Step 6: Handle unexpected errors
    console.error(
      `[getScheduledPosts]: Unexpected error fetching scheduled posts:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred. Please try again or contact support.",
    };
  }
}

/**
 * Groups scheduled posts by their batch ID
 *
 * Note: This function reuses getScheduledPosts(), so rate limiting is inherited.
 * If you need independent rate limiting, add it here separately.
 *
 * @param userId - ID of the user whose scheduled posts to group
 * @returns Structured response with success status, message, and optional grouped data
 */
export async function getScheduledPostsGroupedByBatch(
  userId: string | null
): Promise<{
  success: boolean;
  message: string;
  data?: Record<string, ScheduledPost[]>;
  resetIn?: number;
}> {
  try {
    // Retrieve all scheduled posts
    const postsResponse = await getScheduledPosts(userId);

    if (!postsResponse.success) {
      console.log(
        `[getScheduledPostsGroupedByBatch]: Failed to retrieve posts: ${postsResponse.message}`
      );
      return {
        success: false,
        message: postsResponse.message,
        resetIn: postsResponse.resetIn,
      };
    }

    if (!postsResponse.data || postsResponse.data.length === 0) {
      console.log(
        `[getScheduledPostsGroupedByBatch]: No posts found to group for user: ${userId}`
      );
      return {
        success: true,
        message: "No scheduled posts found to group.",
        data: {},
      };
    }

    // Group posts by batch_id
    const groupedPosts = postsResponse.data.reduce(
      (acc: Record<string, ScheduledPost[]>, post) => {
        const batchId = post.batch_id || "no-batch";
        if (!acc[batchId]) {
          acc[batchId] = [];
        }
        acc[batchId].push(post);
        return acc;
      },
      {}
    );

    const batchCount = Object.keys(groupedPosts).length;
    console.log(
      `[getScheduledPostsGroupedByBatch] Grouped into ${batchCount} batches for user: ${userId}`
    );

    // Step 5: Return successful response with grouped data
    return {
      success: true,
      message: `Successfully grouped posts into ${batchCount} batches.`,
      data: groupedPosts,
    };
  } catch (err) {
    // Catch any unexpected errors not handled above
    console.error(
      `[getScheduledPostsGroupedByBatch]: Unexpected error grouping posts:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while grouping your posts. Please try again later.",
    };
  }
}
