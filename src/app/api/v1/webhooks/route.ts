import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { toWebhookSubscriptionDTO } from "@/lib/api/rest/dto/toWebhookSubscriptionDTO";
import { WebhookCreateInputSchema } from "@/lib/api/rest/validation/webhookSchemas";
import { generateWebhookSecret } from "@/lib/api/rest/webhooks/secretGenerator";
import { verifyWebhookUrl } from "@/lib/api/rest/webhooks/verifyWebhookConfig";
import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * POST /v1/webhooks -- create a webhook subscription.
 *
 * Returns the full secret ONCE in the response. Subsequent GET
 * responses only show the DTO (secret stripped).
 */
export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.webhooks.create",
  handler: async (ctx, request) => {
    // Step 1: parse JSON body.
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

    // Step 2: Zod validate.
    const validationResult = WebhookCreateInputSchema.safeParse(rawBody);
    if (!validationResult.success) {
      return restErrorResponse(
        "validation_error",
        "Request body failed validation",
        ctx.requestId,
        { issues: validationResult.error.issues },
      );
    }
    const validatedInput = validationResult.data;

    // Step 3: validate URL (https, no private IPs).
    const urlCheck = await verifyWebhookUrl(validatedInput.url);
    if (!urlCheck.valid) {
      return restErrorResponse(
        "validation_error",
        urlCheck.message,
        ctx.requestId,
      );
    }

    // Step 4: generate secret and insert.
    const webhookSecret = generateWebhookSecret();
    const { data: subscriptionRow, error: insertError } = await adminSupabase
      .from("webhook_subscriptions")
      .insert({
        principal_id: ctx.principal.principalId,
        url: validatedInput.url,
        events: validatedInput.events,
        secret: webhookSecret,
      })
      .select("*")
      .single();

    if (insertError || !subscriptionRow) {
      console.error(
        `[v1/webhooks POST] insert failed (request_id=${ctx.requestId}):`,
        insertError?.message ?? "no row returned",
      );
      return restErrorResponse(
        "internal_error",
        "Failed to create webhook subscription",
        ctx.requestId,
      );
    }

    // Return the DTO plus the full secret (shown once at creation).
    const subscriptionDto = toWebhookSubscriptionDTO(subscriptionRow);

    return {
      response: NextResponse.json(
        { ...subscriptionDto, secret: webhookSecret },
        { status: 201, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        subscription_id: subscriptionRow.id,
        events_count: validatedInput.events.length,
      },
    };
  },
});

/**
 * GET /v1/webhooks -- list webhook subscriptions for the principal.
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.webhooks.list",
  handler: async (ctx) => {
    const { data: rows, error: queryError } = await adminSupabase
      .from("webhook_subscriptions")
      .select("*")
      .eq("principal_id", ctx.principal.principalId)
      .order("created_at", { ascending: false });

    if (queryError) {
      console.error(
        `[v1/webhooks GET] list failed (request_id=${ctx.requestId}):`,
        queryError.message,
      );
      return restErrorResponse(
        "internal_error",
        "Webhook subscriptions query failed",
        ctx.requestId,
      );
    }

    const subscriptionDtos = (rows ?? []).map(toWebhookSubscriptionDTO);
    const activeCount = subscriptionDtos.filter(
      (subscription) => subscription.active,
    ).length;

    return {
      response: NextResponse.json(
        { data: subscriptionDtos },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        count: subscriptionDtos.length,
        active_count: activeCount,
      },
    };
  },
});
