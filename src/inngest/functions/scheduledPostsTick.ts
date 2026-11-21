import { inngest } from "@/inngest/client";
import { planPostDueEvents, POST_DUE_LOOKAHEAD_MS } from "@/inngest/events/postDue";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import { fetchUnclaimedPostsDueBy, settleStuckProcessingPosts } from "./scheduledPostsTickHelpers";

const STUCK_PROCESSING_AGE_MS = 2 * 60 * 60 * 1000;

const STUCK_PROCESSING_MESSAGE = "Publishing stopped without a result; the post may have published";

// Inngest retries a step only when it throws, and a completed step's result
// is stored, so `nowMs` and the event ids stay the same on a retry.
// https://www.inngest.com/docs/learn/how-functions-are-executed
export const scheduledPostsTick = inngest.createFunction(
  {
    id: "scheduled-posts-tick",
    name: "Scheduled posts safety net",
    concurrency: { limit: 1 },
    retries: 2,
    triggers: [{ cron: "0 * * * *" }],
  },
  async ({ step }) => {
    const unclaimed = await step.run("read-unclaimed-posts", async () => {
      const nowMs = Date.now();
      const found = await fetchUnclaimedPostsDueBy({
        dueByIso: new Date(nowMs + POST_DUE_LOOKAHEAD_MS).toISOString(),
        limit: RUNTIME.dispatcherBatchSize,
      });
      if (!found.success) throw new Error(found.message);
      return { nowMs, targets: found.targets };
    });

    const plannedEvents = planPostDueEvents(unclaimed);
    if (plannedEvents.length > 0) {
      await step.sendEvent(
        "send-post-due-events",
        plannedEvents.map((planned) => planned.event),
      );
    }

    const lateEvents = plannedEvents.filter((planned) => planned.timing === "late");
    if (lateEvents.length > 0) {
      console.warn(
        `[scheduledPostsTick] Re-sent ${lateEvents.length} overdue post(s):`,
        lateEvents.map((planned) => planned.event.data.scheduled_post_id).join(", "),
      );
    }

    const settledCount = await step.run("settle-stuck-processing-posts", async () => {
      const settled = await settleStuckProcessingPosts({
        claimedBeforeIso: new Date(Date.now() - STUCK_PROCESSING_AGE_MS).toISOString(),
        limit: RUNTIME.dispatcherBatchSize,
        failureMessage: STUCK_PROCESSING_MESSAGE,
      });
      if (!settled.success) throw new Error(settled.message);
      if (settled.failures.length > 0) {
        const failedPosts = settled.failures
          .map((failure) => `${failure.postId}: ${failure.message}`)
          .join("; ");
        throw new Error(`[scheduledPostsTick] Could not settle stuck post(s): ${failedPosts}`);
      }
      if (settled.settledCount > 0) {
        console.warn(
          `[scheduledPostsTick] Settled ${settled.settledCount} post(s) left in processing with no run`,
        );
      }
      return settled.settledCount;
    });

    return { sent: plannedEvents.length, late: lateEvents.length, settled: settledCount };
  },
);
