import "server-only";

import { and, eq } from "drizzle-orm";

import { getServerSignedViewUrl } from "@/actions/server/data/getServerSignedViewUrl";
import {
  describeAccountMismatch,
  loadOwnedAccountPlatforms,
} from "@/actions/server/data/loadOwnedAccountPlatforms";
import { resolvePlatformTextLimit } from "@/components/core/create/constants/captionLimits";
import { db, runQuery } from "@/db/client";
import { pending_direct_posts } from "@/db/schema";
import type { CreatedVia, MediaType, Platform } from "@/db/schema";
import { dispatchPostNowEvents } from "@/inngest/dispatch/dispatchPostNowEvents";
import type { PostNowEventData } from "@/inngest/functions/processDirectPostHelpers";
import { buildProxiedTikTokMediaUrl } from "@/lib/api/tiktok/buildProxiedTikTokMediaUrl";
import type { PlatformOptions } from "@/lib/types/dbTypes";
import type { PostBatchFailure, PostRejection } from "@/lib/types/postBatch";
import type { PreflightResult } from "@/lib/types/preflight";
import { deriveMediaMimeType } from "@/lib/utils/deriveMediaMimeType";
import { generateBatchId } from "@/lib/utils/generateBatchId";
import { randomUUID } from "node:crypto";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

const MAX_BATCH_SIZE = 30;
const RATE_LIMIT = 20;
const RATE_WINDOW_SECONDS = 60;

export type DirectPostData = {
  socialAccountId: string;
  platform: Platform;
  postType: MediaType;
  title?: string | null;
  description: string | null;
  mediaStoragePath: string;
  coverTimestamp?: number;
  platformOptions?: PlatformOptions;
  pinterestBoardId?: string;
  pinterestBoardName?: string;
  pinterestLink?: string;
  idempotency_key?: string;
  /** Registry-provider per-post options; null/absent for legacy platforms. */
  postOptions?: Record<string, unknown> | null;
};

/**
 * A failed batch carries `failure` (see PostBatchFailure) so each caller can
 * answer in its own terms; `message` is safe to show and never carries a
 * database error.
 */
export type DirectPostBatchResult = {
  message: string;
  batchId: string;
  resetIn?: number;
  details: {
    total: number;
    dispatched: number;
    duplicates: number;
    rejected: PostRejection[];
  };
  eventIds: string[];
} & ({ success: true } | { success: false; failure: PostBatchFailure });

/**
 * Dispatches N direct-post events in a single batch. Shared core for
 * web/MCP/x402.
 *
 * **Authentication:** Does not call Clerk. Caller validates `principalId`.
 * **Rate limiting:** 20 calls per 60s per source.
 * **Tables:** social_accounts (ownership + platform match), pending_direct_posts (locks).
 * **Inngest events:** post.now per accepted post.
 *
 * Flow:
 *   1. Size + per-post validation (Pinterest fields, caption length, media presence)
 *   2. Rate limit
 *   3. Ownership + platform match (1 query, IN(...))
 *   4. Mint URLs cached by media path
 *   5. Build PostNowEventData per post
 *   6. Idempotency keys derive from batch_id when agent supplies it
 *   7. dispatchPostNowEvents (lock insert + inngest.send)
 *
 * Single post = batch with N=1. Same code path.
 */
export async function directPostBatch(
  posts: DirectPostData[],
  principalId: string,
  source: CreatedVia,
  agentSuppliedBatchId?: string,
  requestId?: string | null,
): Promise<DirectPostBatchResult> {
  const batchId = agentSuppliedBatchId ?? generateBatchId();
  const useAgentBatchId = Boolean(agentSuppliedBatchId);

  console.log(
    `[directPostBatch] [req=${requestId ?? "?"}] Starting from source="${source}" for principal=${principalId}, ${posts?.length ?? 0} post(s), batchId=${batchId}`,
  );

  const emptyDetails = {
    total: 0,
    dispatched: 0,
    duplicates: 0,
    rejected: [] as PostRejection[],
  };

  try {
    // Step 0: shape checks
    if (!posts || posts.length === 0) {
      return {
        success: false,
        failure: "invalid_request",
        message: "No posts provided.",
        batchId,
        details: emptyDetails,
        eventIds: [],
      };
    }
    if (posts.length > MAX_BATCH_SIZE) {
      return {
        success: false,
        failure: "invalid_request",
        message: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} posts.`,
        batchId,
        details: { ...emptyDetails, total: posts.length },
        eventIds: [],
      };
    }

    // Step 1: rate limit. A limiter that could not answer is not the
    // caller's doing, so it is not reported as "too many requests".
    const rateCheck = await checkRateLimit(
      `${source}_direct_post_batch`,
      principalId,
      RATE_LIMIT,
      RATE_WINDOW_SECONDS,
    );
    if (!rateCheck.success) {
      return {
        success: false,
        failure: rateCheck.reason === "limited" ? "rate_limited" : "unavailable",
        message: rateCheck.message,
        batchId,
        resetIn: rateCheck.resetIn,
        details: { ...emptyDetails, total: posts.length },
        eventIds: [],
      };
    }

    // Step 2: per-post validation, partial success
    const rejected: PostRejection[] = [];
    const validPosts: DirectPostData[] = [];

    for (const post of posts) {
      const validationError = validatePostFields(post, principalId);
      if (validationError) {
        rejected.push({
          socialAccountId: post.socialAccountId ?? "unknown",
          code: "invalid_input",
          reason: validationError,
        });
        continue;
      }
      validPosts.push(post);
    }

    if (validPosts.length === 0) {
      return {
        success: false,
        failure: "rejected",
        message: "All posts failed validation.",
        batchId,
        details: {
          total: posts.length,
          dispatched: 0,
          duplicates: 0,
          rejected,
        },
        eventIds: [],
      };
    }

    // Step 3: ownership + platform match
    const ownership = await loadOwnedAccountPlatforms(
      validPosts.map((post) => post.socialAccountId),
      principalId,
    );
    if (!ownership.success) {
      console.error(
        `[directPostBatch] [req=${requestId ?? "?"}] ${ownership.message}`,
      );
      return {
        success: false,
        failure: "unavailable",
        message: "Could not check account ownership. Please try again.",
        batchId,
        details: {
          total: posts.length,
          dispatched: 0,
          duplicates: 0,
          rejected,
        },
        eventIds: [],
      };
    }

    const ownedPosts: DirectPostData[] = [];
    for (const post of validPosts) {
      const mismatch = describeAccountMismatch(ownership.platformByAccountId, post);
      if (mismatch) {
        rejected.push(mismatch);
      } else {
        ownedPosts.push(post);
      }
    }

    if (ownedPosts.length === 0) {
      return {
        success: false,
        failure: "rejected",
        message: "No posts owned by the principal.",
        batchId,
        details: {
          total: posts.length,
          dispatched: 0,
          duplicates: 0,
          rejected,
        },
        eventIds: [],
      };
    }

    // Step 4: mint URLs cached by media path
    const urlResult = await buildMediaUrlsCached(ownedPosts, principalId);
    if (!urlResult.success) {
      console.error(
        `[directPostBatch] [req=${requestId ?? "?"}] ${urlResult.message}`,
      );
      return {
        success: false,
        failure: "internal",
        message: "Could not prepare the media for publishing. Please try again.",
        batchId,
        details: {
          total: posts.length,
          dispatched: 0,
          duplicates: 0,
          rejected,
        },
        eventIds: [],
      };
    }

    // Step 5: build events
    const events = buildEventPayloads(
      ownedPosts,
      batchId,
      urlResult.signedByPath,
      urlResult.tiktokByPath,
      principalId,
      source,
      useAgentBatchId,
      requestId,
    );

    // Step 6: lock + dispatch
    const dispatch = await dispatchPostNowEvents(events);
    if (!dispatch.success) {
      console.error(
        `[directPostBatch] [req=${requestId ?? "?"}] Dispatch failed (${dispatch.phase}):`,
        dispatch.message,
      );
      return {
        success: false,
        failure: "internal",
        message: "Could not dispatch the post. Please try again.",
        batchId,
        details: {
          total: posts.length,
          dispatched: 0,
          duplicates: 0,
          rejected,
        },
        eventIds: [],
      };
    }

    const duplicates = events.length - dispatch.freshCount;

    return {
      success: true,
      message: `Dispatched ${dispatch.freshCount} post(s)${duplicates > 0 ? `, ${duplicates} already existed (idempotent retry)` : ""}.`,
      batchId,
      details: {
        total: posts.length,
        dispatched: dispatch.freshCount,
        duplicates,
        rejected,
      },
      eventIds: dispatch.eventIds,
    };
  } catch (err) {
    console.error(
      `[directPostBatch] [req=${requestId ?? "?"}] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      failure: "internal",
      message: "Unexpected error dispatching posts.",
      batchId,
      details: emptyDetails,
      eventIds: [],
    };
  }
}

/**
 * Pre-payment check for one post: the field, media-path, ownership and
 * platform rules directPostBatch applies, plus a duplicate idempotency key,
 * without the rate limit or the dispatch. A paid caller (x402 post-now) runs
 * it before settlement so a post that cannot be dispatched costs nothing.
 * directPostBatch still enforces the same rules when it runs.
 */
export async function preflightDirectPost(
  post: DirectPostData,
  principalId: string,
): Promise<PreflightResult> {
  const validationError = validatePostFields(post, principalId);
  if (validationError) {
    return { ok: false, httpStatus: 400, errorKind: "validation_error", message: validationError };
  }

  const ownership = await loadOwnedAccountPlatforms([post.socialAccountId], principalId);
  if (!ownership.success) {
    return { ok: false, httpStatus: 500, errorKind: "precheck_failed", message: ownership.message };
  }
  const accountPlatform = ownership.platformByAccountId.get(post.socialAccountId);
  if (!accountPlatform) {
    return {
      ok: false,
      httpStatus: 403,
      errorKind: "account_not_owned",
      message: "This social account does not belong to the paying wallet.",
    };
  }
  if (accountPlatform !== post.platform) {
    return {
      ok: false,
      httpStatus: 400,
      errorKind: "platform_mismatch",
      message: `Account platform is ${accountPlatform}, post declared ${post.platform}.`,
    };
  }

  // dispatchPostNowEvents skips an already-used key and reports success, so a
  // paid retry with the same key would be charged for a post it never gets.
  if (post.idempotency_key) {
    const { data: existingLocks, error: lockLookupError } = await runQuery(
      db
        .select({ event_id: pending_direct_posts.event_id })
        .from(pending_direct_posts)
        .where(
          and(
            eq(pending_direct_posts.principal_id, principalId),
            eq(pending_direct_posts.idempotency_key, post.idempotency_key),
          ),
        )
        .limit(1),
    );
    if (lockLookupError) {
      return {
        ok: false,
        httpStatus: 500,
        errorKind: "precheck_failed",
        message: `Idempotency lookup failed: ${lockLookupError.message}`,
      };
    }
    if (existingLocks.length > 0) {
      return {
        ok: false,
        httpStatus: 409,
        errorKind: "duplicate_idempotency_key",
        message: "A post with this idempotency_key was already dispatched.",
      };
    }
  }

  return { ok: true };
}

// ---------- helpers ----------

/** Returns null if valid, error message if invalid. */
function validatePostFields(
  post: DirectPostData,
  principalId: string,
): string | null {
  if (!post.socialAccountId || !post.platform || !post.postType) {
    return "Missing required fields (socialAccountId, platform, postType).";
  }
  if (post.postType !== "text" && !post.mediaStoragePath) {
    return `Media file is required for ${post.postType} posts.`;
  }

  // Vuln 1 fix: prevent cross-user media file reference.
  if (
    post.mediaStoragePath &&
    !post.mediaStoragePath.startsWith(`${principalId}/`)
  ) {
    return "Media path is not owned by the calling principal.";
  }
  // Pinterest rules
  if (post.platform === "pinterest" && !post.pinterestBoardId) {
    return "Pinterest posts require pinterestBoardId.";
  }
  if (
    post.platform !== "pinterest" &&
    (post.pinterestBoardId || post.pinterestLink)
  ) {
    return "Pinterest-specific fields are only valid when platform='pinterest'.";
  }

  // Caption length. Registry platforms answer from their catalog rules; the
  // legacy map alone gave every one of them the 2200 default.
  if (post.description) {
    const limit = resolvePlatformTextLimit(post.platform);
    if (post.description.length > limit) {
      return `Caption exceeds ${post.platform} limit of ${limit} chars (got ${post.description.length}).`;
    }
  }

  return null;
}

async function buildMediaUrlsCached(
  posts: DirectPostData[],
  principalId: string,
): Promise<
  | {
      success: true;
      signedByPath: Map<string, string>;
      tiktokByPath: Map<string, string>;
    }
  | { success: false; message: string }
> {
  const signedPaths = new Set<string>();
  const tiktokPaths = new Set<string>();

  for (const post of posts) {
    if (!post.mediaStoragePath) continue;
    if (post.platform === "tiktok") tiktokPaths.add(post.mediaStoragePath);
    else signedPaths.add(post.mediaStoragePath);
  }

  const signedByPath = new Map<string, string>();
  const tiktokByPath = new Map<string, string>();

  for (const path of signedPaths) {
    const result = await getServerSignedViewUrl(path);
    if (!result.success) {
      return {
        success: false,
        message: `Failed to mint signed URL for ${path}: ${result.message}`,
      };
    }
    signedByPath.set(path, result.url);
  }

  for (const path of tiktokPaths) {
    const result = buildProxiedTikTokMediaUrl({
      mediaPath: path,
      principalId,
    });
    if (!result.success) {
      return {
        success: false,
        message: `Failed to build TikTok URL for ${path}: ${result.message}`,
      };
    }
    tiktokByPath.set(path, result.url);
  }

  return { success: true, signedByPath, tiktokByPath };
}

function buildEventPayloads(
  posts: DirectPostData[],
  batchId: string,
  signedByPath: Map<string, string>,
  tiktokByPath: Map<string, string>,
  principalId: string,
  source: CreatedVia,
  useAgentBatchIdForIdempotency: boolean,
  requestId?: string | null,
): { name: "post.now"; data: PostNowEventData }[] {
  return posts.map((post, index) => {
    const fileName = post.mediaStoragePath
      ? (post.mediaStoragePath.split("/").pop() ?? "")
      : "";
    const mediaType = deriveMediaMimeType(fileName, post.postType);

    const platformOptions: PlatformOptions = post.platformOptions ?? {
      tiktok: {
        privacyLevel: "PUBLIC_TO_EVERYONE",
        disableComment: false,
        disableDuet: false,
        disableStitch: false,
      },
      pinterest: {
        privacyLevel: "PUBLIC",
        board: post.pinterestBoardId ?? "",
        link: post.pinterestLink ?? "",
      },
      linkedin: { visibility: "PUBLIC" },
    };

    const board: PostNowEventData["board"] =
      post.platform === "pinterest"
        ? {
            boardID: post.pinterestBoardId ?? "",
            boardName: post.pinterestBoardName ?? "Board",
            accountId: post.socialAccountId,
            isSelected: true,
          }
        : null;

    const mediaUrl =
      post.platform !== "tiktok" && post.mediaStoragePath
        ? (signedByPath.get(post.mediaStoragePath) ?? null)
        : null;
    const tiktokMediaUrl =
      post.platform === "tiktok" && post.mediaStoragePath
        ? (tiktokByPath.get(post.mediaStoragePath) ?? null)
        : null;

    const data: PostNowEventData = {
      batch_id: batchId,
      principal_id: principalId,
      social_account_id: post.socialAccountId,
      platform: post.platform,
      post_type: post.postType,
      account_content: {
        accountId: post.socialAccountId,
        title: post.title ?? "",
        description: post.description ?? "",
        link: post.pinterestLink ?? "",
        isCustomized: true,
      },
      platform_options: platformOptions,
      board,
      cover_timestamp: post.coverTimestamp ?? 1000,
      file_name: fileName,
      media_type: mediaType,
      media_path: post.mediaStoragePath,
      media_url: mediaUrl,
      tiktok_media_url: tiktokMediaUrl,
      dispatch_id: randomUUID(),
      created_via: source,
      idempotency_key:
        post.idempotency_key ??
        (useAgentBatchIdForIdempotency ? `${batchId}:${index}` : undefined),
      request_id: requestId ?? null,
      post_options: post.postOptions ?? null,
    };

    return { name: "post.now" as const, data };
  });
}
