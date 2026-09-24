import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { WebhookTestInputSchema } from "@/lib/api/rest/validation/webhookSchemas";
import { deliverSignedWebhook } from "@/lib/api/rest/webhooks/deliverSignedWebhook";
import { signWebhookPayload } from "@/lib/api/rest/webhooks/signWebhookPayload";
import { db, runQuery } from "@/db/client";
import { webhook_deliveries, webhook_subscriptions } from "@/db/schema";

const SubscriptionIdSchema = z.guid();
const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * POST /v1/webhooks/[id]/test -- send a synthetic event to the subscription URL.
 *
 * Delivers synchronously (not via Inngest) so the response carries
 * the actual delivery outcome for instant debugging feedback.
 */
export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.webhooks.test",
  handler: async (ctx, request) => {
    // Step 1: extract subscription ID from URL.
    const urlSegments = new URL(request.url).pathname.split("/");
    // Path: /api/v1/webhooks/[id]/test -> id is second-to-last.
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

    // Step 2: parse optional body.
    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      // Empty body is fine for test endpoint.
    }

    const bodyParseResult = WebhookTestInputSchema.safeParse(rawBody);
    const eventType = bodyParseResult.success
      ? (bodyParseResult.data.event_type ?? "webhook.test")
      : "webhook.test";

    // Step 3: load subscription.
    const { data: subscriptionRows, error: loadError } = await runQuery(
      db
        .select({
          url: webhook_subscriptions.url,
          secret: webhook_subscriptions.secret,
        })
        .from(webhook_subscriptions)
        .where(
          and(
            eq(webhook_subscriptions.id, subscriptionId),
            eq(webhook_subscriptions.principal_id, ctx.principal.principalId),
          ),
        )
        .limit(1),
    );

    if (loadError) {
      console.error(
        `[v1/webhooks/[id]/test POST] lookup failed (request_id=${ctx.requestId}):`,
        loadError.message,
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

    // Step 4: build payload + sign.
    const deliveryId = crypto.randomUUID();
    const bodyString = JSON.stringify({
      event_type: eventType,
      event_id: `test_${ctx.requestId}`,
      delivery_id: deliveryId,
      created_at: new Date().toISOString(),
      data: { test: true, message: "This is a test event from Sharetopus" },
    });
    const hmacSignatureHex = signWebhookPayload(
      bodyString,
      subscriptionRow.secret,
    );

    // Step 5: deliver synchronously (SSRF-guarded, IP-pinned at delivery).
    const startedAt = Date.now();
    const { statusCode, responseBody, errorMessage } =
      await deliverSignedWebhook(subscriptionRow.url, {
        headers: {
          "Content-Type": "application/json",
          "X-Sharetopus-Event": eventType,
          "X-Sharetopus-Delivery": deliveryId,
          "X-Sharetopus-Signature": `sha256=${hmacSignatureHex}`,
          "User-Agent": "Sharetopus-Webhook/1.0",
        },
        body: bodyString,
        timeoutMs: DELIVERY_TIMEOUT_MS,
      });

    const latencyMs = Date.now() - startedAt;
    const wasSuccess =
      statusCode !== null && statusCode >= 200 && statusCode < 300;

    // Step 6: persist delivery record. The receiver already got the event,
    // so a failed insert is logged and the response still reports the
    // delivery outcome.
    const { error: deliveryLogError } = await runQuery(
      db.insert(webhook_deliveries).values({
        id: deliveryId,
        subscription_id: subscriptionId,
        event_type: eventType,
        event_id: `test_${ctx.requestId}`,
        payload: {
          test: true,
          message: "This is a test event from Sharetopus",
        },
        status_code: statusCode,
        response_body: responseBody,
        attempt: 1,
        latency_ms: latencyMs,
        delivered_at: wasSuccess ? new Date().toISOString() : null,
        failed_at: wasSuccess ? null : new Date().toISOString(),
        error_message: errorMessage,
      }),
    );
    if (deliveryLogError) {
      console.error(
        `[v1/webhooks/[id]/test POST] delivery log insert failed (request_id=${ctx.requestId}):`,
        deliveryLogError.message,
      );
    }

    return {
      response: NextResponse.json(
        {
          delivery_id: deliveryId,
          subscription_id: subscriptionId,
          status_code: statusCode,
          latency_ms: latencyMs,
          delivered_at: wasSuccess ? new Date().toISOString() : null,
          error_message: errorMessage,
        },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        subscription_id: subscriptionId,
        delivery_id: deliveryId,
        status_code: statusCode,
        latency_ms: latencyMs,
        delivery_logged: deliveryLogError === null,
      },
    };
  },
});
