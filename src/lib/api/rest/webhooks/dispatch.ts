import "server-only";

import { randomUUID } from "node:crypto";

import { waitUntil } from "@vercel/functions";
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
 * eventId. Used by the replay endpoint, which must reach only the
 * subscription being replayed.
 */
export async function sendWebhookDispatchEvent(
  delivery: WebhookDelivery,
): Promise<WebhookDispatchSendResult> {
  return sendWebhookDispatchEvents([delivery]);
}

type WebhookDelivery = {
  subscriptionId: string;
  eventType: string;
  eventId: string;
  payload: Record<string, unknown>;
};

async function sendWebhookDispatchEvents(
  deliveries: WebhookDelivery[],
): Promise<WebhookDispatchSendResult> {
  try {
    await inngest.send(
      deliveries.map((delivery) => ({
        name: "webhook.dispatch.v1",
        data: {
          subscription_id: delivery.subscriptionId,
          event_type: delivery.eventType,
          event_id: delivery.eventId,
          payload: delivery.payload,
        },
      })),
    );
    return { ok: true };
  } catch (sendError) {
    return {
      ok: false,
      message: sendError instanceof Error ? sendError.message : String(sendError),
    };
  }
}

export function dispatchWebhook(
  principalId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  return dispatchWebhooks(principalId, eventType, [payload]);
}

/**
 * Queues one delivery per (event, matching subscription): one subscription
 * read and one Inngest send for the whole list. Each payload is its own
 * event with its own eventId. The delivery worker signs, retries and records.
 *
 * Never throws. A failed read or send is logged. The work is registered with
 * waitUntil, so a caller that does not await it (a floating call in an
 * Inngest step or a server action) still has the send finish before the
 * function is frozen.
 */
export function dispatchWebhooks(
  principalId: string,
  eventType: string,
  payloads: Record<string, unknown>[],
): Promise<void> {
  const dispatchWork = queueWebhookDeliveries(principalId, eventType, payloads);
  waitUntil(dispatchWork);
  return dispatchWork;
}

async function queueWebhookDeliveries(
  principalId: string,
  eventType: string,
  payloads: Record<string, unknown>[],
): Promise<void> {
  if (payloads.length === 0) return;
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
        `[queueWebhookDeliveries] subscription lookup failed (principal=${principalId}, event=${eventType}):`,
        lookupError.message,
      );
      return;
    }

    if (matchingSubscriptions.length === 0) {
      return;
    }

    const deliveries = payloads.flatMap((payload) => {
      const eventId = randomUUID();
      return matchingSubscriptions.map((subscription) => ({
        subscriptionId: subscription.id,
        eventType,
        eventId,
        payload,
      }));
    });

    const sendResult = await sendWebhookDispatchEvents(deliveries);
    if (!sendResult.ok) {
      console.warn(
        `[queueWebhookDeliveries] Inngest send failed for ${deliveries.length} deliveries (principal=${principalId}, event=${eventType}):`,
        sendResult.message,
      );
    }
  } catch (unexpectedError) {
    console.warn(
      "[queueWebhookDeliveries] unexpected error:",
      unexpectedError instanceof Error
        ? unexpectedError.message
        : unexpectedError,
    );
  }
}
