import "server-only";

import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { scheduled_posts, stripe_subscriptions } from "@/db/schema";

export type CleanupResult =
  | {
      success: true;
      candidatesFound: number;
      deleted: number;
      skippedDueToResubscribe: number;
      skippedDueToCheckError: number;
    }
  | { success: false; message: string };

const GRACE_DAYS = 7;
const MAX_DELETE_PER_RUN = 2000;

/**
 * Deletes system-cancelled scheduled_posts past the grace period.
 *
 * Selection criteria:
 *   - status = 'cancelled'
 *   - cancelled_by_sub_at IS NOT NULL
 *   - cancelled_by_sub_at < now() - 7 days
 *
 * Before deleting, the function double-checks the user's current
 * subscription status. If the user has resubscribed (active or trialing)
 * but the resume-on-resubscribe webhook handler failed for any reason,
 * we skip the delete and log so the user is not silently penalized. A
 * check that fails is treated the same way: the posts stay until a run
 * can confirm the user has no subscription.
 *
 * Errors-as-values. Designed for Inngest step execution.
 */
export async function cleanupCancelledPostsAfterGrace(): Promise<CleanupResult> {
  try {
    const cutoff = new Date(
      Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: candidates, error: queryErr } = await runQuery(
      db
        .select({
          id: scheduled_posts.id,
          principal_id: scheduled_posts.principal_id,
        })
        .from(scheduled_posts)
        .where(
          and(
            eq(scheduled_posts.status, "cancelled"),
            isNotNull(scheduled_posts.cancelled_by_sub_at),
            lt(scheduled_posts.cancelled_by_sub_at, cutoff),
          ),
        )
        .limit(MAX_DELETE_PER_RUN),
    );

    if (queryErr) {
      return {
        success: false,
        message: `[cleanupCancelledPostsAfterGrace] Candidate query failed: ${queryErr.message}`,
      };
    }

    if (candidates.length === 0) {
      return {
        success: true,
        candidatesFound: 0,
        deleted: 0,
        skippedDueToResubscribe: 0,
        skippedDueToCheckError: 0,
      };
    }

    // Group by principal_id to minimize subscription lookups
    const byPrincipal = new Map<string, string[]>();
    for (const row of candidates) {
      const list = byPrincipal.get(row.principal_id) ?? [];
      list.push(row.id);
      byPrincipal.set(row.principal_id, list);
    }

    let deleted = 0;
    let skipped = 0;
    let skippedDueToCheckError = 0;

    for (const [principalId, postIds] of byPrincipal) {
      // Re-check subscription. If user resubscribed, skip and let
      // tomorrow's run re-evaluate (the resume-on-resubscribe handler
      // should have cleared the cancellation tag by then).
      const { data: subscriptionRows, error: subscriptionError } =
        await runQuery(
          db
            .select({ status: stripe_subscriptions.status })
            .from(stripe_subscriptions)
            .where(
              and(
                eq(stripe_subscriptions.user_id, principalId),
                inArray(stripe_subscriptions.status, ["active", "trialing"]),
              ),
            )
            .limit(1),
        );

      // A failed check says nothing about the subscription. Reading it as
      // "not subscribed" deleted the posts of users who had resubscribed.
      if (subscriptionError) {
        console.error(
          `[cleanupCancelledPostsAfterGrace] Subscription check failed for ${principalId}, keeping ${postIds.length} posts: ${subscriptionError.message}`
        );
        skippedDueToCheckError += postIds.length;
        continue;
      }

      const activeSubscription = subscriptionRows[0];
      if (activeSubscription) {
        console.log(
          `[cleanupCancelledPostsAfterGrace] Skipping ${postIds.length} posts for ${principalId} (resubscribed, status=${activeSubscription.status})`
        );
        skipped += postIds.length;
        continue;
      }

      // The DELETE repeats the selection criteria so a post resumed or
      // cancelled again since the candidate query is left alone, and
      // RETURNING counts only the rows actually removed.
      const { data: deletedRows, error: deleteErr } = await runQuery(
        db
          .delete(scheduled_posts)
          .where(
            and(
              inArray(scheduled_posts.id, postIds),
              eq(scheduled_posts.status, "cancelled"),
              lt(scheduled_posts.cancelled_by_sub_at, cutoff),
            ),
          )
          .returning({ id: scheduled_posts.id }),
      );

      if (deleteErr) {
        console.error(
          `[cleanupCancelledPostsAfterGrace] Delete failed for ${principalId}: ${deleteErr.message}`
        );
        continue;
      }
      deleted += deletedRows.length;
    }

    console.log(
      `[cleanupCancelledPostsAfterGrace] candidates=${candidates.length} deleted=${deleted} skipped=${skipped} skippedDueToCheckError=${skippedDueToCheckError}`
    );

    return {
      success: true,
      candidatesFound: candidates.length,
      deleted,
      skippedDueToResubscribe: skipped,
      skippedDueToCheckError,
    };
  } catch (err) {
    return {
      success: false,
      message: `[cleanupCancelledPostsAfterGrace] Unexpected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
