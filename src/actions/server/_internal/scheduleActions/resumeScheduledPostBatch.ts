import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { bumpPastScheduleToFuture } from "./_shared/bumpPastScheduleToFuture";

/**
 * Resumes cancelled posts without authCheck. Principal already verified.
 *
 * If a post's scheduled_at is in the past, bumps it to 1 hour from now.
 * Mirrors src/actions/server/scheduleActions/resumeScheduledPost.ts
 *
 * Tables touched: scheduled_posts (read + update)
 * Called by: src/lib/mcp/tools/resumeScheduledPosts.ts
 */
export async function resumeScheduledPostBatchInternal(
  postIds: string[],
  principalId: string
): Promise<{
  success: boolean;
  message: string;
  details?: { total: number; succeeded: number; failed: number; timeUpdated: number };
}> {
  try {
    if (!postIds || postIds.length === 0) {
      return { success: false, message: "No post IDs provided." };
    }

    const { data: posts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("id, principal_id, status, scheduled_at, platform")
      .in("id", postIds);

    if (fetchError || !posts || posts.length === 0) {
      return { success: false, message: "No posts found." };
    }

    const unauthorized = posts.filter((p) => p.principal_id !== principalId);
    if (unauthorized.length > 0) {
      return { success: false, message: "You do not own some of these posts." };
    }

    const resumable = posts.filter((p) => p.status === "cancelled");
    if (resumable.length === 0) {
      return { success: false, message: "No posts are in a resumable (cancelled) state." };
    }

    const pastIds: string[] = [];
    const futureIds: string[] = [];
    let timeUpdated = 0;

    for (const post of resumable) {
      const original = new Date(post.scheduled_at);
      const bumped = bumpPastScheduleToFuture(original);
      if (bumped.getTime() !== original.getTime()) {
        pastIds.push(post.id);
        timeUpdated++;
      } else {
        futureIds.push(post.id);
      }
    }

    let ok = true;
    if (pastIds.length > 0) {
      const newTime = bumpPastScheduleToFuture(new Date(0));
      const { error } = await adminSupabase
        .from("scheduled_posts")
        .update({ status: "scheduled", scheduled_at: newTime.toISOString() })
        .in("id", pastIds);
      if (error) ok = false;
    }
    if (futureIds.length > 0) {
      const { error } = await adminSupabase
        .from("scheduled_posts")
        .update({ status: "scheduled" })
        .in("id", futureIds);
      if (error) ok = false;
    }

    if (!ok) {
      return { success: false, message: "Database error resuming posts." };
    }

    return {
      success: true,
      message: `Resumed ${resumable.length} post(s)${timeUpdated > 0 ? `, ${timeUpdated} rescheduled` : ""}.`,
      details: {
        total: postIds.length,
        succeeded: resumable.length,
        failed: postIds.length - resumable.length,
        timeUpdated,
      },
    };
  } catch (err) {
    console.error(
      `[resumeScheduledPostBatchInternal] Error:`,
      err instanceof Error ? err.message : err
    );
    return { success: false, message: "Unexpected error resuming posts." };
  }
}
