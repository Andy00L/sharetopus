import { z } from "zod";

import { inngest } from "@/inngest/client";
import { finalizeTikTokPostByPublishId } from "@/actions/server/data/finalizeTikTokPostByPublishId";

const WebhookEventDataSchema = z.object({
  event: z.string(),
  content: z.string().optional(),
});

// TikTok sends `content` as a serialized JSON string:
// https://developers.tiktok.com/doc/webhooks-events
const WebhookContentSchema = z.object({
  publish_id: z.string().nullish(),
  post_id: z.union([z.string(), z.number()]).nullish(),
  publish_type: z.string().nullish(),
  reason: z.string().nullish(),
});

export const processTikTokPublishWebhook = inngest.createFunction(
  {
    id: "process-tiktok-publish-webhook",
    name: "Process TikTok publish webhook",
    retries: 3,
    triggers: [{ event: "tiktok.publish.webhook.received" }],
  },
  async ({ event }) => {
    const eventData = WebhookEventDataSchema.safeParse(event.data);
    if (!eventData.success || eventData.data.content === undefined) {
      console.error("[processTikTokPublishWebhook] Event data has no content");
      return { outcome: "skipped", reason: "content_parse_failed" };
    }
    const { event: eventName, content } = eventData.data;

    let contentJson: unknown;
    try {
      contentJson = JSON.parse(content);
    } catch (parseErr) {
      console.error(
        "[processTikTokPublishWebhook] Failed to parse content:",
        parseErr instanceof Error ? parseErr.message : parseErr,
      );
      return { outcome: "skipped", reason: "content_parse_failed" };
    }

    const contentParse = WebhookContentSchema.safeParse(contentJson);
    if (!contentParse.success) {
      console.error(
        "[processTikTokPublishWebhook] Content is not a publish status object",
      );
      return { outcome: "skipped", reason: "content_parse_failed" };
    }
    const parsed = contentParse.data;

    if (!parsed.publish_id) {
      console.log(
        `[processTikTokPublishWebhook] Event ${eventName} has no publish_id, ignoring`,
      );
      return { outcome: "skipped", reason: "no_publish_id" };
    }

    if (parsed.publish_type && parsed.publish_type === "INBOX_SHARE") {
      console.log(
        `[processTikTokPublishWebhook] Ignoring INBOX_SHARE event ${eventName}`,
      );
      return { outcome: "ignored", reason: "inbox_share" };
    }

    switch (eventName) {
      case "post.publish.complete": {
        const result = await finalizeOrThrow(parsed.publish_id, {
          source: "webhook",
          outcome: "completed",
          // post.publish.complete carries no post_id; only
          // post.publish.publicly_available does, and a non-public post
          // never triggers it:
          // https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status
          tiktok_post_id: null,
        });
        return {
          outcome: "completed",
          publish_id: parsed.publish_id,
          finalize_result: result,
        };
      }

      case "post.publish.publicly_available": {
        const tiktokPostId =
          parsed.post_id !== undefined && parsed.post_id !== null
            ? String(parsed.post_id)
            : null;

        const result = await finalizeOrThrow(parsed.publish_id, {
          source: "webhook",
          outcome: "completed",
          tiktok_post_id: tiktokPostId,
        });
        return {
          outcome: "publicly_available",
          publish_id: parsed.publish_id,
          tiktok_post_id: tiktokPostId,
          finalize_result: result,
        };
      }

      case "post.publish.failed": {
        const result = await finalizeOrThrow(parsed.publish_id, {
          source: "webhook",
          outcome: "failed",
          fail_reason: parsed.reason ?? "TikTok webhook reported failure",
        });
        return {
          outcome: "failed",
          publish_id: parsed.publish_id,
          reason: parsed.reason,
          finalize_result: result,
        };
      }

      case "post.publish.inbox_delivered":
      case "post.publish.no_longer_publicaly_available":
      case "authorization.removed":
      default:
        console.log(
          `[processTikTokPublishWebhook] Ignored event type: ${eventName}`,
        );
        return { outcome: "ignored", reason: "unhandled_event_type" };
    }
  },
);

/**
 * Finalizes and throws on failure, the Inngest retry exception to errors
 * as values: this handler has no step.run, so a throw re-runs it whole.
 */
async function finalizeOrThrow(
  publishId: string,
  outcome: Parameters<typeof finalizeTikTokPostByPublishId>[1],
): Promise<Awaited<ReturnType<typeof finalizeTikTokPostByPublishId>>> {
  const finalized = await finalizeTikTokPostByPublishId(publishId, outcome);
  if (!finalized.success) {
    throw new Error(`[finalizeOrThrow] ${publishId}: ${finalized.message}`);
  }
  return finalized;
}
