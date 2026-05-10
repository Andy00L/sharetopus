import { inngest } from "@/inngest/client";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import {
  callDirectPostFromEvent,
  fetchAccountForDirectPost,
  type PostNowEventData,
} from "./processDirectPostHelpers";
import { cleanupMediaIfUnreferenced } from "./processSinglePostHelpers";

/**
 * Processes ONE direct-post item for ONE social_account on ONE platform.
 * Triggered by the "post.now" event sent from handleSocialMediaPost.
 *
 * No retries: direct posts are fire-and-forget from the user's
 * perspective. Failures surface via the polling endpoint.
 *
 * Cleanup:
 *   - Non-TikTok platforms: cleanup at end of this worker run.
 *   - TikTok success: poll worker handles cleanup after terminal.
 *   - TikTok failure (init failed): cleanup here.
 */
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
    triggers: [{ event: "post.now" }],
  },
  async ({ event, step }) => {
    const data = event.data as PostNowEventData;

    // Step 1: fetch account
    const fetched = await step.run("fetch-account", () =>
      fetchAccountForDirectPost(data.social_account_id)
    );
    if (!fetched.success) {
      return {
        ok: false,
        reason: "account_fetch_failed",
        message: fetched.message,
      };
    }

    // Step 2: call platform direct post via existing helpers
    const result = await step.run("call-platform-direct-post", () =>
      callDirectPostFromEvent(data, fetched.account)
    );

    // Step 3: cleanup media
    // For TikTok success: do NOT cleanup here. The tikTokPublishStatusPollWorker
    // handles cleanup after the publish reaches a terminal state.
    // For TikTok failure (init failed): cleanup here because no pending pull was created.
    const isTikTokSuccess = data.platform === "tiktok" && result.success;
    if (!isTikTokSuccess && data.media_path) {
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
