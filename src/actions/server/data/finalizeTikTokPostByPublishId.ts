import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import {
  content_history,
  pending_direct_posts,
  pending_tiktok_pulls,
  scheduled_posts,
} from "@/db/schema";
import type { PostStatus } from "@/db/schema";
import type { PlatformFailureReason } from "@/lib/api/_shared/platformFailure";
import type { DispatchWebhookFields } from "@/lib/api/rest/webhooks/postWebhookPayloads";

export type TikTokPullOutcome =
  | { outcome: "completed"; tiktokPostId: string | null }
  | { outcome: "failed"; reason: PlatformFailureReason; message: string };

export type FailedTikTokPost =
  | { kind: "scheduled"; scheduledPostId: string; reason: PlatformFailureReason; message: string }
  | { kind: "post_now"; dispatch: DispatchWebhookFields; reason: PlatformFailureReason; message: string };

type FailedTikTokPull = Extract<TikTokPullOutcome, { outcome: "failed" }>;

type DirectPostStatus = (typeof pending_direct_posts.$inferSelect)["status"];

type ClaimedPull = {
  social_account_id: string;
  media_storage_path: string;
  content_history_id: string | null;
};

type FinalizeSuccess =
  | { success: true; kind: "not_found" | "already_finalized" }
  | {
      success: true;
      kind: "finalized";
      principalId: string;
      mediaStoragePath: string;
      failedPost: FailedTikTokPost | null;
    };

export type FinalizeTikTokPullResult =
  | FinalizeSuccess
  | { success: false; message: string };

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SCHEDULED_STATUSES_A_TIKTOK_FAILURE_OVERRIDES: PostStatus[] = [
  "processing",
  "posted",
];

const DISPATCH_STATUSES_A_TIKTOK_FAILURE_OVERRIDES: DirectPostStatus[] = ["processing", "completed"];

const AMBIGUOUS_DISPATCH_MATCH_COUNT = 2;

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
      social_account_id: pending_tiktok_pulls.social_account_id,
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
      failedPost: null,
    };
  }

  await markContentHistoryFailed(transaction, {
    contentHistoryId: claimedPull.content_history_id,
    message: result.message,
    failedAt: finalizedAt,
  });
  const failedPost = claimedPull.scheduled_post_id
    ? await markScheduledPostFailed(transaction, {
        scheduledPostId: claimedPull.scheduled_post_id,
        result,
        failedAt: finalizedAt,
      })
    : await markDirectDispatchFailed(transaction, { pull: claimedPull, result, failedAt: finalizedAt });

  return {
    success: true,
    kind: "finalized",
    principalId: claimedPull.principal_id,
    mediaStoragePath: claimedPull.media_storage_path,
    failedPost,
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
  input: { scheduledPostId: string; result: FailedTikTokPull; failedAt: string },
): Promise<FailedTikTokPost | null> {
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
    kind: "scheduled",
    scheduledPostId: failedPost.id,
    reason: input.result.reason,
    message: input.result.message,
  };
}

async function findDirectDispatchOfPull(
  transaction: Transaction,
  pull: ClaimedPull,
): Promise<string | null> {
  if (!pull.content_history_id) return null;
  const [history] = await transaction
    .select({ batch_id: content_history.batch_id })
    .from(content_history)
    .where(eq(content_history.id, pull.content_history_id))
    .limit(1);
  if (!history?.batch_id) return null;

  const matchingDispatches = await transaction
    .select({ event_id: pending_direct_posts.event_id })
    .from(pending_direct_posts)
    .where(
      and(
        eq(pending_direct_posts.batch_id, history.batch_id),
        eq(pending_direct_posts.social_account_id, pull.social_account_id),
        eq(pending_direct_posts.platform, "tiktok"),
        eq(pending_direct_posts.media_storage_path, pull.media_storage_path),
      ),
    )
    .limit(AMBIGUOUS_DISPATCH_MATCH_COUNT);
  if (matchingDispatches.length >= AMBIGUOUS_DISPATCH_MATCH_COUNT) {
    console.warn(
      `[findDirectDispatchOfPull] Batch ${history.batch_id} holds several TikTok dispatches for account ${pull.social_account_id}; none is failed`,
    );
    return null;
  }
  return matchingDispatches[0]?.event_id ?? null;
}

async function markDirectDispatchFailed(
  transaction: Transaction,
  input: { pull: ClaimedPull; result: FailedTikTokPull; failedAt: string },
): Promise<FailedTikTokPost | null> {
  const dispatchId = await findDirectDispatchOfPull(transaction, input.pull);
  if (!dispatchId) return null;
  const [failedDispatch] = await transaction
    .update(pending_direct_posts)
    .set({
      status: "failed",
      failure_reason: input.result.message.slice(0, STORED_MESSAGE_MAX_CHARS),
      finished_at: input.failedAt,
    })
    .where(
      and(
        eq(pending_direct_posts.event_id, dispatchId),
        inArray(pending_direct_posts.status, DISPATCH_STATUSES_A_TIKTOK_FAILURE_OVERRIDES),
      ),
    )
    .returning({
      dispatch_id: pending_direct_posts.event_id,
      batch_id: pending_direct_posts.batch_id,
      platform: pending_direct_posts.platform,
      social_account_id: pending_direct_posts.social_account_id,
    });
  if (!failedDispatch) return null;
  return {
    kind: "post_now",
    dispatch: failedDispatch,
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
