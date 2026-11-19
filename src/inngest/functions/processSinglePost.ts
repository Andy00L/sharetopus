import { z } from "zod";

import { fetchAccountForPublish } from "@/actions/server/data/fetchAccountForPublish";
import { inngest } from "@/inngest/client";
import { RUNTIME, toInngestRetryCount } from "@/lib/jobs/runtimeConfig";
import { platformHotlinksMedia } from "@/lib/platforms/capabilities";
import { deriveMediaMimeType } from "@/lib/utils/deriveMediaMimeType";
import { toJsonObject } from "@/lib/utils/jsonObject";
import { isSafeToRetryPost, type PlatformPostOutcome } from "./platformErrors";
import {
  buildPlatformSignedUrls,
  callPlatformDirectPost,
  checkPlatformCompatibility,
  claimPostForProcessing,
  cleanupMediaIfUnreferenced,
  findPublishedContentHistory,
  loadPostForProcessing,
  recordPostStatus,
} from "./processSinglePostHelpers";

/**
 * The post.due fields this worker reads. scheduledPostsTick also sends
 * principal_id and social_account_id (the throttle key).
 */
const PostDueEventDataSchema = z.object({
  scheduled_post_id: z.string(),
  // scheduled_posts.platform is plain text; checkPlatformCompatibility
  // fails an unknown value.
  platform: z.string(),
  scheduled_at: z.string(),
});

/**
 * Processes ONE scheduled_posts row for ONE social_account on ONE
 * platform, calling the platform adapter in-process.
 *
 * Retry contract: a step that wants to be retried throws INSIDE itself.
 * Inngest checkpoints completed step results, so a throw placed after a
 * step never re-executes it. Reads and status writes throw on a database
 * error (repeating them is safe); the publish step throws only for a rate
 * limit (isSafeToRetryPost) and returns every other failure as a value.
 * When retries run out, onFailure finalizes the row so a claimed post
 * cannot be stranded in 'processing' (nothing sweeps that status).
 */
export const processSinglePost = inngest.createFunction(
  {
    id: "process-single-post",
    name: "Post a single scheduled item",
    retries: toInngestRetryCount(RUNTIME.maxRetries),
    concurrency: { limit: RUNTIME.workerConcurrency },
    throttle: {
      limit: RUNTIME.perAccountThrottlePerMinute,
      period: "1m",
      key: "event.data.social_account_id",
    },
    triggers: [{ event: "post.due" }],
    onFailure: async ({ event, error }) => finalizeExhaustedPost(event, error),
  },
  async ({ event, step }) => {
    const parsedEvent = PostDueEventDataSchema.safeParse(event.data);
    if (!parsedEvent.success) {
      console.error("[processSinglePost] Event data is malformed; post not claimed");
      return { skipped: true, reason: "invalid_event_data" };
    }
    const data = parsedEvent.data;

    const loaded = await step.run("load-post-for-processing", async () => {
      const loadResult = await loadPostForProcessing(data.scheduled_post_id);
      if (loadResult.kind === "lookup_failed") {
        throw new Error(`post-lookup-failure: ${loadResult.message}`);
      }
      return loadResult;
    });
    if (loaded.kind === "terminal") {
      return { skipped: true, reason: loaded.message };
    }
    const post = loaded.post;

    const claimRow = async (stepId: string): Promise<boolean> => {
      const claim = await step.run(stepId, async () => {
        const claimResult = await claimPostForProcessing({
          scheduledPostId: data.scheduled_post_id,
          dispatchedScheduledAt: data.scheduled_at,
        });
        if (!claimResult.success) throw new Error(claimResult.message);
        return claimResult;
      });
      return claim.claimed;
    };

    const recordOutcome = async (
      stepId: string,
      result: PlatformPostOutcome,
    ): Promise<void> => {
      await step.run(stepId, async () => {
        const recorded = await recordPostStatus({ post, result });
        if (!recorded.success) throw new Error(recorded.message);
        return recorded;
      });
    };

    if (loaded.kind === "account_missing") {
      if (!(await claimRow("claim-account-missing"))) {
        return { skipped: true, reason: "claimed-by-another-worker" };
      }
      await recordOutcome("record-account-missing", {
        ok: false,
        reason: "invalid_input",
        message: "Social account not found or deleted",
      });
      return { ok: false, reason: "invalid_input" };
    }

    const compat = checkPlatformCompatibility(data.platform, post.media_type);
    if (!compat.compatible) {
      if (!(await claimRow("claim-incompatible"))) {
        return { skipped: true, reason: "claimed-by-another-worker" };
      }
      await recordOutcome("record-incompatible", {
        ok: false,
        reason: "invalid_input",
        message: compat.reason,
      });
      return { ok: false, reason: "invalid_input" };
    }

    if (!(await claimRow("claim-post"))) {
      return { skipped: true, reason: "claimed-by-another-worker" };
    }

    // Minting a signed URL is side-effect free, so throwing inside the step
    // is safe and is the only placement that actually re-mints on retry.
    const urls = await step.run("build-signed-urls", async () => {
      const minted = await buildPlatformSignedUrls(post, data.platform);
      if (!minted.success) {
        throw new Error(`signed-url-failure: ${minted.message}`);
      }
      return minted;
    });

    const fileName = post.media_storage_path
      ? (post.media_storage_path.split("/").pop() ?? "")
      : "";

    const mediaType = deriveMediaMimeType(fileName, post.media_type);

    const result = await step.run("call-platform-direct-post", async () => {
      // A re-executed step (a crash or timeout after the platform accepted
      // the post) must not publish twice: the publish path writes
      // content_history right after the platform accepts.
      const published = await findPublishedContentHistory(post);
      if (!published.success) {
        throw new Error(`publish-guard-failure: ${published.message}`);
      }
      if (published.isPublished) {
        const alreadyPublished: PlatformPostOutcome = {
          ok: true,
          contentId: post.id,
          mediaUrl: urls.mediaUrl,
        };
        return alreadyPublished;
      }

      // Loaded here, not in an earlier step: Inngest stores every step
      // result, and the row carries the OAuth tokens. Reading it here also
      // picks up a token another run refreshed since.
      const accountForPublish = await fetchAccountForPublish(post.social_account_id);
      if (!accountForPublish.success) {
        if (accountForPublish.reason === "lookup_failed") {
          throw new Error(`account-reload-failure: ${accountForPublish.message}`);
        }
        const accountGone: PlatformPostOutcome = {
          ok: false,
          reason: "invalid_input",
          message: accountForPublish.message,
        };
        return accountGone;
      }

      const outcome = await callPlatformDirectPost({
        post,
        account: accountForPublish.account,
        mediaUrl: urls.mediaUrl,
        tiktokMediaUrl: urls.tiktokMediaUrl,
        fileName,
        mediaType,
      });

      // Only rate limits throw: the platform refused the request, so
      // nothing was published and a backoff retry cannot duplicate it.
      if (!outcome.ok && isSafeToRetryPost(outcome.reason)) {
        throw new Error(`retryable: ${outcome.reason}: ${outcome.message}`);
      }
      return outcome;
    });

    await recordOutcome("record-status", result);

    // Hotlinking registry providers embed the media URL in the published
    // content (markdown image, link post), so the file must outlive the
    // post: deleting it here would kill the live embed. deleteSupabaseFile
    // only preserves files referenced by scheduled/processing rows, and by
    // this point the row is posted, so the skip has to happen here.
    if (post.media_storage_path && !platformHotlinksMedia(data.platform)) {
      await step.run("cleanup-storage", () =>
        cleanupMediaIfUnreferenced(post.media_storage_path, post.principal_id),
      );
    }

    return {
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      contentId: result.ok ? result.contentId : undefined,
    };
  },
);

/**
 * Finalizes a post whose run exhausted every retry, so it cannot sit in
 * 'queued' or 'processing' forever (nothing sweeps either status). A row
 * not yet claimed is claimed first, guarded on the dispatched scheduled_at
 * so a post rescheduled meanwhile is left for its new run. A post whose
 * content_history row exists was published, so it is recorded as posted.
 * recordPostStatus is CAS-guarded on 'processing', so a row that already
 * reached a terminal state is left untouched.
 */
async function finalizeExhaustedPost(
  // Structural shape of Inngest's FailureEventPayload: the original event
  // is nested at data.event, and its own `data` is optional on EventPayload.
  // sourceRef: node_modules/inngest/types.d.ts, FailureEventPayload.
  failureEvent: { data: { event: { data?: unknown } } },
  error: Error,
): Promise<{ finalized: boolean; reason?: string }> {
  const parsedEvent = PostDueEventDataSchema.safeParse(
    toJsonObject(failureEvent.data.event.data),
  );
  if (!parsedEvent.success) {
    console.error(
      "[finalizeExhaustedPost] Failure event carried no scheduled_post_id; cannot finalize.",
    );
    return { finalized: false, reason: "missing_scheduled_post_id" };
  }
  const scheduledPostId = parsedEvent.data.scheduled_post_id;

  const loaded = await loadPostForProcessing(scheduledPostId);
  if (loaded.kind === "lookup_failed") {
    console.error(
      `[finalizeExhaustedPost] Could not load post ${scheduledPostId} to finalize it: ${loaded.message}`,
    );
    return { finalized: false, reason: loaded.message };
  }
  if (loaded.kind === "terminal") {
    return { finalized: false, reason: "already-terminal" };
  }

  if (loaded.post.status !== "processing") {
    const claim = await claimPostForProcessing({
      scheduledPostId,
      dispatchedScheduledAt: parsedEvent.data.scheduled_at,
    });
    if (!claim.success || !claim.claimed) {
      return { finalized: false, reason: "not-claimable" };
    }
  }

  const published = await findPublishedContentHistory(loaded.post);
  const finalOutcome: PlatformPostOutcome =
    published.success && published.isPublished
      ? { ok: true, contentId: loaded.post.id, mediaUrl: null }
      : {
          ok: false,
          reason: "transient",
          message: `Retries exhausted: ${error.message}`,
        };

  const recorded = await recordPostStatus({ post: loaded.post, result: finalOutcome });
  const isRecorded = recorded.success && recorded.updated;

  console.error(
    `[finalizeExhaustedPost] Post ${scheduledPostId} exhausted retries ` +
      `(recorded=${isRecorded}, published=${finalOutcome.ok}). Last error: ${error.message}`,
  );

  return { finalized: isRecorded };
}
