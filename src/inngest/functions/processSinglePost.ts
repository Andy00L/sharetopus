import { inngest } from "@/inngest/client";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import type { Platform } from "@/lib/types/database.types";
import { deriveMediaMimeType } from "@/lib/utils/deriveMediaMimeType";
import { isRetryableReason, type PlatformPostOutcome } from "./platformErrors";
import {
  buildPlatformSignedUrls,
  callPlatformDirectPost,
  checkPlatformCompatibility,
  claimPostForProcessing,
  cleanupMediaIfUnreferenced,
  fetchPostAndAccount,
  recordPostStatus,
} from "./processSinglePostHelpers";

type PostDueEventData = {
  scheduled_post_id: string;
  principal_id: string;
  social_account_id: string;
  platform: Platform;
  scheduled_at: string;
  // Correlation ID propagated from the originating request. Optional because
  // cron-dispatched events do not carry one.
  request_id?: string | null;
};

/**
 * Processes ONE scheduled_posts row for ONE social_account on ONE
 * platform. Calls directPostFor{Platform}Accounts directly
 * in-process; no HTTP hop through /api/social/{platform}/process or
 * /post (those routes still serve the direct "Post Now" path).
 */
export const processSinglePost = inngest.createFunction(
  {
    id: "process-single-post",
    name: "Post a single scheduled item",
    retries: Math.min(RUNTIME.maxRetries, 20) as 0 | 1 | 2 | 3 | 4 | 5,
    concurrency: { limit: RUNTIME.workerConcurrency },
    throttle: {
      limit: RUNTIME.perAccountThrottlePerMinute,
      period: "1m",
      key: "event.data.social_account_id",
    },
    triggers: [{ event: "post.due" }],
  },
  async ({ event, step }) => {
    const data = event.data as PostDueEventData;
    const requestId = data.request_id ?? null;

    const fetched = await step.run("fetch-post-and-account", () =>
      fetchPostAndAccount(data.scheduled_post_id),
    );
    if (!fetched.success) {
      // Permanent: account row gone, FK broken, etc. Do not retry.
      return { skipped: true, reason: fetched.message };
    }
    if (fetched.skip) {
      return { skipped: true, reason: "already-handled" };
    }

    const compat = checkPlatformCompatibility(
      data.platform,
      fetched.post.media_type,
    );
    if (!compat.compatible) {
      const result: PlatformPostOutcome = {
        ok: false,
        reason: "invalid_input",
        message: compat.reason,
      };
      await step.run("claim-and-fail-incompatible", async () => {
        const claim = await claimPostForProcessing(data.scheduled_post_id);
        if (!claim.claimed) return { handled: false };
        await recordPostStatus({
          post: fetched.post,
          account: fetched.account,
          result,
        });
        return { handled: true };
      });
      return { ok: false, reason: "invalid_input" };
    }

    const claim = await step.run("claim-post", () =>
      claimPostForProcessing(data.scheduled_post_id),
    );
    if (!claim.claimed) {
      return { skipped: true, reason: "claimed-by-another-worker" };
    }

    const urls = await step.run("build-signed-urls", () =>
      buildPlatformSignedUrls(fetched.post, data.platform),
    );
    if (!urls.success) {
      // Retryable: signed URL minting can blip on Supabase.
      throw new Error(`signed-url-failure: ${urls.message}`);
    }

    const fileName = fetched.post.media_storage_path
      ? (fetched.post.media_storage_path.split("/").pop() ?? "")
      : "";

    const mediaType = deriveMediaMimeType(fileName, fetched.post.media_type);

    const result = await step.run("call-platform-direct-post", () =>
      callPlatformDirectPost({
        post: fetched.post,
        account: fetched.account,
        mediaUrl: urls.mediaUrl,
        tiktokMediaUrl: urls.tiktokMediaUrl,
        fileName,
        mediaType,
      }),
    );

    await step.run("record-status", () =>
      recordPostStatus({
        post: fetched.post,
        account: fetched.account,
        result,
      }),
    );

    if (fetched.post.media_storage_path) {
      await step.run("cleanup-storage", () =>
        cleanupMediaIfUnreferenced(
          fetched.post.media_storage_path,
          fetched.post.principal_id,
        ),
      );
    }

    // Retry policy: throw ONLY on retryable failures. Inngest
    // performs exponential backoff up to RUNTIME.maxRetries.
    // Terminal failures fall through; record-status already wrote
    // both scheduled_posts.status='failed' and a failed_posts row
    // via the centralized storeFailedPost in recordPostStatus.
    if (!result.ok && isRetryableReason(result.reason)) {
      throw new Error(`retryable: ${result.reason}: ${result.message}`);
    }

    return {
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      contentId: result.ok ? result.contentId : undefined,
    };
  },
);
