import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";

export type CancelResult =
  | { success: true; cancelled: number }
  | { success: false; message: string };

/**
 * Cancels all of a user's scheduled posts whose scheduled_at is in the
 * future. Tags each cancelled row with `cancelled_by_sub_at = now()` so
 * the resume-on-resubscribe and 7-day cleanup paths can distinguish
 * system cancellations from manual user cancellations.
 *
 * Idempotent: re-running for the same user produces zero additional
 * cancellations because the WHERE clause requires status='scheduled'.
 *
 * Called from the Stripe webhook handler on customer.subscription.deleted
 * after the active sub status flip.
 */
export async function cancelFutureScheduledPostsOnSubCancel(
  principalId: string
): Promise<CancelResult> {
  try {
    const nowIso = new Date().toISOString();

    const { data, error } = await adminSupabase
      .from("scheduled_posts")
      .update({
        status: "cancelled",
        cancelled_by_sub_at: nowIso,
      })
      .eq("principal_id", principalId)
      .eq("status", "scheduled")
      .gt("scheduled_at", nowIso)
      .select("id");

    if (error) {
      return {
        success: false,
        message: `[cancelFutureScheduledPostsOnSubCancel] ${error.message}`,
      };
    }

    const count = data?.length ?? 0;
    if (count > 0) {
      console.log(
        `[cancelFutureScheduledPostsOnSubCancel] Cancelled ${count} future posts for ${principalId}`
      );
    }
    return { success: true, cancelled: count };
  } catch (err) {
    return {
      success: false,
      message: `[cancelFutureScheduledPostsOnSubCancel] Unexpected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
