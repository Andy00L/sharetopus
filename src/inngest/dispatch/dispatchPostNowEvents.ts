import "server-only";
import { inngest } from "@/inngest/client";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { insertPendingDirectPosts } from "@/actions/server/data/pendingDirectPosts";
import type { PostNowEventData } from "@/inngest/functions/processDirectPostHelpers";

export type DispatchPostNowEventsResult =
  | { success: true; eventIds: string[]; freshCount: number }
  | { success: false; message: string; phase: "lock_insert" | "inngest_send" };

/**
 * Inserts pending_direct_posts lock rows for every event and dispatches the
 * events to Inngest in a single send call.
 *
 * Idempotency: if any event carries an idempotency_key, the helper pre-checks
 * the (principal_id, idempotency_key) partial unique index. Events whose keys
 * already exist are NOT re-dispatched. The returned eventIds array preserves
 * input order, mixing fresh dispatch_ids with existing event_ids.
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
 * Tables touched: pending_direct_posts (select + insert)
 * Inngest events sent: post.now (one per new element)
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

  // Step 1: pre-check existing idempotency keys (only when any event carries one).
  const keyedEvents = events.filter((e) => e.data.idempotency_key);
  const existingMap = new Map<string, string>(); // idempotency_key -> event_id

  if (keyedEvents.length > 0) {
    const keys = keyedEvents.map((e) => e.data.idempotency_key as string);
    const principalIds = [
      ...new Set(keyedEvents.map((e) => e.data.principal_id)),
    ];
    if (principalIds.length !== 1) {
      return {
        success: false,
        message: "All keyed events must share the same principal_id",
        phase: "lock_insert",
      };
    }

    const { data: existing, error: lookupErr } = await adminSupabase
      .from("pending_direct_posts")
      .select("event_id, idempotency_key")
      .eq("principal_id", principalIds[0])
      .in("idempotency_key", keys);

    if (lookupErr) {
      return {
        success: false,
        message: `Idempotency lookup failed: ${lookupErr.message}`,
        phase: "lock_insert",
      };
    }

    for (const row of existing ?? []) {
      if (row.idempotency_key) {
        existingMap.set(row.idempotency_key, row.event_id);
      }
    }
  }

  // Step 2: split events into already-dispatched vs new.
  const newEvents = events.filter((e) => {
    const key = e.data.idempotency_key;
    return !key || !existingMap.has(key);
  });

  // Step 3: insert lock rows + send only the new ones.
  if (newEvents.length > 0) {
    const lockRows = newEvents.map((evt) => ({
      event_id: evt.data.dispatch_id!,
      batch_id: evt.data.batch_id,
      principal_id: evt.data.principal_id,
      social_account_id: evt.data.social_account_id,
      platform: evt.data.platform,
      media_storage_path: evt.data.media_path ?? "",
      idempotency_key: evt.data.idempotency_key ?? null,
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
      await inngest.send(newEvents);
      console.log(
        `[dispatchPostNowEvents] Dispatched ${newEvents.length} post.now event(s)` +
          (existingMap.size > 0
            ? ` (${existingMap.size} skipped as idempotent)`
            : "")
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[dispatchPostNowEvents] Inngest send failed:", message);
      return {
        success: false,
        message: `Failed to dispatch events: ${message}`,
        phase: "inngest_send",
      };
    }
  } else {
    console.log(
      `[dispatchPostNowEvents] All ${events.length} event(s) already dispatched (idempotent)`
    );
  }

  // Step 4: assemble eventIds in input order, mixing fresh + existing.
  const eventIds = events.map((e) => {
    const key = e.data.idempotency_key;
    if (key && existingMap.has(key)) {
      return existingMap.get(key) as string;
    }
    return e.data.dispatch_id as string;
  });

  return { success: true, eventIds, freshCount: newEvents.length };
}
