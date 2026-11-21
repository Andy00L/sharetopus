export const WEBHOOK_EVENT_TYPES = [
  "post.scheduled",
  "post.published",
  "post.failed",
  "connection.connected",
  "connection.expired",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
