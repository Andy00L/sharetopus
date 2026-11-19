import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { storeFailedPost } from "@/actions/server/contentHistoryActions/storeFailedPost";
import { getServerSignedViewUrl } from "@/actions/server/data/getServerSignedViewUrl";
import { deleteSupabaseFile } from "@/actions/server/data/storageFiles/deleteSupabaseFile";
import { db, runQuery } from "@/db/client";
import { content_history, scheduled_posts, social_accounts } from "@/db/schema";
import type { PostStatus } from "@/db/schema";
import { directPostForFacebookAccounts } from "@/lib/api/facebook/post/directPostForFacebookAccounts";
import { directPostForInstagramAccounts } from "@/lib/api/instagram/post/directPostForInstagramAccounts";
import { directPostForLinkedInAccounts } from "@/lib/api/linkedin/post/directPostForLinkedInAccounts";
import { directPostForPinterestAccounts } from "@/lib/api/pinterest/post/directPostForPinterestAccounts";
import { buildTikTokMediaUrl } from "@/lib/api/tiktok/buildTikTokMediaUrl";
import { directPostForTikTokAccounts } from "@/lib/api/tiktok/post/directPostForTikTokAccounts";
import { directPostForXAccounts } from "@/lib/api/x/post/directPostForXAccounts";
import { directPostForYouTubeAccounts } from "@/lib/api/youtube/post/directPostForYouTubeAccounts";
import {
  PLATFORM_LABELS,
  isPostingPlatform,
  isSchedulablePlatform,
  platformHotlinksMedia,
  platformSupportsMediaType,
} from "@/lib/platforms/capabilities";
import { publishViaRegistry } from "@/lib/platforms/providers/publishViaRegistry";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import { dispatchWebhook } from "@/lib/api/rest/webhooks/dispatch";
import type {
  PlatformOptions,
  PrivacyLevel,
  SocialAccount,
} from "@/lib/types/dbTypes";
import { toJsonObject } from "@/lib/utils/jsonObject";
import "server-only";
import {
  classifyDirectPostFailure,
  type PlatformErrorReason,
  type PlatformPostOutcome,
} from "./platformErrors";

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
          eq(content_history.batch_id, post.batch_id ?? post.id),
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

export type SignedUrlsResult =
  | {
      success: true;
      message: string;
      mediaUrl: string | null;
      tiktokMediaUrl: string | null;
    }
  | { success: false; message: string };

export const HOTLINK_SIGNED_URL_TTL_S = 30 * 24 * 60 * 60;

export async function buildPlatformSignedUrls(
  post: ScheduledPost,
  platform: string,
): Promise<SignedUrlsResult> {
  if (!post.media_storage_path || post.media_storage_path === "") {
    return {
      success: true,
      message: "no media",
      mediaUrl: null,
      tiktokMediaUrl: null,
    };
  }

  if (!isPostingPlatform(platform)) {
    const registrySigned = await getServerSignedViewUrl(
      post.media_storage_path,
      platformHotlinksMedia(platform)
        ? HOTLINK_SIGNED_URL_TTL_S
        : RUNTIME.signedUrlTtlS,
    );
    if (!registrySigned.success) {
      return {
        success: false,
        message: registrySigned.message ?? "Failed to mint signed URL",
      };
    }
    return {
      success: true,
      message: "registry signed url minted",
      mediaUrl: registrySigned.url ?? null,
      tiktokMediaUrl: null,
    };
  }

  if (platform === "youtube" || platform === "x") {
    return {
      success: true,
      message: "buffer-upload platform, no url minted",
      mediaUrl: null,
      tiktokMediaUrl: null,
    };
  }

  if (platform === "tiktok") {
    const tiktokUrlResult = await buildTikTokMediaUrl({
      mediaPath: post.media_storage_path,
      principalId: post.principal_id,
    });
    if (!tiktokUrlResult.success) {
      return { success: false, message: tiktokUrlResult.message };
    }
    return {
      success: true,
      message: `tiktok ${tiktokUrlResult.mode} url minted`,
      mediaUrl: null,
      tiktokMediaUrl: tiktokUrlResult.url,
    };
  }

  const signed = await getServerSignedViewUrl(
    post.media_storage_path,
    RUNTIME.signedUrlTtlS,
  );
  if (!signed.success) {
    return {
      success: false,
      message: signed.message ?? "Failed to mint signed URL",
    };
  }
  return {
    success: true,
    message: "signed url minted",
    mediaUrl: signed.url ?? null,
    tiktokMediaUrl: null,
  };
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

export type CallPlatformResult = PlatformPostOutcome;

const PRIVACY_LEVELS = {
  PUBLIC_TO_EVERYONE: "PUBLIC_TO_EVERYONE",
  MUTUAL_FOLLOW_FRIENDS: "MUTUAL_FOLLOW_FRIENDS",
  FOLLOWER_OF_CREATOR: "FOLLOWER_OF_CREATOR",
  SELF_ONLY: "SELF_ONLY",
  PUBLIC: "PUBLIC",
  PROTECTED: "PROTECTED",
} as const satisfies { [Level in PrivacyLevel]: Level };

const PostOptionsSchema = z.object({
  link: z.string().nullish(),
  board: z.string().nullish(),
  boardName: z.string().nullish(),
  privacyLevel: z.enum(PRIVACY_LEVELS).nullish(),
  visibility: z.string().nullish(),
  disableComment: z.boolean().nullish(),
  disableDuet: z.boolean().nullish(),
  disableStitch: z.boolean().nullish(),
  brandContentToggle: z.boolean().nullish(),
  yourBrand: z.boolean().nullish(),
  brandedContent: z.boolean().nullish(),
  isAigc: z.boolean().nullish(),
  privacyStatus: z.enum(["public", "unlisted", "private"]).nullish(),
});

export async function callPlatformDirectPost(args: {
  post: ScheduledPost;
  account: SocialAccount;
  mediaUrl: string | null;
  tiktokMediaUrl: string | null;
  fileName: string;
  mediaType: string;
}): Promise<CallPlatformResult> {
  const { post, account, mediaUrl, tiktokMediaUrl, fileName, mediaType } = args;

  const createdVia = post.created_via ?? "web";

  const platform = post.platform;
  if (!isSchedulablePlatform(platform)) {
    return {
      ok: false,
      reason: "invalid_input",
      message: `Unsupported platform: ${platform}`,
    };
  }

  const parsedOptions = PostOptionsSchema.safeParse(post.post_options ?? {});
  if (!parsedOptions.success) {
    const invalidKeys = parsedOptions.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    return {
      ok: false,
      reason: "invalid_input",
      message: `Malformed post_options: ${invalidKeys}`,
    };
  }
  const options = parsedOptions.data;
  const accountContent = {
    accountId: account.id,
    title: post.post_title ?? "",
    description: post.post_description ?? "",
    link: options.link ?? "",
    isCustomized: true,
  };

  const platformOptions: PlatformOptions = {
    pinterest: {
      privacyLevel: options.privacyLevel ?? "PUBLIC",
      board: options.board ?? "",
      link: options.link ?? "",
    },
    linkedin: {
      visibility: options.visibility ?? "PUBLIC",
    },
    tiktok: {
      privacyLevel: options.privacyLevel ?? undefined,
      disableComment: options.disableComment ?? false,
      disableDuet: options.disableDuet ?? false,
      disableStitch: options.disableStitch ?? false,
      brandContentToggle: options.brandContentToggle ?? undefined,
      yourBrand: options.yourBrand ?? undefined,
      brandedContent: options.brandedContent ?? undefined,
      isAigc: options.isAigc ?? undefined,
    },
    youtube: {
      privacyStatus: options.privacyStatus ?? "public",
    },
  };

  const batchId = post.batch_id ?? post.id;

  try {
    let result: { success: boolean; count: number; message?: string };

    switch (platform) {
      case "pinterest": {
        if (!options.board) {
          return {
            ok: false,
            reason: "invalid_input",
            message: "No board configured in post_options",
          };
        }
        result = await directPostForPinterestAccounts({
          account,
          mediaPath: post.media_storage_path,
          coverTimestamp: post.cover_image_timestamp ?? 1000,
          boards: {
            boardID: options.board,
            boardName: options.boardName ?? "Board",
            accountId: account.id,
            isSelected: true,
          },
          platformOptions,
          accountContent,
          userId: post.principal_id,
          fileName,
          batchId,
          mediaType,
          postType: post.media_type,
          mediaUrl: mediaUrl ?? "",
          scheduledPostId: post.id,
          createdVia,
        });
        break;
      }
      case "linkedin": {
        result = await directPostForLinkedInAccounts({
          account,
          mediaPath: post.media_storage_path,
          coverTimestamp: post.cover_image_timestamp ?? undefined,
          mediaType,
          platformOptions,
          accountContent,
          userId: post.principal_id,
          fileName,
          batchId,
          postType: post.media_type,
          isCronJob: true,
          scheduledPostId: post.id,
          createdVia,
        });
        break;
      }
      case "tiktok": {
        result = await directPostForTikTokAccounts({
          account,
          mediaPath: post.media_storage_path,
          coverTimestamp: post.cover_image_timestamp ?? 1000,
          tiktokMediaUrl: tiktokMediaUrl ?? "",
          mediaType,
          platformOptions,
          accountContent,
          userId: post.principal_id,
          postType: post.media_type,
          fileName,
          batchId,
          scheduledPostId: post.id,
          createdVia,
        });
        break;
      }
      case "instagram": {
        if (post.media_type === "text") {
          return {
            ok: false,
            reason: "invalid_input",
            message: "Instagram does not support text posts",
          };
        }
        result = await directPostForInstagramAccounts({
          account,
          mediaPath: post.media_storage_path,
          coverTimestamp: post.cover_image_timestamp ?? 1000,
          mediaType,
          accountContent,
          userId: post.principal_id,
          mediaUrl: mediaUrl ?? "",
          postType: post.media_type,
          fileName,
          batchId,
          scheduledPostId: post.id,
          createdVia,
        });
        break;
      }
      case "youtube": {
        result = await directPostForYouTubeAccounts({
          account,
          mediaPath: post.media_storage_path,
          mediaType,
          platformOptions,
          accountContent,
          userId: post.principal_id,
          batchId,
          postType: post.media_type,
          scheduledPostId: post.id,
          createdVia,
        });
        break;
      }
      case "x": {
        result = await directPostForXAccounts({
          account,
          mediaPath: post.media_storage_path,
          mediaType,
          accountContent,
          userId: post.principal_id,
          batchId,
          postType: post.media_type,
          scheduledPostId: post.id,
          createdVia,
        });
        break;
      }
      case "facebook": {
        result = await directPostForFacebookAccounts({
          account,
          mediaPath: post.media_storage_path,
          accountContent,
          userId: post.principal_id,
          mediaUrl: mediaUrl ?? "",
          batchId,
          postType: post.media_type,
          scheduledPostId: post.id,
          createdVia,
        });
        break;
      }
      default: {
        result = await publishViaRegistry({
          account,
          principalId: post.principal_id,
          title: post.post_title,
          body: post.post_description,
          mediaType: post.media_type,
          mediaUrl,
          fileName,
          mediaMimeType: mediaType,
          options: post.post_options,
          batchId: post.batch_id ?? post.id,
          scheduledPostId: post.id,
          createdVia: post.created_via ?? "web",
        });
        break;
      }
    }

    if (result.success && result.count > 0) {
      return {
        ok: true,
        contentId: post.id,
        mediaUrl: mediaUrl ?? null,
      };
    }

    const reason = classifyDirectPostFailure(platform, result.message);
    return {
      ok: false,
      reason,
      message: result.message ?? "Failed without message",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason: PlatformErrorReason = classifyDirectPostFailure(
      platform,
      message,
    );
    return { ok: false, reason, message };
  }
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
    batch_id: post.batch_id ?? post.id,
    idempotency_key: post.idempotency_key,
    x402_charge_id: post.x402_charge_id,
    extra_data: {
      reason: result.reason,
      message: result.message,
      timestamp: nowIso,
    },
    created_via: post.created_via ?? "web",
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
  if (!mediaPath || mediaPath === "") {
    return { success: true, message: "no media to clean", deleted: false };
  }
  try {
    const result = await deleteSupabaseFile(principalId, mediaPath, false);
    return {
      success: true,
      message: result.success
        ? `cleanup done for ${mediaPath}`
        : `cleanup skipped: ${result.message}`,
      deleted: result.success,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[processSinglePost] cleanup error: ${message}`);
    return {
      success: true,
      message: `cleanup error (non-blocking): ${message}`,
      deleted: false,
    };
  }
}
