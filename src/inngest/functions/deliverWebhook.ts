import { and, eq, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { inngest } from "../client";
import {
  webhookDispatchEvent,
  type WebhookDispatchEventData,
} from "../events/webhookDispatch";
import { db, runQuery } from "@/db/client";
import { webhook_deliveries, webhook_subscriptions } from "@/db/schema";
import { deliverSignedWebhook } from "@/lib/api/rest/webhooks/deliverSignedWebhook";
import { signWebhookPayload } from "@/lib/api/rest/webhooks/signWebhookPayload";

const DELIVERY_TIMEOUT_MS = 10_000;
const AUTO_DISABLE_THRESHOLD = 10;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_DELAYS_BEFORE_NEXT_ATTEMPT = ["30s", "2m", "10m"] as const;
const DB_STEP_RETRIES = 3;
const FOREIGN_KEY_VIOLATION_SQLSTATE = "23503";

type DeliveryAttempt =
  | { kind: "subscription_gone" }
  | {
      kind: "sent";
      deliveryId: string;
      statusCode: number | null;
      responseBody: string | null;
      errorMessage: string | null;
      latencyMs: number;
      finishedAt: string;
    };

// Each side effect is its own step: Inngest stores a completed step's result
// and retries only the step that threw, so a failed log or counter write
// never sends the POST again. A new POST attempt gets a new step id.
// https://www.inngest.com/docs/learn/how-functions-are-executed
export const deliverWebhook = inngest.createFunction(
  {
    id: "deliver-webhook",
    name: "Deliver Webhook",
    retries: DB_STEP_RETRIES,
    throttle: {
      limit: 100,
      period: "60s",
      key: "event.data.subscription_id",
    },
    triggers: [webhookDispatchEvent],
  },
  async ({ event, step }) => {
    const delivery = event.data;

    for (let attemptNumber = 1; ; attemptNumber++) {
      const attempt = await step.run(`send-${attemptNumber}`, () =>
        sendSignedDelivery(delivery),
      );
      if (attempt.kind === "subscription_gone") {
        return { skipped: true, reason: "subscription_inactive_or_deleted" };
      }

      await step.run(`record-delivery-${attemptNumber}`, () =>
        recordDeliveryAttempt({ delivery, attempt, attemptNumber }),
      );

      if (isSuccessStatus(attempt.statusCode)) {
        await step.run("reset-failure-count", () =>
          resetSubscriptionFailures(delivery.subscription_id),
        );
        return { delivered: true, status_code: attempt.statusCode, attempts: attemptNumber };
      }

      const isRetryable =
        attempt.statusCode === null || RETRYABLE_STATUS_CODES.has(attempt.statusCode);
      const retryDelay = RETRY_DELAYS_BEFORE_NEXT_ATTEMPT.at(attemptNumber - 1);
      if (isRetryable && retryDelay !== undefined) {
        await step.sleep(`backoff-${attemptNumber}`, retryDelay);
        continue;
      }

      await step.run("count-failure", () =>
        countSubscriptionFailure(delivery.subscription_id),
      );
      if (isRetryable) {
        // NonRetriableError stops the run without a retry
        // (node_modules/inngest/components/NonRetriableError.d.ts).
        throw new NonRetriableError(
          `[deliverWebhook] Delivery failed after ${attemptNumber} attempts: status=${attempt.statusCode ?? "network"} err=${attempt.errorMessage ?? "5xx"}`,
        );
      }
      return {
        delivered: false,
        status_code: attempt.statusCode,
        terminal: true,
        attempts: attemptNumber,
      };
    }
  },
);

function isSuccessStatus(statusCode: number | null): boolean {
  return statusCode !== null && statusCode >= 200 && statusCode < 300;
}

async function sendSignedDelivery(
  delivery: WebhookDispatchEventData,
): Promise<DeliveryAttempt> {
  const { data: subscriptionRows, error: loadError } = await runQuery(
    db
      .select({
        url: webhook_subscriptions.url,
        secret: webhook_subscriptions.secret,
      })
      .from(webhook_subscriptions)
      .where(
        and(
          eq(webhook_subscriptions.id, delivery.subscription_id),
          eq(webhook_subscriptions.active, true),
        ),
      )
      .limit(1),
  );
  if (loadError) {
    throw new Error(
      `[sendSignedDelivery] Subscription lookup failed for ${delivery.subscription_id}: ${loadError.message}`,
    );
  }
  const subscriptionRow = subscriptionRows[0];
  if (!subscriptionRow) return { kind: "subscription_gone" };

  const deliveryId = crypto.randomUUID();
  const bodyString = JSON.stringify({
    event_type: delivery.event_type,
    event_id: delivery.event_id,
    delivery_id: deliveryId,
    created_at: new Date().toISOString(),
    data: delivery.payload,
  });
  const hmacSignatureHex = signWebhookPayload(bodyString, subscriptionRow.secret);

  const startedAt = Date.now();
  const outcome = await deliverSignedWebhook(subscriptionRow.url, {
    headers: {
      "Content-Type": "application/json",
      "X-Sharetopus-Event": delivery.event_type,
      "X-Sharetopus-Delivery": deliveryId,
      "X-Sharetopus-Signature": `sha256=${hmacSignatureHex}`,
      "User-Agent": "Sharetopus-Webhook/1.0",
    },
    body: bodyString,
    timeoutMs: DELIVERY_TIMEOUT_MS,
  });

  return {
    kind: "sent",
    deliveryId,
    statusCode: outcome.statusCode,
    responseBody: outcome.responseBody,
    errorMessage: outcome.errorMessage,
    latencyMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString(),
  };
}

async function recordDeliveryAttempt(input: {
  delivery: WebhookDispatchEventData;
  attempt: Extract<DeliveryAttempt, { kind: "sent" }>;
  attemptNumber: number;
}): Promise<void> {
  const { delivery, attempt } = input;
  const wasSuccess = isSuccessStatus(attempt.statusCode);
  const { error } = await runQuery(
    db
      .insert(webhook_deliveries)
      .values({
        id: attempt.deliveryId,
        subscription_id: delivery.subscription_id,
        event_type: delivery.event_type,
        event_id: delivery.event_id,
        payload: delivery.payload,
        status_code: attempt.statusCode,
        response_body: attempt.responseBody,
        attempt: input.attemptNumber,
        latency_ms: attempt.latencyMs,
        delivered_at: wasSuccess ? attempt.finishedAt : null,
        failed_at: wasSuccess ? null : attempt.finishedAt,
        error_message: attempt.errorMessage,
      })
      .onConflictDoNothing({ target: webhook_deliveries.id }),
  );
  if (error?.code === FOREIGN_KEY_VIOLATION_SQLSTATE) return;
  if (error) {
    throw new Error(
      `[recordDeliveryAttempt] delivery log insert failed (subscription=${delivery.subscription_id}, delivery=${attempt.deliveryId}): ${error.message}`,
    );
  }
}

async function resetSubscriptionFailures(subscriptionId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await runQuery(
    db
      .update(webhook_subscriptions)
      .set({ failure_count: 0, last_delivery_at: nowIso, updated_at: nowIso })
      .where(eq(webhook_subscriptions.id, subscriptionId)),
  );
  if (error) {
    throw new Error(
      `[resetSubscriptionFailures] failure count reset failed (subscription=${subscriptionId}): ${error.message}`,
    );
  }
}

async function countSubscriptionFailure(subscriptionId: string): Promise<void> {
  const reachesAutoDisable = sql`${webhook_subscriptions.failure_count} + 1 >= ${AUTO_DISABLE_THRESHOLD}`;
  const nowIso = new Date().toISOString();
  const { error } = await runQuery(
    db
      .update(webhook_subscriptions)
      .set({
        failure_count: sql`${webhook_subscriptions.failure_count} + 1`,
        active: sql`${webhook_subscriptions.active} and not (${reachesAutoDisable})`,
        last_disabled_at: sql`case when ${webhook_subscriptions.active} and ${reachesAutoDisable} then ${nowIso}::timestamptz else ${webhook_subscriptions.last_disabled_at} end`,
        updated_at: nowIso,
      })
      .where(eq(webhook_subscriptions.id, subscriptionId)),
  );
  if (error) {
    throw new Error(
      `[countSubscriptionFailure] failure count update failed (subscription=${subscriptionId}): ${error.message}`,
    );
  }
}
