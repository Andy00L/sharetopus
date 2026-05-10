"use server";

import { authCheck } from "@/actions/server/authCheck";
import { schedulePostInternal } from "@/actions/server/_internal/scheduleActions/schedulePost";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import type { CreatedVia } from "@/lib/types/database.types";

/**
 * Schedules a post for publishing at a specified future time.
 *
 * Thin wrapper: authenticates the caller, then delegates all data work
 * to schedulePostInternal. MCP and other already-authenticated callers
 * should use the internal version directly.
 *
 * Tables touched (via _internal): scheduled_posts, social_accounts
 */
export async function schedulePost(
  data: SchedulePostData,
  userId: string | null,
  createdVia: CreatedVia
): Promise<{
  success: boolean;
  message: string;
  scheduleId?: string;
  resetIn?: number;
}> {
  if (!userId) {
    return { success: false, message: "Authentication required." };
  }

  const authResult = await authCheck(userId);
  if (!authResult) {
    return {
      success: false,
      message: "Authentication validation failed. Please sign in again.",
    };
  }

  return schedulePostInternal(data, userId, createdVia);
}
