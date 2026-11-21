import { eventType } from "inngest";
import { z } from "zod";

import type { scheduled_posts } from "@/db/schema";

export const PostDueEventDataSchema = z.object({
  scheduled_post_id: z.string(),
  principal_id: z.string(),
  social_account_id: z.string(),
  platform: z.string(),
  scheduled_at: z.string(),
});

export type PostDueEventData = z.infer<typeof PostDueEventDataSchema>;

export const postDueEvent = eventType("post.due", { schema: PostDueEventDataSchema });

export const POST_DUE_LOOKAHEAD_MS = 2 * 60 * 60 * 1000;
export const POST_DUE_OVERDUE_GRACE_MS = 15 * 60 * 1000;

export type PostDueTarget = Pick<
  typeof scheduled_posts.$inferSelect,
  "id" | "principal_id" | "social_account_id" | "platform" | "scheduled_at"
>;

export type PlannedPostDueEvent = {
  timing: "on_time" | "late";
  event: ReturnType<typeof postDueEvent.create>;
};

// Inngest starts a run at a future `ts` and drops a repeated event id for
// 24 hours, so an on-time id is the same for every send of one scheduled_at.
// A late post gets a fresh id: its on-time event may already be spent.
// https://www.inngest.com/docs/reference/events/send
// https://www.inngest.com/docs/guides/handling-idempotency
export function planPostDueEvents(input: {
  targets: readonly PostDueTarget[];
  nowMs: number;
}): PlannedPostDueEvent[] {
  const { targets, nowMs } = input;
  return targets.flatMap((target) => {
    const scheduledAtMs = Date.parse(target.scheduled_at);
    if (Number.isNaN(scheduledAtMs)) {
      console.error(
        `[planPostDueEvents] Unreadable scheduled_at for ${target.id}: ${target.scheduled_at}`,
      );
      return [];
    }
    if (scheduledAtMs > nowMs + POST_DUE_LOOKAHEAD_MS) return [];

    const timing = scheduledAtMs < nowMs - POST_DUE_OVERDUE_GRACE_MS ? "late" : "on_time";
    const onTimeEventId = `post.due-${target.id}-${scheduledAtMs}`;
    const event = postDueEvent.create(
      {
        scheduled_post_id: target.id,
        principal_id: target.principal_id,
        social_account_id: target.social_account_id,
        platform: target.platform,
        scheduled_at: target.scheduled_at,
      },
      {
        id: timing === "late" ? `${onTimeEventId}-late-${nowMs}` : onTimeEventId,
        ts: scheduledAtMs > nowMs ? scheduledAtMs : undefined,
      },
    );
    return [{ timing, event }];
  });
}
