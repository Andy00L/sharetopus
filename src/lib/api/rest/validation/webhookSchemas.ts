import { z } from "zod";

import { WebhookEventTypeEnum } from "@/lib/api/rest/webhooks/eventTypes";

/**
 * Body schema for POST /v1/webhooks (create subscription).
 */
export const WebhookCreateInputSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(WebhookEventTypeEnum).min(1).max(20),
});

export type WebhookCreateInput = z.infer<typeof WebhookCreateInputSchema>;

/**
 * Body schema for PATCH /v1/webhooks/[id] (update subscription).
 * All fields optional; at least one must be present.
 */
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

/**
 * Body schema for POST /v1/webhooks/[id]/test.
 */
export const WebhookTestInputSchema = z.object({
  event_type: WebhookEventTypeEnum.optional(),
});

export type WebhookTestInput = z.infer<typeof WebhookTestInputSchema>;

/**
 * Query schema for GET /v1/webhooks/[id]/deliveries.
 */
export const WebhookDeliveryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type WebhookDeliveryListQuery = z.infer<
  typeof WebhookDeliveryListQuerySchema
>;
