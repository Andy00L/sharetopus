import type { Database } from "@/lib/types/database.types";

type WebhookDeliveryRow =
  Database["public"]["Tables"]["webhook_deliveries"]["Row"];

/**
 * Public DTO for a webhook delivery log entry. Excludes the full
 * response_body (can be large) and the raw payload jsonb.
 * Includes status_code, latency, timestamps, and error info.
 */
export type WebhookDeliveryDTO = {
  id: string;
  event_type: string;
  event_id: string;
  status_code: number | null;
  attempt: number;
  latency_ms: number | null;
  delivered_at: string | null;
  failed_at: string | null;
  error_message: string | null;
  created_at: string;
};

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
