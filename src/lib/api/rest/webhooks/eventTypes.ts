import { z } from "zod";

/**
 * Canonical list of webhook event types supported in v1.
 * Used for Zod validation on subscription create/update and for
 * the test endpoint's optional event_type override.
 */
export const WEBHOOK_EVENT_TYPES = [
  "post.scheduled",
  "post.published",
  "post.failed",
  "connection.connected",
  "connection.expired",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WebhookEventTypeEnum = z.enum(WEBHOOK_EVENT_TYPES);
