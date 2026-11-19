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
