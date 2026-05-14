// src/actions/server/scheduleActions/resume/resumeScheduledPostBatch.ts
import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { CreatedVia } from "@/lib/types/database.types";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";
import { bumpPastScheduleToFuture } from "./_shared/bumpPastScheduleToFuture";

/**
 * Resumes cancelled posts back to "scheduled" status.
 *
 * **Authentication:** Does not call Clerk. Caller must validate `principalId`.
 * **Rate limiting:** 30 requests per 60s, scoped per source.
 * **Tables:** `scheduled_posts` (read + update).
 *
 * If a post's scheduled_at is in the past, bumps it to 1 hour from now.
 */
export async function resumeScheduledPostBatch(
  postIds: string[],
  principalId: string,
  source: CreatedVia,
  requestId?: string | null,
): Promise<{
  success: boolean;
  message: string;
  resetIn?: number;
  details?: {
    total: number;
    succeeded: number;
    failed: number;
    timeUpdated: number;
  };
}> {
  console.log(
    `[resumeScheduledPostBatch] [req=${requestId ?? "?"}] Starting from source="${source}" for principal=${principalId}, ${postIds?.length ?? 0} post(s) requested`,
  );

  try {
    if (!postIds || postIds.length === 0) {
      return { success: false, message: "No post IDs provided." };
    }

    // Step 1: rate limit
    const rateLimitScope = `${source}_resume_scheduled_posts`;
    const rateCheck = await checkRateLimit(rateLimitScope, principalId, 30, 60);
    if (!rateCheck.success) {
      return {
        success: false,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }

    // Step 2: fetch posts and verify ownership
    const { data: posts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select("id, principal_id, status, scheduled_at, platform")
      .in("id", postIds);

    if (fetchError || !posts || posts.length === 0) {
      return { success: false, message: "No posts found." };
    }

    const unauthorizedPosts = posts.filter(
      (post) => post.principal_id !== principalId,
    );
    if (unauthorizedPosts.length > 0) {
      console.warn(
        `[resumeScheduledPostBatch] [req=${requestId ?? "?"}] Ownership violation: ${principalId} tried to resume ${unauthorizedPosts.length} post(s) they don't own`,
      );
      return {
        success: false,
        message: "You do not own some of these posts.",
      };
    }

    // Step 3: split resumable posts by past/future scheduled_at
    const resumablePosts = posts.filter((post) => post.status === "cancelled");
    if (resumablePosts.length === 0) {
      return {
        success: false,
        message: "No posts are in a resumable (cancelled) state.",
      };
    }

    const pastIds: string[] = [];
    const futureIds: string[] = [];
    let timeUpdated = 0;

    for (const post of resumablePosts) {
      const originalDate = new Date(post.scheduled_at);
      const bumpedDate = bumpPastScheduleToFuture(originalDate);
      if (bumpedDate.getTime() !== originalDate.getTime()) {
        pastIds.push(post.id);
        timeUpdated++;
      } else {
        futureIds.push(post.id);
      }
    }

    // Step 4: update DB. Past-scheduled posts get a new time; future ones just flip status.
    let allUpdatesOk = true;

    if (pastIds.length > 0) {
      const newScheduledAt = bumpPastScheduleToFuture(new Date(0));
      const { error: updatePastError } = await adminSupabase
        .from("scheduled_posts")
        .update({
          status: "scheduled",
          scheduled_at: newScheduledAt.toISOString(),
        })
        .in("id", pastIds);
      if (updatePastError) {
        console.error(
          `[resumeScheduledPostBatch] [req=${requestId ?? "?"}] Past update error:`,
          updatePastError.message,
        );
        allUpdatesOk = false;
      }
    }

    if (futureIds.length > 0) {
      const { error: updateFutureError } = await adminSupabase
        .from("scheduled_posts")
        .update({ status: "scheduled" })
        .in("id", futureIds);
      if (updateFutureError) {
        console.error(
          `[resumeScheduledPostBatch] [req=${requestId ?? "?"}] Future update error:`,
          updateFutureError.message,
        );
        allUpdatesOk = false;
      }
    }

    if (!allUpdatesOk) {
      return { success: false, message: "Database error resuming posts." };
    }

    return {
      success: true,
      message: `Resumed ${resumablePosts.length} post(s)${timeUpdated > 0 ? `, ${timeUpdated} rescheduled` : ""}.`,
      details: {
        total: postIds.length,
        succeeded: resumablePosts.length,
        failed: postIds.length - resumablePosts.length,
        timeUpdated,
      },
    };
  } catch (err) {
    console.error(
      `[resumeScheduledPostBatch] [req=${requestId ?? "?"}] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return { success: false, message: "Unexpected error resuming posts." };
  }
}
