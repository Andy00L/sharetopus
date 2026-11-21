import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { content_history, pending_tiktok_pulls, scheduled_posts } from "@/db/schema";
import type { PostStatus } from "@/db/schema";
import type { PlatformErrorReason } from "@/inngest/functions/platformErrors";

export type TikTokPullOutcome =
  | { outcome: "completed"; tiktokPostId: string | null }
  | { outcome: "failed"; reason: PlatformErrorReason; message: string };

export type FailedScheduledTikTokPost = {
  scheduledPostId: string;
  reason: PlatformErrorReason;
  message: string;
};

type FinalizeSuccess =
  | { success: true; kind: "not_found" | "already_finalized" }
  | {
      success: true;
      kind: "finalized";
      principalId: string;
      mediaStoragePath: string;
      failedScheduledPost: FailedScheduledTikTokPost | null;
    };

export type FinalizeTikTokPullResult =
  | FinalizeSuccess
  | { success: false; message: string };

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SCHEDULED_STATUSES_A_TIKTOK_FAILURE_OVERRIDES: PostStatus[] = [
  "processing",
  "posted",
];

const STORED_MESSAGE_MAX_CHARS = 1000;

export async function finalizeTikTokPostByPublishId(input: {
  publishId: string;
  source: "poll" | "webhook";
  result: TikTokPullOutcome;
}): Promise<FinalizeTikTokPullResult> {
  const { data: finalized, error } = await runQuery(
    db.transaction((transaction) =>
      applyTikTokPullOutcome(transaction, input.publishId, input.result),
    ),
  );

  if (error) {
    console.error(
      `[finalizeTikTokPostByPublishId] ${input.publishId} rolled back (source=${input.source}): ${error.message}`,
    );
    return { success: false, message: `Finalize failed: ${error.message}` };
  }

  console.log(
    `[finalizeTikTokPostByPublishId] ${input.publishId} ${finalized.kind} (source=${input.source}, outcome=${input.result.outcome})`,
  );
  return finalized;
}

async function applyTikTokPullOutcome(
  transaction: Transaction,
  publishId: string,
  result: TikTokPullOutcome,
): Promise<FinalizeSuccess> {
  const finalizedAt = new Date().toISOString();
  const pullUpdate: Partial<typeof pending_tiktok_pulls.$inferInsert> =
    result.outcome === "completed"
      ? { status: "completed", tiktok_post_id: result.tiktokPostId, finalized_at: finalizedAt }
      : {
          status: "failed",
          failure_reason: result.message.slice(0, STORED_MESSAGE_MAX_CHARS),
          finalized_at: finalizedAt,
        };

  const [claimedPull] = await transaction
    .update(pending_tiktok_pulls)
    .set(pullUpdate)
    .where(
      and(
        eq(pending_tiktok_pulls.publish_id, publishId),
        eq(pending_tiktok_pulls.status, "pending"),
      ),
    )
    .returning({
      principal_id: pending_tiktok_pulls.principal_id,
      media_storage_path: pending_tiktok_pulls.media_storage_path,
      content_history_id: pending_tiktok_pulls.content_history_id,
      scheduled_post_id: pending_tiktok_pulls.scheduled_post_id,
      creator_username: pending_tiktok_pulls.creator_username,
    });

  if (!claimedPull) {
    return backfillFinalizedPull(transaction, publishId, result);
  }

  if (result.outcome === "completed") {
    await writeTikTokDeepLink(transaction, {
      contentHistoryId: claimedPull.content_history_id,
      creatorUsername: claimedPull.creator_username,
      tiktokPostId: result.tiktokPostId,
      publishId,
    });
    return {
      success: true,
      kind: "finalized",
      principalId: claimedPull.principal_id,
      mediaStoragePath: claimedPull.media_storage_path,
      failedScheduledPost: null,
    };
  }

  await markContentHistoryFailed(transaction, {
    contentHistoryId: claimedPull.content_history_id,
    message: result.message,
    failedAt: finalizedAt,
  });
  const failedScheduledPost = await markScheduledPostFailed(transaction, {
    scheduledPostId: claimedPull.scheduled_post_id,
    result,
    failedAt: finalizedAt,
  });

  return {
    success: true,
    kind: "finalized",
    principalId: claimedPull.principal_id,
    mediaStoragePath: claimedPull.media_storage_path,
    failedScheduledPost,
  };
}

async function backfillFinalizedPull(
  transaction: Transaction,
  publishId: string,
  result: TikTokPullOutcome,
): Promise<FinalizeSuccess> {
  const [existingPull] = await transaction
    .select({
      tiktok_post_id: pending_tiktok_pulls.tiktok_post_id,
      content_history_id: pending_tiktok_pulls.content_history_id,
      creator_username: pending_tiktok_pulls.creator_username,
    })
    .from(pending_tiktok_pulls)
    .where(eq(pending_tiktok_pulls.publish_id, publishId))
    .limit(1);

  if (!existingPull) return { success: true, kind: "not_found" };

  const isPostIdNew =
    result.outcome === "completed" &&
    result.tiktokPostId !== null &&
    existingPull.tiktok_post_id === null;
  if (!isPostIdNew) return { success: true, kind: "already_finalized" };

  const [backfilledPull] = await transaction
    .update(pending_tiktok_pulls)
    .set({ tiktok_post_id: result.tiktokPostId })
    .where(
      and(
        eq(pending_tiktok_pulls.publish_id, publishId),
        isNull(pending_tiktok_pulls.tiktok_post_id),
      ),
    )
    .returning({ publish_id: pending_tiktok_pulls.publish_id });

  if (backfilledPull) {
    await writeTikTokDeepLink(transaction, {
      contentHistoryId: existingPull.content_history_id,
      creatorUsername: existingPull.creator_username,
      tiktokPostId: result.tiktokPostId,
      publishId,
    });
  }
  return { success: true, kind: "already_finalized" };
}

async function writeTikTokDeepLink(
  transaction: Transaction,
  input: {
    contentHistoryId: string | null;
    creatorUsername: string | null;
    tiktokPostId: string | null;
    publishId: string;
  },
): Promise<void> {
  if (!input.contentHistoryId) return;
  const deepLink = buildTikTokDeepLink(input);
  if (!deepLink) return;
  await transaction
    .update(content_history)
    .set({ media_url: deepLink })
    .where(eq(content_history.id, input.contentHistoryId));
}

async function markContentHistoryFailed(
  transaction: Transaction,
  input: { contentHistoryId: string | null; message: string; failedAt: string },
): Promise<void> {
  if (!input.contentHistoryId) return;
  const failurePatch = JSON.stringify({
    failure_reason: input.message,
    failed_at: input.failedAt,
  });
  await transaction
    .update(content_history)
    .set({
      status: "failed",
      extra: sql`(case when jsonb_typeof(${content_history.extra}) = 'object' then ${content_history.extra} else '{}'::jsonb end) || ${failurePatch}::jsonb`,
    })
    .where(eq(content_history.id, input.contentHistoryId));
}

async function markScheduledPostFailed(
  transaction: Transaction,
  input: {
    scheduledPostId: string | null;
    result: Extract<TikTokPullOutcome, { outcome: "failed" }>;
    failedAt: string;
  },
): Promise<FailedScheduledTikTokPost | null> {
  if (!input.scheduledPostId) return null;
  const [failedPost] = await transaction
    .update(scheduled_posts)
    .set({
      status: "failed",
      error_message: `${input.result.reason}: ${input.result.message}`.slice(
        0,
        STORED_MESSAGE_MAX_CHARS,
      ),
      updated_at: input.failedAt,
    })
    .where(
      and(
        eq(scheduled_posts.id, input.scheduledPostId),
        inArray(scheduled_posts.status, SCHEDULED_STATUSES_A_TIKTOK_FAILURE_OVERRIDES),
      ),
    )
    .returning({ id: scheduled_posts.id });

  if (!failedPost) return null;
  return {
    scheduledPostId: failedPost.id,
    reason: input.result.reason,
    message: input.result.message,
  };
}

function buildTikTokDeepLink(input: {
  creatorUsername: string | null;
  tiktokPostId: string | null;
  publishId: string;
}): string | null {
  if (!input.creatorUsername || !input.tiktokPostId) return null;

  let segment: "photo" | "video";
  if (input.publishId.startsWith("p_pub_")) {
    segment = "photo";
  } else if (input.publishId.startsWith("v_pub_")) {
    segment = "video";
  } else {
    console.warn(
      `[buildTikTokDeepLink] Unknown publish_id prefix: ${input.publishId}`,
    );
    return null;
  }

  return `https://www.tiktok.com/@${input.creatorUsername}/${segment}/${input.tiktokPostId}`;
}
