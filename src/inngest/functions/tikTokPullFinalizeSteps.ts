import "server-only";
import type { GetStepTools } from "inngest";

import {
  finalizeTikTokPostByPublishId,
  type FailedTikTokPost,
  type FinalizeTikTokPullResult,
  type TikTokPullOutcome,
} from "@/actions/server/data/finalizeTikTokPostByPublishId";
import type { inngest } from "@/inngest/client";
import { dispatchWebhook, type WebhookPayload } from "@/lib/api/rest/webhooks/dispatch";
import {
  buildDispatchFailedPayload,
  buildPostFailedFields,
} from "@/lib/api/rest/webhooks/postWebhookPayloads";
import { cleanupMediaIfUnreferenced } from "./processSinglePostHelpers";

type FinalizedTikTokPull = Extract<FinalizeTikTokPullResult, { success: true }>;

function buildTikTokPostFailedPayload(failedPost: FailedTikTokPost): WebhookPayload {
  const failure = { reason: failedPost.reason, message: failedPost.message, mayHavePublished: false };
  if (failedPost.kind === "post_now") return buildDispatchFailedPayload(failedPost.dispatch, failure);
  return { post_id: failedPost.scheduledPostId, platform: "tiktok", ...buildPostFailedFields(failure) };
}

export async function finalizeTikTokPullInSteps(input: {
  step: GetStepTools<typeof inngest>;
  stepId: string;
  publishId: string;
  source: "poll" | "webhook";
  result: TikTokPullOutcome;
}): Promise<FinalizedTikTokPull> {
  const finalized: FinalizedTikTokPull = await input.step.run(input.stepId, async () => {
    const finalizeResult = await finalizeTikTokPostByPublishId({
      publishId: input.publishId,
      source: input.source,
      result: input.result,
    });
    if (!finalizeResult.success) throw new Error(finalizeResult.message);
    return finalizeResult;
  });
  if (finalized.kind !== "finalized") return finalized;

  await input.step.run(`${input.stepId}-cleanup-media`, () =>
    cleanupMediaIfUnreferenced(finalized.mediaStoragePath, finalized.principalId),
  );

  const failedPost = finalized.failedPost;
  if (failedPost) {
    await input.step.run(`${input.stepId}-notify-post-failed`, () =>
      dispatchWebhook(finalized.principalId, "post.failed", buildTikTokPostFailedPayload(failedPost)),
    );
  }
  return finalized;
}
