"use server";

import { authCheck } from "@/actions/server/authCheck";
import { checkRateLimit } from "../rateLimit/checkRateLimit";
import { getScheduledPostsInternal } from "@/actions/server/_internal/scheduleActions/getScheduledPosts";
import type { ScheduledPost } from "@/lib/types/dbTypes";

/**
 * Retrieves all scheduled posts for the authenticated user.
 *
 * Thin wrapper: authenticates the caller, checks rate limits, then
 * delegates to getScheduledPostsInternal.
 *
 * Tables read (via _internal): scheduled_posts, social_accounts (join)
 * Called by: PostsGrid, getScheduledPostsGroupedByBatch
 */
export async function getScheduledPosts(userId: string | null): Promise<{
  success: boolean;
  message: string;
  data?: ScheduledPost[];
  resetIn?: number;
}> {
  const authResult = await authCheck(userId);
  if (!authResult) {
    return {
      success: false,
      message: "Authentication validation failed. Please sign in again.",
    };
  }

  const rateCheck = await checkRateLimit("getScheduledPosts", userId, 60, 60);
  if (!rateCheck.success) {
    return {
      success: false,
      message: "Too many requests. Please try again later.",
      resetIn: rateCheck.resetIn,
    };
  }

  return getScheduledPostsInternal(userId!);
}

/**
 * Groups scheduled posts by their batch ID.
 *
 * Reuses getScheduledPosts() so rate limiting is inherited.
 */
export async function getScheduledPostsGroupedByBatch(
  userId: string | null
): Promise<{
  success: boolean;
  message: string;
  data?: Record<string, ScheduledPost[]>;
  resetIn?: number;
}> {
  const postsResponse = await getScheduledPosts(userId);

  if (!postsResponse.success) {
    return {
      success: false,
      message: postsResponse.message,
      resetIn: postsResponse.resetIn,
    };
  }

  if (!postsResponse.data || postsResponse.data.length === 0) {
    return {
      success: true,
      message: "No scheduled posts found to group.",
      data: {},
    };
  }

  const groupedPosts = postsResponse.data.reduce(
    (acc: Record<string, ScheduledPost[]>, post) => {
      const batchId = post.batch_id || "no-batch";
      if (!acc[batchId]) acc[batchId] = [];
      acc[batchId].push(post);
      return acc;
    },
    {}
  );

  return {
    success: true,
    message: `Grouped posts into ${Object.keys(groupedPosts).length} batches.`,
    data: groupedPosts,
  };
}
