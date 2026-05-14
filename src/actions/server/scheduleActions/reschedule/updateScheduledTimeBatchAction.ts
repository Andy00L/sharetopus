"use server";

import { authCheck } from "@/actions/server/authCheck";
import { generateRequestId } from "@/lib/utils/generateRequestId";
import {
  updateScheduledTimeBatch,
  type UpdateScheduledTimeBatchResult,
} from "./updateScheduledTimeBatch";

/**
 * Server Action wrapper for web callers. Authenticates via Clerk,
 * then delegates to the shared core.
 *
 * Called by: BatchedPostCard (client component).
 */
export async function updateScheduledTimeBatchAction(
  postIds: string[],
  newScheduledTime: string | Date,
  userId: string | null,
): Promise<UpdateScheduledTimeBatchResult> {
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

  const requestId = generateRequestId();
  return updateScheduledTimeBatch(postIds, newScheduledTime, userId, "web", requestId);
}
