import { and, eq, sql } from "drizzle-orm";

import { inngest } from "../client";
import { db, runQuery } from "@/db/client";
import {
  webhook_deliveries,
  webhook_subscriptions,
  type Json,
} from "@/db/schema";
import { deliverSignedWebhook } from "@/lib/api/rest/webhooks/deliverSignedWebhook";
import { signWebhookPayload } from "@/lib/api/rest/webhooks/signWebhookPayload";

const DELIVERY_TIMEOUT_MS = 10_000;
const AUTO_DISABLE_THRESHOLD = 10;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Inngest retry budget for one dispatch. Declared here (rather than inline
 * on the function config) because the handler needs it to recognize its
 * final attempt: `attempt` is zero-indexed, so the last one is
 * MAX_DELIVERY_RETRIES.
 * sourceRef: node_modules/inngest/types.d.ts, BaseContext.attempt.
 */
const MAX_DELIVERY_RETRIES = 3;

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
 * Two throws drive Inngest retries (its retry contract): a failed
 * subscription lookup in step 1, before anything was sent, and a retryable
 * delivery failure in step 7. Terminal failures (4xx except 408/429)
 * return cleanly. Write failures after the POST are logged, never thrown:
 * a retry would send the subscriber the same event again.
 */
export const deliverWebhook = inngest.createFunction(
  {
    id: "deliver-webhook",
    name: "Deliver Webhook",
    retries: MAX_DELIVERY_RETRIES,
    // Keyed per subscription, so one busy subscriber cannot use up the
    // budget and delay every other subscriber's deliveries.
    throttle: {
      limit: 100,
      period: "60s",
      key: "event.data.subscription_id",
    },
    triggers: [{ event: "webhook.dispatch.v1" }],
  },
  async ({ event, attempt }) => {
    const eventData = event.data as WebhookDispatchEventData;
    const { subscription_id, event_type, event_id, payload } = eventData;

    // Step 1: load subscription (skip if disabled or deleted).
    const { data: subscriptionRows, error: loadError } = await runQuery(
      db
        .select({
          url: webhook_subscriptions.url,
          secret: webhook_subscriptions.secret,
        })
        .from(webhook_subscriptions)
        .where(
          and(
            eq(webhook_subscriptions.id, subscription_id),
            eq(webhook_subscriptions.active, true),
          ),
        )
        .limit(1),
    );

    // A failed lookup is not a deleted subscription. Returning "skipped"
    // here dropped the event for good; nothing was sent yet, so a retry
    // is safe.
    if (loadError) {
      throw new Error(
        `[deliverWebhook] Subscription lookup failed for ${subscription_id}: ${loadError.message}`,
      );
    }
    const subscriptionRow = subscriptionRows[0];
    if (!subscriptionRow) {
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
    const { error: deliveryLogError } = await runQuery(
      db.insert(webhook_deliveries).values({
        id: deliveryId,
        subscription_id,
        event_type,
        event_id,
        payload: payload as Json,
        status_code: statusCode,
        response_body: responseBody,
        // Real attempt number. `attempt` is zero-indexed, the column is
        // 1-indexed. This used to be hardcoded to 1, so every retry row
        // claimed to be the first try.
        attempt: attempt + 1,
        latency_ms: latencyMs,
        delivered_at: wasSuccess ? new Date().toISOString() : null,
        failed_at: wasSuccess ? null : new Date().toISOString(),
        error_message: errorMessage,
      }),
    );
    if (deliveryLogError) {
      console.error(
        `[deliverWebhook] delivery log insert failed (subscription=${subscription_id}, delivery=${deliveryId}):`,
        deliveryLogError.message,
      );
    }

    // Step 5: update subscription stats on success.
    if (wasSuccess) {
      const { error: resetError } = await runQuery(
        db
          .update(webhook_subscriptions)
          .set({
            failure_count: 0,
            last_delivery_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .where(eq(webhook_subscriptions.id, subscription_id)),
      );
      if (resetError) {
        console.error(
          `[deliverWebhook] failure count reset failed (subscription=${subscription_id}):`,
          resetError.message,
        );
      }

      return { delivered: true, status_code: statusCode };
    }

    // Step 6: failure path. This handler uses no step.run, so a retry
    // re-executes the whole body. Counting a failure on every attempt made
    // one bad event cost MAX_DELIVERY_RETRIES + 1 increments, so a
    // subscriber hit AUTO_DISABLE_THRESHOLD (10) after ~2 failing events
    // instead of 10 and was silently deactivated. Count once per event: on
    // the last attempt, or immediately when the status is terminal and no
    // retry will follow.
    const failureIsRetryable =
      statusCode === null || RETRYABLE_STATUS_CODES.has(statusCode);
    const isFinalAttempt = attempt >= MAX_DELIVERY_RETRIES;

    if (!failureIsRetryable || isFinalAttempt) {
      // Computed from the stored row in one statement. Writing a count read
      // in step 1 lost increments from concurrent deliveries, and writing
      // `active: true` below the threshold re-enabled a subscription the
      // user disabled while this delivery was in flight.
      const reachesAutoDisable = sql`${webhook_subscriptions.failure_count} + 1 >= ${AUTO_DISABLE_THRESHOLD}`;
      const nowIso = new Date().toISOString();
      const { error: failureCountError } = await runQuery(
        db
          .update(webhook_subscriptions)
          .set({
            failure_count: sql`${webhook_subscriptions.failure_count} + 1`,
            active: sql`${webhook_subscriptions.active} and not (${reachesAutoDisable})`,
            last_disabled_at: sql`case when ${webhook_subscriptions.active} and ${reachesAutoDisable} then ${nowIso}::timestamptz else ${webhook_subscriptions.last_disabled_at} end`,
            updated_at: nowIso,
          })
          .where(eq(webhook_subscriptions.id, subscription_id)),
      );
      if (failureCountError) {
        console.error(
          `[deliverWebhook] failure count update failed (subscription=${subscription_id}):`,
          failureCountError.message,
        );
      }
    }

    // Step 7: retryable failures throw for Inngest backoff. Terminal
    // failures (4xx that are not 408/429) return cleanly.
    if (failureIsRetryable) {
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
