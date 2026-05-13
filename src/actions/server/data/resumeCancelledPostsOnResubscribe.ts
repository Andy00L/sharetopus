import { adminSupabase } from "@/actions/api/adminSupabase";
import { bumpPastScheduleToFuture } from "@/actions/server/scheduleActions/resume/_shared/bumpPastScheduleToFuture";
import "server-only";

export type ResumeResult =
  | { success: true; resumed: number; bumped: number }
  | { success: false; message: string };

/**
 * Restores all of a user's system-cancelled posts (those tagged with
 * `cancelled_by_sub_at IS NOT NULL`) back to `status='scheduled'`.
 *
 * Posts whose `scheduled_at` has elapsed during the cancellation period
 * are bumped to `now() + 1 hour` via bumpPastScheduleToFuture. The
 * `bumped` count in the result reflects how many were rescheduled vs.
 * kept at their original time.
 *
 * `cancelled_by_sub_at` is cleared on resumption so the row is no longer
 * targeted by the 7-day cleanup cron.
 *
 * Manual user cancellations (`cancelled_by_sub_at IS NULL`) are NEVER
 * touched by this helper.
 *
 * Idempotent: re-running yields zero changes because the WHERE clause
 * requires `cancelled_by_sub_at IS NOT NULL`.
 */
export async function resumeCancelledPostsOnResubscribe(
  principalId: string,
): Promise<ResumeResult> {
  try {
    const { data: candidates, error: fetchErr } = await adminSupabase
      .from("scheduled_posts")
      .select("id, scheduled_at")
      .eq("principal_id", principalId)
      .eq("status", "cancelled")
      .not("cancelled_by_sub_at", "is", null);

    if (fetchErr) {
      return {
        success: false,
        message: `[resumeCancelledPostsOnResubscribe] Fetch failed: ${fetchErr.message}`,
      };
    }

    if (!candidates || candidates.length === 0) {
      return { success: true, resumed: 0, bumped: 0 };
    }

    let bumped = 0;
    let resumed = 0;

    for (const row of candidates) {
      const original = new Date(row.scheduled_at);
      const newTime = bumpPastScheduleToFuture(original);
      const wasBumped = newTime.getTime() !== original.getTime();

      const { error: updateErr } = await adminSupabase
        .from("scheduled_posts")
        .update({
          status: "scheduled",
          scheduled_at: newTime.toISOString(),
          cancelled_by_sub_at: null,
        })
        .eq("id", row.id);

      if (updateErr) {
        console.error(
          `[resumeCancelledPostsOnResubscribe] Failed to resume ${row.id}: ${updateErr.message}`,
        );
        continue;
      }
      resumed += 1;
      if (wasBumped) bumped += 1;
    }

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
