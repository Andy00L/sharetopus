import { and, desc, eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toWebhookDeliveryDTO } from "@/lib/api/rest/dto/toWebhookDeliveryDTO";
import { WebhookDeliveryListQuerySchema } from "@/lib/api/rest/validation/webhookSchemas";
import { db, runQuery } from "@/db/client";
import { webhook_deliveries, webhook_subscriptions } from "@/db/schema";

const SubscriptionIdSchema = z.guid();

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
    const { data: subscriptionRows, error: ownershipError } = await runQuery(
      db
        .select({ id: webhook_subscriptions.id })
        .from(webhook_subscriptions)
        .where(
          and(
            eq(webhook_subscriptions.id, subscriptionId),
            eq(webhook_subscriptions.principal_id, ctx.principal.principalId),
          ),
        )
        .limit(1),
    );

    if (ownershipError || !subscriptionRows[0]) {
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
    const { data: fetchedRows, error: queryError } = await runQuery(
      db
        .select()
        .from(webhook_deliveries)
        .where(
          and(
            eq(webhook_deliveries.subscription_id, subscriptionId),
            query.cursor
              ? lt(webhook_deliveries.created_at, query.cursor)
              : undefined,
          ),
        )
        .orderBy(desc(webhook_deliveries.created_at))
        .limit(query.limit + 1),
    );
    if (queryError) {
      return restErrorResponse(
        "internal_error",
        "Delivery log query failed",
        ctx.requestId,
      );
    }

    // Step 5: compute pagination.
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
