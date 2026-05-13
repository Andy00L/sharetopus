import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { getServerSignedViewUrl } from "@/actions/server/data/getServerSignedViewUrl";
import {
  CAPTION_LIMITS,
  type CaptionPlatform,
} from "@/components/core/create/constants/captionLimits";
import { dispatchPostNowEvents } from "@/inngest/dispatch/dispatchPostNowEvents";
import type { PostNowEventData } from "@/inngest/functions/processDirectPostHelpers";
import { buildProxiedTikTokMediaUrl } from "@/lib/api/tiktok/buildProxiedTikTokMediaUrl";
import type {
  CreatedVia,
  MediaType,
  Platform,
} from "@/lib/types/database.types";
import type { PlatformOptions } from "@/lib/types/dbTypes";
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
};

export type DirectPostBatchResult = {
  success: boolean;
  message: string;
  batchId: string;
  resetIn?: number;
  details: {
    total: number;
    dispatched: number;
    duplicates: number;
    rejected: { socialAccountId: string; reason: string }[];
  };
  eventIds: string[];
};

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
): Promise<DirectPostBatchResult> {
  const batchId = agentSuppliedBatchId ?? generateBatchId();
  const useAgentBatchId = Boolean(agentSuppliedBatchId);

  console.log(
    `[directPostBatch] Starting from source="${source}" for principal=${principalId}, ${posts?.length ?? 0} post(s), batchId=${batchId}`,
  );

  const emptyDetails = {
    total: 0,
    dispatched: 0,
    duplicates: 0,
    rejected: [] as { socialAccountId: string; reason: string }[],
  };

  try {
    // Step 0: shape checks
    if (!posts || posts.length === 0) {
      return {
        success: false,
        message: "No posts provided.",
        batchId,
        details: emptyDetails,
        eventIds: [],
      };
    }
    if (posts.length > MAX_BATCH_SIZE) {
      return {
        success: false,
        message: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} posts.`,
        batchId,
        details: { ...emptyDetails, total: posts.length },
        eventIds: [],
      };
    }

    // Step 1: rate limit
    const rateCheck = await checkRateLimit(
      `${source}_direct_post_batch`,
      principalId,
      RATE_LIMIT,
      RATE_WINDOW_SECONDS,
    );
    if (!rateCheck.success) {
      return {
        success: false,
        message: "Too many post requests. Please try again later.",
        batchId,
        resetIn: rateCheck.resetIn,
        details: { ...emptyDetails, total: posts.length },
        eventIds: [],
      };
    }

    // Step 2: per-post validation, partial success
    const rejected: { socialAccountId: string; reason: string }[] = [];
    const validPosts: DirectPostData[] = [];

    for (const post of posts) {
      const error = validatePostFields(post);
      if (error) {
        rejected.push({
          socialAccountId: post.socialAccountId ?? "unknown",
          reason: error,
        });
        continue;
      }
      validPosts.push(post);
    }

    if (validPosts.length === 0) {
      return {
        success: false,
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
    const ownership = await checkOwnershipAndPlatformMatch(
      validPosts,
      principalId,
    );
    if (!ownership.success) {
      return {
        success: false,
        message: ownership.message,
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
      if (ownership.ownedIds.has(post.socialAccountId)) {
        const expectedPlatform = ownership.platformByAccountId.get(
          post.socialAccountId,
        );
        if (expectedPlatform && expectedPlatform !== post.platform) {
          rejected.push({
            socialAccountId: post.socialAccountId,
            reason: `Account platform is ${expectedPlatform}, post declared ${post.platform}.`,
          });
        } else {
          ownedPosts.push(post);
        }
      } else {
        rejected.push({
          socialAccountId: post.socialAccountId,
          reason: "You do not own this social account.",
        });
      }
    }

    if (ownedPosts.length === 0) {
      return {
        success: false,
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
      return {
        success: false,
        message: urlResult.message,
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
    );

    // Step 6: lock + dispatch
    const dispatch = await dispatchPostNowEvents(events);
    if (!dispatch.success) {
      console.error(
        `[directPostBatch] Dispatch failed (${dispatch.phase}):`,
        dispatch.message,
      );
      return {
        success: false,
        message: dispatch.message,
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
      `[directPostBatch] Unexpected error:`,
      err instanceof Error ? err.message : err,
    );
    return {
      success: false,
      message: "Unexpected error dispatching posts.",
      batchId,
      details: emptyDetails,
      eventIds: [],
    };
  }
}

// ---------- helpers ----------

/** Returns null if valid, error message if invalid. */
function validatePostFields(post: DirectPostData): string | null {
  if (!post.socialAccountId || !post.platform || !post.postType) {
    return "Missing required fields (socialAccountId, platform, postType).";
  }
  if (post.postType !== "text" && !post.mediaStoragePath) {
    return `Media file is required for ${post.postType} posts.`;
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

  // Caption length
  if (post.description) {
    const limit =
      CAPTION_LIMITS[post.platform as CaptionPlatform] ??
      CAPTION_LIMITS.default;
    if (post.description.length > limit) {
      return `Caption exceeds ${post.platform} limit of ${limit} chars (got ${post.description.length}).`;
    }
  }

  return null;
}

async function checkOwnershipAndPlatformMatch(
  posts: DirectPostData[],
  principalId: string,
): Promise<
  | {
      success: true;
      ownedIds: Set<string>;
      platformByAccountId: Map<string, string>;
    }
  | { success: false; message: string }
> {
  const uniqueIds = [...new Set(posts.map((p) => p.socialAccountId))];

  const { data, error } = await adminSupabase
    .from("social_accounts")
    .select("id, platform")
    .eq("principal_id", principalId)
    .is("deleted_at", null)
    .in("id", uniqueIds);

  if (error) {
    return {
      success: false,
      message: `Ownership check failed: ${error.message}`,
    };
  }

  const ownedIds = new Set((data ?? []).map((row) => row.id));
  const platformByAccountId = new Map<string, string>();
  for (const row of data ?? []) {
    platformByAccountId.set(row.id, row.platform);
  }

  return { success: true, ownedIds, platformByAccountId };
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
    };

    return { name: "post.now" as const, data };
  });
}
