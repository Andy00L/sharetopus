import "server-only";

import { randomUUID } from "node:crypto";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { inngest } from "@/inngest/client";

/**
 * Looks up active webhook subscriptions for the principal matching the
 * given event type, then dispatches one Inngest event per subscription.
 * The delivery worker handles HMAC signing, retry, and audit.
 *
 * Fire-and-forget from the caller's perspective. Never throws. If no
 * subscriptions match, returns silently. If DB lookup or Inngest dispatch
 * fails, logs a warning and returns.
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
    const { data: matchingSubscriptions, error: lookupError } =
      await adminSupabase
        .from("webhook_subscriptions")
        .select("id, url, events")
        .eq("principal_id", principalId)
        .eq("active", true)
        .contains("events", [eventType]);

    if (lookupError) {
      console.warn(
        `[dispatchWebhook] subscription lookup failed (principal=${principalId}, event=${eventType}):`,
        lookupError.message,
      );
      return;
    }

    if (!matchingSubscriptions || matchingSubscriptions.length === 0) {
      return;
    }

    // Each subscription gets its own Inngest event so the delivery
    // worker can retry, rate-limit, and record per-subscription.
    const eventIdBase = randomUUID();
    const dispatchPromises = matchingSubscriptions.map(
      (subscription, index) =>
        inngest.send({
          name: "webhook.dispatch.v1",
          data: {
            subscription_id: subscription.id,
            event_type: eventType,
            event_id: eventIdBase,
            payload,
          },
        }),
    );

    await Promise.allSettled(dispatchPromises);
  } catch (unexpectedError) {
    console.warn(
      "[dispatchWebhook] unexpected error:",
      unexpectedError instanceof Error
        ? unexpectedError.message
        : unexpectedError,
    );
  }
}
