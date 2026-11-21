import { eventType } from "inngest";
import { z } from "zod";

import { CREATED_VIA_CHANNELS, MEDIA_TYPES, SOCIAL_PLATFORMS } from "@/db/schema";

import { PlatformOptionsSchema } from "./postOptions";

export const PostNowEventDataSchema = z.object({
  dispatch_id: z.string().min(1),
  batch_id: z.string(),
  principal_id: z.string(),
  social_account_id: z.string(),
  platform: z.enum(SOCIAL_PLATFORMS),
  post_type: z.enum(MEDIA_TYPES),
  account_content: z.object({
    title: z.string(),
    description: z.string(),
    link: z.string(),
  }),
  platform_options: PlatformOptionsSchema,
  board: z.object({ boardID: z.string(), boardName: z.string().nullable() }).nullable(),
  cover_timestamp: z.number().nullable(),
  media_path: z.string(),
  created_via: z.enum(CREATED_VIA_CHANNELS),
  idempotency_key: z.string().optional(),
  request_id: z.string().nullable(),
  post_options: z.record(z.string(), z.unknown()).nullable(),
});

export type PostNowEventData = z.infer<typeof PostNowEventDataSchema>;

export const postNowEvent = eventType("post.now", { schema: PostNowEventDataSchema });

// Inngest drops a repeated event id for 24 hours:
// https://www.inngest.com/docs/guides/handling-idempotency
export function buildPostNowEvent(data: PostNowEventData) {
  return postNowEvent.create(data, { id: `post.now-${data.dispatch_id}` });
}
