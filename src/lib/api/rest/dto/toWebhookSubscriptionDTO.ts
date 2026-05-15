import type { Database } from "@/lib/types/database.types";

type WebhookSubscriptionRow =
  Database["public"]["Tables"]["webhook_subscriptions"]["Row"];

/**
 * Public DTO for a webhook subscription. The raw `secret` is NEVER
 * returned on read endpoints. Only the first 10 chars are exposed
 * as `secret_preview` so the user can identify which secret is active.
 *
 * The full secret is returned once at creation time via a separate
 * response shape (not this DTO).
 */
export type WebhookSubscriptionDTO = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  failure_count: number;
  last_delivery_at: string | null;
  last_disabled_at: string | null;
  created_at: string;
  updated_at: string;
};

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
