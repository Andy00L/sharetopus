import { inngest } from "@/inngest/client";
import { sweepStuckPendingDirectPosts } from "@/actions/server/data/pendingDirectPosts";

const STUCK_AGE_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Sweeps pending_direct_posts rows stuck in 'processing' for >10 minutes.
 *
 * Why: the direct-post worker UPDATEs its row to 'completed'/'failed' at
 * terminal. If the worker crashes (OOM, Vercel timeout, Inngest aborts),
 * the row stays at 'processing' and blocks file cleanup forever.
 *
 * 10-minute cutoff: a single direct-post run today completes in <30s
 * (worst case TikTok poll up to ~3 minutes for terminal). 10 minutes
 * is conservative and well past any legitimate run time.
 *
 * Idempotent: rows already terminal are not touched (sweepStuckPendingDirectPosts
 * filters by status='processing').
 */
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
