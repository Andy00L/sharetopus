// src/actions/server/scheduleActions/delete/deleteScheduledPostBatchAction.ts
"use server";

import { authCheck } from "@/actions/server/authCheck";
import { authCheckCronJob } from "../../authCheckCronJob";
import { deleteScheduledPostBatch } from "./deleteScheduledPostBatch";

/**
 * Browser/cron-facing Server Action. Validates Clerk session OR cron secret,
 * then delegates to the core `deleteScheduledPostBatch` with source="web".
 *
 * Called by: BatchedPostCard (client component), cleanup cron job
 */
export async function deleteScheduledPostBatchAction(
  postIds: string[],
  userId: string | null,
  cronSecret?: string,
) {
  if (cronSecret) {
    const ok = await authCheckCronJob(userId, cronSecret);
    if (!ok) {
      return {
        success: false,
        message: "Cron job authentication failed. Invalid secret key.",
      };
    }
  } else {
    const ok = await authCheck(userId);
    if (!ok) {
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }
  }

  if (!userId) {
    return { success: false, message: "Missing user ID." };
  }

  return deleteScheduledPostBatch(postIds, userId, "web");
}
