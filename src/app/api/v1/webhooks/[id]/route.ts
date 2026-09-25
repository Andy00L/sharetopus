import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toWebhookSubscriptionDTO } from "@/lib/api/rest/dto/toWebhookSubscriptionDTO";
import type { WebhookDeleteResult } from "@/lib/api/rest/openapi/responseSchemas";
import { WebhookPatchInputSchema } from "@/lib/api/rest/validation/webhookSchemas";
import { verifyWebhookUrl } from "@/lib/api/rest/webhooks/verifyWebhookConfig";
import { db, runQuery } from "@/db/client";
import { webhook_deliveries, webhook_subscriptions } from "@/db/schema";

type WebhookSubscriptionUpdate = Partial<
  typeof webhook_subscriptions.$inferInsert
>;

const SubscriptionIdSchema = z.guid();

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

    const { data: subscriptionRows, error: lookupError } = await runQuery(
      db
        .select()
        .from(webhook_subscriptions)
        .where(
          and(
            eq(webhook_subscriptions.id, idParseResult.data),
            eq(webhook_subscriptions.principal_id, ctx.principal.principalId),
          ),
        )
        .limit(1),
    );

    if (lookupError) {
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

    // Build the update payload, typed from the table schema.
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

    const { data: updatedRows, error: updateError } = await runQuery(
      db
        .update(webhook_subscriptions)
        .set(updatePayload)
        .where(
          and(
            eq(webhook_subscriptions.id, subscriptionId),
            eq(webhook_subscriptions.principal_id, ctx.principal.principalId),
          ),
        )
        .returning(),
    );

    if (updateError) {
      return restErrorResponse(
        "internal_error",
        "Webhook subscription update failed",
        ctx.requestId,
      );
    }
    const updatedRow = updatedRows[0];
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

    // Count deliveries before deletion (for audit summary). A failed count
    // leaves deliveryCount null and the summary reports 0, as before.
    const { data: deliveryCount } = await runQuery(
      db.$count(
        webhook_deliveries,
        eq(webhook_deliveries.subscription_id, subscriptionId),
      ),
    );

    // Delete subscription (FK cascade removes deliveries). RETURNING tells a
    // real deletion apart from an id that is missing or belongs to another
    // principal, which deletes nothing and used to answer 200 as well.
    const { data: deletedRows, error: deleteError } = await runQuery(
      db
        .delete(webhook_subscriptions)
        .where(
          and(
            eq(webhook_subscriptions.id, subscriptionId),
            eq(webhook_subscriptions.principal_id, ctx.principal.principalId),
          ),
        )
        .returning({ id: webhook_subscriptions.id }),
    );

    if (deleteError) {
      console.error(
        `[v1/webhooks/[id] DELETE] delete failed (request_id=${ctx.requestId}):`,
        deleteError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Webhook subscription deletion failed",
        ctx.requestId,
      );
    }
    if (!deletedRows[0]) {
      return restErrorResponse(
        "not_found",
        "Webhook subscription not found",
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        { id: subscriptionId, deleted: true } satisfies WebhookDeleteResult,
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        subscription_id: subscriptionId,
        deliveries_deleted: deliveryCount ?? 0,
      },
    };
  },
});
