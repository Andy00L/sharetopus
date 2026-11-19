import { inngest } from "@/inngest/client";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import {
  fetchDueScheduledPosts,
  markPostsAsQueued,
} from "./scheduledPostsTickHelpers";

/**
 * Dispatches due scheduled posts every 5 minutes on Inngest's cron. Every
 * step is safe to repeat (a read, a send deduplicated by event id, a
 * CAS-guarded update), so each throws on failure and Inngest retries it.
 */
export const scheduledPostsTick = inngest.createFunction(
  {
    id: "scheduled-posts-tick",
    name: "Scheduled posts dispatcher",
    concurrency: { limit: 1 },
    retries: 2,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const duePosts = await step.run("read-due-posts", async () => {
      const due = await fetchDueScheduledPosts(
        new Date().toISOString(),
        RUNTIME.dispatcherBatchSize,
      );
      if (!due.success) throw new Error(due.message);
      return due.posts;
    });

    if (duePosts.length === 0) {
      return { enqueued: 0, marked: 0, message: "no due posts" };
    }

    // Inngest dedupes events with an identical id within 24h. The id
    // includes scheduled_at so a rescheduled post gets a fresh event.
    const events = duePosts.map((post) => ({
      name: "post.due" as const,
      id: `post.due-${post.id}-${post.scheduled_at}`,
      data: {
        scheduled_post_id: post.id,
        principal_id: post.principal_id,
        social_account_id: post.social_account_id,
        platform: post.platform,
        scheduled_at: post.scheduled_at,
      },
    }));

    await step.sendEvent("dispatch-due-posts", events);

    const marked = await step.run("mark-queued", async () => {
      const markResult = await markPostsAsQueued(duePosts);
      if (!markResult.success) throw new Error(markResult.message);
      return markResult;
    });

    return {
      enqueued: events.length,
      marked: marked.updated,
      message: `Dispatched ${events.length}, marked ${marked.updated} queued`,
    };
  },
);
