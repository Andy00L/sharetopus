import { inngest } from "@/inngest/client";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import {
  fetchDueScheduledPosts,
  markPostsAsQueued,
} from "./scheduledPostsTickHelpers";

/**
 * Runs once per minute on Inngest's cron infrastructure.
 * Replaces the Supabase Edge Function process-scheduled-posts AND
 * /api/cron/process-scheduled-posts. Vercel cron is not used
 * (Hobby plan has a 1 invocation/day cap).
 */
export const scheduledPostsTick = inngest.createFunction(
  {
    id: "scheduled-posts-tick",
    name: "Scheduled posts dispatcher",
    concurrency: { limit: 1 },
    retries: 0,
    triggers: [{ cron: "* * * * *" }],
  },
  async ({ step }) => {
    const due = await step.run("fetch-due-posts", () =>
      fetchDueScheduledPosts(
        new Date().toISOString(),
        RUNTIME.dispatcherBatchSize
      )
    );

    if (!due.success) {
      return { enqueued: 0, marked: 0, message: due.message };
    }
    if (due.posts.length === 0) {
      return { enqueued: 0, marked: 0, message: "no due posts" };
    }

    // Inngest dedupes events with identical id within 24h. The id
    // includes scheduled_at so a manual reschedule (status flipped
    // back from failed to scheduled with a new scheduled_at) gets
    // a fresh event id.
    const events = due.posts.map((post) => ({
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

    const marked = await step.run("mark-queued", () =>
      markPostsAsQueued(due.posts.map((p) => p.id))
    );

    return {
      enqueued: events.length,
      marked: marked.updated,
      message: `Dispatched ${events.length}, marked ${marked.updated} queued`,
    };
  }
);
