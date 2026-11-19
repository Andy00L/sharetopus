import { inngest } from "@/inngest/client";
import { cleanupCancelledPostsAfterGrace } from "@/actions/server/data/cleanupCancelledPostsAfterGrace";

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
      skippedDueToCheckError: result.skippedDueToCheckError,
    };
  }
);
