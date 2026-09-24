import "server-only";

import { randomUUID } from "node:crypto";

import { and, arrayContains, eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { webhook_subscriptions } from "@/db/schema";
import { inngest } from "@/inngest/client";

export type WebhookDispatchSendResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Queues one delivery of one event to one subscription as a
 * webhook.dispatch.v1 Inngest event; the deliver-webhook worker signs,
 * sends, retries and records it. Deliveries of the same event share
 * eventId. Used by dispatchWebhook for live events and by the replay
 * endpoint, which must reach only the subscription being replayed.
 */
export async function sendWebhookDispatchEvent(delivery: {
  subscriptionId: string;
  eventType: string;
  eventId: string;
  payload: Record<string, unknown>;
}): Promise<WebhookDispatchSendResult> {
  try {
    await inngest.send({
      name: "webhook.dispatch.v1",
      data: {
        subscription_id: delivery.subscriptionId,
        event_type: delivery.eventType,
        event_id: delivery.eventId,
        payload: delivery.payload,
      },
    });
    return { ok: true };
  } catch (sendError) {
    return {
      ok: false,
      message: sendError instanceof Error ? sendError.message : String(sendError),
    };
  }
}

/**
 * Looks up active webhook subscriptions for the principal matching the
 * given event type, then dispatches one Inngest event per subscription.
 * The delivery worker handles HMAC signing, retry, and audit.
 *
 * Fire-and-forget from the caller's perspective. Never throws. If no
 * subscriptions match, returns silently. If the DB lookup or an Inngest
 * send fails, logs a warning and returns.
 *
 * Caller pattern: invoke after any stateful operation worth notifying
 * (post created, post published, connection succeeded, etc.). Do NOT
 * await the delivery itself; the worker handles that downstream.
 */
export async function dispatchWebhook(
  principalId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: matchingSubscriptions, error: lookupError } = await runQuery(
      db
        .select({ id: webhook_subscriptions.id })
        .from(webhook_subscriptions)
        .where(
          and(
            eq(webhook_subscriptions.principal_id, principalId),
            eq(webhook_subscriptions.active, true),
            arrayContains(webhook_subscriptions.events, [eventType]),
          ),
        ),
    );

    if (lookupError) {
      console.warn(
        `[dispatchWebhook] subscription lookup failed (principal=${principalId}, event=${eventType}):`,
        lookupError.message,
      );
      return;
    }

    if (matchingSubscriptions.length === 0) {
      return;
    }

    // Each subscription gets its own Inngest event so the delivery
    // worker can retry, rate-limit, and record per-subscription.
    const eventId = randomUUID();
    const sendResults = await Promise.all(
      matchingSubscriptions.map((subscription) =>
        sendWebhookDispatchEvent({
          subscriptionId: subscription.id,
          eventType,
          eventId,
          payload,
        }),
      ),
    );

    for (const sendResult of sendResults) {
      if (!sendResult.ok) {
        console.warn(
          `[dispatchWebhook] Inngest send failed (principal=${principalId}, event=${eventType}):`,
          sendResult.message,
        );
      }
    }
  } catch (unexpectedError) {
    console.warn(
      "[dispatchWebhook] unexpected error:",
      unexpectedError instanceof Error
        ? unexpectedError.message
        : unexpectedError,
    );
  }
}
