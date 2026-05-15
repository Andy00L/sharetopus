import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { dispatchWebhook } from "@/lib/api/rest/webhooks/dispatch";
import { adminSupabase } from "@/actions/api/adminSupabase";

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
    const { data: subscriptionRow, error: subError } = await adminSupabase
      .from("webhook_subscriptions")
      .select("id, principal_id, active")
      .eq("id", subscriptionId)
      .eq("principal_id", ctx.principal.principalId)
      .maybeSingle();

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
    const { data: originalDeliveryRow, error: deliveryError } =
      await adminSupabase
        .from("webhook_deliveries")
        .select("id, subscription_id, event_type, payload")
        .eq("id", deliveryId)
        .eq("subscription_id", subscriptionId)
        .maybeSingle();

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
