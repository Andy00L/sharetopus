import type { webhook_deliveries } from "@/db/schema";
import type { WebhookDeliveryDTO } from "@/lib/api/rest/openapi/responseSchemas";

type WebhookDeliveryRow = typeof webhook_deliveries.$inferSelect;

/**
 * Public DTO for a webhook delivery log entry; its shape is
 * WebhookDeliveryDTOSchema (responseSchemas.ts), the same schema the
 * OpenAPI spec renders. Excludes the full response_body (can be large) and
 * the raw payload jsonb.
 */
export function toWebhookDeliveryDTO(
  row: WebhookDeliveryRow,
): WebhookDeliveryDTO {
  return {
    id: row.id,
    event_type: row.event_type,
    event_id: row.event_id,
    status_code: row.status_code,
    attempt: row.attempt,
    latency_ms: row.latency_ms,
    delivered_at: row.delivered_at,
    failed_at: row.failed_at,
    error_message: row.error_message,
    created_at: row.created_at,
  };
}
