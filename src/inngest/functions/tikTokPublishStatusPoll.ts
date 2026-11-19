import { z } from "zod";

import { inngest } from "@/inngest/client";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import { getTikTokPublishStatus } from "@/lib/api/tiktok/getTikTokPublishStatus";
import {
  findPendingTikTokPullByPublishId,
  incrementTikTokPullAttemptCount,
} from "@/actions/server/data/pendingTikTokPulls";
import { finalizeTikTokPostByPublishId } from "@/actions/server/data/finalizeTikTokPostByPublishId";
import { resolveTikTokAccessTokenForAccount } from "./tikTokPublishStatusPollHelpers";

const PollEventDataSchema = z.object({
  publish_id: z.string(),
  social_account_id: z.string(),
});

type PollAttemptResult =
  | { kind: "token_unavailable"; message: string }
  | {
      kind: "status";
      status: Awaited<ReturnType<typeof getTikTokPublishStatus>>;
    };

// A database error throws inside its step so Inngest retries that step;
// reads, a status fetch and an idempotent finalize are safe to repeat.
export const tikTokPublishStatusPollWorker = inngest.createFunction(
  {
    id: "tiktok-publish-status-poll",
    name: "TikTok publish status poll",
    concurrency: { limit: 5, key: "event.data.social_account_id" },
    retries: 3,
    triggers: [{ event: "tiktok.publish.poll" }],
    onFailure: async ({ event, error }) => finalizeAbandonedPoll(event, error),
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

    const finalizeInStep = async (
      stepId: string,
      outcome: Parameters<typeof finalizeTikTokPostByPublishId>[1],
    ): Promise<void> => {
      await step.run(stepId, async () => {
        const finalized = await finalizeTikTokPostByPublishId(publish_id, outcome);
        if (!finalized.success) throw new Error(finalized.message);
        return finalized;
      });
    };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const currentPull = await step.run(
        `check-pending-${attempt}`,
        async () => {
          const pullResult = await findPendingTikTokPullByPublishId(publish_id);
          if (!pullResult.success) throw new Error(pullResult.message);
          return pullResult;
        },
      );

      if (currentPull.pull.status !== "pending") {
        console.log(
          `[tiktokPublishStatusPollWorker] Already finalized via ${currentPull.pull.status}, exiting (likely webhook)`,
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
        if (consecutiveErrors >= 5) {
          await finalizeInStep("finalize-token-failure", {
            source: "poll",
            outcome: "failed",
            fail_reason: "Could not resolve access token for polling",
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
        if (consecutiveErrors >= 5) {
          await finalizeInStep("finalize-poll-errors", {
            source: "poll",
            outcome: "failed",
            fail_reason: `Status fetch errors exceeded: ${status.message}`,
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
        await finalizeInStep("finalize-completed", {
          source: "poll",
          outcome: "completed",
          tiktok_post_id: status.tiktok_post_id ?? null,
        });
        return { outcome: "completed", raw_status: status.raw_status };
      }

      if (status.terminal && status.kind === "failed") {
        const reason = status.reason ?? `TikTok status: ${status.raw_status}`;
        await finalizeInStep("finalize-failed", {
          source: "poll",
          outcome: "failed",
          fail_reason: reason,
        });
        return {
          outcome: "failed",
          reason,
          raw_status: status.raw_status,
        };
      }

      await step.sleep(`wait-${attempt}`, `${intervalMs}ms`);
    }

    await finalizeInStep("finalize-timeout", {
      source: "poll",
      outcome: "failed",
      fail_reason: "Timeout waiting for TikTok publish status",
    });

    return { outcome: "failed", reason: "timeout" };
  },
);

async function finalizeAbandonedPoll(
  failureEvent: { data: { event: { data?: unknown } } },
  error: Error,
): Promise<{ finalized: boolean }> {
  const eventData = PollEventDataSchema.safeParse(failureEvent.data.event.data);
  if (!eventData.success) {
    console.error("[finalizeAbandonedPoll] Failure event carried no publish_id");
    return { finalized: false };
  }
  const finalized = await finalizeTikTokPostByPublishId(eventData.data.publish_id, {
    source: "poll",
    outcome: "failed",
    fail_reason: `Status polling stopped: ${error.message}`.slice(0, 1000),
  });
  if (!finalized.success) {
    console.error(
      `[finalizeAbandonedPoll] Could not finalize ${eventData.data.publish_id}: ${finalized.message}`,
    );
  }
  return { finalized: finalized.success };
}
