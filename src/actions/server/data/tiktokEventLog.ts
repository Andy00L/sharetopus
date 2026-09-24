import "server-only";

import { eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { tiktok_webhook_events } from "@/db/schema";

/*
 * tiktok_webhook_events lists the TikTok webhook events already handed to
 * Inngest. The webhook logs an event only after the dispatch succeeded: a
 * failure answers 500 and TikTok redelivers (at-least-once, retries for
 * 72h), so no failure can leave an undispatched event marked as done. The
 * same shape as the Stripe log (src/actions/server/stripe/stripeEventLog.ts).
 *
 * TikTok sends no event id; the caller derives one as
 * sha256(client_key.create_time.event.content).
 */

export type ProcessedTikTokEventCheck =
  | { ok: true; isProcessed: boolean }
  | { ok: false };

/** Whether an earlier delivery of this TikTok event was dispatched. */
export async function isTikTokEventProcessed(
  eventId: string,
): Promise<ProcessedTikTokEventCheck> {
  const { data: loggedEvents, error } = await runQuery(
    db
      .select({ event_id: tiktok_webhook_events.event_id })
      .from(tiktok_webhook_events)
      .where(eq(tiktok_webhook_events.event_id, eventId))
      .limit(1),
  );

  if (error) {
    console.error(
      `[isTikTokEventProcessed] Lookup failed for ${eventId}:`,
      error.message,
    );
    return { ok: false };
  }
  return { ok: true, isProcessed: loggedEvents.length > 0 };
}

/** Logs a dispatched event. Logging it a second time changes nothing. */
export async function markTikTokEventProcessed(event: {
  event_id: string;
  event_type: string;
}): Promise<{ ok: boolean }> {
  const { error } = await runQuery(
    db
      .insert(tiktok_webhook_events)
      .values(event)
      .onConflictDoNothing({ target: tiktok_webhook_events.event_id }),
  );

  if (error) {
    console.error(
      `[markTikTokEventProcessed] Failed to log ${event.event_id}:`,
      error.message,
    );
    return { ok: false };
  }
  return { ok: true };
}
