import { z } from "zod";

import { WEBHOOK_EVENT_TYPES } from "@/lib/api/rest/webhooks/eventTypes";
import { CreatedAtCursorSchema } from "@/lib/api/rest/pagination";

const WebhookEventTypeEnum = z.enum(WEBHOOK_EVENT_TYPES);

export const WebhookCreateInputSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(WebhookEventTypeEnum).min(1).max(20),
});

export type WebhookCreateInput = z.infer<typeof WebhookCreateInputSchema>;

export const WebhookPatchInputSchema = z
  .object({
    url: z.string().url().max(2048).optional(),
    events: z.array(WebhookEventTypeEnum).min(1).max(20).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.url !== undefined ||
      data.events !== undefined ||
      data.active !== undefined,
    { message: "At least one field must be provided" },
  );

export type WebhookPatchInput = z.infer<typeof WebhookPatchInputSchema>;

export const WebhookTestInputSchema = z.object({
  event_type: WebhookEventTypeEnum.optional(),
});

export type WebhookTestInput = z.infer<typeof WebhookTestInputSchema>;

export const WebhookDeliveryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: CreatedAtCursorSchema.optional(),
});

export type WebhookDeliveryListQuery = z.infer<
  typeof WebhookDeliveryListQuerySchema
>;
