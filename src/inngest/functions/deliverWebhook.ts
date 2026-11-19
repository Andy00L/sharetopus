import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { inngest } from "../client";
import { db, runQuery } from "@/db/client";
import { webhook_deliveries, webhook_subscriptions } from "@/db/schema";
import { deliverSignedWebhook } from "@/lib/api/rest/webhooks/deliverSignedWebhook";
import { signWebhookPayload } from "@/lib/api/rest/webhooks/signWebhookPayload";

const DELIVERY_TIMEOUT_MS = 10_000;
const AUTO_DISABLE_THRESHOLD = 10;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

// Inngest's `attempt` is zero-indexed, so the last attempt equals this
// count. sourceRef: node_modules/inngest/types.d.ts, BaseContext.attempt.
const MAX_DELIVERY_RETRIES = 3;

const WebhookDispatchEventDataSchema = z.object({
  subscription_id: z.string(),
  event_type: z.string(),
  event_id: z.string(),
  payload: z.record(z.string(), z.json()),
});

// Two throws drive Inngest retries: a failed subscription lookup, before
// anything was sent, and a retryable delivery failure. With no step.run, a
// retry re-runs the whole handler:
// https://www.inngest.com/docs/learn/how-functions-are-executed
export const deliverWebhook = inngest.createFunction(
  {
    id: "deliver-webhook",
    name: "Deliver Webhook",
    retries: MAX_DELIVERY_RETRIES,
    throttle: {
      limit: 100,
      period: "60s",
      key: "event.data.subscription_id",
    },
    triggers: [{ event: "webhook.dispatch.v1" }],
  },
  async ({ event, attempt }) => {
    const eventData = WebhookDispatchEventDataSchema.safeParse(event.data);
    if (!eventData.success) {
      console.error("[deliverWebhook] Event data is malformed; nothing sent");
      return { skipped: true, reason: "invalid_event_data" };
    }
    const { subscription_id, event_type, event_id, payload } = eventData.data;

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

    if (loadError) {
      throw new Error(
        `[deliverWebhook] Subscription lookup failed for ${subscription_id}: ${loadError.message}`,
      );
    }
    const subscriptionRow = subscriptionRows[0];
    if (!subscriptionRow) {
      return { skipped: true, reason: "subscription_inactive_or_deleted" };
    }

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

    const { error: deliveryLogError } = await runQuery(
      db.insert(webhook_deliveries).values({
        id: deliveryId,
        subscription_id,
        event_type,
        event_id,
        payload,
        status_code: statusCode,
        response_body: responseBody,
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

    const failureIsRetryable =
      statusCode === null || RETRYABLE_STATUS_CODES.has(statusCode);
    const isFinalAttempt = attempt >= MAX_DELIVERY_RETRIES;

    if (!failureIsRetryable || isFinalAttempt) {
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
