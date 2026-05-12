import { inngest } from "@/inngest/client";
import { cleanupCancelledPostsAfterGrace } from "@/actions/server/data/cleanupCancelledPostsAfterGrace";

/**
 * Daily cron at 05:00 UTC. Runs after sweepStaleOauthClientsCron (04:00)
 * and sweepOrphanStorageFiles (03:00).
 *
 * Deletes scheduled_posts rows that were cancelled by the subscription
 * webhook more than 7 days ago, IF the user has not resubscribed.
 * Orphan media files are picked up by sweepOrphanStorageFiles the
 * following day.
 */
export const cleanupCancelledPostsAfterGraceCron = inngest.createFunction(
  {
    id: "cleanup-cancelled-posts-after-grace",
    name: "Cleanup scheduled posts cancelled by sub expiry past grace period",
    retries: 0,
    triggers: [{ cron: "0 5 * * *" }],
  },
  async ({ step }) => {
    const result = await step.run("cleanup-cancelled", () =>
      cleanupCancelledPostsAfterGrace()
    );

    if (!result.success) {
      console.error(
        `[cleanupCancelledPostsAfterGraceCron] ${result.message}`
      );
      return { ok: false, reason: result.message };
    }

    return {
      ok: true,
      candidatesFound: result.candidatesFound,
      deleted: result.deleted,
      skippedDueToResubscribe: result.skippedDueToResubscribe,
    };
  }
);
