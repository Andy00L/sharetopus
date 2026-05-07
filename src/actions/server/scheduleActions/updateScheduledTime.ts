"use server";

import { authCheck } from "@/actions/server/authCheck";
import { checkRateLimit } from "../rateLimit/checkRateLimit";
import { updateScheduledTimeBatchInternal } from "@/actions/server/_internal/scheduleActions/updateScheduledTimeBatch";

/**
 * Updates the scheduled time for multiple posts at once.
 *
 * Thin wrapper: authenticates the caller, checks rate limits, then
 * delegates to updateScheduledTimeBatchInternal.
 *
 * Tables touched (via _internal): scheduled_posts (read + update)
 * Called by: BatchedPostCard
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

  const rateCheck = await checkRateLimit(
    "updateScheduledTimeBatch",
    userId,
    30,
    60
  );
  if (!rateCheck.success) {
    return {
      success: false,
      message: "Too many requests. Please try again later.",
      resetIn: rateCheck.resetIn,
    };
  }

  return updateScheduledTimeBatchInternal(postIds, newScheduledTime, userId);
}
