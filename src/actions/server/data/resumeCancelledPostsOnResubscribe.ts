import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import {
  buildResumeSchedule,
  countBumpedRows,
} from "@/actions/server/scheduleActions/resume/_shared/bumpPastScheduleToFuture";
import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";
import {
  POST_DUE_TARGET_COLUMNS,
  sendPostDueEvents,
} from "@/inngest/dispatch/sendPostDueEvents";

export type ResumeResult =
  | { success: true; resumed: number; bumped: number }
  | { success: false; message: string };

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
        .returning(POST_DUE_TARGET_COLUMNS),
    );

    if (updateErr) {
      return {
        success: false,
        message: `[resumeCancelledPostsOnResubscribe] Resume failed: ${updateErr.message}`,
      };
    }

    await sendPostDueEvents(resumedRows);

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
