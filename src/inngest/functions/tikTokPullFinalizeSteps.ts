import "server-only";
import type { GetStepTools } from "inngest";

import {
  finalizeTikTokPostByPublishId,
  type FinalizeTikTokPullResult,
  type TikTokPullOutcome,
} from "@/actions/server/data/finalizeTikTokPostByPublishId";
import type { inngest } from "@/inngest/client";
import { dispatchWebhook } from "@/lib/api/rest/webhooks/dispatch";
import { cleanupMediaIfUnreferenced } from "./processSinglePostHelpers";

type FinalizedTikTokPull = Extract<FinalizeTikTokPullResult, { success: true }>;

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

  const failedScheduledPost = finalized.failedScheduledPost;
  if (failedScheduledPost) {
    await input.step.run(`${input.stepId}-notify-post-failed`, () =>
      dispatchWebhook(finalized.principalId, "post.failed", {
        post_id: failedScheduledPost.scheduledPostId,
        platform: "tiktok",
        reason: failedScheduledPost.reason,
        error_message: failedScheduledPost.message,
      }),
    );
  }
  return finalized;
}
