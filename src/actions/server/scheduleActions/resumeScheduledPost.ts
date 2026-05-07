"use server";

import { authCheck } from "@/actions/server/authCheck";
import { checkRateLimit } from "../rateLimit/checkRateLimit";
import { resumeScheduledPostBatchInternal } from "@/actions/server/_internal/scheduleActions/resumeScheduledPostBatch";

/**
 * Resumes multiple cancelled posts at once.
 *
 * Thin wrapper: authenticates the caller, checks rate limits, then
 * delegates to resumeScheduledPostBatchInternal.
 *
 * Tables touched (via _internal): scheduled_posts (read + update)
 * Called by: BatchedPostCard
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
    "resumeScheduledPostBatch",
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

  return resumeScheduledPostBatchInternal(postIds, userId);
}
