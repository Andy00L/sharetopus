import { inngest } from "@/inngest/client";
import { platformHotlinksMedia } from "@/lib/platforms/capabilities";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import {
  callDirectPostFromEvent,
  type DirectPostResult,
  type PostNowEventData,
} from "./processDirectPostHelpers";
import { cleanupMediaIfUnreferenced } from "./processSinglePostHelpers";
import { fetchAccountForPublish } from "@/actions/server/data/fetchAccountForPublish";
import { finalizePendingDirectPost } from "@/actions/server/data/pendingDirectPosts";

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
    const requestId = data.request_id ?? null;

    // Steps 1-2: load the account and publish, in one step. Inngest stores
    // every step result and the account row carries the OAuth tokens, so the
    // account is loaded where it is used and never returned. An account that
    // cannot be loaded fails the post, and step 3 finalizes its lock.
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

    // Step 3: finalize THIS worker's lock (release self before cleanup check).
    // dispatch_id may be undefined for legacy in-flight events that predate
    // the FIX RACE-1 deploy. Skip finalize in that case.
    if (data.dispatch_id) {
      await step.run("finalize-pending-direct-post", () =>
        finalizePendingDirectPost(
          data.dispatch_id!,
          result.success ? "completed" : "failed",
          result.success ? null : (result.message?.slice(0, 1000) ?? null)
        )
      );
    }

    // Step 4: cleanup media
    // For TikTok success: do NOT cleanup here. The tikTokPublishStatusPollWorker
    // handles cleanup after the publish reaches a terminal state.
    // For TikTok failure (init failed): cleanup here because no pending pull was created.
    // Hotlinking registry platforms embed the media URL in the published
    // content, so the file must outlive the post (mirrors the skip in
    // processSinglePost).
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
