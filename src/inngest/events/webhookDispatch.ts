import { eventType } from "inngest";
import { z } from "zod";

export const WebhookDispatchEventDataSchema = z.object({
  subscription_id: z.string(),
  event_type: z.string(),
  event_id: z.string(),
  payload: z.record(z.string(), z.json()),
});

export type WebhookDispatchEventData = z.infer<typeof WebhookDispatchEventDataSchema>;

export const webhookDispatchEvent = eventType("webhook.dispatch.v1", {
  schema: WebhookDispatchEventDataSchema,
});
