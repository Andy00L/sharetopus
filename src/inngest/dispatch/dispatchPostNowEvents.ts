import "server-only";
import { inngest } from "@/inngest/client";
import { insertPendingDirectPosts } from "@/actions/server/data/pendingDirectPosts";
import type { PostNowEventData } from "@/inngest/functions/processDirectPostHelpers";

export type DispatchPostNowEventsResult =
  | { success: true; eventIds: string[] }
  | { success: false; message: string; phase: "lock_insert" | "inngest_send" };

/**
 * Inserts pending_direct_posts lock rows for every event and dispatches the
 * events to Inngest in a single send call.
 *
 * Caller is responsible for building the PostNowEventData[] array. Each event
 * MUST have a dispatch_id (UUID) set; the lock row uses it as event_id so
 * processDirectPost can finalize it after the worker run.
 *
 * Failure semantics (matches prior in-line behavior):
 *   - Lock insert fails: returns { success: false, phase: "lock_insert" }.
 *     No events dispatched. Caller should surface to user.
 *   - Inngest send fails AFTER locks inserted: returns
 *     { success: false, phase: "inngest_send" }. Locks stay in 'processing';
 *     sweepStuckDirectPosts cron finalizes them as 'failed' after 10 minutes,
 *     which then frees storage cleanup. This is intentional, do not roll back
 *     the locks.
 *
 * Callers: web direct-post path (handleSocialMediaPost.dispatchDirectPostEvents),
 *          MCP post_now tool, MCP bulk_post_now tool, future REST/x402 endpoints.
 *
 * Tables touched: pending_direct_posts (insert)
 * Inngest events sent: post.now (one per element)
 */
export async function dispatchPostNowEvents(
  events: { name: "post.now"; data: PostNowEventData }[]
): Promise<DispatchPostNowEventsResult> {
  if (events.length === 0) {
    return {
      success: false,
      message: "No events provided",
      phase: "lock_insert",
    };
  }

  for (const evt of events) {
    if (!evt.data.dispatch_id) {
      return {
        success: false,
        message: "Event missing dispatch_id (caller must set per event)",
        phase: "lock_insert",
      };
    }
  }

  const lockRows = events.map((evt) => ({
    event_id: evt.data.dispatch_id!,
    batch_id: evt.data.batch_id,
    principal_id: evt.data.principal_id,
    social_account_id: evt.data.social_account_id,
    platform: evt.data.platform,
    media_storage_path: evt.data.media_path ?? "",
  }));

  const lockResult = await insertPendingDirectPosts(lockRows);
  if (!lockResult.success) {
    console.error(
      "[dispatchPostNowEvents] Lock insert failed:",
      lockResult.message
    );
    return {
      success: false,
      message: `Could not acquire dispatch locks: ${lockResult.message}`,
      phase: "lock_insert",
    };
  }

  try {
    const sendResult = await inngest.send(events);
    console.log(
      `[dispatchPostNowEvents] Dispatched ${events.length} post.now event(s)`
    );
    return { success: true, eventIds: sendResult.ids };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dispatchPostNowEvents] Inngest send failed:", message);
    return {
      success: false,
      message: `Failed to dispatch events: ${message}`,
      phase: "inngest_send",
    };
  }
}
