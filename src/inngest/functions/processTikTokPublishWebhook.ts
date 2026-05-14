import { inngest } from "@/inngest/client";
import { finalizeTikTokPostByPublishId } from "@/actions/server/data/finalizeTikTokPostByPublishId";

type WebhookContent = {
  publish_id?: string;
  post_id?: string | number;
  publish_type?: string;
  reason?: string;
};

/**
 * Inngest worker that processes TikTok Content Posting API webhooks.
 *
 * Triggered by the "tiktok.publish.webhook.received" event dispatched
 * by /api/webhooks/tiktok/publish after signature verification and
 * idempotency claim.
 *
 * Per TikTok doc, the inner content is a JSON-stringified string.
 * Event types handled:
 *   - post.publish.complete           -> finalize completed (no post_id)
 *   - post.publish.publicly_available -> finalize completed + post_id
 *   - post.publish.failed             -> finalize failed
 *   - others (inbox_delivered, no_longer_publicaly_available,
 *     authorization.removed, ...): logged and ignored.
 *
 * Retries: Inngest default. The finalize function is idempotent so
 * retries are safe.
 */
export const processTikTokPublishWebhook = inngest.createFunction(
  {
    id: "process-tiktok-publish-webhook",
    name: "Process TikTok publish webhook",
    retries: 3,
    triggers: [{ event: "tiktok.publish.webhook.received" }],
  },
  async ({ event }) => {
    const { event: eventName, content } = event.data as {
      event: string;
      content: string;
    };

    let parsed: WebhookContent;
    try {
      parsed = JSON.parse(content) as WebhookContent;
    } catch (parseErr) {
      console.error(
        "[processTikTokPublishWebhook] Failed to parse content:",
        parseErr instanceof Error ? parseErr.message : parseErr,
      );
      return { outcome: "skipped", reason: "content_parse_failed" };
    }

    if (!parsed.publish_id) {
      console.log(
        `[processTikTokPublishWebhook] Event ${eventName} has no publish_id, ignoring`,
      );
      return { outcome: "skipped", reason: "no_publish_id" };
    }

    // Ignore INBOX_SHARE publish_type. We only use DIRECT_POST.
    if (parsed.publish_type && parsed.publish_type === "INBOX_SHARE") {
      console.log(
        `[processTikTokPublishWebhook] Ignoring INBOX_SHARE event ${eventName}`,
      );
      return { outcome: "ignored", reason: "inbox_share" };
    }

    switch (eventName) {
      case "post.publish.complete": {
        const result = await finalizeTikTokPostByPublishId(parsed.publish_id, {
          source: "webhook",
          outcome: "completed",
          // post_id not yet known. publicly_available will arrive later
          // for public posts. SELF_ONLY never gets one.
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

        const result = await finalizeTikTokPostByPublishId(parsed.publish_id, {
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
        const result = await finalizeTikTokPostByPublishId(parsed.publish_id, {
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
