import type { FailureEventPayload } from "inngest";

import { inngest } from "@/inngest/client";
import {
  postNowEvent,
  PostNowEventDataSchema,
  type PostNowEventData,
} from "@/inngest/events/postNow";
import { dispatchWebhook, type WebhookPayload } from "@/lib/api/rest/webhooks/dispatch";
import type { WebhookEventType } from "@/lib/api/rest/webhooks/eventTypes";
import { RUNTIME, toInngestRetryCount } from "@/lib/jobs/runtimeConfig";
import {
  buildInputRefusal,
  buildMissingMediaRefusal,
  isSafeToRetryPost,
  type PlatformPostOutcome,
  type PublishFailure,
} from "./platformErrors";
import {
  buildDirectPublishRequest,
  claimDirectPublishAttempt,
  findPublishedDirectPost,
  readDirectDispatch,
  releaseDirectPublishAttempt,
  type DirectPublishBlock,
} from "./processDirectPostHelpers";
import { cleanupMediaIfUnreferenced } from "./processSinglePostHelpers";
import {
  mintPublishMediaUrls,
  publishToPlatform,
  shouldDeleteMediaAfterPublish,
} from "./publishToPlatform";
import { fetchAccountForPublish } from "@/actions/server/data/fetchAccountForPublish";
import {
  finalizePendingDirectPost,
  type DirectPostOutcome,
} from "@/actions/server/data/pendingDirectPosts";

const MAY_HAVE_PUBLISHED_NOTE =
  "An earlier publish attempt stopped before it reported a result; the post may have published";

const EARLIER_ATTEMPT_UNFINISHED: PublishFailure = {
  ok: false,
  reason: "unknown",
  message: MAY_HAVE_PUBLISHED_NOTE,
  mayHavePublished: true,
};

function describeBlockedPublish(block: DirectPublishBlock, batchId: string): PlatformPostOutcome {
  switch (block) {
    case "dispatch-gone":
      return buildInputRefusal("Dispatch lock no longer exists");
    case "already-published":
      return { ok: true, contentId: batchId };
    case "attempt-already-started":
      return EARLIER_ATTEMPT_UNFINISHED;
    case "already-failed":
      return {
        ok: false,
        reason: "transient",
        message: "Not published: the post was already marked failed",
        mayHavePublished: false,
      };
    default: {
      const unhandledBlock: never = block;
      return unhandledBlock;
    }
  }
}

function describeExhaustedRetries(lastError: Error, isClaimHeld: boolean): PublishFailure {
  const message = `Retries exhausted: ${lastError.message}`;
  return isClaimHeld
    ? { ok: false, reason: "unknown", message: `${message}. ${MAY_HAVE_PUBLISHED_NOTE}`, mayHavePublished: true }
    : { ok: false, reason: "transient", message, mayHavePublished: false };
}

function toDirectPostOutcome(outcome: PlatformPostOutcome): DirectPostOutcome {
  return outcome.ok ? { status: "completed" } : { status: "failed", failureReason: outcome.message };
}

type OutcomeWebhook = {
  eventType: Extract<WebhookEventType, "post.published" | "post.failed">;
  payload: WebhookPayload;
};

function buildOutcomeWebhook(data: PostNowEventData, outcome: PlatformPostOutcome): OutcomeWebhook {
  const dispatchFields = {
    dispatch_id: data.dispatch_id,
    batch_id: data.batch_id,
    platform: data.platform,
    social_account_id: data.social_account_id,
  };
  if (outcome.ok) return { eventType: "post.published", payload: dispatchFields };
  return {
    eventType: "post.failed",
    payload: {
      ...dispatchFields,
      reason: outcome.reason,
      error_message: outcome.message,
      may_have_published: outcome.mayHavePublished,
    },
  };
}

function notifyDirectPostOutcome(data: PostNowEventData, outcome: PlatformPostOutcome): Promise<void> {
  const webhook = buildOutcomeWebhook(data, outcome);
  return dispatchWebhook(data.principal_id, webhook.eventType, webhook.payload);
}

// A step that wants to be retried throws inside itself: Inngest stores
// completed step results, so a throw placed after a step never re-runs it.
// https://www.inngest.com/docs/learn/how-functions-are-executed
export const processDirectPost = inngest.createFunction(
  {
    id: "process-direct-post",
    name: "Post a single direct-post item",
    retries: toInngestRetryCount(RUNTIME.maxRetries),
    concurrency: { limit: RUNTIME.workerConcurrency },
    throttle: {
      limit: RUNTIME.perAccountThrottlePerMinute,
      period: "1m",
      key: "event.data.social_account_id",
    },
    triggers: [postNowEvent],
    onFailure: async ({ event, error }) => finalizeExhaustedDirectPost(event, error),
  },
  async ({ event, step, attempt }) => {
    const data = event.data;
    const dispatchId = data.dispatch_id;

    // Inngest stores every step result and the account row carries the
    // OAuth tokens, so the account is loaded inside the step that uses it:
    // https://www.inngest.com/docs/learn/how-functions-are-executed
    const result = await step.run(
      "call-platform-direct-post",
      async (): Promise<PlatformPostOutcome> => {
        const dispatchRead = await readDirectDispatch(dispatchId);
        if (!dispatchRead.success) throw new Error(`dispatch-lookup-failure: ${dispatchRead.message}`);
        const dispatch = dispatchRead.dispatch;
        if (!dispatch) return describeBlockedPublish("dispatch-gone", data.batch_id);

        if (attempt > 0) {
          const published = await findPublishedDirectPost({
            dispatch,
            description: data.account_content.description,
          });
          if (!published.success) throw new Error(`publish-guard-failure: ${published.message}`);
          if (published.isPublished) return { ok: true, contentId: data.batch_id };
        }

        const fetched = await fetchAccountForPublish(data.social_account_id);
        if (!fetched.success) {
          if (fetched.reason === "lookup_failed") {
            throw new Error(`account-lookup-failure: ${fetched.message}`);
          }
          return buildInputRefusal(fetched.message);
        }

        const minted = await mintPublishMediaUrls({
          platform: data.platform,
          storagePath: data.media_path,
          principalId: data.principal_id,
        });
        if (!minted.success) {
          if (minted.reason === "not_found") return buildMissingMediaRefusal(minted.message);
          throw new Error(`signed-url-failure: ${minted.message}`);
        }

        const publishClaim = await claimDirectPublishAttempt(dispatchId);
        if (!publishClaim.success) throw new Error(publishClaim.message);
        if (publishClaim.kind !== "claimed") {
          return describeBlockedPublish(publishClaim.kind, data.batch_id);
        }

        const publishResult = await publishToPlatform(
          buildDirectPublishRequest({ data, account: fetched.account, urls: minted }),
        );
        if (!publishResult.ok && isSafeToRetryPost(publishResult)) {
          const released = await releaseDirectPublishAttempt(dispatchId);
          const releaseNote = released.success ? "" : ` (${released.message})`;
          throw new Error(`retryable: ${publishResult.reason}: ${publishResult.message}${releaseNote}`);
        }
        return publishResult.ok ? { ok: true, contentId: data.batch_id } : publishResult;
      },
    );

    const recorded = await step.run("finalize-pending-direct-post", async () => {
      const outcome = toDirectPostOutcome(result);
      const finalized = await finalizePendingDirectPost({ eventId: dispatchId, outcome });
      if (!finalized.success) throw new Error(`finalize-failure: ${finalized.message}`);
      if (finalized.updated) return { isRecorded: true };
      const current = await readDirectDispatch(dispatchId);
      if (!current.success) throw new Error(`finalize-reread-failure: ${current.message}`);
      return { isRecorded: current.dispatch?.status === outcome.status };
    });

    if (recorded.isRecorded) {
      await step.run("notify-post-outcome", () => notifyDirectPostOutcome(data, result));
    }

    if (
      data.media_path &&
      shouldDeleteMediaAfterPublish({
        platform: data.platform,
        mightBeLive: result.ok || result.mayHavePublished,
      })
    ) {
      await step.run("cleanup-media", () =>
        cleanupMediaIfUnreferenced(data.media_path, data.principal_id)
      );
    }

    return result;
  }
);

async function finalizeExhaustedDirectPost(
  failureEvent: FailureEventPayload,
  error: Error,
): Promise<{ finalized: boolean; reason?: string }> {
  const parsedEvent = PostNowEventDataSchema.safeParse(failureEvent.data.event.data);
  if (!parsedEvent.success) {
    console.error(
      "[finalizeExhaustedDirectPost] Failure event carried no readable post.now data; cannot finalize.",
    );
    return { finalized: false, reason: "unreadable_event" };
  }
  const data = parsedEvent.data;
  const dispatchId = data.dispatch_id;

  const dispatchRead = await readDirectDispatch(dispatchId);
  if (!dispatchRead.success) {
    console.error(`[finalizeExhaustedDirectPost] Could not read dispatch ${dispatchId}: ${dispatchRead.message}`);
    return { finalized: false, reason: dispatchRead.message };
  }
  const dispatch = dispatchRead.dispatch;
  if (!dispatch || dispatch.status === "completed") {
    return { finalized: false, reason: "already-final" };
  }

  const published = await findPublishedDirectPost({
    dispatch,
    description: data.account_content.description,
  });
  const isPublished = published.success && published.isPublished;
  const outcome: PlatformPostOutcome = isPublished
    ? { ok: true, contentId: data.batch_id }
    : describeExhaustedRetries(error, dispatch.publish_started_at !== null);
  const finalized = await finalizePendingDirectPost({
    eventId: dispatchId,
    outcome: toDirectPostOutcome(outcome),
  });
  const isFinalized = finalized.success && finalized.updated;
  if (isFinalized) await notifyDirectPostOutcome(data, outcome);

  if (data.media_path && shouldDeleteMediaAfterPublish({ platform: data.platform, mightBeLive: true })) {
    await cleanupMediaIfUnreferenced(data.media_path, data.principal_id);
  }

  console.error(
    `[finalizeExhaustedDirectPost] Direct post ${dispatchId} exhausted retries ` +
      `(finalized=${isFinalized}, published=${isPublished}). Last error: ${error.message}`,
  );
  return { finalized: isFinalized };
}
