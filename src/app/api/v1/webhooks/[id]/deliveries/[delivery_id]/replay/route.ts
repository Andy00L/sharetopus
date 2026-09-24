import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { dispatchWebhook } from "@/lib/api/rest/webhooks/dispatch";
import { db, runQuery } from "@/db/client";
import { webhook_deliveries, webhook_subscriptions } from "@/db/schema";

const UuidSchema = z.guid();

/**
 * POST /v1/webhooks/[id]/deliveries/[delivery_id]/replay
 *
 * Re-dispatches a past delivery's event through the same Inngest
 * pipeline as live events. Reuses dispatchWebhook (single source).
 *
 * - Deleted subscription: 404
 * - Disabled subscription: 409 (re-enable first)
 * - Delivery not found or not owned: 404
 */
export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.webhooks.replay",
  handler: async (ctx, request) => {
    // Step 1: extract IDs from URL path.
    // Path: /api/v1/webhooks/[id]/deliveries/[delivery_id]/replay
    const urlSegments = new URL(request.url).pathname.split("/");
    const deliveryIdCandidate = urlSegments[urlSegments.length - 2] ?? "";
    const subscriptionIdCandidate = urlSegments[urlSegments.length - 5] ?? "";

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

    const subscriptionRow = subscriptionRows?.[0];
    if (subError || !subscriptionRow) {
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

    const originalDeliveryRow = deliveryRows?.[0];
    if (deliveryError || !originalDeliveryRow) {
      return restErrorResponse(
        "not_found",
        "Delivery not found",
        ctx.requestId,
      );
    }

    // Step 4: re-dispatch through the same Inngest pipeline as live events.
    const replayPayload =
      typeof originalDeliveryRow.payload === "object" &&
      originalDeliveryRow.payload !== null &&
      !Array.isArray(originalDeliveryRow.payload)
        ? (originalDeliveryRow.payload as Record<string, unknown>)
        : {};

    await dispatchWebhook(
      ctx.principal.principalId,
      originalDeliveryRow.event_type,
      replayPayload,
    );

    return {
      response: NextResponse.json(
        {
          subscription_id: subscriptionId,
          original_delivery_id: deliveryId,
          event_type: originalDeliveryRow.event_type,
          message: "Replay dispatched. A new delivery will appear shortly.",
        },
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
