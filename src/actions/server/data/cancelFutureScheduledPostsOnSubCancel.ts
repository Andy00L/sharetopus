import "server-only";

import { and, eq, gt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts } from "@/db/schema";

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

    const { data: cancelledRows, error } = await runQuery(
      db
        .update(scheduled_posts)
        .set({
          status: "cancelled",
          cancelled_by_sub_at: nowIso,
        })
        .where(
          and(
            eq(scheduled_posts.principal_id, principalId),
            eq(scheduled_posts.status, "scheduled"),
            gt(scheduled_posts.scheduled_at, nowIso),
          ),
        )
        .returning({ id: scheduled_posts.id }),
    );

    if (error) {
      return {
        success: false,
        message: `[cancelFutureScheduledPostsOnSubCancel] ${error.message}`,
      };
    }

    const count = cancelledRows.length;
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
