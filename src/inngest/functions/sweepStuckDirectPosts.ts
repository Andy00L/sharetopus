import { inngest } from "@/inngest/client";
import { sweepStuckPendingDirectPosts } from "@/actions/server/data/pendingDirectPosts";

const STUCK_AGE_MS = 60 * 60 * 1000;

export const sweepStuckDirectPosts = inngest.createFunction(
  {
    id: "sweep-stuck-direct-posts",
    name: "Sweep stuck pending_direct_posts",
    retries: 2,
    triggers: [{ cron: "15 * * * *" }],
  },
  async ({ step }) =>
    step.run("sweep", async () => {
      const cutoffIso = new Date(Date.now() - STUCK_AGE_MS).toISOString();
      const result = await sweepStuckPendingDirectPosts(cutoffIso);
      // Inngest marks a run failed and retries it only when the step throws:
      // https://www.inngest.com/docs/guides/error-handling
      if (!result.success) throw new Error(`sweep-failure: ${result.message}`);
      if (result.sweptCount > 0) {
        console.log(
          `[sweepStuckDirectPosts] Swept ${result.sweptCount} stuck rows older than ${cutoffIso}`
        );
      }
      return { swept: result.sweptCount, cutoffIso };
    })
);
