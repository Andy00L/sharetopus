import "server-only";

import { eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { stripe_webhook_events } from "@/db/schema";

/*
 * stripe_webhook_events lists the Stripe events already processed. The
 * webhook logs an event only after processing it succeeded: a failure
 * answers 500 and Stripe's retry processes the event again, so no failure
 * can leave an unprocessed event marked as done. Every processing step is
 * idempotent, which also covers a duplicate delivery that arrives while the
 * first one is still running.
 */

export type ProcessedEventCheck =
  | { ok: true; isProcessed: boolean }
  | { ok: false };

/** Whether an earlier delivery of this Stripe event was processed. */
export async function isStripeEventProcessed(
  eventId: string,
): Promise<ProcessedEventCheck> {
  const { data: loggedEvents, error } = await runQuery(
    db
      .select({ event_id: stripe_webhook_events.event_id })
      .from(stripe_webhook_events)
      .where(eq(stripe_webhook_events.event_id, eventId))
      .limit(1),
  );

  if (error) {
    console.error(
      `[isStripeEventProcessed] Lookup failed for ${eventId}:`,
      error.message,
    );
    return { ok: false };
  }
  return { ok: true, isProcessed: loggedEvents.length > 0 };
}

/** Logs a processed event. Logging it a second time changes nothing. */
export async function markStripeEventProcessed(event: {
  event_id: string;
  type: string;
  livemode: boolean;
}): Promise<{ ok: boolean }> {
  const { error } = await runQuery(
    db
      .insert(stripe_webhook_events)
      .values(event)
      .onConflictDoNothing({ target: stripe_webhook_events.event_id }),
  );

  if (error) {
    console.error(
      `[markStripeEventProcessed] Failed to log ${event.event_id}:`,
      error.message,
    );
    return { ok: false };
  }
  return { ok: true };
}
