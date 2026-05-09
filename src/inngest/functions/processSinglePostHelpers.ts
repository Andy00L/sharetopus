import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { getSignedViewUrl } from "@/actions/client/getSignedViewUrl";
import { buildTikTokMediaUrl } from "@/lib/api/tiktok/buildTikTokMediaUrl";
import { deleteSupabaseFileActionInternal } from "@/actions/server/_internal/data/deleteSupabaseFileAction";
import { storeFailedPost } from "@/actions/server/contentHistoryActions/storeFailedPost";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import type {
  Platform,
  PostStatus,
  ScheduledPost,
  SocialAccount,
} from "@/lib/types/database.types";
import {
  classifyDirectPostFailure,
  type PlatformErrorReason,
  type PlatformPostOutcome,
} from "./platformErrors";
import { directPostForPinterestAccounts } from "@/lib/api/pinterest/post/directPostForPinterestAccounts";
import { directPostForLinkedInAccounts } from "@/lib/api/linkedin/post/directPostForLinkedInAccounts";
import { directPostForTikTokAccounts } from "@/lib/api/tiktok/post/directPostForTikTokAccounts";
import { directPostForInstagramAccounts } from "@/lib/api/instagram/post/directPostForInstagramAccounts";
import type { PlatformOptions, PrivacyLevel } from "@/lib/types/dbTypes";

// ---------- fetch-post-and-account ----------

export type FetchPostResult =
  | {
      success: true;
      message: string;
      skip: false;
      post: ScheduledPost;
      account: SocialAccount;
    }
  | { success: true; message: string; skip: true }
  | { success: false; message: string };

/**
 * Returns skip:true if the row no longer exists or its status is
 * terminal (posted/failed/cancelled), so a re-invocation is a no-op.
 */
export async function fetchPostAndAccount(
  scheduledPostId: string
): Promise<FetchPostResult> {
  const { data: post, error: postErr } = await adminSupabase
    .from("scheduled_posts")
    .select("*")
    .eq("id", scheduledPostId)
    .single();

  if (postErr) {
    if (postErr.code === "PGRST116") {
      return { success: true, message: "post not found", skip: true };
    }
    return {
      success: false,
      message: `Failed to fetch post: ${postErr.message}`,
    };
  }
  if (!post) {
    return { success: true, message: "post not found", skip: true };
  }

  const terminalStates: PostStatus[] = ["posted", "failed", "cancelled"];
  if (terminalStates.includes(post.status as PostStatus)) {
    return {
      success: true,
      message: `post already ${post.status}`,
      skip: true,
    };
  }

  const { data: account, error: accErr } = await adminSupabase
    .from("social_accounts")
    .select("*")
    .eq("id", post.social_account_id)
    .is("deleted_at", null)
    .single();

  if (accErr) {
    if (accErr.code === "PGRST116") {
      return {
        success: false,
        message: "Social account not found or deleted",
      };
    }
    return {
      success: false,
      message: `Failed to fetch account: ${accErr.message}`,
    };
  }
  if (!account) {
    return {
      success: false,
      message: "Social account not found or deleted",
    };
  }

  return {
    success: true,
    message: "fetched",
    skip: false,
    post: post as ScheduledPost,
    account: account as SocialAccount,
  };
}

// ---------- claim-post ----------

export type ClaimResult = {
  success: true;
  message: string;
  claimed: boolean;
};

/**
 * UPDATE ... SET status='processing' WHERE id=? AND status IN
 * ('scheduled','queued'). Zero rows updated means another worker
 * took it OR the row already moved on; return claimed=false.
 */
export async function claimPostForProcessing(
  scheduledPostId: string
): Promise<ClaimResult> {
  const { data, error } = await adminSupabase
    .from("scheduled_posts")
    .update({
      status: "processing" satisfies PostStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", scheduledPostId)
    .in("status", ["scheduled", "queued"] satisfies PostStatus[])
    .select("id");

  if (error) {
    console.error("[processSinglePost] claim failed:", error.message);
    return {
      success: true,
      message: `claim error: ${error.message}`,
      claimed: false,
    };
  }
  return {
    success: true,
    message: data && data.length > 0 ? "claimed" : "not claimed",
    claimed: !!(data && data.length > 0),
  };
}

// ---------- build-signed-urls ----------

export type SignedUrlsResult =
  | {
      success: true;
      message: string;
      mediaUrl: string | null;
      tiktokMediaUrl: string | null;
    }
  | { success: false; message: string };

/**
 * Mirrors handleSocialMediaPost URL-minting logic:
 *   - Pinterest/LinkedIn/Instagram: getSignedViewUrl (Supabase 5 min)
 *   - TikTok: buildTikTokMediaUrl (proxy or supabase_direct per env)
 * For text posts (no media_storage_path) both are null.
 */
export async function buildPlatformSignedUrls(
  post: ScheduledPost,
  platform: Platform
): Promise<SignedUrlsResult> {
  if (!post.media_storage_path || post.media_storage_path === "") {
    return {
      success: true,
      message: "no media",
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

  const signed = await getSignedViewUrl(
    post.media_storage_path,
    post.principal_id,
    RUNTIME.signedUrlTtlS
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

// ---------- platform compatibility check ----------

export type CompatibilityResult = {
  success: true;
  message: string;
  compatible: boolean;
  reason: string;
};

/**
 * Per-platform post-type rules from the existing process* code:
 *   - pinterest: image | video. Text rejected.
 *   - instagram: image | video. Text rejected.
 *   - tiktok: image | video. Text rejected.
 *   - linkedin: text | image | video. All accepted.
 * If incompatible, the worker records it as invalid_input (terminal).
 */
export function checkPlatformCompatibility(
  platform: Platform,
  mediaType: ScheduledPost["media_type"]
): CompatibilityResult {
  if (platform === "pinterest" && mediaType === "text") {
    return {
      success: true,
      message: "incompatible",
      compatible: false,
      reason: "Pinterest does not support text-only posts",
    };
  }
  if (platform === "instagram" && mediaType === "text") {
    return {
      success: true,
      message: "incompatible",
      compatible: false,
      reason: "Instagram does not support text-only posts",
    };
  }
  if (platform === "tiktok" && mediaType === "text") {
    return {
      success: true,
      message: "incompatible",
      compatible: false,
      reason: "TikTok does not support text-only posts",
    };
  }
  return {
    success: true,
    message: "compatible",
    compatible: true,
    reason: "",
  };
}

// ---------- call platform direct-post function ----------

export type CallPlatformResult = PlatformPostOutcome;

type PostOptions = {
  link?: string;
  board?: string;
  boardName?: string;
  privacyLevel?: string;
  visibility?: string;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
};

/**
 * Dispatches to the right per-account direct-post function based on
 * platform. Failed-post recording is centralized in recordPostStatus;
 * the directPostFor functions no longer write to failed_posts.
 * LinkedIn still receives isCronJob:true to skip rate limiting.
 */
export async function callPlatformDirectPost(args: {
  post: ScheduledPost;
  account: SocialAccount;
  mediaUrl: string | null;
  tiktokMediaUrl: string | null;
  fileName: string;
  mediaType: string;
}): Promise<CallPlatformResult> {
  const { post, account, mediaUrl, tiktokMediaUrl, fileName, mediaType } =
    args;

  const options = (post.post_options ?? {}) as PostOptions;
  const accountContent = {
    accountId: account.id,
    title: post.post_title ?? "",
    description: post.post_description ?? "",
    link: options.link ?? "",
    isCustomized: true,
  };

  // Platform options shape mirrors handleSocialMediaPost
  const platformOptions: PlatformOptions = {
    pinterest: {
      privacyLevel: (options.privacyLevel ?? "PUBLIC") as PrivacyLevel,
      board: options.board ?? "",
      link: options.link ?? "",
    },
    linkedin: {
      visibility: options.visibility ?? "PUBLIC",
    },
    tiktok: {
      privacyLevel: (options.privacyLevel ??
        "PUBLIC_TO_EVERYONE") as PrivacyLevel,
      disableComment: options.disableComment ?? false,
      disableDuet: options.disableDuet ?? false,
      disableStitch: options.disableStitch ?? false,
    },
  };

  const batchId = post.batch_id ?? post.id;

  try {
    let result: { success: boolean; count: number; message?: string };

    switch (post.platform as Platform) {
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
          coverTimestamp: post.cover_image_timestamp ?? 0,
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
        });
        break;
      }
      case "tiktok": {
        result = await directPostForTikTokAccounts({
          account,
          mediaPath: post.media_storage_path,
          coverTimestamp: post.cover_image_timestamp ?? 0,
          tiktokMediaUrl: tiktokMediaUrl ?? "",
          mediaType,
          platformOptions,
          accountContent,
          userId: post.principal_id,
          postType: post.media_type,
          fileName,
          batchId,
          scheduledPostId: post.id,
        });
        break;
      }
      case "instagram": {
        // Instagram postType is "image" | "video" (never "text";
        // compatibility check rejects text before this point).
        const igPostType = post.media_type as "image" | "video";
        result = await directPostForInstagramAccounts({
          account,
          mediaPath: post.media_storage_path,
          coverTimestamp: post.cover_image_timestamp ?? 0,
          mediaType,
          accountContent,
          userId: post.principal_id,
          mediaUrl: mediaUrl ?? "",
          postType: igPostType,
          fileName,
          batchId,
          scheduledPostId: post.id,
        });
        break;
      }
      default: {
        return {
          ok: false,
          reason: "invalid_input",
          message: `Unsupported platform: ${post.platform}`,
        };
      }
    }

    if (result.success && result.count > 0) {
      // The directPostFor functions write content_history themselves
      // via storeContentHistory. We do not duplicate that write here.
      return {
        ok: true,
        contentId: post.id,
        mediaUrl: mediaUrl ?? null,
      };
    }

    const reason = classifyDirectPostFailure(
      post.platform as Platform,
      result.message
    );
    return {
      ok: false,
      reason,
      message: result.message ?? "Failed without message",
    };
  } catch (err) {
    // Network / unexpected. Classify to drive retry decisions.
    const message = err instanceof Error ? err.message : String(err);
    const reason: PlatformErrorReason = classifyDirectPostFailure(
      post.platform as Platform,
      message
    );
    return { ok: false, reason, message };
  }
}

// ---------- record final status ----------

export type RecordStatusResult = {
  success: true;
  message: string;
  updated: boolean;
};

/**
 * Idempotent: only acts if the row is currently 'processing'.
 * Re-invocation after success is a no-op (row already posted/failed).
 *
 * For terminal failures, this function both UPDATEs the scheduled_posts
 * row to status='failed' AND INSERTs a failed_posts record via
 * storeFailedPost. The failed_posts INSERT only fires when the CAS
 * guard matches (row was 'processing'), preventing duplicate rows on
 * re-invocation. If the INSERT fails, the error is logged and the
 * function continues (the scheduled_posts update already succeeded).
 *
 * For success, content_history (with scheduled_post_id lineage) is
 * already written by the directPostFor function; this step marks the
 * scheduled_posts row as status='posted'. The row stays alive so the
 * FK on content_history.scheduled_post_id is not cascaded (ON DELETE
 * SET NULL). The Scheduled UI filters out 'posted' rows by default.
 */
export async function recordPostStatus(args: {
  post: ScheduledPost;
  account: SocialAccount;
  result: PlatformPostOutcome;
}): Promise<RecordStatusResult> {
  const { post, account, result } = args;
  const nowIso = new Date().toISOString();

  if (result.ok) {
    const { data, error } = await adminSupabase
      .from("scheduled_posts")
      .update({
        status: "posted" satisfies PostStatus,
        posted_at: nowIso,
        error_message: null,
        updated_at: nowIso,
      })
      .eq("id", post.id)
      .eq("status", "processing" satisfies PostStatus)
      .select("id");

    if (error) {
      console.error("[recordPostStatus] mark posted failed:", error.message);
      return {
        success: true,
        message: `mark-posted error: ${error.message}`,
        updated: false,
      };
    }
    return {
      success: true,
      message: data && data.length > 0 ? "marked posted" : "already moved on",
      updated: !!(data && data.length > 0),
    };
  }

  // Terminal failure path. Retryable failures throw upstream and
  // never reach this branch.
  const errorMessage = `${result.reason}: ${result.message}`.slice(0, 1000);

  const { data, error } = await adminSupabase
    .from("scheduled_posts")
    .update({
      status: "failed" satisfies PostStatus,
      error_message: errorMessage,
      updated_at: nowIso,
    })
    .eq("id", post.id)
    .eq("status", "processing" satisfies PostStatus)
    .select("id");

  if (error) {
    console.error("[recordPostStatus] mark failed failed:", error.message);
    return {
      success: true,
      message: `mark-failed error: ${error.message}`,
      updated: false,
    };
  }

  const wasUpdated = !!(data && data.length > 0);

  // Write a failed_posts row only when we actually transitioned the
  // row to 'failed'. The CAS guard prevents duplicate rows on
  // re-invocation (wasUpdated is false if the row already moved on).
  if (wasUpdated) {
    const storeResult = await storeFailedPost({
      principal_id: post.principal_id,
      social_account_id: post.social_account_id ?? account.id,
      platform: post.platform,
      post_title: post.post_title ?? null,
      post_description: post.post_description ?? null,
      post_options: (post.post_options ?? {}) as object,
      media_type: post.media_type as "image" | "video" | "text",
      media_storage_path: post.media_storage_path ?? "",
      coverTimestamp: post.cover_image_timestamp ?? undefined,
      batch_id: post.batch_id ?? post.id,
      extra_data: {
        reason: result.reason,
        message: result.message,
        timestamp: nowIso,
      },
    });

    if (!storeResult.success) {
      console.error(
        "[recordPostStatus] Failed to store failed post record:",
        storeResult.message
      );
      // Continue. The scheduled_posts UPDATE already succeeded;
      // losing the failed_posts row is non-fatal.
    }
  }

  return {
    success: true,
    message: wasUpdated ? "marked failed" : "already moved on",
    updated: wasUpdated,
  };
}

// ---------- cleanup storage ----------

export type CleanupResult = {
  success: true;
  message: string;
  deleted: boolean;
};

/**
 * Uses the internal delete helper (no auth checks needed in worker
 * context). Already idempotent. No-ops if other scheduled_posts or
 * failed_posts rows still reference the same path.
 */
export async function cleanupMediaIfUnreferenced(
  mediaPath: string,
  principalId: string
): Promise<CleanupResult> {
  if (!mediaPath || mediaPath === "") {
    return { success: true, message: "no media to clean", deleted: false };
  }
  try {
    const result = await deleteSupabaseFileActionInternal(
      principalId,
      mediaPath,
      false
    );
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
