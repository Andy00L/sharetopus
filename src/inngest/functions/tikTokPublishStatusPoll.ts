import { inngest } from "@/inngest/client";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import { getTikTokPublishStatus } from "@/lib/api/tiktok/getTikTokPublishStatus";
import {
  finalizeTikTokPullAsCompleted,
  finalizeTikTokPullAsFailed,
  incrementTikTokPullAttemptCount,
} from "@/actions/server/data/pendingTikTokPulls";
import {
  resolveTikTokAccessTokenForAccount,
  updateContentHistoryStatusToFailed,
} from "./tikTokPublishStatusPollHelpers";

/**
 * Inngest worker that polls TikTok's /v2/post/publish/status/fetch/
 * endpoint until the publish reaches a terminal state.
 *
 * Triggered by the "tiktok.publish.poll" event dispatched after a
 * successful TikTok init (image or video). Runs up to
 * RUNTIME.tikTokPublishPollMaxAttempts iterations with
 * RUNTIME.tikTokPublishPollIntervalMs between each.
 *
 * On terminal success: marks the pending_tiktok_pulls row as completed.
 * On terminal failure: marks the row as failed, updates content_history
 * to status='failed' with the reason.
 * On timeout: same as terminal failure with reason "Timeout".
 *
 * Retries: 0 (retry logic is internal via the poll loop).
 * Concurrency: 50 per social_account_id (safety valve).
 */
export const tikTokPublishStatusPollWorker = inngest.createFunction(
  {
    id: "tiktok-publish-status-poll",
    name: "TikTok publish status poll",
    concurrency: { limit: 50, key: "event.data.social_account_id" },
    retries: 0,
    triggers: [{ event: "tiktok.publish.poll" }],
  },
  async ({ event, step }) => {
    const {
      publish_id,
      social_account_id,
      content_history_id,
    } = event.data as {
      publish_id: string;
      social_account_id: string;
      content_history_id: string | null;
    };

    const maxAttempts = RUNTIME.tikTokPublishPollMaxAttempts;
    const intervalMs = RUNTIME.tikTokPublishPollIntervalMs;

    let consecutiveErrors = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Resolve a fresh access token (handles refresh if expired)
      const token = await step.run(
        `resolve-token-${attempt}`,
        async () => {
          return await resolveTikTokAccessTokenForAccount(
            social_account_id
          );
        }
      );

      if (!token.success) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          await step.run("finalize-token-failure", async () => {
            await finalizeTikTokPullAsFailed(
              publish_id,
              "Could not resolve access token for polling"
            );
          });
          await step.run("update-history-token-failure", async () => {
            await updateContentHistoryStatusToFailed(
              content_history_id,
              "Token resolution failed during polling"
            );
          });
          return {
            outcome: "failed",
            reason: "token_resolution_exhausted",
          };
        }
        await step.sleep(
          `wait-token-error-${attempt}`,
          `${intervalMs}ms`
        );
        continue;
      }

      // Poll TikTok for the publish status
      const status = await step.run(`poll-${attempt}`, async () => {
        await incrementTikTokPullAttemptCount(publish_id);
        return await getTikTokPublishStatus({
          publish_id,
          access_token: token.token,
        });
      });

      if (!status.success) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          await step.run("finalize-poll-errors", async () => {
            await finalizeTikTokPullAsFailed(
              publish_id,
              `Status fetch errors exceeded: ${status.message}`
            );
          });
          await step.run("update-history-poll-errors", async () => {
            await updateContentHistoryStatusToFailed(
              content_history_id,
              "Status polling exceeded error threshold"
            );
          });
          return {
            outcome: "failed",
            reason: "poll_errors_exceeded",
          };
        }
        await step.sleep(
          `wait-poll-error-${attempt}`,
          `${intervalMs}ms`
        );
        continue;
      }

      // Reset consecutive errors on a successful API call
      consecutiveErrors = 0;

      if (status.terminal && status.kind === "completed") {
        await step.run("finalize-completed", async () => {
          await finalizeTikTokPullAsCompleted(publish_id);
        });
        return { outcome: "completed", raw_status: status.raw_status };
      }

      if (status.terminal && status.kind === "failed") {
        const reason =
          status.reason ?? `TikTok status: ${status.raw_status}`;
        await step.run("finalize-failed", async () => {
          await finalizeTikTokPullAsFailed(publish_id, reason);
        });
        await step.run("update-history-failed", async () => {
          await updateContentHistoryStatusToFailed(
            content_history_id,
            reason
          );
        });
        return {
          outcome: "failed",
          reason,
          raw_status: status.raw_status,
        };
      }

      // Non-terminal: TikTok is still processing. Wait and retry.
      await step.sleep(`wait-${attempt}`, `${intervalMs}ms`);
    }

    // Max attempts exhausted without terminal status
    await step.run("finalize-timeout", async () => {
      await finalizeTikTokPullAsFailed(
        publish_id,
        "Timeout waiting for TikTok publish status"
      );
    });
    await step.run("update-history-timeout", async () => {
      await updateContentHistoryStatusToFailed(
        content_history_id,
        "Timeout waiting for TikTok publish status"
      );
    });

    return { outcome: "failed", reason: "timeout" };
  }
);
