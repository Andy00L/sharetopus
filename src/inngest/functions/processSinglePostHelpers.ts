import { and, eq, inArray, isNull } from "drizzle-orm";

import { storeFailedPost } from "@/actions/server/contentHistoryActions/storeFailedPost";
import { deleteSupabaseFile } from "@/actions/server/data/storageFiles/deleteSupabaseFile";
import { db, runQuery } from "@/db/client";
import { content_history, scheduled_posts, social_accounts } from "@/db/schema";
import type { PostStatus } from "@/db/schema";
import {
  PLATFORM_LABELS,
  isPostingPlatform,
  platformSupportsMediaType,
} from "@/lib/platforms/capabilities";
import { dispatchWebhook } from "@/lib/api/rest/webhooks/dispatch";
import { decodeStoredPostOptions } from "@/inngest/events/postOptions";
import type { SocialAccount } from "@/lib/types/dbTypes";
import { toJsonObject } from "@/lib/utils/jsonObject";
import "server-only";
import {
  buildInputRefusal,
  type PlatformPostOutcome,
  type PublishFailure,
} from "./platformErrors";
import type { PublishMediaUrls, PublishRequest } from "./publishToPlatform";

type ScheduledPost = typeof scheduled_posts.$inferSelect;

export type LoadPostResult =
  | { kind: "ready"; post: ScheduledPost }
  | { kind: "account_missing"; post: ScheduledPost }
  | { kind: "terminal"; message: string }
  | { kind: "lookup_failed"; message: string };

// Reads only the account id, never its tokens: this result is returned
// from an Inngest step, which stores it.
export async function loadPostForProcessing(
  scheduledPostId: string,
): Promise<LoadPostResult> {
  const { data: postRows, error: postError } = await runQuery(
    db
      .select()
      .from(scheduled_posts)
      .where(eq(scheduled_posts.id, scheduledPostId))
      .limit(1),
  );
  if (postError) {
    return { kind: "lookup_failed", message: `Failed to fetch post: ${postError.message}` };
  }
  const post = postRows[0];
  if (!post) return { kind: "terminal", message: "post not found" };
  if (TERMINAL_POST_STATUSES.includes(post.status)) {
    return { kind: "terminal", message: `post already ${post.status}` };
  }

  const { data: accountRows, error: accountError } = await runQuery(
    db
      .select({ id: social_accounts.id })
      .from(social_accounts)
      .where(
        and(
          eq(social_accounts.id, post.social_account_id),
          isNull(social_accounts.deleted_at),
        ),
      )
      .limit(1),
  );
  if (accountError) {
    return { kind: "lookup_failed", message: `Failed to fetch account: ${accountError.message}` };
  }
  return accountRows.length > 0
    ? { kind: "ready", post }
    : { kind: "account_missing", post };
}

const TERMINAL_POST_STATUSES: readonly PostStatus[] = ["posted", "failed", "cancelled"];

export type ClaimResult =
  | { success: true; claimed: boolean }
  | { success: false; message: string };

export async function claimPostForProcessing(input: {
  scheduledPostId: string;
  dispatchedScheduledAt: string;
}): Promise<ClaimResult> {
  const { data, error } = await runQuery(
    db
      .update(scheduled_posts)
      .set({
        status: "processing" satisfies PostStatus,
        updated_at: new Date().toISOString(),
      })
      .where(
        and(
          eq(scheduled_posts.id, input.scheduledPostId),
          inArray(
            scheduled_posts.status,
            ["scheduled", "queued"] satisfies PostStatus[],
          ),
          eq(scheduled_posts.scheduled_at, input.dispatchedScheduledAt),
        ),
      )
      .returning({ id: scheduled_posts.id }),
  );

  if (error) {
    console.error("[claimPostForProcessing] claim failed:", error.message);
    return { success: false, message: `claim error: ${error.message}` };
  }
  return { success: true, claimed: data.length > 0 };
}

export function resolvePostBatchId(post: Pick<ScheduledPost, "id" | "batch_id">): string {
  return post.batch_id ?? post.id;
}

export type PublishedCheckResult =
  | { success: true; isPublished: boolean }
  | { success: false; message: string };

export async function findPublishedContentHistory(
  post: Pick<ScheduledPost, "id" | "batch_id">,
): Promise<PublishedCheckResult> {
  const { data, error } = await runQuery(
    db
      .select({ id: content_history.id })
      .from(content_history)
      .where(
        and(
          eq(content_history.batch_id, resolvePostBatchId(post)),
          eq(content_history.scheduled_post_id, post.id),
        ),
      )
      .limit(1),
  );
  if (error) {
    return { success: false, message: `content history lookup failed: ${error.message}` };
  }
  return { success: true, isPublished: data.length > 0 };
}

export type CompatibilityResult = {
  success: true;
  message: string;
  compatible: boolean;
  reason: string;
};

export function checkPlatformCompatibility(
  platform: string,
  mediaType: ScheduledPost["media_type"],
): CompatibilityResult {
  if (!platformSupportsMediaType(platform, mediaType)) {
    const platformLabel = isPostingPlatform(platform)
      ? PLATFORM_LABELS[platform]
      : platform;
    return {
      success: true,
      message: "incompatible",
      compatible: false,
      reason: `${platformLabel} does not support ${mediaType} posts`,
    };
  }
  return {
    success: true,
    message: "compatible",
    compatible: true,
    reason: "",
  };
}

export type ScheduledPublishRequestResult =
  | { ok: true; request: PublishRequest }
  | PublishFailure;

export function buildScheduledPublishRequest(input: {
  post: ScheduledPost;
  account: SocialAccount;
  urls: PublishMediaUrls;
}): ScheduledPublishRequestResult {
  const { post, account, urls } = input;
  const decodedOptions = decodeStoredPostOptions(post.post_options);
  if (!decodedOptions.ok) {
    return buildInputRefusal(`Malformed post_options: ${decodedOptions.invalidKeys.join(", ")}`);
  }
  const { platformOptions, pinterestBoard, link } = decodedOptions.decoded;

  return {
    ok: true,
    request: {
      account,
      principalId: post.principal_id,
      platform: post.platform,
      postType: post.media_type,
      title: post.post_title ?? "",
      description: post.post_description ?? "",
      link,
      platformOptions,
      pinterestBoard,
      registryOptions: post.post_options,
      coverTimestampMs: post.cover_image_timestamp,
      media: { storagePath: post.media_storage_path, urls },
      batchId: resolvePostBatchId(post),
      scheduledPostId: post.id,
      createdVia: post.created_via,
    },
  };
}

export type RecordStatusResult =
  | { success: true; updated: boolean }
  | { success: false; message: string };

export async function recordPostStatus(args: {
  post: ScheduledPost;
  result: PlatformPostOutcome;
}): Promise<RecordStatusResult> {
  const { post, result } = args;
  const nowIso = new Date().toISOString();

  if (result.ok) {
    const { data, error } = await runQuery(
      db
        .update(scheduled_posts)
        .set({
          status: "posted" satisfies PostStatus,
          posted_at: nowIso,
          error_message: null,
          updated_at: nowIso,
        })
        .where(
          and(
            eq(scheduled_posts.id, post.id),
            eq(scheduled_posts.status, "processing" satisfies PostStatus),
          ),
        )
        .returning({ id: scheduled_posts.id }),
    );

    if (error) {
      console.error("[recordPostStatus] mark posted failed:", error.message);
      return { success: false, message: `mark-posted error: ${error.message}` };
    }
    const wasPosted = data.length > 0;
    if (wasPosted) {
      dispatchWebhook(post.principal_id, "post.published", {
        post_id: post.id,
        platform: post.platform,
      });
    }
    return { success: true, updated: wasPosted };
  }

  const errorMessage = `${result.reason}: ${result.message}`.slice(0, 1000);

  const { data, error } = await runQuery(
    db
      .update(scheduled_posts)
      .set({
        status: "failed" satisfies PostStatus,
        error_message: errorMessage,
        updated_at: nowIso,
      })
      .where(
        and(
          eq(scheduled_posts.id, post.id),
          eq(scheduled_posts.status, "processing" satisfies PostStatus),
        ),
      )
      .returning({ id: scheduled_posts.id }),
  );

  if (error) {
    console.error("[recordPostStatus] mark failed failed:", error.message);
    return { success: false, message: `mark-failed error: ${error.message}` };
  }

  const wasUpdated = data.length > 0;
  if (!wasUpdated) return { success: true, updated: false };

  const storeResult = await storeFailedPost({
    principal_id: post.principal_id,
    social_account_id: post.social_account_id,
    platform: post.platform,
    post_title: post.post_title ?? null,
    post_description: post.post_description ?? null,
    post_options: toJsonObject(post.post_options) ?? {},
    media_type: post.media_type,
    media_storage_path: post.media_storage_path ?? "",
    coverTimestamp: post.cover_image_timestamp ?? undefined,
    batch_id: resolvePostBatchId(post),
    idempotency_key: post.idempotency_key,
    x402_charge_id: post.x402_charge_id,
    extra_data: {
      reason: result.reason,
      message: result.message,
      timestamp: nowIso,
    },
    created_via: post.created_via,
  });
  if (!storeResult.success) {
    console.error(
      "[recordPostStatus] Failed to store failed post record:",
      storeResult.message,
    );
  }

  dispatchWebhook(post.principal_id, "post.failed", {
    post_id: post.id,
    platform: post.platform,
    reason: result.reason,
    error_message: result.message,
  });
  if (result.reason === "auth_expired") {
    dispatchWebhook(post.principal_id, "connection.expired", {
      social_account_id: post.social_account_id,
      platform: post.platform,
      reason: "auth_expired",
    });
  }

  return { success: true, updated: true };
}

export type CleanupResult = {
  success: true;
  message: string;
  deleted: boolean;
};

export async function cleanupMediaIfUnreferenced(
  mediaPath: string,
  principalId: string,
): Promise<CleanupResult> {
  if (mediaPath === "") {
    return { success: true, message: "no media to clean", deleted: false };
  }
  const result = await deleteSupabaseFile(principalId, mediaPath, false);
  if (!result.success) {
    console.warn(`[cleanupMediaIfUnreferenced] ${mediaPath} not cleaned up: ${result.message}`);
    return { success: true, message: `cleanup skipped: ${result.message}`, deleted: false };
  }
  return {
    success: true,
    message: result.removed ? `deleted ${mediaPath}` : `kept ${mediaPath}: ${result.message}`,
    deleted: result.removed,
  };
}
