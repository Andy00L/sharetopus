import { inngest } from "@/inngest/client";
import { cleanupCancelledPostsAfterGrace } from "@/actions/server/data/cleanupCancelledPostsAfterGrace";

export const cleanupCancelledPostsAfterGraceCron = inngest.createFunction(
  {
    id: "cleanup-cancelled-posts-after-grace",
    name: "Cleanup scheduled posts cancelled by sub expiry past grace period",
    retries: 2,
    triggers: [{ cron: "0 5 * * *" }],
  },
  async ({ step }) => {
    const result = await step.run("cleanup-cancelled", async () => {
      const stepResult = await cleanupCancelledPostsAfterGrace();
      // Inngest marks a step failed, and retries it, only when it throws:
      // https://www.inngest.com/docs/guides/error-handling
      if (!stepResult.success) throw new Error(`[cleanupCancelledPostsAfterGraceCron] ${stepResult.message}`);
      return stepResult;
    });

    return {
      ok: true,
      candidatesFound: result.candidatesFound,
      deleted: result.deleted,
      skippedDueToResubscribe: result.skippedDueToResubscribe,
      skippedDueToCheckError: result.skippedDueToCheckError,
    };
  }
);
