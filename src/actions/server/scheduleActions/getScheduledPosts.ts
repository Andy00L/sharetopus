// Updated getScheduledPosts.ts
import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { authCheck } from "@/actions/authCheck";
import { ScheduledPost } from "@/lib/types/dbTypes";
import { checkRateLimit } from "../reddis/rate-limit";

/**
 * Retrieves all scheduled posts for the authenticated user
 *
 * This function:
 * 1. Verifies user authentication
 * 2. Performs rate limiting to prevent abuse
 * 3. Fetches scheduled posts with their associated social account details
 * 4. Returns a structured response with the posts data or error information
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
    console.log(
      `[getScheduledPosts]: Starting scheduled posts retrieval for user: ${userId}`
    );

    // Step 1: Verify user is authenticated
    if (!userId) {
      console.error(`[getScheduledPosts]: Missing user ID in request`);
      return {
        success: false,
        message: "User ID is required. Please sign in to continue.",
      };
    }
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
    console.log(
      `[getScheduledPosts]: Authentication validated for user: ${userId}`
    );
    // Step 2: Check rate limits to prevent abuse
    console.log(
      `[getScheduledPosts]: Checking rate limits for user: ${userId}`
    );
    const rateCheck = await checkRateLimit(
      "getScheduledPosts", // Unique identifier for this operation
      userId, // User identifier
      60, // Limit (60 requests)
      60 // Window (60 seconds)
    );

    if (!rateCheck.success) {
      console.warn(
        `[getScheduledPosts]: Rate limit exceeded for user: ${userId}. Reset in: ${
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
      `[getScheduledPosts]: Rate limit check passed for user: ${userId}`
    );

    // Step 3: Fetch scheduled posts with social account details
    console.log(`[getScheduledPosts]: Querying database for scheduled posts`);
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
    // Step 5: Return successful response with data
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
 * This function:
 * 1. Retrieves all scheduled posts for the user
 * 2. Organizes them into groups based on their batch ID
 * 3. Returns the grouped data in a structured response
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
    console.log(
      `[getScheduledPostsGroupedByBatch]: Starting batch grouping for user: ${userId}`
    );

    // Step 1: Get all scheduled posts using the primary function
    const postsResponse = await getScheduledPosts(userId);

    // Step 2: Handle errors or rate limiting from the posts retrieval
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

    // If no posts found, return early with empty object
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

    // Step 3: Group posts by batch_id
    console.log(
      `[getScheduledPostsGroupedByBatch]: Grouping ${postsResponse.data.length} posts by batch ID`
    );
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

    // Step 4: Calculate batch statistics for logging
    const batchCount = Object.keys(groupedPosts).length;
    console.log(
      `[getScheduledPostsGroupedByBatch]: Successfully grouped posts into ${batchCount} batches`
    );

    // Step 5: Return successful response with grouped data
    return {
      success: true,
      message: `Successfully grouped posts into ${batchCount} batches.`,
      data: groupedPosts,
    };
  } catch (err) {
    // Step 6: Handle unexpected errors
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
