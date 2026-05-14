import { inngest } from "@/inngest/client";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import { getTikTokPublishStatus } from "@/lib/api/tiktok/getTikTokPublishStatus";
import {
  findPendingTikTokPullByPublishId,
  incrementTikTokPullAttemptCount,
} from "@/actions/server/data/pendingTikTokPulls";
import { finalizeTikTokPostByPublishId } from "@/actions/server/data/finalizeTikTokPostByPublishId";
import { resolveTikTokAccessTokenForAccount } from "./tikTokPublishStatusPollHelpers";

/**
 * Inngest worker that polls TikTok's /v2/post/publish/status/fetch/
 * endpoint until the publish reaches a terminal state.
 *
 * Triggered by the "tiktok.publish.poll" event dispatched after a
 * successful TikTok init (image or video). Runs up to
 * RUNTIME.tikTokPublishPollMaxAttempts iterations with
 * RUNTIME.tikTokPublishPollIntervalMs between each.
 *
 * All finalization goes through finalizeTikTokPostByPublishId, which
 * handles pending_tiktok_pulls status, content_history updates, and
 * media cleanup. The webhook worker uses the same function, so both
 * paths converge. Early-exit at top of each iteration detects when
 * the webhook already finalized the post.
 *
 * Retries: 0 (retry logic is internal via the poll loop).
 * Concurrency: 5 per social_account_id (safety valve).
 */
export const tikTokPublishStatusPollWorker = inngest.createFunction(
  {
    id: "tiktok-publish-status-poll",
    name: "TikTok publish status poll",
    concurrency: { limit: 5, key: "event.data.social_account_id" },
    retries: 0,
    triggers: [{ event: "tiktok.publish.poll" }],
  },
  async ({ event, step }) => {
    const { publish_id, social_account_id } =
      event.data as {
        publish_id: string;
        social_account_id: string;
        content_history_id: string | null;
      };

    const maxAttempts = RUNTIME.tikTokPublishPollMaxAttempts;
    const intervalMs = RUNTIME.tikTokPublishPollIntervalMs;

    let consecutiveErrors = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Early-exit: if webhook already finalized this post, stop polling.
      const currentPull = await step.run(
        `check-pending-${attempt}`,
        async () => {
          return await findPendingTikTokPullByPublishId(publish_id);
        },
      );

      if (!currentPull.success) {
        console.log(
          `[tiktokPublishStatusPollWorker] Pull row gone for ${publish_id}, exiting`,
        );
        return { outcome: "skipped", reason: "pull_not_found" };
      }

      if (currentPull.pull.status !== "pending") {
        console.log(
          `[tiktokPublishStatusPollWorker] Already finalized via ${currentPull.pull.status}, exiting (likely webhook)`,
        );
        return { outcome: "skipped", reason: "already_finalized" };
      }

      // Resolve a fresh access token (handles refresh if expired)
      const token = await step.run(`resolve-token-${attempt}`, async () => {
        return await resolveTikTokAccessTokenForAccount(social_account_id);
      });

      if (!token.success) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          await step.run("finalize-token-failure", async () => {
            await finalizeTikTokPostByPublishId(publish_id, {
              source: "poll",
              outcome: "failed",
              fail_reason: "Could not resolve access token for polling",
            });
          });
          return {
            outcome: "failed",
            reason: "token_resolution_exhausted",
          };
        }
        await step.sleep(`wait-token-error-${attempt}`, `${intervalMs}ms`);
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
            await finalizeTikTokPostByPublishId(publish_id, {
              source: "poll",
              outcome: "failed",
              fail_reason: `Status fetch errors exceeded: ${status.message}`,
            });
          });
          return {
            outcome: "failed",
            reason: "poll_errors_exceeded",
          };
        }
        await step.sleep(`wait-poll-error-${attempt}`, `${intervalMs}ms`);
        continue;
      }

      // Reset consecutive errors on a successful API call
      consecutiveErrors = 0;

      if (status.terminal && status.kind === "completed") {
        await step.run("finalize-completed", async () => {
          await finalizeTikTokPostByPublishId(publish_id, {
            source: "poll",
            outcome: "completed",
            tiktok_post_id: status.tiktok_post_id ?? null,
          });
        });
        return { outcome: "completed", raw_status: status.raw_status };
      }

      if (status.terminal && status.kind === "failed") {
        const reason = status.reason ?? `TikTok status: ${status.raw_status}`;
        await step.run("finalize-failed", async () => {
          await finalizeTikTokPostByPublishId(publish_id, {
            source: "poll",
            outcome: "failed",
            fail_reason: reason,
          });
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
      await finalizeTikTokPostByPublishId(publish_id, {
        source: "poll",
        outcome: "failed",
        fail_reason: "Timeout waiting for TikTok publish status",
      });
    });

    return { outcome: "failed", reason: "timeout" };
  },
);
