// src/actions/server/scheduleActions/resume/resumeScheduledPostBatchAction.ts
"use server";

import { authCheck } from "@/actions/server/authCheck";
import { resumeScheduledPostBatch } from "./resumeScheduledPostBatch";

/**
 * Browser-facing Server Action. Validates Clerk session, then delegates
 * to the core `resumeScheduledPostBatch` with source="web".
 *
 * Called by: BatchedPostCard (client component)
 */
export async function resumeScheduledPostBatchAction(
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

  return resumeScheduledPostBatch(postIds, userId, "web");
}
