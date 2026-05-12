import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";

export type CleanupResult =
  | {
      success: true;
      candidatesFound: number;
      deleted: number;
      skippedDueToResubscribe: number;
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
 * we skip the delete and log so the user is not silently penalized.
 *
 * Errors-as-values. Designed for Inngest step execution.
 */
export async function cleanupCancelledPostsAfterGrace(): Promise<CleanupResult> {
  try {
    const cutoff = new Date(
      Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: candidates, error: queryErr } = await adminSupabase
      .from("scheduled_posts")
      .select("id, principal_id")
      .eq("status", "cancelled")
      .not("cancelled_by_sub_at", "is", null)
      .lt("cancelled_by_sub_at", cutoff)
      .limit(MAX_DELETE_PER_RUN);

    if (queryErr) {
      return {
        success: false,
        message: `[cleanupCancelledPostsAfterGrace] Candidate query failed: ${queryErr.message}`,
      };
    }

    if (!candidates || candidates.length === 0) {
      return {
        success: true,
        candidatesFound: 0,
        deleted: 0,
        skippedDueToResubscribe: 0,
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

    for (const [principalId, postIds] of byPrincipal) {
      // Re-check subscription. If user resubscribed, skip and let
      // tomorrow's run re-evaluate (the resume-on-resubscribe handler
      // should have cleared the cancellation tag by then).
      const { data: sub } = await adminSupabase
        .from("stripe_subscriptions")
        .select("status")
        .eq("user_id", principalId)
        .in("status", ["active", "trialing"])
        .limit(1)
        .maybeSingle();

      if (sub) {
        console.log(
          `[cleanupCancelledPostsAfterGrace] Skipping ${postIds.length} posts for ${principalId} (resubscribed, status=${sub.status})`
        );
        skipped += postIds.length;
        continue;
      }

      const { error: deleteErr } = await adminSupabase
        .from("scheduled_posts")
        .delete()
        .in("id", postIds);

      if (deleteErr) {
        console.error(
          `[cleanupCancelledPostsAfterGrace] Delete failed for ${principalId}: ${deleteErr.message}`
        );
        continue;
      }
      deleted += postIds.length;
    }

    console.log(
      `[cleanupCancelledPostsAfterGrace] candidates=${candidates.length} deleted=${deleted} skipped=${skipped}`
    );

    return {
      success: true,
      candidatesFound: candidates.length,
      deleted,
      skippedDueToResubscribe: skipped,
    };
  } catch (err) {
    return {
      success: false,
      message: `[cleanupCancelledPostsAfterGrace] Unexpected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
