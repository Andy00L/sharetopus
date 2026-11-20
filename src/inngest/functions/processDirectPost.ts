import { inngest } from "@/inngest/client";
import type { Platform } from "@/db/schema";
import { platformHotlinksMedia } from "@/lib/platforms/capabilities";
import { RUNTIME, toInngestRetryCount } from "@/lib/jobs/runtimeConfig";
import { classifyDirectPostFailure, isSafeToRetryPost } from "./platformErrors";
import {
  callDirectPostFromEvent,
  findPublishedDirectPost,
  postNowEvent,
  type DirectPostResult,
  type PostNowEventData,
} from "./processDirectPostHelpers";
import { cleanupMediaIfUnreferenced } from "./processSinglePostHelpers";
import { fetchAccountForPublish } from "@/actions/server/data/fetchAccountForPublish";
import {
  finalizePendingDirectPost,
  readDirectPostLock,
} from "@/actions/server/data/pendingDirectPosts";

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
    onFailure: async ({ event, error }) => finalizeExhaustedDirectPost(event.data.event.data, error),
  },
  async ({ event, step, attempt }) => {
    const data = event.data;
    const dispatchId = data.dispatch_id;
    if (!dispatchId) {
      console.error("[processDirectPost] Event has no dispatch_id; nothing guards a publish");
      return { ok: false, reason: "missing_dispatch_id", message: null, contentId: null };
    }

    // Inngest stores every step result and the account row carries the
    // OAuth tokens, so the account is loaded inside the step that uses it:
    // https://www.inngest.com/docs/learn/how-functions-are-executed
    const result = await step.run(
      "call-platform-direct-post",
      async (): Promise<DirectPostResult> => {
        const lockRead = await readDirectPostLock(dispatchId);
        if (!lockRead.success) throw new Error(`lock-lookup-failure: ${lockRead.message}`);
        const lock = lockRead.lock;
        if (!lock) {
          return { success: false, message: "Dispatch lock no longer exists", contentId: null };
        }

        if (attempt > 0) {
          const published = await findPublishedDirectPost({
            lock,
            description: data.account_content.description,
          });
          if (!published.success) throw new Error(`publish-guard-failure: ${published.message}`);
          if (published.isPublished) {
            return { success: true, message: "Published by an earlier attempt", contentId: data.batch_id };
          }
        }

        if (lock.status !== "processing") {
          return {
            success: false,
            message: `Not published: the post was already marked ${lock.status}`,
            contentId: null,
          };
        }

        const fetched = await fetchAccountForPublish(data.social_account_id);
        if (!fetched.success) {
          if (fetched.reason === "lookup_failed") {
            throw new Error(`account-lookup-failure: ${fetched.message}`);
          }
          return { success: false, message: fetched.message, contentId: null };
        }

        const platformResult = await callDirectPostFromEvent(data, fetched.account);
        const failureReason = platformResult.success
          ? null
          : classifyDirectPostFailure(data.platform, platformResult.message ?? undefined);
        if (failureReason && isSafeToRetryPost(failureReason)) {
          throw new Error(`retryable: ${failureReason}: ${platformResult.message}`);
        }
        return platformResult;
      },
    );

    await step.run("finalize-pending-direct-post", async () => {
      const finalized = await finalizePendingDirectPost({
        eventId: dispatchId,
        outcome: result.success
          ? { status: "completed" }
          : { status: "failed", failureReason: result.message ?? "Failed without message" },
      });
      if (!finalized.success) throw new Error(`finalize-failure: ${finalized.message}`);
      return finalized;
    });

    if (data.media_path && shouldDeleteMediaAfter({ platform: data.platform, isPublished: result.success })) {
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

function shouldDeleteMediaAfter(input: { platform: Platform; isPublished: boolean }): boolean {
  if (!input.isPublished) return true;
  return input.platform !== "tiktok" && !platformHotlinksMedia(input.platform);
}

async function finalizeExhaustedDirectPost(
  data: PostNowEventData,
  error: Error,
): Promise<{ finalized: boolean; reason?: string }> {
  const dispatchId = data.dispatch_id;
  if (!dispatchId) return { finalized: false, reason: "missing_dispatch_id" };

  const lockRead = await readDirectPostLock(dispatchId);
  if (!lockRead.success) {
    console.error(`[finalizeExhaustedDirectPost] Could not read lock ${dispatchId}: ${lockRead.message}`);
    return { finalized: false, reason: lockRead.message };
  }
  const lock = lockRead.lock;
  if (!lock || lock.status === "completed") {
    return { finalized: false, reason: "already-final" };
  }

  const published = await findPublishedDirectPost({
    lock,
    description: data.account_content.description,
  });
  const isPublished = published.success && published.isPublished;
  const finalized = await finalizePendingDirectPost({
    eventId: dispatchId,
    outcome: isPublished
      ? { status: "completed" }
      : { status: "failed", failureReason: `Retries exhausted: ${error.message}` },
  });
  const isFinalized = finalized.success && finalized.updated;

  if (data.media_path && shouldDeleteMediaAfter({ platform: data.platform, isPublished })) {
    await cleanupMediaIfUnreferenced(data.media_path, data.principal_id);
  }

  console.error(
    `[finalizeExhaustedDirectPost] Direct post ${dispatchId} exhausted retries ` +
      `(finalized=${isFinalized}, published=${isPublished}). Last error: ${error.message}`,
  );
  return { finalized: isFinalized };
}
