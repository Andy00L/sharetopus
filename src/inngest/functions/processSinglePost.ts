import type { FailureEventPayload } from "inngest";

import { fetchAccountForPublish } from "@/actions/server/data/fetchAccountForPublish";
import { inngest } from "@/inngest/client";
import { postDueEvent, PostDueEventDataSchema } from "@/inngest/events/postDue";
import { RUNTIME, toInngestRetryCount } from "@/lib/jobs/runtimeConfig";
import {
  buildInputRefusal,
  buildMissingMediaRefusal,
  isSafeToRetryPost,
  type PlatformPostOutcome,
} from "./platformErrors";
import {
  buildScheduledPublishRequest,
  checkPlatformCompatibility,
  claimPostForProcessing,
  claimPublishAttempt,
  cleanupMediaIfUnreferenced,
  finalizeProcessingPost,
  findPublishedContentHistory,
  gatePostOnOwnerAccess,
  loadPostForProcessing,
  recordPostStatus,
  releasePublishAttempt,
} from "./processSinglePostHelpers";
import {
  mintPublishMediaUrls,
  publishToPlatform,
  shouldDeleteMediaAfterPublish,
} from "./publishToPlatform";

const EARLY_START_TOLERANCE_MS = 10_000;

type RowClaim =
  | { claimed: true }
  | { claimed: false; skipReason: "claimed-by-another-worker" | "paused-without-access" };

type PublishSkip = { skipped: true; reason: "post-deleted" | "post-no-longer-processing" };

const EARLIER_ATTEMPT_UNFINISHED: PlatformPostOutcome = {
  ok: false,
  reason: "unknown",
  message: "An earlier publish attempt stopped before it reported a result; the post may have published",
  mayHavePublished: true,
};

// A step that wants to be retried throws inside itself: Inngest stores
// completed step results, so a throw placed after a step never re-runs it.
// https://www.inngest.com/docs/learn/how-functions-are-executed
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
    triggers: [postDueEvent],
    onFailure: async ({ event, error }) => finalizeExhaustedPost(event, error),
  },
  async ({ event, step }) => {
    const data = event.data;

    const loaded = await step.run("load-post-for-processing", async () => {
      const loadResult = await loadPostForProcessing(data.scheduled_post_id);
      if (loadResult.kind === "lookup_failed") {
        throw new Error(`post-lookup-failure: ${loadResult.message}`);
      }
      return { ...loadResult, loadedAtMs: Date.now() };
    });
    if (loaded.kind === "terminal") {
      return { skipped: true, reason: loaded.message };
    }
    if (loaded.loadedAtMs < Date.parse(data.scheduled_at) - EARLY_START_TOLERANCE_MS) {
      await step.sleepUntil("wait-until-scheduled-time", data.scheduled_at);
    }
    const post = loaded.post;

    const claimRow = (stepId: string): Promise<RowClaim> =>
      step.run(stepId, async (): Promise<RowClaim> => {
        const gate = await gatePostOnOwnerAccess({
          post,
          dispatchedScheduledAt: data.scheduled_at,
        });
        if (!gate.success) throw new Error(`access-check-failure: ${gate.message}`);
        if (!gate.isOpen) {
          return {
            claimed: false,
            skipReason: gate.isPaused ? "paused-without-access" : "claimed-by-another-worker",
          };
        }
        const claimResult = await claimPostForProcessing({
          scheduledPostId: data.scheduled_post_id,
          dispatchedScheduledAt: data.scheduled_at,
        });
        if (!claimResult.success) throw new Error(claimResult.message);
        return claimResult.claimed
          ? { claimed: true }
          : { claimed: false, skipReason: "claimed-by-another-worker" };
      });

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
      const accountMissingClaim = await claimRow("claim-account-missing");
      if (!accountMissingClaim.claimed) {
        return { skipped: true, reason: accountMissingClaim.skipReason };
      }
      await recordOutcome(
        "record-account-missing",
        buildInputRefusal("Social account not found or deleted"),
      );
      return { ok: false, reason: "invalid_input" };
    }

    const compat = checkPlatformCompatibility(data.platform, post.media_type);
    if (!compat.compatible) {
      const incompatibleClaim = await claimRow("claim-incompatible");
      if (!incompatibleClaim.claimed) {
        return { skipped: true, reason: incompatibleClaim.skipReason };
      }
      await recordOutcome("record-incompatible", buildInputRefusal(compat.reason));
      return { ok: false, reason: "invalid_input" };
    }

    const postClaim = await claimRow("claim-post");
    if (!postClaim.claimed) {
      return { skipped: true, reason: postClaim.skipReason };
    }

    const result = await step.run("call-platform-direct-post", async () => {
      const published = await findPublishedContentHistory(post);
      if (!published.success) {
        throw new Error(`publish-guard-failure: ${published.message}`);
      }
      if (published.isPublished) {
        const alreadyPublished: PlatformPostOutcome = { ok: true, contentId: post.id };
        return alreadyPublished;
      }

      // Loaded here, not in an earlier step: Inngest stores every step
      // result, and the row carries the OAuth tokens.
      const accountForPublish = await fetchAccountForPublish(post.social_account_id);
      if (!accountForPublish.success) {
        if (accountForPublish.reason === "lookup_failed") {
          throw new Error(`account-reload-failure: ${accountForPublish.message}`);
        }
        return buildInputRefusal(accountForPublish.message);
      }

      const minted = await mintPublishMediaUrls({
        platform: post.platform,
        storagePath: post.media_storage_path,
        principalId: post.principal_id,
      });
      if (!minted.success) {
        if (minted.reason === "not_found") return buildMissingMediaRefusal(minted.message);
        throw new Error(`signed-url-failure: ${minted.message}`);
      }

      const built = buildScheduledPublishRequest({
        post,
        account: accountForPublish.account,
        urls: minted,
      });
      if (!built.ok) return built;

      const attempt = await claimPublishAttempt(post.id);
      if (!attempt.success) throw new Error(attempt.message);
      switch (attempt.kind) {
        case "post-deleted":
        case "post-no-longer-processing": {
          const skip: PublishSkip = { skipped: true, reason: attempt.kind };
          return skip;
        }
        case "attempt-already-started":
          return EARLIER_ATTEMPT_UNFINISHED;
        case "claimed":
          break;
        default: {
          const unhandledAttempt: never = attempt.kind;
          return unhandledAttempt;
        }
      }

      const publishResult = await publishToPlatform(built.request);
      if (!publishResult.ok && isSafeToRetryPost(publishResult)) {
        const released = await releasePublishAttempt(post.id);
        const releaseNote = released.success ? "" : ` (${released.message})`;
        throw new Error(`retryable: ${publishResult.reason}: ${publishResult.message}${releaseNote}`);
      }
      const outcome: PlatformPostOutcome = publishResult.ok
        ? { ok: true, contentId: post.id }
        : publishResult;
      return outcome;
    });

    if ("skipped" in result) return result;

    await recordOutcome("record-status", result);

    if (
      post.media_storage_path &&
      shouldDeleteMediaAfterPublish({
        platform: post.platform,
        mightBeLive: result.ok || result.mayHavePublished,
      })
    ) {
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

// Inngest runs the failure handler as its own function with one retry, and
// retries it only when it throws:
// node_modules/inngest/components/InngestFunction.js:114-133
async function finalizeExhaustedPost(
  failureEvent: FailureEventPayload,
  error: Error,
): Promise<{ finalized: boolean; reason?: string }> {
  const parsedEvent = PostDueEventDataSchema.safeParse(failureEvent.data.event.data);
  if (!parsedEvent.success) {
    console.error(
      "[finalizeExhaustedPost] Failure event carried no scheduled_post_id; cannot finalize.",
    );
    return { finalized: false, reason: "missing_scheduled_post_id" };
  }
  const scheduledPostId = parsedEvent.data.scheduled_post_id;

  const loaded = await loadPostForProcessing(scheduledPostId);
  if (loaded.kind === "lookup_failed") {
    throw new Error(
      `[finalizeExhaustedPost] Could not load post ${scheduledPostId} to finalize it: ${loaded.message}`,
    );
  }
  if (loaded.kind === "terminal") {
    return { finalized: false, reason: "already-terminal" };
  }

  if (loaded.post.status !== "processing") {
    const claim = await claimPostForProcessing({
      scheduledPostId,
      dispatchedScheduledAt: parsedEvent.data.scheduled_at,
    });
    if (!claim.success) {
      throw new Error(`[finalizeExhaustedPost] Post ${scheduledPostId}: ${claim.message}`);
    }
    if (!claim.claimed) return { finalized: false, reason: "not-claimable" };
  }

  const finalized = await finalizeProcessingPost({
    post: loaded.post,
    failureMessage: `Retries exhausted: ${error.message}`,
    abandonedClaimBeforeIso: null,
  });
  if (!finalized.success) {
    throw new Error(`[finalizeExhaustedPost] Post ${scheduledPostId}: ${finalized.message}`);
  }

  console.error(
    `[finalizeExhaustedPost] Post ${scheduledPostId} exhausted retries ` +
      `(recorded=${finalized.updated}, published=${finalized.outcome.ok}). Last error: ${error.message}`,
  );

  return { finalized: finalized.updated };
}
