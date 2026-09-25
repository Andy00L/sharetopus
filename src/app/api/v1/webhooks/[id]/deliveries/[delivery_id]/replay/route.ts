import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { sendWebhookDispatchEvent } from "@/lib/api/rest/webhooks/dispatch";
import type { WebhookReplayResult } from "@/lib/api/rest/openapi/responseSchemas";
import { db, runQuery } from "@/db/client";
import { webhook_deliveries, webhook_subscriptions } from "@/db/schema";

const UuidSchema = z.guid();

/**
 * POST /v1/webhooks/[id]/deliveries/[delivery_id]/replay
 *
 * Re-dispatches a past delivery's event, with its original event_id and
 * payload, to this subscription only, through the same Inngest pipeline
 * as live events (sendWebhookDispatchEvent).
 *
 * - Deleted subscription: 404
 * - Disabled subscription: 403 (re-enable first)
 * - Delivery not found or not owned: 404
 * - Database lookup or Inngest send failure: 500
 */
export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.webhooks.replay",
  handler: async (ctx, request) => {
    // Step 1: extract IDs from URL path.
    // Path: /api/v1/webhooks/[id]/deliveries/[delivery_id]/replay, so the
    // delivery id is second-to-last and the subscription id fourth-to-last.
    // Reading fifth-to-last picked up "webhooks" and rejected every replay
    // as an invalid id.
    const urlSegments = new URL(request.url).pathname.split("/");
    const deliveryIdCandidate = urlSegments[urlSegments.length - 2] ?? "";
    const subscriptionIdCandidate = urlSegments[urlSegments.length - 4] ?? "";

    const subscriptionIdResult = UuidSchema.safeParse(subscriptionIdCandidate);
    const deliveryIdResult = UuidSchema.safeParse(deliveryIdCandidate);

    if (!subscriptionIdResult.success || !deliveryIdResult.success) {
      return restErrorResponse(
        "validation_error",
        "Invalid subscription or delivery id format",
        ctx.requestId,
      );
    }
    const subscriptionId = subscriptionIdResult.data;
    const deliveryId = deliveryIdResult.data;

    // Step 2: verify subscription exists and is owned by principal.
    const { data: subscriptionRows, error: subError } = await runQuery(
      db
        .select({ active: webhook_subscriptions.active })
        .from(webhook_subscriptions)
        .where(
          and(
            eq(webhook_subscriptions.id, subscriptionId),
            eq(webhook_subscriptions.principal_id, ctx.principal.principalId),
          ),
        )
        .limit(1),
    );

    if (subError) {
      console.error(
        `[v1/webhooks/[id]/deliveries/[delivery_id]/replay POST] subscription lookup failed (request_id=${ctx.requestId}):`,
        subError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Webhook subscription lookup failed",
        ctx.requestId,
      );
    }
    const subscriptionRow = subscriptionRows[0];
    if (!subscriptionRow) {
      return restErrorResponse(
        "not_found",
        "Webhook subscription not found",
        ctx.requestId,
      );
    }

    if (!subscriptionRow.active) {
      return restErrorResponse(
        "forbidden",
        "Subscription is disabled. Re-enable it before replaying.",
        ctx.requestId,
      );
    }

    // Step 3: load original delivery row.
    const { data: deliveryRows, error: deliveryError } = await runQuery(
      db
        .select({
          event_type: webhook_deliveries.event_type,
          event_id: webhook_deliveries.event_id,
          payload: webhook_deliveries.payload,
        })
        .from(webhook_deliveries)
        .where(
          and(
            eq(webhook_deliveries.id, deliveryId),
            eq(webhook_deliveries.subscription_id, subscriptionId),
          ),
        )
        .limit(1),
    );

    if (deliveryError) {
      console.error(
        `[v1/webhooks/[id]/deliveries/[delivery_id]/replay POST] delivery lookup failed (request_id=${ctx.requestId}):`,
        deliveryError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Delivery lookup failed",
        ctx.requestId,
      );
    }
    const originalDeliveryRow = deliveryRows[0];
    if (!originalDeliveryRow) {
      return restErrorResponse(
        "not_found",
        "Delivery not found",
        ctx.requestId,
      );
    }

    // Step 4: queue one delivery for this subscription. dispatchWebhook
    // would send the event to every active subscription of the principal
    // that listens for this event type, not only the one being replayed.
    const replayPayload =
      typeof originalDeliveryRow.payload === "object" &&
      originalDeliveryRow.payload !== null &&
      !Array.isArray(originalDeliveryRow.payload)
        ? (originalDeliveryRow.payload as Record<string, unknown>)
        : {};

    const replaySendResult = await sendWebhookDispatchEvent({
      subscriptionId,
      eventType: originalDeliveryRow.event_type,
      eventId: originalDeliveryRow.event_id,
      payload: replayPayload,
    });
    if (!replaySendResult.ok) {
      console.error(
        `[v1/webhooks/[id]/deliveries/[delivery_id]/replay POST] dispatch failed (request_id=${ctx.requestId}):`,
        replaySendResult.message,
      );
      return restErrorResponse(
        "internal_error",
        "Replay could not be dispatched",
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        {
          subscription_id: subscriptionId,
          original_delivery_id: deliveryId,
          event_type: originalDeliveryRow.event_type,
          message: "Replay dispatched. A new delivery will appear shortly.",
        } satisfies WebhookReplayResult,
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        subscription_id: subscriptionId,
        original_delivery_id: deliveryId,
        event_type: originalDeliveryRow.event_type,
      },
    };
  },
});
