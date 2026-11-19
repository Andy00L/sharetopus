// src/actions/server/scheduleActions/resume/resumeScheduledPostBatch.ts
import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import type { CreatedVia } from "@/db/schema";
import { checkRateLimit } from "../../rateLimit/checkRateLimit";
import {
  buildResumeSchedule,
  countBumpedRows,
} from "./_shared/bumpPastScheduleToFuture";

/**
 * Resumes cancelled posts back to "scheduled" status.
 *
 * **Authentication:** Does not call Clerk. Caller must validate `principalId`.
 * **Rate limiting:** 30 requests per 60s, scoped per source.
 * **Tables:** `scheduled_posts` (read + update).
 *
 * If a post's scheduled_at is in the past, bumps it to 1 hour from now.
 * Clears cancelled_by_sub_at: a post the user brings back is no longer a
 * subscription cancellation, and a stale tag let the 7-day grace cleanup
 * delete it after a later manual cancel. One UPDATE resumes the batch and
 * repeats the 'cancelled' check, so the counts are the rows it changed.
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
        message: rateCheck.message,
        resetIn: rateCheck.resetIn,
      };
    }

    // Step 2: fetch posts and verify ownership
    const { data: posts, error: fetchError } = await runQuery(
      db
        .select({
          id: scheduled_posts.id,
          principal_id: scheduled_posts.principal_id,
          status: scheduled_posts.status,
        })
        .from(scheduled_posts)
        .where(inArray(scheduled_posts.id, postIds)),
    );

    if (fetchError) {
      console.error(
        `[resumeScheduledPostBatch] [req=${requestId ?? "?"}] Fetch error:`,
        fetchError.message,
      );
      return {
        success: false,
        message: "Could not load your posts. Please try again.",
      };
    }
    if (posts.length === 0) {
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
        message: `No post found for id(s): ${unauthorizedPosts.map((post) => post.id).join(", ")}.`,
      };
    }

    const resumableIds = posts
      .filter((post) => post.status === "cancelled")
      .map((post) => post.id);
    if (resumableIds.length === 0) {
      return {
        success: false,
        message: "No posts are in a resumable (cancelled) state.",
      };
    }

    const resumeSchedule = buildResumeSchedule(new Date());
    const { data: resumedRows, error: updateError } = await runQuery(
      db
        .update(scheduled_posts)
        .set({
          status: "scheduled",
          scheduled_at: resumeSchedule.scheduledAt,
          cancelled_by_sub_at: null,
        })
        .where(
          and(
            inArray(scheduled_posts.id, resumableIds),
            eq(scheduled_posts.principal_id, principalId),
            eq(scheduled_posts.status, "cancelled"),
          ),
        )
        .returning({ scheduled_at: scheduled_posts.scheduled_at }),
    );

    if (updateError) {
      console.error(
        `[resumeScheduledPostBatch] [req=${requestId ?? "?"}] Update error:`,
        updateError.message,
      );
      return { success: false, message: "Database error resuming posts." };
    }
    if (resumedRows.length === 0) {
      return {
        success: false,
        message: "No posts are in a resumable (cancelled) state.",
      };
    }

    const timeUpdated = countBumpedRows(resumedRows, resumeSchedule.bumpedAtIso);

    return {
      success: true,
      message: `Resumed ${resumedRows.length} post(s)${timeUpdated > 0 ? `, ${timeUpdated} rescheduled` : ""}.`,
      details: {
        total: postIds.length,
        succeeded: resumedRows.length,
        failed: postIds.length - resumedRows.length,
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
