import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import {
  buildResumeSchedule,
  countBumpedRows,
} from "@/actions/server/scheduleActions/resume/_shared/bumpPastScheduleToFuture";
import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";

export type ResumeResult =
  | { success: true; resumed: number; bumped: number }
  | { success: false; message: string };

/**
 * Restores all of a user's system-cancelled posts (those tagged with
 * `cancelled_by_sub_at IS NOT NULL`) back to `status='scheduled'` in one
 * UPDATE, so the posts come back together or not at all.
 *
 * Posts whose `scheduled_at` has elapsed during the cancellation period
 * are bumped to `now() + 1 hour` (buildResumeSchedule). The `bumped` count
 * in the result reflects how many were rescheduled vs. kept at their
 * original time.
 *
 * `cancelled_by_sub_at` is cleared on resumption so the row is no longer
 * targeted by the 7-day cleanup cron.
 *
 * Manual user cancellations (`cancelled_by_sub_at IS NULL`) are NEVER
 * touched by this helper.
 *
 * Idempotent: re-running yields zero changes because the WHERE clause
 * requires `cancelled_by_sub_at IS NOT NULL`. A failed UPDATE fails the
 * call, so the Stripe webhook answers 500 and its retry resumes whatever
 * is still tagged.
 */
export async function resumeCancelledPostsOnResubscribe(
  principalId: string,
): Promise<ResumeResult> {
  try {
    const resumeSchedule = buildResumeSchedule(new Date());
    const { data: resumedRows, error: updateErr } = await runQuery(
      db
        .update(scheduled_posts)
        .set({
          status: "scheduled",
          scheduled_at: resumeSchedule.scheduledAt,
          cancelled_by_sub_at: null,
        })
        .where(
          and(
            eq(scheduled_posts.principal_id, principalId),
            eq(scheduled_posts.status, "cancelled"),
            isNotNull(scheduled_posts.cancelled_by_sub_at),
          ),
        )
        .returning({ scheduled_at: scheduled_posts.scheduled_at }),
    );

    if (updateErr) {
      return {
        success: false,
        message: `[resumeCancelledPostsOnResubscribe] Resume failed: ${updateErr.message}`,
      };
    }

    const resumed = resumedRows.length;
    const bumped = countBumpedRows(resumedRows, resumeSchedule.bumpedAtIso);
    if (resumed > 0) {
      console.log(
        `[resumeCancelledPostsOnResubscribe] Resumed ${resumed} posts for ${principalId} (${bumped} bumped to future)`,
      );
    }
    return { success: true, resumed, bumped };
  } catch (err) {
    return {
      success: false,
      message: `[resumeCancelledPostsOnResubscribe] Unexpected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
