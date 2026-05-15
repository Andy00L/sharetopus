import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toWebhookSubscriptionDTO } from "@/lib/api/rest/dto/toWebhookSubscriptionDTO";
import { WebhookPatchInputSchema } from "@/lib/api/rest/validation/webhookSchemas";
import { verifyWebhookUrl } from "@/lib/api/rest/webhooks/verifyWebhookConfig";
import { adminSupabase } from "@/actions/api/adminSupabase";
import type { Database } from "@/lib/types/database.types";

type WebhookSubscriptionUpdate =
  Database["public"]["Tables"]["webhook_subscriptions"]["Update"];

const SubscriptionIdSchema = z.string().uuid();

/**
 * GET /v1/webhooks/[id] -- fetch a single webhook subscription.
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.webhooks.get",
  handler: async (ctx, request) => {
    const urlSegments = new URL(request.url).pathname.split("/");
    const idCandidate = urlSegments[urlSegments.length - 1] ?? "";

    const idParseResult = SubscriptionIdSchema.safeParse(idCandidate);
    if (!idParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Invalid webhook subscription id format",
        ctx.requestId,
      );
    }

    const { data: subscriptionRow, error: lookupError } = await adminSupabase
      .from("webhook_subscriptions")
      .select("*")
      .eq("id", idParseResult.data)
      .eq("principal_id", ctx.principal.principalId)
      .maybeSingle();

    if (lookupError) {
      return restErrorResponse(
        "internal_error",
        "Webhook subscription lookup failed",
        ctx.requestId,
      );
    }
    if (!subscriptionRow) {
      return restErrorResponse(
        "not_found",
        "Webhook subscription not found",
        ctx.requestId,
      );
    }

    const subscriptionDto = toWebhookSubscriptionDTO(subscriptionRow);

    return {
      response: NextResponse.json(subscriptionDto, {
        status: 200,
        headers: { "x-request-id": ctx.requestId },
      }),
      auditSummary: {
        subscription_id: subscriptionRow.id,
        failure_count: subscriptionRow.failure_count,
      },
    };
  },
});

/**
 * PATCH /v1/webhooks/[id] -- update url, events, or active flag.
 */
export const PATCH = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.webhooks.patch",
  handler: async (ctx, request) => {
    const urlSegments = new URL(request.url).pathname.split("/");
    const idCandidate = urlSegments[urlSegments.length - 1] ?? "";

    const idParseResult = SubscriptionIdSchema.safeParse(idCandidate);
    if (!idParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Invalid webhook subscription id format",
        ctx.requestId,
      );
    }
    const subscriptionId = idParseResult.data;

    // Parse body.
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return restErrorResponse(
        "validation_error",
        "Request body is not valid JSON",
        ctx.requestId,
      );
    }

    const bodyParseResult = WebhookPatchInputSchema.safeParse(rawBody);
    if (!bodyParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Request body failed validation",
        ctx.requestId,
        { issues: bodyParseResult.error.issues },
      );
    }
    const patchInput = bodyParseResult.data;

    // Validate new URL if provided.
    if (patchInput.url) {
      const urlCheck = await verifyWebhookUrl(patchInput.url);
      if (!urlCheck.valid) {
        return restErrorResponse(
          "validation_error",
          urlCheck.message,
          ctx.requestId,
        );
      }
    }

    // Build update payload with proper Supabase type.
    const updatePayload: WebhookSubscriptionUpdate = {
      updated_at: new Date().toISOString(),
    };
    const fieldsChanged: string[] = [];
    if (patchInput.url !== undefined) {
      updatePayload.url = patchInput.url;
      fieldsChanged.push("url");
    }
    if (patchInput.events !== undefined) {
      updatePayload.events = patchInput.events;
      fieldsChanged.push("events");
    }
    if (patchInput.active !== undefined) {
      updatePayload.active = patchInput.active;
      fieldsChanged.push("active");
      // Re-enabling clears failure state so auto-disable can restart.
      if (patchInput.active) {
        updatePayload.failure_count = 0;
        updatePayload.last_disabled_at = null;
      }
    }

    const { data: updatedRow, error: updateError } = await adminSupabase
      .from("webhook_subscriptions")
      .update(updatePayload)
      .eq("id", subscriptionId)
      .eq("principal_id", ctx.principal.principalId)
      .select("*")
      .maybeSingle();

    if (updateError) {
      return restErrorResponse(
        "internal_error",
        "Webhook subscription update failed",
        ctx.requestId,
      );
    }
    if (!updatedRow) {
      return restErrorResponse(
        "not_found",
        "Webhook subscription not found",
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(toWebhookSubscriptionDTO(updatedRow), {
        status: 200,
        headers: { "x-request-id": ctx.requestId },
      }),
      auditSummary: {
        subscription_id: subscriptionId,
        fields_changed: fieldsChanged,
      },
    };
  },
});

/**
 * DELETE /v1/webhooks/[id] -- delete subscription + cascade deliveries.
 */
export const DELETE = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.webhooks.delete",
  handler: async (ctx, request) => {
    const urlSegments = new URL(request.url).pathname.split("/");
    const idCandidate = urlSegments[urlSegments.length - 1] ?? "";

    const idParseResult = SubscriptionIdSchema.safeParse(idCandidate);
    if (!idParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Invalid webhook subscription id format",
        ctx.requestId,
      );
    }
    const subscriptionId = idParseResult.data;

    // Count deliveries before deletion (for audit summary).
    const { count: deliveryCount } = await adminSupabase
      .from("webhook_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("subscription_id", subscriptionId);

    // Delete subscription (FK cascade removes deliveries).
    const { error: deleteError } = await adminSupabase
      .from("webhook_subscriptions")
      .delete()
      .eq("id", subscriptionId)
      .eq("principal_id", ctx.principal.principalId);

    if (deleteError) {
      return restErrorResponse(
        "internal_error",
        "Webhook subscription deletion failed",
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        { id: subscriptionId, deleted: true },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        subscription_id: subscriptionId,
        deliveries_deleted: deliveryCount ?? 0,
      },
    };
  },
});
