"use server";

import { authCheck } from "@/actions/server/authCheck";
import { authCheckCronJob } from "../authCheckCronJob";
import { checkRateLimit } from "../rateLimit/checkRateLimit";
import { deleteScheduledPostBatchInternal } from "@/actions/server/_internal/scheduleActions/deleteScheduledPostBatch";

/**
 * Batch deletes multiple scheduled posts and their associated media.
 *
 * Thin wrapper: authenticates (Clerk or cron secret), checks rate limits,
 * then delegates to deleteScheduledPostBatchInternal.
 *
 * Tables touched (via _internal): scheduled_posts (read + delete), Storage
 * Called by: BatchedPostCard, process-scheduled-posts cron
 */
export async function deleteScheduledPostBatch(
  postIds: string[],
  userId: string | null,
  cronSecret?: string | undefined
): Promise<{
  success: boolean;
  message: string;
  resetIn?: number;
  details?: {
    total: number;
    succeeded: number;
    failed: number;
    mediaDeleted: number;
  };
}> {
  if (cronSecret) {
    const authResult = await authCheckCronJob(userId, cronSecret);
    if (!authResult) {
      return {
        success: false,
        message: "Cron job authentication failed. Invalid secret key.",
      };
    }
  } else {
    const authResult = await authCheck(userId);
    if (!authResult) {
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }
  }

  if (!userId) {
    return { success: false, message: "Missing user ID." };
  }

  const rateCheck = await checkRateLimit(
    "deleteScheduledPostBatch",
    userId,
    30,
    60,
    cronSecret
  );
  if (!rateCheck.success) {
    return {
      success: false,
      message: rateCheck.message ?? "Too many requests. Please try again later.",
      resetIn: rateCheck.resetIn,
    };
  }

  return deleteScheduledPostBatchInternal(postIds, userId);
}
