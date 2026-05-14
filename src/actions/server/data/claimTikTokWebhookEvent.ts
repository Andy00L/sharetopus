import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * Idempotency claim for TikTok webhook events. INSERT into
 * tiktok_webhook_events, return 'duplicate' if the event_id already
 * exists, 'claimed' if newly inserted, 'error' on DB failure.
 *
 * TikTok provides at-least-once delivery with 72h retries. event_id
 * is computed by the caller as sha256(client_key+create_time+event+content)
 * since TikTok does not supply a native event_id.
 */
export async function claimTikTokWebhookEvent(input: {
  event_id: string;
  event_type: string;
}): Promise<
  | { claimed: true }
  | { claimed: false; reason: "duplicate"; message: string }
  | { claimed: false; reason: "error"; message: string }
> {
  const { error } = await adminSupabase
    .from("tiktok_webhook_events")
    .insert({
      event_id: input.event_id,
      event_type: input.event_type,
    });

  if (!error) {
    return { claimed: true };
  }

  // Postgres unique violation
  if (error.code === "23505") {
    return {
      claimed: false,
      reason: "duplicate",
      message: `Event ${input.event_id} already processed`,
    };
  }

  console.error(
    "[claimTikTokWebhookEvent] Insert failed:",
    error.message,
  );
  return {
    claimed: false,
    reason: "error",
    message: `Claim failed: ${error.message}`,
  };
}
