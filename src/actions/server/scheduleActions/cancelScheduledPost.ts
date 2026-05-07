"use server";

import { authCheck } from "@/actions/server/authCheck";
import { checkRateLimit } from "../rateLimit/checkRateLimit";
import { cancelScheduledPostBatchInternal } from "@/actions/server/_internal/scheduleActions/cancelScheduledPostBatch";

/**
 * Cancels multiple scheduled posts at once.
 *
 * Thin wrapper: authenticates the caller, checks rate limits, then
 * delegates to cancelScheduledPostBatchInternal.
 *
 * Tables touched (via _internal): scheduled_posts (read + update)
 * Called by: BatchedPostCard
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
  if (!userId) {
    return {
      success: false,
      message: "User authentication required. Please sign in to continue.",
    };
  }

  const authResult = await authCheck(userId);
  if (!authResult) {
    return {
      success: false,
      message: "Authentication validation failed. Please sign in again.",
    };
  }

  const rateCheck = await checkRateLimit("cancelScheduledPost", userId, 30, 60);
  if (!rateCheck.success) {
    return {
      success: false,
      message: "Too many requests. Please try again later.",
      resetIn: rateCheck.resetIn,
    };
  }

  return cancelScheduledPostBatchInternal(postIds, userId);
}
