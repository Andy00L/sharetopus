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
 * Before deleting, the function double-checks the owners' current
 * subscription status in one query. If a user has resubscribed (active or
 * trialing) but the resume-on-resubscribe webhook handler failed for any
 * reason, we skip the delete and log so the user is not silently
 * penalized. A check that fails is treated the same way: the posts stay
 * until a run can confirm the user has no subscription. The eligible posts
 * go in one DELETE.
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

    const postIdsByPrincipal = groupPostIdsByPrincipal(candidates);
    const principalIds = [...postIdsByPrincipal.keys()];

    // One read for every candidate owner. A user who resubscribed keeps
    // their posts until tomorrow's run: the resume-on-resubscribe handler
    // should have cleared the tag by then.
    const { data: activeSubscriptionRows, error: subscriptionError } =
      await runQuery(
        db
          .selectDistinct({ user_id: stripe_subscriptions.user_id })
          .from(stripe_subscriptions)
          .where(
            and(
              inArray(stripe_subscriptions.user_id, principalIds),
              inArray(stripe_subscriptions.status, ["active", "trialing"]),
            ),
          ),
      );

    // A failed check says nothing about the subscriptions. Reading it as
    // "not subscribed" deleted the posts of users who had resubscribed.
    if (subscriptionError) {
      console.error(
        `[cleanupCancelledPostsAfterGrace] Subscription check failed, keeping ${candidates.length} posts: ${subscriptionError.message}`
      );
      return {
        success: true,
        candidatesFound: candidates.length,
        deleted: 0,
        skippedDueToResubscribe: 0,
        skippedDueToCheckError: candidates.length,
      };
    }

    const resubscribedPrincipals = new Set(
      activeSubscriptionRows.map((subscriptionRow) => subscriptionRow.user_id)
    );
    const deletablePostIds: string[] = [];
    let skipped = 0;
    for (const [principalId, postIds] of postIdsByPrincipal) {
      if (resubscribedPrincipals.has(principalId)) {
        console.log(
          `[cleanupCancelledPostsAfterGrace] Skipping ${postIds.length} posts for ${principalId} (resubscribed)`
        );
        skipped += postIds.length;
        continue;
      }
      deletablePostIds.push(...postIds);
    }

    let deleted = 0;
    if (deletablePostIds.length > 0) {
      // The DELETE repeats the selection criteria so a post resumed or
      // cancelled again since the candidate query is left alone, and
      // RETURNING counts only the rows actually removed.
      const { data: deletedRows, error: deleteErr } = await runQuery(
        db
          .delete(scheduled_posts)
          .where(
            and(
              inArray(scheduled_posts.id, deletablePostIds),
              eq(scheduled_posts.status, "cancelled"),
              lt(scheduled_posts.cancelled_by_sub_at, cutoff),
            ),
          )
          .returning({ id: scheduled_posts.id }),
      );

      if (deleteErr) {
        return {
          success: false,
          message: `[cleanupCancelledPostsAfterGrace] Delete failed: ${deleteErr.message}`,
        };
      }
      deleted = deletedRows.length;
    }
    console.log(
      `[cleanupCancelledPostsAfterGrace] candidates=${candidates.length} deleted=${deleted} skipped=${skipped}`
    );

    return {
      success: true,
      candidatesFound: candidates.length,
      deleted,
      skippedDueToResubscribe: skipped,
      skippedDueToCheckError: 0,
    };
  } catch (err) {
    return {
      success: false,
      message: `[cleanupCancelledPostsAfterGrace] Unexpected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function groupPostIdsByPrincipal(
  candidates: { id: string; principal_id: string }[]
): Map<string, string[]> {
  const postIdsByPrincipal = new Map<string, string[]>();
  for (const candidate of candidates) {
    const postIds = postIdsByPrincipal.get(candidate.principal_id) ?? [];
    postIds.push(candidate.id);
    postIdsByPrincipal.set(candidate.principal_id, postIds);
  }
  return postIdsByPrincipal;
}
