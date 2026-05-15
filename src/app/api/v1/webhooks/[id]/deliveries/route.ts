import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toWebhookDeliveryDTO } from "@/lib/api/rest/dto/toWebhookDeliveryDTO";
import { WebhookDeliveryListQuerySchema } from "@/lib/api/rest/validation/webhookSchemas";
import { adminSupabase } from "@/actions/api/adminSupabase";

const SubscriptionIdSchema = z.string().uuid();

/**
 * GET /v1/webhooks/[id]/deliveries -- list delivery log for a subscription.
 *
 * Cursor pagination on created_at (newest first).
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.webhooks.deliveries",
  handler: async (ctx, request) => {
    // Step 1: extract subscription ID from URL.
    // Path: /api/v1/webhooks/[id]/deliveries -> id is second-to-last.
    const urlSegments = new URL(request.url).pathname.split("/");
    const idCandidate = urlSegments[urlSegments.length - 2] ?? "";

    const idParseResult = SubscriptionIdSchema.safeParse(idCandidate);
    if (!idParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Invalid webhook subscription id format",
        ctx.requestId,
      );
    }
    const subscriptionId = idParseResult.data;

    // Step 2: verify subscription ownership.
    const { data: subscriptionRow, error: ownershipError } =
      await adminSupabase
        .from("webhook_subscriptions")
        .select("id")
        .eq("id", subscriptionId)
        .eq("principal_id", ctx.principal.principalId)
        .maybeSingle();

    if (ownershipError || !subscriptionRow) {
      return restErrorResponse(
        "not_found",
        "Webhook subscription not found",
        ctx.requestId,
      );
    }

    // Step 3: parse query params.
    const queryObject = Object.fromEntries(
      new URL(request.url).searchParams,
    );
    const queryParseResult =
      WebhookDeliveryListQuerySchema.safeParse(queryObject);
    if (!queryParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Query parameters failed validation",
        ctx.requestId,
        { issues: queryParseResult.error.issues },
      );
    }
    const query = queryParseResult.data;

    // Step 4: query deliveries with cursor pagination.
    let deliveriesQuery = adminSupabase
      .from("webhook_deliveries")
      .select("*")
      .eq("subscription_id", subscriptionId)
      .order("created_at", { ascending: false })
      .limit(query.limit + 1);

    if (query.cursor) {
      deliveriesQuery = deliveriesQuery.lt("created_at", query.cursor);
    }

    const { data: rows, error: queryError } = await deliveriesQuery;
    if (queryError) {
      return restErrorResponse(
        "internal_error",
        "Delivery log query failed",
        ctx.requestId,
      );
    }

    // Step 5: compute pagination.
    const fetchedRows = rows ?? [];
    const hasMore = fetchedRows.length > query.limit;
    const pagedRows = hasMore
      ? fetchedRows.slice(0, query.limit)
      : fetchedRows;
    const nextCursor = hasMore
      ? pagedRows[pagedRows.length - 1].created_at
      : null;

    const deliveryDtos = pagedRows.map(toWebhookDeliveryDTO);

    return {
      response: NextResponse.json(
        { data: deliveryDtos, next_cursor: nextCursor },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        subscription_id: subscriptionId,
        count: deliveryDtos.length,
      },
    };
  },
});
