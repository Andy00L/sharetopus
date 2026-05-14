// src/actions/server/scheduleActions/cancelScheduledPostBatchAction.ts

"use server";

import { authCheck } from "@/actions/server/authCheck";
import { generateRequestId } from "@/lib/utils/generateRequestId";
import { cancelScheduledPostBatch } from "./cancelScheduledPostBatch";

/**
 * Browser-facing Server Action. Validates Clerk session, then delegates
 * to the core `cancelScheduledPostBatch` with source="web".
 *
 * Called by: BatchedPostCard (client component)
 */
export async function cancelScheduledPostBatchAction(
  postIds: string[],
  userId: string | null,
) {
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
  return cancelScheduledPostBatch(postIds, userId, "web", requestId);
}
