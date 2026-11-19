import { inngest } from "@/inngest/client";
import { sweepStuckPendingDirectPosts } from "@/actions/server/data/pendingDirectPosts";

const STUCK_AGE_MS = 10 * 60 * 1000;

export const sweepStuckDirectPosts = inngest.createFunction(
  {
    id: "sweep-stuck-direct-posts",
    name: "Sweep stuck pending_direct_posts",
    retries: 0,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const cutoffIso = new Date(Date.now() - STUCK_AGE_MS).toISOString();
    const result = await step.run("sweep", () =>
      sweepStuckPendingDirectPosts(cutoffIso)
    );
    if (!result.success) {
      console.error(
        "[sweepStuckDirectPosts] Sweep failed:",
        result.message
      );
      return { ok: false, swept: 0 };
    }
    if (result.sweptCount > 0) {
      console.log(
        `[sweepStuckDirectPosts] Swept ${result.sweptCount} stuck rows older than ${cutoffIso}`
      );
    }
    return { ok: true, swept: result.sweptCount };
  }
);
