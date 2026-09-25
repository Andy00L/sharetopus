import type { webhook_subscriptions } from "@/db/schema";
import type { WebhookSubscriptionDTO } from "@/lib/api/rest/openapi/responseSchemas";

type WebhookSubscriptionRow = typeof webhook_subscriptions.$inferSelect;

/**
 * Public DTO for a webhook subscription; its shape is
 * WebhookSubscriptionDTOSchema (responseSchemas.ts), the same schema the
 * OpenAPI spec renders. The secret is never part of it: POST /v1/webhooks
 * returns it once, in WebhookSubscriptionCreated.
 */
export function toWebhookSubscriptionDTO(
  row: WebhookSubscriptionRow,
): WebhookSubscriptionDTO {
  return {
    id: row.id,
    url: row.url,
    events: row.events,
    active: row.active,
    failure_count: row.failure_count,
    last_delivery_at: row.last_delivery_at,
    last_disabled_at: row.last_disabled_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
