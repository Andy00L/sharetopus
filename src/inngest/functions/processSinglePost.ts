import { fetchAccountForPublish } from "@/actions/server/data/fetchAccountForPublish";
import { inngest } from "@/inngest/client";
import { RUNTIME, toInngestRetryCount } from "@/lib/jobs/runtimeConfig";
import { platformHotlinksMedia } from "@/lib/platforms/capabilities";
import type { Platform } from "@/db/schema";
import { deriveMediaMimeType } from "@/lib/utils/deriveMediaMimeType";
import { isSafeToRetryPost, type PlatformPostOutcome } from "./platformErrors";
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
 *
 * Retry contract: a step that wants to be retried throws INSIDE itself.
 * Inngest checkpoints completed step results, so a throw placed after a
 * step never re-executes it; the retried invocation replays the memoized
 * value and re-throws, burning every attempt without changing anything.
 * Only failures that are safe to repeat throw at all (see
 * isSafeToRetryPost); everything else returns a value and is recorded as
 * terminal. When retries do run out, onFailure finalizes the row so a
 * claimed post cannot be stranded in 'processing' (nothing sweeps that
 * status).
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
    const data = event.data as PostDueEventData;

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

    // Minting a signed URL is side-effect free, so throwing inside the step
    // is safe and is the only placement that actually re-mints on retry.
    const urls = await step.run("build-signed-urls", async () => {
      const minted = await buildPlatformSignedUrls(fetched.post, data.platform);
      if (!minted.success) {
        throw new Error(`signed-url-failure: ${minted.message}`);
      }
      return minted;
    });

    const fileName = fetched.post.media_storage_path
      ? (fetched.post.media_storage_path.split("/").pop() ?? "")
      : "";

    const mediaType = deriveMediaMimeType(fileName, fetched.post.media_type);

    const result = await step.run("call-platform-direct-post", async () => {
      // Loaded here, not in fetch-post-and-account: Inngest stores every
      // step result, and the row carries the OAuth tokens. Reading it here
      // also picks up a token another run refreshed since that step.
      const accountForPublish = await fetchAccountForPublish(fetched.account.id);
      if (!accountForPublish.success) {
        // Nothing was published yet, so a failed read is safe to retry.
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
        post: fetched.post,
        account: accountForPublish.account,
        mediaUrl: urls.mediaUrl,
        tiktokMediaUrl: urls.tiktokMediaUrl,
        fileName,
        mediaType,
      });

      // Throwing here, inside the step, is what makes the retry re-run the
      // platform call. Only rate limits reach this branch: the platform
      // refused the request, so nothing was published and a backoff retry
      // cannot duplicate the post.
      if (!outcome.ok && isSafeToRetryPost(outcome.reason)) {
        throw new Error(`retryable: ${outcome.reason}: ${outcome.message}`);
      }
      return outcome;
    });

    await step.run("record-status", () =>
      recordPostStatus({
        post: fetched.post,
        account: fetched.account,
        result,
      }),
    );

    // Hotlinking registry providers embed the media URL in the published
    // content (markdown image, link post), so the file must outlive the
    // post: deleting it here would kill the live embed. deleteSupabaseFile
    // only preserves files referenced by scheduled/processing rows, and by
    // this point the row is posted, so the skip has to happen here.
    if (
      fetched.post.media_storage_path &&
      !platformHotlinksMedia(data.platform)
    ) {
      await step.run("cleanup-storage", () =>
        cleanupMediaIfUnreferenced(
          fetched.post.media_storage_path,
          fetched.post.principal_id,
        ),
      );
    }

    // No throw here. Anything reaching this point is terminal, and
    // record-status has already written scheduled_posts.status='failed'
    // plus a failed_posts row via storeFailedPost. Retryable failures
    // threw inside their own step above and never got this far.
    return {
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      contentId: result.ok ? result.contentId : undefined,
    };
  },
);

/**
 * Finalizes a post whose run exhausted every retry.
 *
 * Why this is required: the claim step flips the row to 'processing'
 * before any platform work, and record-status is what moves it out of that
 * state. When a step throws its way through all retries, record-status
 * never runs, and nothing sweeps scheduled_posts stuck in 'processing'
 * (sweepStuckDirectPosts covers pending_direct_posts only). Without this
 * handler the row would sit in 'processing' forever: invisible to the
 * dispatcher, never retried, never reported to its owner.
 *
 * recordPostStatus is CAS-guarded on status='processing', so a row that
 * already reached a terminal state is left untouched and no duplicate
 * failed_posts row or webhook is produced.
 */
async function finalizeExhaustedPost(
  // Structural shape of Inngest's FailureEventPayload: the original event
  // is nested at data.event, and its own `data` is optional on EventPayload.
  // sourceRef: node_modules/inngest/types.d.ts, FailureEventPayload.
  failureEvent: { data: { event: { data?: unknown } } },
  error: Error,
): Promise<{ finalized: boolean; reason?: string }> {
  const originalEventData = failureEvent.data.event.data as
    | Partial<PostDueEventData>
    | null
    | undefined;
  const scheduledPostId = originalEventData?.scheduled_post_id;

  if (typeof scheduledPostId !== "string" || scheduledPostId.length === 0) {
    console.error(
      "[processSinglePost.onFailure] Failure event carried no scheduled_post_id; cannot finalize.",
    );
    return { finalized: false, reason: "missing_scheduled_post_id" };
  }

  const fetched = await fetchPostAndAccount(scheduledPostId);
  if (!fetched.success) {
    console.error(
      `[processSinglePost.onFailure] Could not load post ${scheduledPostId} to finalize it: ${fetched.message}`,
    );
    return { finalized: false, reason: fetched.message };
  }
  if (fetched.skip) {
    // Already posted, failed, or cancelled. Nothing to finalize.
    return { finalized: false, reason: "already-terminal" };
  }

  const exhaustedOutcome: PlatformPostOutcome = {
    ok: false,
    reason: "transient",
    message: `Retries exhausted: ${error.message}`,
  };

  const recorded = await recordPostStatus({
    post: fetched.post,
    account: fetched.account,
    result: exhaustedOutcome,
  });

  console.error(
    `[processSinglePost.onFailure] Post ${scheduledPostId} exhausted retries ` +
      `(recorded=${recorded.updated}). Last error: ${error.message}`,
  );

  return { finalized: recorded.updated };
}
