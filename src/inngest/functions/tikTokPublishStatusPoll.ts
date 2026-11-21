import type { FailureEventPayload, GetStepTools } from "inngest";
import { z } from "zod";

import { inngest } from "@/inngest/client";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import { getTikTokPublishStatus } from "@/lib/api/tiktok/getTikTokPublishStatus";
import {
  findPendingTikTokPullByPublishId,
  incrementTikTokPullAttemptCount,
} from "@/actions/server/data/pendingTikTokPulls";
import type { TikTokPullOutcome } from "@/actions/server/data/finalizeTikTokPostByPublishId";
import type { PendingTikTokPull } from "@/lib/types/dbTypes";
import { classifyTikTokFailReason } from "./tikTokFailReason";
import { finalizeTikTokPullInSteps } from "./tikTokPullFinalizeSteps";
import { resolveTikTokAccessTokenForAccount } from "./tikTokPublishStatusPollHelpers";

const PollEventDataSchema = z.object({
  publish_id: z.string(),
  social_account_id: z.string(),
});

const MAX_CONSECUTIVE_POLL_ERRORS = 5;

type PullState =
  | { kind: "found"; status: PendingTikTokPull["status"] }
  | { kind: "not_found" };

type PollAttemptResult =
  | { kind: "token_unavailable"; message: string }
  | {
      kind: "status";
      status: Awaited<ReturnType<typeof getTikTokPublishStatus>>;
    };

export const tikTokPublishStatusPollWorker = inngest.createFunction(
  {
    id: "tiktok-publish-status-poll",
    name: "TikTok publish status poll",
    concurrency: { limit: 5, key: "event.data.social_account_id" },
    retries: 3,
    triggers: [{ event: "tiktok.publish.poll" }],
    onFailure: async ({ event, error, step }) =>
      finalizeAbandonedPoll({ failureEvent: event, error, step }),
  },
  async ({ event, step }) => {
    const eventData = PollEventDataSchema.safeParse(event.data);
    if (!eventData.success) {
      console.error(
        "[tiktokPublishStatusPollWorker] Event data has no publish_id or social_account_id",
      );
      return { outcome: "skipped", reason: "invalid_event_data" };
    }
    const { publish_id, social_account_id } = eventData.data;

    const maxAttempts = RUNTIME.tikTokPublishPollMaxAttempts;
    const intervalMs = RUNTIME.tikTokPublishPollIntervalMs;

    let consecutiveErrors = 0;

    const finalizeInSteps = (stepId: string, result: TikTokPullOutcome) =>
      finalizeTikTokPullInSteps({
        step,
        stepId,
        publishId: publish_id,
        source: "poll",
        result,
      });

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const pullState = await step.run(
        `read-pull-${attempt}`,
        async (): Promise<PullState> => {
          const lookup = await findPendingTikTokPullByPublishId(publish_id);
          if (lookup.success) return { kind: "found", status: lookup.pull.status };
          if (lookup.reason === "lookup_failed") throw new Error(lookup.message);
          return { kind: "not_found" };
        },
      );

      if (pullState.kind === "not_found") {
        console.log(
          `[tiktokPublishStatusPollWorker] No pull row for ${publish_id}, exiting`,
        );
        return { outcome: "skipped", reason: "pull_not_found" };
      }

      if (pullState.status !== "pending") {
        console.log(
          `[tiktokPublishStatusPollWorker] Already finalized via ${pullState.status}, exiting (likely webhook)`,
        );
        return { outcome: "skipped", reason: "already_finalized" };
      }

      // Token and poll share one step: Inngest stores every step result,
      // so a token returned from its own step would sit in the run's
      // history: https://www.inngest.com/docs/learn/how-functions-are-executed
      const attemptResult = await step.run(
        `status-check-${attempt}`,
        async (): Promise<PollAttemptResult> => {
          const token = await resolveTikTokAccessTokenForAccount(social_account_id);
          if (!token.success) {
            return { kind: "token_unavailable", message: token.message };
          }
          await incrementTikTokPullAttemptCount(publish_id);
          const status = await getTikTokPublishStatus({
            publish_id,
            access_token: token.token,
          });
          return { kind: "status", status };
        },
      );

      if (attemptResult.kind === "token_unavailable") {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          await finalizeInSteps("finalize-token-failure", {
            outcome: "failed",
            reason: "auth_expired",
            message: "Could not resolve access token for polling",
          });
          return {
            outcome: "failed",
            reason: "token_resolution_exhausted",
          };
        }
        await step.sleep(`wait-token-error-${attempt}`, `${intervalMs}ms`);
        continue;
      }

      const status = attemptResult.status;
      if (!status.success) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
          await finalizeInSteps("finalize-poll-errors", {
            outcome: "failed",
            reason: "transient",
            message: `Status fetch errors exceeded: ${status.message}`,
          });
          return {
            outcome: "failed",
            reason: "poll_errors_exceeded",
          };
        }
        await step.sleep(`wait-poll-error-${attempt}`, `${intervalMs}ms`);
        continue;
      }

      consecutiveErrors = 0;

      if (status.terminal && status.kind === "completed") {
        await finalizeInSteps("finalize-completed", {
          outcome: "completed",
          tiktokPostId: status.tiktok_post_id ?? null,
        });
        return { outcome: "completed", raw_status: status.raw_status };
      }

      if (status.terminal && status.kind === "failed") {
        const failureMessage = status.reason ?? `TikTok status: ${status.raw_status}`;
        await finalizeInSteps("finalize-failed", {
          outcome: "failed",
          reason: classifyTikTokFailReason(status.reason),
          message: failureMessage,
        });
        return {
          outcome: "failed",
          reason: failureMessage,
          raw_status: status.raw_status,
        };
      }

      await step.sleep(`wait-${attempt}`, `${intervalMs}ms`);
    }

    await finalizeInSteps("finalize-timeout", {
      outcome: "failed",
      reason: "transient",
      message: "Timeout waiting for TikTok publish status",
    });

    return { outcome: "failed", reason: "timeout" };
  },
);

async function finalizeAbandonedPoll(input: {
  failureEvent: FailureEventPayload;
  error: Error;
  step: GetStepTools<typeof inngest>;
}): Promise<{ finalized: boolean }> {
  const eventData = PollEventDataSchema.safeParse(input.failureEvent.data.event.data);
  if (!eventData.success) {
    console.error("[finalizeAbandonedPoll] Failure event carried no publish_id");
    return { finalized: false };
  }
  const finalized = await finalizeTikTokPullInSteps({
    step: input.step,
    stepId: "finalize-abandoned-poll",
    publishId: eventData.data.publish_id,
    source: "poll",
    result: {
      outcome: "failed",
      reason: "transient",
      message: `Status polling stopped: ${input.error.message}`,
    },
  });
  return { finalized: finalized.kind === "finalized" };
}
