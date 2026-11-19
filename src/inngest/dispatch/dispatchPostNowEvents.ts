import "server-only";
import { and, eq, inArray } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { db, runQuery } from "@/db/client";
import { pending_direct_posts } from "@/db/schema";
import { insertPendingDirectPosts } from "@/actions/server/data/pendingDirectPosts";
import type { PostNowEventData } from "@/inngest/functions/processDirectPostHelpers";

export type DispatchPostNowEventsResult =
  | { success: true; eventIds: string[]; freshCount: number }
  | { success: false; message: string; phase: "lock_insert" | "inngest_send" };

type PostNowEvent = { name: "post.now"; data: PostNowEventData };

type DispatchablePostNowEvent = PostNowEvent & { data: { dispatch_id: string } };

/** True when the event carries the non-empty dispatch_id its lock row needs. */
function hasDispatchId(
  postEvent: PostNowEvent,
): postEvent is DispatchablePostNowEvent {
  return (
    typeof postEvent.data.dispatch_id === "string" &&
    postEvent.data.dispatch_id.length > 0
  );
}

/**
 * Inserts pending_direct_posts lock rows for every event, then sends to
 * Inngest only the events whose lock row this call wrote.
 *
 * Idempotency: the lock insert skips a row whose event_id or
 * (principal_id, idempotency_key) already exists
 * (pending_direct_posts_principal_idem_uq). The database decides, so a
 * retry and two concurrent dispatches of one batch both send each post
 * once. The returned eventIds keep input order; a skipped keyed event
 * reports the event_id of the row that already holds its key.
 *
 * Each sent event carries id post.now-{dispatch_id}, so a repeated send
 * of the same event is dropped by Inngest's 24-hour event deduplication.
 *
 * Failure semantics:
 *   - Lock insert fails: { success: false, phase: "lock_insert" }, nothing
 *     sent.
 *   - Inngest send fails AFTER locks inserted: { success: false, phase:
 *     "inngest_send" }. Locks stay in 'processing'; sweepStuckDirectPosts
 *     finalizes them as 'failed' after 10 minutes, which frees storage
 *     cleanup.
 *
 * Callers: web direct-post path (handleSocialMediaPost.dispatchDirectPostEvents),
 *          directPostBatch (MCP publish_posts, REST, x402).
 */
export async function dispatchPostNowEvents(
  events: PostNowEvent[]
): Promise<DispatchPostNowEventsResult> {
  const requestId = events[0]?.data.request_id ?? null;

  if (events.length === 0) {
    return { success: false, message: "No events provided", phase: "lock_insert" };
  }

  const dispatchableEvents = events.filter(hasDispatchId);
  if (dispatchableEvents.length !== events.length) {
    return {
      success: false,
      message: "Event missing dispatch_id (caller must set per event)",
      phase: "lock_insert",
    };
  }

  const keyedPrincipalIds = new Set(
    dispatchableEvents
      .filter((postEvent) => postEvent.data.idempotency_key)
      .map((postEvent) => postEvent.data.principal_id),
  );
  if (keyedPrincipalIds.size > 1) {
    return {
      success: false,
      message: "All keyed events must share the same principal_id",
      phase: "lock_insert",
    };
  }

  const lockResult = await insertPendingDirectPosts(
    dispatchableEvents.map((postEvent) => ({
      event_id: postEvent.data.dispatch_id,
      batch_id: postEvent.data.batch_id,
      principal_id: postEvent.data.principal_id,
      social_account_id: postEvent.data.social_account_id,
      platform: postEvent.data.platform,
      media_storage_path: postEvent.data.media_path ?? "",
      idempotency_key: postEvent.data.idempotency_key ?? null,
    })),
  );
  if (!lockResult.success) {
    console.error(
      `[dispatchPostNowEvents] [req=${requestId ?? "?"}] Lock insert failed:`,
      lockResult.message,
    );
    return {
      success: false,
      message: `Could not acquire dispatch locks: ${lockResult.message}`,
      phase: "lock_insert",
    };
  }

  const lockedDispatchIds = new Set(lockResult.insertedEventIds);
  const eventsToSend = dispatchableEvents.filter((postEvent) =>
    lockedDispatchIds.has(postEvent.data.dispatch_id),
  );

  const existingEventIdsByKey = await readExistingEventIdsByKey(
    dispatchableEvents.filter(
      (postEvent) => !lockedDispatchIds.has(postEvent.data.dispatch_id),
    ),
  );

  if (eventsToSend.length > 0) {
    try {
      await inngest.send(
        eventsToSend.map((postEvent) => ({
          ...postEvent,
          id: `post.now-${postEvent.data.dispatch_id}`,
        })),
      );
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      console.error(
        `[dispatchPostNowEvents] [req=${requestId ?? "?"}] Inngest send failed:`,
        message,
      );
      return {
        success: false,
        message: `Failed to dispatch events: ${message}`,
        phase: "inngest_send",
      };
    }
  }

  const skippedCount = dispatchableEvents.length - eventsToSend.length;
  console.log(
    `[dispatchPostNowEvents] [req=${requestId ?? "?"}] Dispatched ${eventsToSend.length} post.now event(s)` +
      (skippedCount > 0 ? ` (${skippedCount} already dispatched)` : ""),
  );

  const eventIds = dispatchableEvents.map((postEvent) => {
    if (lockedDispatchIds.has(postEvent.data.dispatch_id)) {
      return postEvent.data.dispatch_id;
    }
    const key = postEvent.data.idempotency_key;
    return (key ? existingEventIdsByKey.get(key) : undefined) ?? postEvent.data.dispatch_id;
  });

  return { success: true, eventIds, freshCount: eventsToSend.length };
}

/**
 * Maps the idempotency keys of skipped events to the event_id of the lock
 * row that already holds each key. A failed read degrades to an empty map:
 * the dispatch itself already succeeded, and the caller then reports the
 * skipped events under their own dispatch_ids.
 */
async function readExistingEventIdsByKey(
  skippedEvents: DispatchablePostNowEvent[],
): Promise<Map<string, string>> {
  const existingEventIdsByKey = new Map<string, string>();
  const keyedSkippedEvents = skippedEvents.filter(
    (postEvent) => postEvent.data.idempotency_key,
  );
  const skippedKeys = keyedSkippedEvents.flatMap(
    (postEvent) => postEvent.data.idempotency_key ?? [],
  );
  const principalId = keyedSkippedEvents[0]?.data.principal_id;
  if (!principalId) return existingEventIdsByKey;

  const { data: existingRows, error } = await runQuery(
    db
      .select({
        event_id: pending_direct_posts.event_id,
        idempotency_key: pending_direct_posts.idempotency_key,
      })
      .from(pending_direct_posts)
      .where(
        and(
          eq(pending_direct_posts.principal_id, principalId),
          inArray(pending_direct_posts.idempotency_key, skippedKeys),
        ),
      ),
  );
  if (error) {
    console.error(
      "[readExistingEventIdsByKey] Existing lock lookup failed:",
      error.message,
    );
    return existingEventIdsByKey;
  }

  for (const existingRow of existingRows) {
    if (existingRow.idempotency_key) {
      existingEventIdsByKey.set(existingRow.idempotency_key, existingRow.event_id);
    }
  }
  return existingEventIdsByKey;
}
