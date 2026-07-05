import { inngest } from "../client";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { deliverSignedWebhook } from "@/lib/api/rest/webhooks/deliverSignedWebhook";
import { signWebhookPayload } from "@/lib/api/rest/webhooks/signWebhookPayload";
import type { Json } from "@/lib/types/database.types";

const DELIVERY_TIMEOUT_MS = 10_000;
const AUTO_DISABLE_THRESHOLD = 10;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

type WebhookDispatchEventData = {
  subscription_id: string;
  event_type: string;
  event_id: string;
  payload: Record<string, unknown>;
};

/**
 * Inngest function that delivers a single webhook event to one subscriber.
 *
 * Flow:
 *   1. Load subscription (skip if disabled or deleted)
 *   2. Build JSON body and HMAC-SHA256 signature
 *   3. POST to subscriber URL with timeout
 *   4. Record delivery in webhook_deliveries
 *   5. On success: reset failure_count
 *   6. On failure: increment failure_count, auto-disable at threshold
 *   7. On retryable failure (5xx, 408, 429, network): throw to trigger Inngest retry
 *
 * The throw on retryable failures is the ONE permitted throw in this
 * phase (Inngest retry contract). Terminal failures (4xx except 408/429)
 * return cleanly.
 */
export const deliverWebhook = inngest.createFunction(
  {
    id: "deliver-webhook",
    name: "Deliver Webhook",
    retries: 3,
    throttle: { limit: 100, period: "60s" },
    triggers: [{ event: "webhook.dispatch.v1" }],
  },
  async ({ event }) => {
    const eventData = event.data as WebhookDispatchEventData;
    const { subscription_id, event_type, event_id, payload } = eventData;

    // Step 1: load subscription (skip if disabled or deleted).
    const { data: subscriptionRow, error: loadError } = await adminSupabase
      .from("webhook_subscriptions")
      .select("id, principal_id, url, secret, active, failure_count")
      .eq("id", subscription_id)
      .eq("active", true)
      .maybeSingle();

    if (loadError || !subscriptionRow) {
      return { skipped: true, reason: "subscription_inactive_or_deleted" };
    }

    // Step 2: build payload + HMAC sign.
    const deliveryId = crypto.randomUUID();
    const bodyString = JSON.stringify({
      event_type,
      event_id,
      delivery_id: deliveryId,
      created_at: new Date().toISOString(),
      data: payload,
    });
    const hmacSignatureHex = signWebhookPayload(
      bodyString,
      subscriptionRow.secret,
    );

    // Step 3: POST to subscriber URL (SSRF-guarded, IP-pinned at delivery).
    const startedAt = Date.now();
    const { statusCode, responseBody, errorMessage } =
      await deliverSignedWebhook(subscriptionRow.url, {
        headers: {
          "Content-Type": "application/json",
          "X-Sharetopus-Event": event_type,
          "X-Sharetopus-Delivery": deliveryId,
          "X-Sharetopus-Signature": `sha256=${hmacSignatureHex}`,
          "User-Agent": "Sharetopus-Webhook/1.0",
        },
        body: bodyString,
        timeoutMs: DELIVERY_TIMEOUT_MS,
      });

    const latencyMs = Date.now() - startedAt;
    const wasSuccess =
      statusCode !== null && statusCode >= 200 && statusCode < 300;

    // Step 4: persist delivery record.
    await adminSupabase.from("webhook_deliveries").insert({
      id: deliveryId,
      subscription_id,
      event_type,
      event_id,
      payload: payload as Json,
      status_code: statusCode,
      response_body: responseBody,
      attempt: 1,
      latency_ms: latencyMs,
      delivered_at: wasSuccess ? new Date().toISOString() : null,
      failed_at: wasSuccess ? null : new Date().toISOString(),
      error_message: errorMessage,
    });

    // Step 5: update subscription stats on success.
    if (wasSuccess) {
      await adminSupabase
        .from("webhook_subscriptions")
        .update({
          failure_count: 0,
          last_delivery_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscription_id);

      return { delivered: true, status_code: statusCode };
    }

    // Step 6: failure path -- increment failure_count, auto-disable at threshold.
    const newFailureCount = subscriptionRow.failure_count + 1;
    const shouldAutoDisable = newFailureCount >= AUTO_DISABLE_THRESHOLD;

    await adminSupabase
      .from("webhook_subscriptions")
      .update({
        failure_count: newFailureCount,
        active: !shouldAutoDisable,
        ...(shouldAutoDisable
          ? { last_disabled_at: new Date().toISOString() }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscription_id);

    // Step 7: retryable failures throw for Inngest backoff. Terminal
    // failures (4xx that are not 408/429) return cleanly.
    if (
      statusCode === null ||
      RETRYABLE_STATUS_CODES.has(statusCode)
    ) {
      throw new Error(
        `Webhook delivery failed: status=${statusCode ?? "network"} err=${errorMessage ?? "5xx"}`,
      );
    }

    return {
      delivered: false,
      status_code: statusCode,
      terminal: true,
    };
  },
);
