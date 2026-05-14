"use server";

import { authCheck } from "@/actions/server/authCheck";
import { generateRequestId } from "@/lib/utils/generateRequestId";
import {
  directPostBatch,
  type DirectPostBatchResult,
  type DirectPostData,
} from "./directPostBatch";

/**
 * Server Action wrapper for web callers. Authenticates via Clerk,
 * then delegates to the shared core.
 */
export async function directPostBatchAction(
  posts: DirectPostData[],
  userId: string | null,
  batchId?: string,
): Promise<DirectPostBatchResult> {
  if (!userId) {
    return {
      success: false,
      message: "User authentication required. Please sign in to continue.",
      batchId: batchId ?? "",
      details: { total: 0, dispatched: 0, duplicates: 0, rejected: [] },
      eventIds: [],
    };
  }

  const authResult = await authCheck(userId);
  if (!authResult) {
    return {
      success: false,
      message: "Authentication validation failed. Please sign in again.",
      batchId: batchId ?? "",
      details: { total: 0, dispatched: 0, duplicates: 0, rejected: [] },
      eventIds: [],
    };
  }

  const requestId = generateRequestId();
  return directPostBatch(posts, userId, "web", batchId, requestId);
}
