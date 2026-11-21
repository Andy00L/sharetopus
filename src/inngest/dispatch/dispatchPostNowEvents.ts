import "server-only";

import { inngest } from "@/inngest/client";
import {
  lockPendingDirectPosts,
  releasePendingDirectPosts,
  type PendingDirectPostLock,
} from "@/actions/server/data/pendingDirectPosts";
import {
  buildPostNowEvent,
  PostNowEventDataSchema,
  type PostNowEventData,
} from "@/inngest/events/postNow";

export type RefusedPostNowEvent = {
  dispatchId: string;
  socialAccountId: string;
  message: string;
};

export type PostNowDispatch = { eventId: string; batchId: string };

export type DispatchPostNowEventsResult =
  | {
      success: true;
      dispatches: PostNowDispatch[];
      freshCount: number;
      refused: RefusedPostNowEvent[];
    }
  | { success: false; message: string; phase: "lock_insert" | "inngest_send" };

function toDispatchLock(postData: PostNowEventData): PendingDirectPostLock {
  return {
    event_id: postData.dispatch_id,
    batch_id: postData.batch_id,
    principal_id: postData.principal_id,
    social_account_id: postData.social_account_id,
    platform: postData.platform,
    media_storage_path: postData.media_path,
    idempotency_key: postData.idempotency_key ?? null,
  };
}

function partitionBySchema(posts: PostNowEventData[]): {
  validPosts: PostNowEventData[];
  refused: RefusedPostNowEvent[];
} {
  const validPosts: PostNowEventData[] = [];
  const refused: RefusedPostNowEvent[] = [];
  for (const postData of posts) {
    const parsed = PostNowEventDataSchema.safeParse(postData);
    if (parsed.success) {
      validPosts.push(postData);
      continue;
    }
    refused.push({
      dispatchId: postData.dispatch_id,
      socialAccountId: postData.social_account_id,
      message: `Invalid post.now event: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "event"}: ${issue.message}`)
        .join("; ")}`,
    });
  }
  return { validPosts, refused };
}

export async function dispatchPostNowEvents(
  posts: PostNowEventData[]
): Promise<DispatchPostNowEventsResult> {
  const requestId = posts[0]?.request_id ?? null;

  if (posts.length === 0) {
    return { success: false, message: "No events provided", phase: "lock_insert" };
  }

  const keyedPrincipalIds = new Set(
    posts
      .filter((postData) => postData.idempotency_key)
      .map((postData) => postData.principal_id),
  );
  if (keyedPrincipalIds.size > 1) {
    return {
      success: false,
      message: "All keyed events must share the same principal_id",
      phase: "lock_insert",
    };
  }

  const { validPosts, refused } = partitionBySchema(posts);
  for (const refusedEvent of refused) {
    console.error(
      `[dispatchPostNowEvents] [req=${requestId ?? "?"}] Refused account ${refusedEvent.socialAccountId}: ${refusedEvent.message}`,
    );
  }
  if (validPosts.length === 0) {
    return { success: true, dispatches: [], freshCount: 0, refused };
  }

  const lockResult = await lockPendingDirectPosts(validPosts, toDispatchLock);
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

  const postsToSend = lockResult.entries.flatMap((entry) =>
    entry.kind === "locked" ? [entry.item] : [],
  );

  if (postsToSend.length > 0) {
    try {
      await inngest.send(postsToSend.map(buildPostNowEvent));
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError);
      const released = await releasePendingDirectPosts(
        postsToSend.map((postData) => postData.dispatch_id),
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

  const skippedCount = validPosts.length - postsToSend.length;
  console.log(
    `[dispatchPostNowEvents] [req=${requestId ?? "?"}] Dispatched ${postsToSend.length} post.now event(s)` +
      (skippedCount > 0 ? ` (${skippedCount} already dispatched)` : ""),
  );

  return {
    success: true,
    dispatches: lockResult.entries.map((entry): PostNowDispatch =>
      entry.kind === "locked"
        ? { eventId: entry.item.dispatch_id, batchId: entry.item.batch_id }
        : { eventId: entry.existingLock.event_id, batchId: entry.existingLock.batch_id },
    ),
    freshCount: postsToSend.length,
    refused,
  };
}
