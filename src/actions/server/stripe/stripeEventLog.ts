import "server-only";

import { eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { stripe_webhook_events } from "@/db/schema";

export type ProcessedEventCheck =
  | { ok: true; isProcessed: boolean }
  | { ok: false };

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
