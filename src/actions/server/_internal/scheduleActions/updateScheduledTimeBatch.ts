import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * Updates the scheduled time for posts without authCheck. Principal already verified.
 *
 * Mirrors src/actions/server/scheduleActions/updateScheduledTime.ts.
 * Cancelled posts get resumed (status -> scheduled) in addition to time update.
 *
 * Tables touched: scheduled_posts (read + update)
 * Called by: src/lib/mcp/tools/reschedulePosts.ts
 */
export async function updateScheduledTimeBatchInternal(
  postIds: string[],
  newScheduledTime: string | Date,
  principalId: string
): Promise<{
  success: boolean;
  message: string;
  details?: { total: number; succeeded: number; failed: number; resumedCount: number };
}> {
  try {
    if (!postIds || postIds.length === 0) {
      return { success: false, message: "No post IDs provided." };
    }

    const scheduledTime = new Date(newScheduledTime);
    if (isNaN(scheduledTime.getTime())) {
      return { success: false, message: "Invalid date format." };
    }
    if (scheduledTime <= new Date()) {
      return { success: false, message: "Scheduled time must be in the future." };
    }

    const { data: posts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("id, principal_id, status, platform")
      .in("id", postIds);

    if (fetchError || !posts || posts.length === 0) {
      return { success: false, message: "No posts found." };
    }

    const unauthorized = posts.filter((p) => p.principal_id !== principalId);
    if (unauthorized.length > 0) {
      return { success: false, message: "You do not own some of these posts." };
    }

    const reschedulable = posts.filter(
      (p) => p.status === "scheduled" || p.status === "cancelled"
    );
    if (reschedulable.length === 0) {
      return { success: false, message: "No posts in a reschedulable state." };
    }

    const scheduledIds = reschedulable.filter((p) => p.status === "scheduled").map((p) => p.id);
    const cancelledIds = reschedulable.filter((p) => p.status === "cancelled").map((p) => p.id);

    let ok = true;
    if (scheduledIds.length > 0) {
      const { error } = await adminSupabase
        .from("scheduled_posts")
        .update({ scheduled_at: scheduledTime.toISOString() })
        .in("id", scheduledIds);
      if (error) ok = false;
    }
    if (cancelledIds.length > 0) {
      const { error } = await adminSupabase
        .from("scheduled_posts")
        .update({ scheduled_at: scheduledTime.toISOString(), status: "scheduled" })
        .in("id", cancelledIds);
      if (error) ok = false;
    }

    if (!ok) {
      return { success: false, message: "Database error rescheduling posts." };
    }

    const formattedDate = scheduledTime.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    });

    return {
      success: true,
      message: `Rescheduled ${reschedulable.length} post(s) to ${formattedDate}.`,
      details: {
        total: postIds.length,
        succeeded: reschedulable.length,
        failed: postIds.length - reschedulable.length,
        resumedCount: cancelledIds.length,
      },
    };
  } catch (err) {
    console.error(
      `[updateScheduledTimeBatchInternal] Error:`,
      err instanceof Error ? err.message : err
    );
    return { success: false, message: "Unexpected error rescheduling posts." };
  }
}
