import { inngest } from "@/inngest/client";
import { platformHotlinksMedia } from "@/lib/platforms/capabilities";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import {
  callDirectPostFromEvent,
  postNowEvent,
  type DirectPostResult,
} from "./processDirectPostHelpers";
import { cleanupMediaIfUnreferenced } from "./processSinglePostHelpers";
import { fetchAccountForPublish } from "@/actions/server/data/fetchAccountForPublish";
import { finalizePendingDirectPost } from "@/actions/server/data/pendingDirectPosts";

export const processDirectPost = inngest.createFunction(
  {
    id: "process-direct-post",
    name: "Post a single direct-post item",
    retries: 0,
    concurrency: { limit: RUNTIME.workerConcurrency },
    throttle: {
      limit: RUNTIME.perAccountThrottlePerMinute,
      period: "1m",
      key: "event.data.social_account_id",
    },
    triggers: [postNowEvent],
  },
  async ({ event, step }) => {
    const data = event.data;

    // Inngest stores every step result and the account row carries the
    // OAuth tokens, so the account is loaded inside the step that uses it:
    // https://www.inngest.com/docs/learn/how-functions-are-executed
    const result = await step.run(
      "call-platform-direct-post",
      async (): Promise<DirectPostResult> => {
        const fetched = await fetchAccountForPublish(data.social_account_id);
        if (!fetched.success) {
          return { success: false, message: fetched.message, contentId: null };
        }
        return callDirectPostFromEvent(data, fetched.account);
      },
    );

    const dispatchId = data.dispatch_id;
    if (dispatchId) {
      await step.run("finalize-pending-direct-post", () =>
        finalizePendingDirectPost(
          dispatchId,
          result.success ? "completed" : "failed",
          result.success ? null : (result.message?.slice(0, 1000) ?? null)
        )
      );
    }

    const keepsMediaAlive = platformHotlinksMedia(data.platform) && result.success;
    const isTikTokSuccess = data.platform === "tiktok" && result.success;
    if (!isTikTokSuccess && !keepsMediaAlive && data.media_path) {
      await step.run("cleanup-media", () =>
        cleanupMediaIfUnreferenced(data.media_path, data.principal_id)
      );
    }

    return {
      ok: result.success,
      reason: result.success ? undefined : "platform_post_failed",
      message: result.message ?? null,
      contentId: result.contentId ?? null,
    };
  }
);
