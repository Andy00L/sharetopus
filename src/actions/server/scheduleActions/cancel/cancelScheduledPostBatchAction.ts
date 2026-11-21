"use server";

import { authCheck } from "@/actions/server/authCheck";
import { generateRequestId } from "@/lib/utils/generateRequestId";
import {
  cancelScheduledPostBatch,
  type CancelScheduledPostBatchResult,
} from "./cancelScheduledPostBatch";

export async function cancelScheduledPostBatchAction(
  postIds: string[],
  userId: string | null,
): Promise<CancelScheduledPostBatchResult> {
  if (!userId) {
    return {
      success: false,
      failure: "unauthenticated",
      message: "User authentication required. Please sign in to continue.",
    };
  }

  const authResult = await authCheck(userId);
  if (!authResult) {
    return {
      success: false,
      failure: "unauthenticated",
      message: "Authentication validation failed. Please sign in again.",
    };
  }

  const requestId = generateRequestId();
  return cancelScheduledPostBatch(postIds, userId, "web", requestId);
}
