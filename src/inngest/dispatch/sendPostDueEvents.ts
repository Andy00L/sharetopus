import "server-only";

import { scheduled_posts } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { planPostDueEvents, type PostDueTarget } from "@/inngest/events/postDue";

export const POST_DUE_TARGET_COLUMNS = {
  id: scheduled_posts.id,
  principal_id: scheduled_posts.principal_id,
  social_account_id: scheduled_posts.social_account_id,
  platform: scheduled_posts.platform,
  scheduled_at: scheduled_posts.scheduled_at,
};

export type SendPostDueEventsResult =
  | { success: true; sentCount: number }
  | { success: false; message: string };

export async function sendPostDueEvents(
  targets: readonly PostDueTarget[],
): Promise<SendPostDueEventsResult> {
  const plannedEvents = planPostDueEvents({ targets, nowMs: Date.now() });
  if (plannedEvents.length === 0) return { success: true, sentCount: 0 };

  try {
    await inngest.send(plannedEvents.map((planned) => planned.event));
    return { success: true, sentCount: plannedEvents.length };
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError);
    console.error(
      `[sendPostDueEvents] Inngest send failed for ${plannedEvents.length} post(s), the hourly safety net sends them instead:`,
      message,
    );
    return { success: false, message };
  }
}
