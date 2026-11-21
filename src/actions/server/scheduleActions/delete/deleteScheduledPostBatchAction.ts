"use server";

import { authCheck } from "@/actions/server/authCheck";
import { generateRequestId } from "@/lib/utils/generateRequestId";
import { authCheckCronJob } from "../../authCheckCronJob";
import {
  deleteScheduledPostBatch,
  type DeleteScheduledPostBatchResult,
} from "./deleteScheduledPostBatch";

export async function deleteScheduledPostBatchAction(
  postIds: string[],
  userId: string | null,
  cronSecret?: string,
): Promise<DeleteScheduledPostBatchResult> {
  if (cronSecret) {
    const ok = await authCheckCronJob(cronSecret);
    if (!ok) {
      return {
        success: false,
        failure: "unauthenticated",
        message: "Cron job authentication failed. Invalid secret key.",
      };
    }
  } else {
    const ok = await authCheck(userId);
    if (!ok) {
      return {
        success: false,
        failure: "unauthenticated",
        message: "Authentication validation failed. Please sign in again.",
      };
    }
  }

  if (!userId) {
    return {
      success: false,
      failure: "unauthenticated",
      message: "Missing user ID.",
    };
  }

  const requestId = generateRequestId();
  return deleteScheduledPostBatch(postIds, userId, "web", requestId);
}
