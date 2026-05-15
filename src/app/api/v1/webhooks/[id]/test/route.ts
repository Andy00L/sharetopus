import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { WebhookTestInputSchema } from "@/lib/api/rest/validation/webhookSchemas";
import { signWebhookPayload } from "@/lib/api/rest/webhooks/signWebhookPayload";
import { adminSupabase } from "@/actions/api/adminSupabase";

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
    // Path: /api/v1/webhooks/[id]/test -> id is third-to-last.
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
    const { data: subscriptionRow, error: loadError } = await adminSupabase
      .from("webhook_subscriptions")
      .select("id, url, secret, active")
      .eq("id", subscriptionId)
      .eq("principal_id", ctx.principal.principalId)
      .maybeSingle();

    if (loadError || !subscriptionRow) {
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

    // Step 5: deliver synchronously.
    const startedAt = Date.now();
    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;

    try {
      const deliveryResponse = await fetch(subscriptionRow.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Sharetopus-Event": eventType,
          "X-Sharetopus-Delivery": deliveryId,
          "X-Sharetopus-Signature": `sha256=${hmacSignatureHex}`,
          "User-Agent": "Sharetopus-Webhook/1.0",
        },
        body: bodyString,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      statusCode = deliveryResponse.status;
      responseBody = (await deliveryResponse.text()).slice(0, 4096);
    } catch (deliveryError) {
      errorMessage =
        deliveryError instanceof Error
          ? deliveryError.message
          : "unknown network error";
    }

    const latencyMs = Date.now() - startedAt;
    const wasSuccess =
      statusCode !== null && statusCode >= 200 && statusCode < 300;

    // Step 6: persist delivery record.
    await adminSupabase.from("webhook_deliveries").insert({
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
    });

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
      },
    };
  },
});
