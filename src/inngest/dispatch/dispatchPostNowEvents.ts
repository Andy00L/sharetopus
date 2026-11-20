import "server-only";

import { inngest } from "@/inngest/client";
import {
  lockPendingDirectPosts,
  releasePendingDirectPosts,
  type PendingDirectPostLock,
} from "@/actions/server/data/pendingDirectPosts";
import type { PostNowEventData } from "@/inngest/functions/processDirectPostHelpers";

export type DispatchPostNowEventsResult =
  | { success: true; eventIds: string[]; freshCount: number }
  | { success: false; message: string; phase: "lock_insert" | "inngest_send" };

type PostNowEvent = { name: "post.now"; data: PostNowEventData };

type DispatchablePostNowEvent = PostNowEvent & { data: { dispatch_id: string } };

function hasDispatchId(
  postEvent: PostNowEvent,
): postEvent is DispatchablePostNowEvent {
  return (
    typeof postEvent.data.dispatch_id === "string" &&
    postEvent.data.dispatch_id.length > 0
  );
}

function toDispatchLock(postEvent: DispatchablePostNowEvent): PendingDirectPostLock {
  return {
    event_id: postEvent.data.dispatch_id,
    batch_id: postEvent.data.batch_id,
    principal_id: postEvent.data.principal_id,
    social_account_id: postEvent.data.social_account_id,
    platform: postEvent.data.platform,
    media_storage_path: postEvent.data.media_path,
    idempotency_key: postEvent.data.idempotency_key ?? null,
  };
}

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

  const lockResult = await lockPendingDirectPosts(dispatchableEvents, toDispatchLock);
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

  const eventsToSend = lockResult.entries.flatMap((entry) =>
    entry.kind === "locked" ? [entry.item] : [],
  );

  if (eventsToSend.length > 0) {
    try {
      await inngest.send(
        eventsToSend.map((postEvent) => ({
          ...postEvent,
          // Inngest drops a repeated event id for 24 hours:
          // https://www.inngest.com/docs/guides/handling-idempotency
          id: `post.now-${postEvent.data.dispatch_id}`,
        })),
      );
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      const released = await releasePendingDirectPosts(
        eventsToSend.map((postEvent) => postEvent.data.dispatch_id),
      );
      console.error(
        `[dispatchPostNowEvents] [req=${requestId ?? "?"}] Inngest send failed:`,
        message,
        released.success ? "(locks released)" : `(${released.message})`,
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

  return {
    success: true,
    eventIds: lockResult.entries.map((entry) =>
      entry.kind === "locked" ? entry.item.data.dispatch_id : entry.existingEventId,
    ),
    freshCount: eventsToSend.length,
  };
}
