import { eventType } from "inngest";
import { z } from "zod";

import type { pending_tiktok_pulls } from "@/db/schema";

export const TikTokPublishPollEventDataSchema = z.object({
  publish_id: z.string(),
  social_account_id: z.string(),
});

export const tikTokPublishPollEvent = eventType("tiktok.publish.poll", {
  schema: TikTokPublishPollEventDataSchema,
});

type StalledPull = Pick<typeof pending_tiktok_pulls.$inferSelect, "publish_id" | "social_account_id">;

// Inngest drops a repeated event id for 24 hours, so one id per pull and UTC
// hour sends at most one extra poll per pull each hour:
// https://www.inngest.com/docs/guides/handling-idempotency
export function buildTikTokRepollEvents(input: {
  pulls: readonly StalledPull[];
  now: Date;
}): ReturnType<typeof tikTokPublishPollEvent.create>[] {
  const utcHour = input.now.toISOString().slice(0, 13);
  return input.pulls.map((pull) =>
    tikTokPublishPollEvent.create(
      { publish_id: pull.publish_id, social_account_id: pull.social_account_id },
      { id: `tiktok-repoll-${pull.publish_id}-${utcHour}` },
    ),
  );
}
