import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

export type ClaimResult =
  | { claimed: true }
  | { claimed: false; reason: "duplicate" | "error"; message: string };

/**
 * Atomically claims a Stripe webhook event_id. Returns claimed=false
 * with reason="duplicate" when Stripe is retrying a previously-processed
 * event (unique constraint conflict on event_id).
 *
 * Caller MUST treat claimed=false reason="duplicate" as success (200 OK)
 * because the original delivery already processed the event.
 *
 * On DB errors, returns reason="error". Caller should return 500 so
 * Stripe retries.
 */
export async function claimWebhookEvent(input: {
  event_id: string;
  type: string;
  livemode: boolean;
}): Promise<ClaimResult> {
  const { error } = await adminSupabase.from("stripe_webhook_events").insert({
    event_id: input.event_id,
    type: input.type,
    livemode: input.livemode,
  });

  if (!error) {
    return { claimed: true };
  }

  // PG unique_violation = already processed (Stripe retry)
  if (error.code === "23505") {
    console.log(
      `[claimWebhookEvent] Duplicate event ${input.event_id} (${input.type})`,
    );
    return {
      claimed: false,
      reason: "duplicate",
      message: "Event already processed",
    };
  }

  console.error(
    `[claimWebhookEvent] Failed to claim ${input.event_id}:`,
    error.message,
  );
  return {
    claimed: false,
    reason: "error",
    message: `Database error: ${error.message}`,
  };
}

/**
 * Releases a claimed event_id when processing failed. Allows Stripe
 * retry to re-process. Failures here are logged but not thrown.
 */
export async function releaseWebhookEvent(eventId: string): Promise<void> {
  const { error } = await adminSupabase
    .from("stripe_webhook_events")
    .delete()
    .eq("event_id", eventId);

  if (error) {
    console.error(
      `[releaseWebhookEvent] Failed to release ${eventId}:`,
      error.message,
    );
  }
}
